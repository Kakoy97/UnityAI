"use strict";

const { cloneJson, createUnityQueryId } = require("../../utils/turnUtils");
const { QueryStore } = require("./queryStore");

const DEFAULT_TIMEOUT_MS = 60 * 1000;
const DEFAULT_MAX_TIMEOUT_MS = 5 * 60 * 1000;
const MIN_TIMEOUT_MS = 1000;

class QueryCoordinator {
  constructor(options) {
    const opts = options && typeof options === "object" ? options : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.defaultTimeoutMs = this.clampTimeout(
      opts.defaultTimeoutMs,
      DEFAULT_TIMEOUT_MS,
      DEFAULT_MAX_TIMEOUT_MS
    );
    this.maxTimeoutMs = this.toPositiveInt(
      opts.maxTimeoutMs,
      DEFAULT_MAX_TIMEOUT_MS
    );
    this.queryStore =
      opts.queryStore instanceof QueryStore ? opts.queryStore : new QueryStore();
    this.waitersByQueryId = new Map();
  }

  enqueueAndWait(options) {
    return this.enqueue(options).promise;
  }

  enqueue(options) {
    const input = options && typeof options === "object" ? options : {};
    const queryType = this.normalizeString(input.query_type || input.type);
    if (!queryType) {
      throw this.schemaError("query_type is required.");
    }

    const queryId = createUnityQueryId();
    const timeoutMs = this.clampTimeout(
      input.timeout_ms,
      this.defaultTimeoutMs,
      this.maxTimeoutMs
    );
    const nowMs = Date.now();

    const record = this.queryStore.create({
      query_id: queryId,
      query_type: queryType,
      request_id: this.normalizeString(input.request_id),
      thread_id: this.normalizeString(input.thread_id),
      turn_id: this.normalizeString(input.turn_id),
      timeout_ms: timeoutMs,
      payload:
        input.payload && typeof input.payload === "object"
          ? cloneJson(input.payload)
          : {},
      created_at_ms: nowMs,
    });
    if (!record) {
      throw this.internalError("Failed to enqueue Unity query.");
    }

    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const timeoutHandle = setTimeout(() => {
      this.handleQueryTimeout(queryId);
    }, timeoutMs);

    this.waitersByQueryId.set(queryId, {
      resolve: resolvePromise,
      reject: rejectPromise,
      timeoutHandle,
    });

    this.queryStore.sweep({ nowMs });
    return {
      ok: true,
      query_id: queryId,
      promise,
    };
  }

  pullQuery(body) {
    const source = body && typeof body === "object" ? body : {};
    const acceptedQueryTypes = this.normalizeAcceptedQueryTypes(
      source.accepted_query_types
    );
    const nowMs = Date.now();
    this.queryStore.sweep({ nowMs });
    const query = this.queryStore.pullNextPending({
      acceptedQueryTypes,
      nowMs,
    });

    if (!query) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          pending: false,
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        pending: true,
        query: this.buildPullQueryEnvelope(query),
      },
    };
  }

  reportQueryResult(body) {
    const parsed = this.parseReportBody(body);
    if (!parsed.ok) {
      return {
        statusCode: 400,
        body: {
          ok: false,
          error_code: "E_SCHEMA_INVALID",
          message: parsed.message,
        },
      };
    }

    const nowMs = Date.now();
    this.queryStore.sweep({ nowMs });

    const resultOk = this.resolveReportSuccess(parsed.result);
    const errorCode =
      this.normalizeString(parsed.result && parsed.result.error_code) ||
      (resultOk ? "" : "E_QUERY_FAILED");
    const errorMessage =
      this.normalizeString(
        parsed.result &&
          (parsed.result.error_message || parsed.result.message)
      ) ||
      (resultOk ? "" : "Unity query returned failed result.");

    const outcome = this.queryStore.markReported(parsed.query_id, parsed.result, {
      nowMs,
      resultOk,
      errorCode,
      errorMessage,
    });

    if (!outcome.ok) {
      return {
        statusCode: 404,
        body: {
          ok: false,
          error_code: "E_QUERY_NOT_FOUND",
          message: "query_id not found.",
          query_id: parsed.query_id,
        },
      };
    }

    if (!outcome.replay) {
      const waiter = this.waitersByQueryId.get(parsed.query_id);
      if (waiter) {
        clearTimeout(waiter.timeoutHandle);
        this.waitersByQueryId.delete(parsed.query_id);

        if (resultOk) {
          waiter.resolve(cloneJson(parsed.result));
        } else {
          waiter.reject({
            error_code: errorCode || "E_QUERY_FAILED",
            message: errorMessage || "Unity query failed.",
            query_id: parsed.query_id,
            query_type:
              outcome.query && outcome.query.query_type
                ? outcome.query.query_type
                : "",
            recoverable: true,
          });
        }
      }
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        accepted: true,
        replay: outcome.replay === true,
        query_id: parsed.query_id,
        status: outcome.query ? outcome.query.status : "",
      },
    };
  }

  getStats() {
    const counts =
      this.queryStore && typeof this.queryStore.getCounts === "function"
        ? this.queryStore.getCounts()
        : {
            total: 0,
            pending: 0,
            dispatched: 0,
            terminal: 0,
          };
    return {
      ...counts,
      waiters: this.waitersByQueryId.size,
      default_timeout_ms: this.defaultTimeoutMs,
      max_timeout_ms: this.maxTimeoutMs,
    };
  }

  handleQueryTimeout(queryId) {
    const normalizedQueryId = this.normalizeString(queryId);
    if (!normalizedQueryId) {
      return;
    }
    const waiter = this.waitersByQueryId.get(normalizedQueryId);
    if (!waiter) {
      return;
    }
    this.waitersByQueryId.delete(normalizedQueryId);

    const timeoutOutcome = this.queryStore.markTimedOut(normalizedQueryId, {
      nowMs: Date.now(),
      errorCode: "E_QUERY_TIMEOUT",
      errorMessage: "Unity query timed out before report was received.",
    });
    const query =
      timeoutOutcome && timeoutOutcome.query ? timeoutOutcome.query : null;

    waiter.reject({
      error_code: "E_QUERY_TIMEOUT",
      message: "Unity query timed out before report was received.",
      query_id: normalizedQueryId,
      query_type: query && query.query_type ? query.query_type : "",
      recoverable: true,
      suggestion:
        "Retry the read query and ensure Unity polling endpoint /unity/query/pull is healthy.",
    });
  }

  parseReportBody(body) {
    const source = body && typeof body === "object" ? body : {};
    const queryId = this.normalizeString(source.query_id);
    if (!queryId) {
      return {
        ok: false,
        message: "query_id is required.",
      };
    }

    let result = null;
    if (source.result && typeof source.result === "object") {
      result = cloneJson(source.result);
    } else if (source.response && typeof source.response === "object") {
      result = cloneJson(source.response);
    } else {
      result = cloneJson(source);
      delete result.query_id;
    }

    if (!result || typeof result !== "object") {
      return {
        ok: false,
        message: "result object is required.",
      };
    }

    return {
      ok: true,
      query_id: queryId,
      result,
    };
  }

  buildPullQueryEnvelope(query) {
    const item = query && typeof query === "object" ? query : {};
    return {
      query_id: this.normalizeString(item.query_id),
      query_type: this.normalizeString(item.query_type),
      request_id: this.normalizeString(item.request_id),
      thread_id: this.normalizeString(item.thread_id),
      turn_id: this.normalizeString(item.turn_id),
      timeout_ms: this.toPositiveInt(item.timeout_ms, this.defaultTimeoutMs),
      created_at:
        Number.isFinite(Number(item.created_at_ms)) && Number(item.created_at_ms) > 0
          ? new Date(Math.floor(Number(item.created_at_ms))).toISOString()
          : this.nowIso(),
      pull_count: this.toNonNegativeInt(item.pull_count, 0),
      payload:
        item.payload && typeof item.payload === "object"
          ? cloneJson(item.payload)
          : {},
    };
  }

  resolveReportSuccess(result) {
    const source = result && typeof result === "object" ? result : {};
    if (typeof source.ok === "boolean") {
      return source.ok;
    }
    if (typeof source.success === "boolean") {
      return source.success;
    }
    if (this.normalizeString(source.error_code)) {
      return false;
    }
    return true;
  }

  normalizeAcceptedQueryTypes(value) {
    if (!Array.isArray(value)) {
      return null;
    }
    const result = [];
    for (let i = 0; i < value.length; i += 1) {
      const queryType = this.normalizeString(value[i]);
      if (!queryType) {
        continue;
      }
      result.push(queryType);
    }
    return result;
  }

  schemaError(message) {
    const error = new Error(this.normalizeString(message) || "Schema invalid.");
    error.error_code = "E_SCHEMA_INVALID";
    return error;
  }

  internalError(message) {
    const error = new Error(this.normalizeString(message) || "Internal error.");
    error.error_code = "E_INTERNAL";
    return error;
  }

  normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  toPositiveInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return fallback;
    }
    return Math.floor(n);
  }

  toNonNegativeInt(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return fallback;
    }
    return Math.floor(n);
  }

  clampTimeout(value, fallback, max) {
    const raw = this.toPositiveInt(value, fallback);
    const limitedMax = this.toPositiveInt(max, DEFAULT_MAX_TIMEOUT_MS);
    const bounded = Math.min(raw, limitedMax);
    if (bounded < MIN_TIMEOUT_MS) {
      return MIN_TIMEOUT_MS;
    }
    return bounded;
  }
}

module.exports = {
  QueryCoordinator,
};


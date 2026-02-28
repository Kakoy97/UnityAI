"use strict";

const { cloneJson } = require("../../utils/turnUtils");

const DEFAULT_TERMINAL_RETENTION_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 2000;

class QueryStore {
  constructor(options) {
    const opts = options && typeof options === "object" ? options : {};
    this.terminalRetentionMs = this.toPositiveInt(
      opts.terminalRetentionMs,
      DEFAULT_TERMINAL_RETENTION_MS
    );
    this.maxEntries = this.toPositiveInt(opts.maxEntries, DEFAULT_MAX_ENTRIES);
    this.queriesById = new Map();
    this.pendingQueryIds = [];
  }

  create(query) {
    const item = query && typeof query === "object" ? query : null;
    if (!item) {
      return null;
    }
    const queryId = this.normalizeString(item.query_id);
    const queryType = this.normalizeString(item.query_type);
    if (!queryId || !queryType) {
      return null;
    }
    if (this.queriesById.has(queryId)) {
      return null;
    }

    const nowMs = this.toTimestamp(item.created_at_ms, Date.now());
    const record = {
      query_id: queryId,
      query_type: queryType,
      request_id: this.normalizeString(item.request_id),
      thread_id: this.normalizeString(item.thread_id),
      turn_id: this.normalizeString(item.turn_id),
      payload:
        item.payload && typeof item.payload === "object"
          ? cloneJson(item.payload)
          : {},
      timeout_ms: this.toPositiveInt(item.timeout_ms, 0),
      status: "pending",
      created_at_ms: nowMs,
      updated_at_ms: nowMs,
      dispatched_at_ms: 0,
      completed_at_ms: 0,
      pull_count: 0,
      report: null,
      error_code: "",
      error_message: "",
    };

    this.queriesById.set(queryId, record);
    this.pendingQueryIds.push(queryId);
    this.trimIfNeeded(nowMs);
    return cloneJson(record);
  }

  get(queryId) {
    const normalizedQueryId = this.normalizeString(queryId);
    if (!normalizedQueryId) {
      return null;
    }
    const item = this.queriesById.get(normalizedQueryId);
    return item ? cloneJson(item) : null;
  }

  pullNextPending(options) {
    const opts = options && typeof options === "object" ? options : {};
    const nowMs = this.toTimestamp(opts.nowMs, Date.now());
    const accepted = this.normalizeAcceptedTypes(opts.acceptedQueryTypes);

    for (let i = 0; i < this.pendingQueryIds.length; i += 1) {
      const queryId = this.pendingQueryIds[i];
      const item = this.queriesById.get(queryId);
      if (!item || item.status !== "pending") {
        this.pendingQueryIds.splice(i, 1);
        i -= 1;
        continue;
      }
      if (accepted && accepted.size > 0 && !accepted.has(item.query_type)) {
        continue;
      }

      this.pendingQueryIds.splice(i, 1);
      item.status = "dispatched";
      item.updated_at_ms = nowMs;
      item.dispatched_at_ms = nowMs;
      item.pull_count = this.toNonNegativeInt(item.pull_count, 0) + 1;
      return cloneJson(item);
    }

    return null;
  }

  markReported(queryId, reportPayload, options) {
    const normalizedQueryId = this.normalizeString(queryId);
    const item = this.queriesById.get(normalizedQueryId);
    if (!item) {
      return {
        ok: false,
        reason: "not_found",
      };
    }
    if (this.isTerminal(item.status)) {
      return {
        ok: true,
        replay: true,
        query: cloneJson(item),
      };
    }

    const opts = options && typeof options === "object" ? options : {};
    const nowMs = this.toTimestamp(opts.nowMs, Date.now());
    const resultOk = opts.resultOk === true;
    const errorCode = this.normalizeString(opts.errorCode);
    const errorMessage = this.normalizeString(opts.errorMessage);

    item.status = resultOk ? "succeeded" : "failed";
    item.updated_at_ms = nowMs;
    item.completed_at_ms = nowMs;
    item.error_code = errorCode;
    item.error_message = errorMessage;
    item.report =
      reportPayload && typeof reportPayload === "object"
        ? cloneJson(reportPayload)
        : {};

    return {
      ok: true,
      replay: false,
      query: cloneJson(item),
    };
  }

  markTimedOut(queryId, options) {
    const normalizedQueryId = this.normalizeString(queryId);
    const item = this.queriesById.get(normalizedQueryId);
    if (!item) {
      return {
        ok: false,
        reason: "not_found",
      };
    }
    if (this.isTerminal(item.status)) {
      return {
        ok: true,
        replay: true,
        query: cloneJson(item),
      };
    }

    const opts = options && typeof options === "object" ? options : {};
    const nowMs = this.toTimestamp(opts.nowMs, Date.now());
    const errorCode = this.normalizeString(opts.errorCode) || "E_QUERY_TIMEOUT";
    const errorMessage =
      this.normalizeString(opts.errorMessage) ||
      "Unity query timed out before report was received.";

    item.status = "timed_out";
    item.updated_at_ms = nowMs;
    item.completed_at_ms = nowMs;
    item.error_code = errorCode;
    item.error_message = errorMessage;
    item.report = null;
    this.removeFromPending(normalizedQueryId);

    return {
      ok: true,
      replay: false,
      query: cloneJson(item),
    };
  }

  sweep(options) {
    const opts = options && typeof options === "object" ? options : {};
    const nowMs = this.toTimestamp(opts.nowMs, Date.now());
    const retentionMs = this.toPositiveInt(
      opts.terminalRetentionMs,
      this.terminalRetentionMs
    );
    const staleBefore = nowMs - retentionMs;

    for (const [queryId, item] of this.queriesById.entries()) {
      if (!item || !this.isTerminal(item.status)) {
        continue;
      }
      if (this.toTimestamp(item.updated_at_ms, 0) > staleBefore) {
        continue;
      }
      this.queriesById.delete(queryId);
    }

    this.prunePendingQueue();
    this.trimIfNeeded(nowMs);
  }

  getCounts() {
    let pending = 0;
    let dispatched = 0;
    let terminal = 0;
    for (const item of this.queriesById.values()) {
      if (!item) {
        continue;
      }
      if (item.status === "pending") {
        pending += 1;
      } else if (item.status === "dispatched") {
        dispatched += 1;
      } else if (this.isTerminal(item.status)) {
        terminal += 1;
      }
    }
    return {
      total: this.queriesById.size,
      pending,
      dispatched,
      terminal,
    };
  }

  trimIfNeeded(nowMs) {
    this.prunePendingQueue();
    if (this.queriesById.size <= this.maxEntries) {
      return;
    }

    const terminalItems = [];
    for (const item of this.queriesById.values()) {
      if (!item || !this.isTerminal(item.status)) {
        continue;
      }
      terminalItems.push(item);
    }
    terminalItems.sort(
      (a, b) => this.toTimestamp(a.updated_at_ms, nowMs) - this.toTimestamp(b.updated_at_ms, nowMs)
    );

    let index = 0;
    while (this.queriesById.size > this.maxEntries && index < terminalItems.length) {
      const item = terminalItems[index];
      index += 1;
      if (!item || !item.query_id) {
        continue;
      }
      this.queriesById.delete(item.query_id);
    }
  }

  removeFromPending(queryId) {
    for (let i = 0; i < this.pendingQueryIds.length; i += 1) {
      if (this.pendingQueryIds[i] === queryId) {
        this.pendingQueryIds.splice(i, 1);
        i -= 1;
      }
    }
  }

  prunePendingQueue() {
    const next = [];
    for (let i = 0; i < this.pendingQueryIds.length; i += 1) {
      const queryId = this.pendingQueryIds[i];
      const item = this.queriesById.get(queryId);
      if (!item || item.status !== "pending") {
        continue;
      }
      next.push(queryId);
    }
    this.pendingQueryIds = next;
  }

  normalizeAcceptedTypes(value) {
    if (!Array.isArray(value)) {
      return null;
    }
    const set = new Set();
    for (let i = 0; i < value.length; i += 1) {
      const queryType = this.normalizeString(value[i]);
      if (!queryType) {
        continue;
      }
      set.add(queryType);
    }
    return set;
  }

  isTerminal(status) {
    return (
      status === "succeeded" ||
      status === "failed" ||
      status === "timed_out" ||
      status === "cancelled"
    );
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

  toTimestamp(value, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      return fallback;
    }
    return Math.floor(n);
  }
}

module.exports = {
  QueryStore,
};


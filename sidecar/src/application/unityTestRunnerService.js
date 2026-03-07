"use strict";

const { SSOT_QUERY_TYPES } = require("./ssotRuntime/queryTypes");

const TOOL_NAME = "run_unity_tests";
const DEFAULT_SCOPE = "all";
const DEFAULT_TIMEOUT_SECONDS = 900;
const DEFAULT_MIN_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_TIMEOUT_SECONDS = 7200;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeScope(value) {
  const token = normalizeString(value).toLowerCase();
  if (token === "editmode" || token === "playmode" || token === "all") {
    return token;
  }
  return DEFAULT_SCOPE;
}

function normalizePositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(maxValue, value));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = normalizeString(value[i]);
    if (!item) {
      continue;
    }
    output.push(item);
  }
  return output;
}

function normalizeFailedCases(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!isObject(item)) {
      continue;
    }
    output.push({
      platform: normalizeString(item.platform),
      name: normalizeString(item.name),
      fullname: normalizeString(item.fullname),
      message: normalizeString(item.message),
      stack_trace: normalizeString(item.stack_trace),
    });
  }
  return output;
}

function normalizePlatformResults(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (!isObject(item)) {
      continue;
    }
    output.push({
      platform: normalizeString(item.platform),
      status: normalizeString(item.status),
      total: normalizePositiveInteger(item.total, 0),
      passed: normalizePositiveInteger(item.passed, 0),
      failed: normalizePositiveInteger(item.failed, 0),
      skipped: normalizePositiveInteger(item.skipped, 0),
      inconclusive: normalizePositiveInteger(item.inconclusive, 0),
      duration_ms: normalizePositiveInteger(item.duration_ms, 0),
      failed_cases: normalizeFailedCases(item.failed_cases),
    });
  }
  return output;
}

function createServiceError(errorCode, message, statusCode, context = {}) {
  const error = new Error(message || "unity test runner service failed");
  error.errorCode = normalizeString(errorCode) || "E_UNITY_TEST_RUN_FAILED";
  error.statusCode =
    Number.isFinite(Number(statusCode)) && Number(statusCode) > 0
      ? Math.floor(Number(statusCode))
      : 500;
  error.context = isObject(context) ? context : {};
  return error;
}

function mapUnityQueryError(error, timeoutSeconds) {
  const source = isObject(error) ? error : {};
  const code =
    normalizeString(source.error_code || source.errorCode).toUpperCase() ||
    "E_UNITY_TEST_RUN_FAILED";
  const message =
    normalizeString(source.message) || "Unity in-process test query failed.";

  if (code === "E_QUERY_TIMEOUT" || code === "E_UNITY_TEST_TIMEOUT") {
    return createServiceError(
      "E_UNITY_TEST_TIMEOUT",
      `Unity in-process test run timed out after ${timeoutSeconds}s.`,
      504,
      { timeout_seconds: timeoutSeconds }
    );
  }

  if (code === "E_UNSUPPORTED_QUERY_TYPE" || code === "E_UNITY_TEST_QUERY_UNAVAILABLE") {
    return createServiceError(
      "E_UNITY_TEST_QUERY_UNAVAILABLE",
      "Unity runtime does not expose unity.test.run query handler.",
      502
    );
  }

  if (code === "E_UNITY_TEST_EDITOR_BUSY") {
    return createServiceError("E_UNITY_TEST_EDITOR_BUSY", message, 409);
  }

  if (code.startsWith("E_UNITY_TEST_")) {
    return createServiceError(code, message, 502);
  }

  return createServiceError("E_UNITY_TEST_RUN_FAILED", message, 502, {
    upstream_error_code: code,
  });
}

function normalizeUnityRuntimeResult(rawResult, defaults) {
  const source = isObject(rawResult) ? rawResult : null;
  if (!source) {
    throw createServiceError(
      "E_UNITY_TEST_RUN_FAILED",
      "Unity in-process test query returned invalid payload.",
      502
    );
  }

  if (source.ok === false || normalizeString(source.error_code)) {
    throw mapUnityQueryError(
      {
        error_code: normalizeString(source.error_code) || "E_UNITY_TEST_RUN_FAILED",
        message:
          normalizeString(source.error_message || source.message) ||
          "Unity in-process test run failed.",
      },
      defaults.timeoutSeconds
    );
  }

  const scopeRequested = normalizeScope(source.scope_requested || defaults.scope);
  const scopeExecuted = normalizeStringArray(source.scope_executed);
  const platformResults = normalizePlatformResults(source.platform_results);
  const failedCases = normalizeFailedCases(source.failed_cases);
  const status = normalizeString(source.status).toLowerCase() || "succeeded";

  return {
    tool_name: TOOL_NAME,
    run_id: normalizeString(source.run_id),
    scope_requested: scopeRequested,
    scope_executed:
      scopeExecuted.length > 0
        ? scopeExecuted
        : scopeRequested === "all"
          ? ["editmode", "playmode"]
          : [scopeRequested],
    status,
    total: normalizePositiveInteger(source.total, 0),
    passed: normalizePositiveInteger(source.passed, 0),
    failed: normalizePositiveInteger(source.failed, 0),
    skipped: normalizePositiveInteger(source.skipped, 0),
    inconclusive: normalizePositiveInteger(source.inconclusive, 0),
    duration_ms: normalizePositiveInteger(source.duration_ms, 0),
    platform_results: platformResults,
    failed_cases: failedCases,
    artifacts_directory: normalizeString(source.artifacts_directory),
    captured_at: normalizeString(source.captured_at) || defaults.nowIso(),
  };
}

class UnityTestRunnerService {
  constructor(options = {}) {
    const source = isObject(options) ? options : {};
    this._enqueueAndWaitForUnityQuery =
      typeof source.enqueueAndWaitForUnityQuery === "function"
        ? source.enqueueAndWaitForUnityQuery
        : null;
    this._nowIso =
      typeof source.nowIso === "function"
        ? source.nowIso
        : () => new Date().toISOString();
    this._defaultTimeoutSeconds = clamp(
      normalizePositiveInteger(
        source.defaultTimeoutSeconds,
        DEFAULT_TIMEOUT_SECONDS
      ),
      1,
      DEFAULT_MAX_TIMEOUT_SECONDS
    );
    this._minTimeoutSeconds = clamp(
      normalizePositiveInteger(
        source.minTimeoutSeconds,
        DEFAULT_MIN_TIMEOUT_SECONDS
      ),
      1,
      DEFAULT_MAX_TIMEOUT_SECONDS
    );
    this._maxTimeoutSeconds = clamp(
      normalizePositiveInteger(
        source.maxTimeoutSeconds,
        DEFAULT_MAX_TIMEOUT_SECONDS
      ),
      this._minTimeoutSeconds,
      DEFAULT_MAX_TIMEOUT_SECONDS
    );
  }

  async runUnityTests(requestBody) {
    if (typeof this._enqueueAndWaitForUnityQuery !== "function") {
      throw createServiceError(
        "E_UNITY_TEST_QUERY_UNAVAILABLE",
        "Unity query runtime is not configured for in-process test execution.",
        500
      );
    }

    const payload = isObject(requestBody) ? requestBody : {};
    const scope = normalizeScope(payload.scope);
    const timeoutSeconds = clamp(
      normalizePositiveInteger(payload.timeout_seconds, this._defaultTimeoutSeconds),
      this._minTimeoutSeconds,
      this._maxTimeoutSeconds
    );
    const testFilter = normalizeString(payload.test_filter);

    const queryPayload = {
      scope,
      timeout_seconds: timeoutSeconds,
      test_filter: testFilter,
    };
    const timeoutMs = timeoutSeconds * 1000;

    let unityResult;
    try {
      unityResult = await this._enqueueAndWaitForUnityQuery({
        queryType: SSOT_QUERY_TYPES.UNITY_TEST_RUN,
        payload: queryPayload,
        queryPayloadJson: JSON.stringify(queryPayload),
        timeoutMs,
      });
    } catch (error) {
      throw mapUnityQueryError(error, timeoutSeconds);
    }

    return normalizeUnityRuntimeResult(unityResult, {
      scope,
      timeoutSeconds,
      nowIso: this._nowIso,
    });
  }
}

module.exports = {
  TOOL_NAME,
  UnityTestRunnerService,
};

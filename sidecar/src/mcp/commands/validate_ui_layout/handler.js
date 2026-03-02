"use strict";

const {
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");

const QUERY_TYPE = "validate_ui_layout";

async function executeValidateUiLayout(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload = normalizePayload(requestBody);
  const queryCoordinator =
    ctx.queryCoordinator && typeof ctx.queryCoordinator === "object"
      ? ctx.queryCoordinator
      : null;
  if (
    !queryCoordinator ||
    typeof queryCoordinator.enqueueAndWaitForUnityQuery !== "function"
  ) {
    return {
      statusCode: 500,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_INTERNAL",
        message: "Unity query runtime is not configured",
      }),
    };
  }

  let unityResponse = null;
  try {
    unityResponse = await queryCoordinator.enqueueAndWaitForUnityQuery({
      queryType: QUERY_TYPE,
      payload,
      timeoutMs: payload.timeout_ms,
    });
  } catch (error) {
    return mapFailure(error);
  }

  if (!unityResponse || typeof unityResponse !== "object") {
    return {
      statusCode: 502,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_UI_LAYOUT_VALIDATION_FAILED",
        message: "Unity validate_ui_layout response is invalid",
      }),
    };
  }

  if (unityResponse.ok !== true) {
    const errorCode = normalizeNonEmptyString(unityResponse.error_code);
    const errorMessage =
      normalizeNonEmptyString(unityResponse.error_message) ||
      normalizeNonEmptyString(unityResponse.message) ||
      "Unity validate_ui_layout query failed";
    return {
      statusCode: mapValidateErrorToStatusCode(errorCode),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode || "E_UI_LAYOUT_VALIDATION_FAILED",
        message: errorMessage,
      }),
    };
  }

  const normalizedData = normalizeLayoutData(unityResponse.data, payload);
  const snapshotService =
    ctx.snapshotService && typeof ctx.snapshotService === "object"
      ? ctx.snapshotService
      : null;
  const readToken =
    snapshotService &&
    typeof snapshotService.issueReadTokenForQueryResult === "function"
      ? snapshotService.issueReadTokenForQueryResult(
          QUERY_TYPE,
          unityResponse,
          payload
        )
      : null;

  return {
    statusCode: 200,
    body: {
      ok: true,
      data: normalizedData,
      ...(readToken ? { read_token: readToken } : {}),
      captured_at:
        normalizeNonEmptyString(unityResponse.captured_at) ||
        (typeof ctx.nowIso === "function" ? ctx.nowIso() : new Date().toISOString()),
    },
  };
}

function normalizePayload(body) {
  const source = body && typeof body === "object" ? body : {};
  const payload = { ...source };
  const scope =
    payload.scope && typeof payload.scope === "object" ? payload.scope : null;
  const scopeRootPath =
    scope && typeof scope.root_path === "string" ? scope.root_path.trim() : "";
  if (scopeRootPath && !normalizeNonEmptyString(payload.root_path)) {
    payload.root_path = scopeRootPath;
  }
  return payload;
}

function normalizeLayoutData(data, payload) {
  const source = data && typeof data === "object" ? { ...data } : {};
  if (!source.scope && payload.scope && typeof payload.scope === "object") {
    source.scope = payload.scope;
  }
  if (!Array.isArray(source.resolutions) && Array.isArray(payload.resolutions)) {
    source.resolutions = payload.resolutions;
  }
  if (!Number.isFinite(Number(source.time_budget_ms)) && Number.isFinite(Number(payload.time_budget_ms))) {
    source.time_budget_ms = Math.floor(Number(payload.time_budget_ms));
  }
  source.partial = source.partial === true;
  source.truncated_reason = normalizeNonEmptyString(source.truncated_reason) || null;
  source.issues = Array.isArray(source.issues)
    ? source.issues.map((item) => normalizeIssue(item, source))
    : [];
  if (!Number.isFinite(Number(source.issue_count))) {
    source.issue_count = source.issues.length;
  } else {
    source.issue_count = Math.max(0, Math.floor(Number(source.issue_count)));
  }
  return source;
}

function normalizeIssue(issue, layoutData) {
  const item = issue && typeof issue === "object" ? { ...issue } : {};
  const issueType = normalizeNonEmptyString(item.issue_type);
  const approximate =
    item.approximate === true ||
    normalizeNonEmptyString(item.approx_reason) === "NO_RAYCAST_SOURCE";
  if (issueType === "NOT_CLICKABLE") {
    if (!normalizeNonEmptyString(item.mode)) {
      item.mode = approximate
        ? "static_only"
        : "theoretical_with_raycast_context";
    }
    if (approximate && !normalizeNonEmptyString(item.severity)) {
      item.severity = "warning";
    }
  } else if (issueType === "TEXT_OVERFLOW") {
    if (!normalizeNonEmptyString(item.mode)) {
      const runtimeName = normalizeNonEmptyString(layoutData.runtime_resolution_name);
      const resolutionName = normalizeNonEmptyString(item.resolution);
      item.mode =
        runtimeName && resolutionName && resolutionName !== runtimeName
          ? "derived_only"
          : "direct_runtime";
    }
    if (item.mode === "derived_only" && !normalizeNonEmptyString(item.severity)) {
      item.severity = "warning";
    }
  } else {
    if (!normalizeNonEmptyString(item.mode)) {
      item.mode = "direct_runtime";
    }
  }
  if (!normalizeNonEmptyString(item.confidence)) {
    item.confidence = approximate || item.mode === "derived_only" ? "low" : "high";
  }
  return item;
}

function mapFailure(error) {
  const source = error && typeof error === "object" ? error : {};
  const errorCode =
    normalizeNonEmptyString(source.error_code) ||
    normalizeNonEmptyString(source.errorCode) ||
    "E_UI_LAYOUT_VALIDATION_FAILED";
  const message =
    normalizeNonEmptyString(source.message) ||
    normalizeNonEmptyString(source.error_message) ||
    "Unity validate_ui_layout query failed";
  const suggestion = normalizeNonEmptyString(source.suggestion);
  const recoverable =
    typeof source.recoverable === "boolean" ? source.recoverable : undefined;
  return {
    statusCode: mapValidateErrorToStatusCode(errorCode),
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: errorCode,
      message,
      ...(suggestion ? { suggestion } : {}),
      ...(recoverable === undefined ? {} : { recoverable }),
    }),
  };
}

function mapValidateErrorToStatusCode(errorCode) {
  const code = normalizeNonEmptyString(errorCode);
  if (code === "E_SCHEMA_INVALID") {
    return 400;
  }
  if (code === "E_QUERY_TIMEOUT") {
    return 504;
  }
  if (code === "E_UNITY_NOT_CONNECTED") {
    return 503;
  }
  if (code === "E_UI_LAYOUT_SCOPE_NOT_FOUND" || code === "E_TARGET_NOT_FOUND") {
    return 404;
  }
  return 409;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  executeValidateUiLayout,
};


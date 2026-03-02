"use strict";

const { withMcpErrorFeedback } = require("../../../application/mcpGateway/mcpErrorFeedback");

const QUERY_TYPE = "get_ui_tree";

async function executeGetUiTree(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload = normalizeGetUiTreeRequestPayload(requestBody);
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
        error_code: "E_UI_TREE_QUERY_FAILED",
        message: "Unity get_ui_tree response is invalid",
      }),
    };
  }

  if (unityResponse.ok !== true) {
    const errorCode = normalizeNonEmptyString(unityResponse.error_code);
    const errorMessage =
      normalizeNonEmptyString(unityResponse.error_message) ||
      normalizeNonEmptyString(unityResponse.message) ||
      "Unity get_ui_tree query failed";
    return {
      statusCode: mapUiTreeErrorToStatusCode(errorCode),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode || "E_UI_TREE_QUERY_FAILED",
        message: errorMessage,
      }),
    };
  }

  const data =
    unityResponse.data && typeof unityResponse.data === "object"
      ? normalizeGetUiTreeData(unityResponse.data, payload)
      : {};
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
      data,
      ...(readToken ? { read_token: readToken } : {}),
      captured_at:
        normalizeNonEmptyString(unityResponse.captured_at) ||
        (typeof ctx.nowIso === "function" ? ctx.nowIso() : new Date().toISOString()),
    },
  };
}

function normalizeGetUiTreeRequestPayload(body) {
  const payload = body && typeof body === "object" ? { ...body } : {};
  const rootPath = normalizeNonEmptyString(payload.root_path);
  const scope =
    payload.scope && typeof payload.scope === "object" ? { ...payload.scope } : null;
  const scopeRootPath =
    scope && typeof scope.root_path === "string" ? scope.root_path.trim() : "";

  if (scopeRootPath && !rootPath) {
    payload.root_path = scopeRootPath;
  } else if (rootPath && !scopeRootPath) {
    payload.scope = {
      root_path: rootPath,
    };
  } else if (scopeRootPath && rootPath) {
    payload.root_path = rootPath;
    payload.scope = {
      root_path: scopeRootPath,
    };
  }

  return payload;
}

function normalizeGetUiTreeData(data, payload) {
  const result = data && typeof data === "object" ? { ...data } : {};
  const requestScope =
    payload && payload.scope && typeof payload.scope === "object"
      ? payload.scope
      : null;
  const rootPath = normalizeNonEmptyString(
    (requestScope && requestScope.root_path) || payload.root_path
  );
  if (!result.scope && rootPath) {
    result.scope = {
      root_path: rootPath,
    };
  }

  const runtimeResolution = normalizeResolutionObject(result.runtime_resolution);
  const requestResolution = normalizeResolutionObject(payload.resolution);
  if (!runtimeResolution && requestResolution) {
    result.runtime_resolution = requestResolution;
    if (!normalizeRuntimeSource(result.runtime_source)) {
      result.runtime_source = "fallback_req_resolution";
    }
  } else if (runtimeResolution) {
    result.runtime_resolution = runtimeResolution;
    const runtimeSource = normalizeRuntimeSource(result.runtime_source);
    if (runtimeSource) {
      result.runtime_source = runtimeSource;
    }
  }

  return result;
}

function normalizeResolutionObject(value) {
  const source = value && typeof value === "object" ? value : null;
  if (!source) {
    return null;
  }
  const width = Number(source.width);
  const height = Number(source.height);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }
  return {
    width: Math.floor(width),
    height: Math.floor(height),
  };
}

function normalizeRuntimeSource(value) {
  const source = normalizeNonEmptyString(value);
  if (
    source === "canvas_pixel_rect" ||
    source === "largest_canvas_pixel_rect" ||
    source === "fallback_req_resolution"
  ) {
    return source;
  }
  return "";
}

function mapFailure(error) {
  const source = error && typeof error === "object" ? error : {};
  const errorCode =
    normalizeNonEmptyString(source.error_code) ||
    normalizeNonEmptyString(source.errorCode) ||
    "E_UI_TREE_QUERY_FAILED";
  const message =
    normalizeNonEmptyString(source.message) ||
    normalizeNonEmptyString(source.error_message) ||
    "Unity get_ui_tree query failed";
  const suggestion = normalizeNonEmptyString(source.suggestion);
  const recoverable =
    typeof source.recoverable === "boolean" ? source.recoverable : undefined;
  return {
    statusCode: mapUiTreeErrorToStatusCode(errorCode),
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: errorCode,
      message,
      ...(suggestion ? { suggestion } : {}),
      ...(recoverable === undefined ? {} : { recoverable }),
    }),
  };
}

function mapUiTreeErrorToStatusCode(errorCode) {
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
  if (code === "E_UI_TREE_SOURCE_NOT_FOUND" || code === "E_TARGET_NOT_FOUND") {
    return 404;
  }
  return 409;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  executeGetUiTree,
};

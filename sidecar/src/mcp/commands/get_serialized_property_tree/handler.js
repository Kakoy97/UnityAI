"use strict";

const {
  validationError,
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");
const {
  validateGetSerializedPropertyTree,
} = require("./validator");

const QUERY_TYPE = "get_serialized_property_tree";

async function executeGetSerializedPropertyTree(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload = normalizeRequestPayload(requestBody);
  const validation = validateGetSerializedPropertyTree(payload);
  if (!validation.ok) {
    return validationError(validation, {
      requestBody: payload,
      toolName: QUERY_TYPE,
    });
  }

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
        error_code: "E_SERIALIZED_PROPERTY_TREE_QUERY_FAILED",
        message: "Unity get_serialized_property_tree response is invalid",
      }),
    };
  }

  if (unityResponse.ok !== true) {
    const errorCode = normalizeNonEmptyString(unityResponse.error_code);
    const errorMessage =
      normalizeNonEmptyString(unityResponse.error_message) ||
      normalizeNonEmptyString(unityResponse.message) ||
      "Unity get_serialized_property_tree query failed";
    return {
      statusCode: mapQueryErrorToStatusCode(errorCode),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode || "E_SERIALIZED_PROPERTY_TREE_QUERY_FAILED",
        message: errorMessage,
      }),
    };
  }

  const data =
    unityResponse.data && typeof unityResponse.data === "object"
      ? normalizeResponseData(unityResponse.data)
      : {
          returned_count: 0,
          truncated: false,
          truncated_reason: "",
          next_cursor: "",
          nodes: [],
        };
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

function normalizeResponseData(source) {
  const result = source && typeof source === "object" ? { ...source } : {};
  result.nodes = Array.isArray(result.nodes) ? result.nodes : [];
  result.returned_count = Number.isFinite(Number(result.returned_count))
    ? Math.floor(Number(result.returned_count))
    : result.nodes.length;
  result.truncated = result.truncated === true;
  result.truncated_reason = normalizeNonEmptyString(result.truncated_reason);
  result.next_cursor = normalizeNonEmptyString(result.next_cursor);
  return result;
}

function normalizeRequestPayload(source) {
  const body = source && typeof source === "object" ? source : {};
  const payload = { ...body };
  if (payload.depth === undefined) {
    payload.depth = 1;
  }
  if (payload.page_size === undefined) {
    payload.page_size = 64;
  }
  if (payload.node_budget === undefined) {
    payload.node_budget = 128;
  }
  if (payload.char_budget === undefined) {
    payload.char_budget = 12000;
  }
  if (payload.include_value_summary === undefined) {
    payload.include_value_summary = true;
  }
  if (payload.include_non_visible === undefined) {
    payload.include_non_visible = false;
  }
  return payload;
}

function mapFailure(error) {
  const source = error && typeof error === "object" ? error : {};
  const errorCode =
    normalizeNonEmptyString(source.error_code) ||
    normalizeNonEmptyString(source.errorCode) ||
    "E_SERIALIZED_PROPERTY_TREE_QUERY_FAILED";
  const message =
    normalizeNonEmptyString(source.message) ||
    normalizeNonEmptyString(source.error_message) ||
    "Unity get_serialized_property_tree query failed";
  const suggestion = normalizeNonEmptyString(source.suggestion);
  const recoverable =
    typeof source.recoverable === "boolean" ? source.recoverable : undefined;
  return {
    statusCode: mapQueryErrorToStatusCode(errorCode),
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: errorCode,
      message,
      ...(suggestion ? { suggestion } : {}),
      ...(recoverable === undefined ? {} : { recoverable }),
    }),
  };
}

function mapQueryErrorToStatusCode(errorCode) {
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
  if (
    code === "E_TARGET_NOT_FOUND" ||
    code === "E_ACTION_COMPONENT_NOT_FOUND" ||
    code === "E_ACTION_COMPONENT_INDEX_OUT_OF_RANGE" ||
    code === "E_PROPERTY_NOT_FOUND" ||
    code === "E_CURSOR_NOT_FOUND"
  ) {
    return 404;
  }
  return 409;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  executeGetSerializedPropertyTree,
};

"use strict";

const {
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");

const QUERY_TYPE = "hit_test_ui_at_viewport_point";
const ALLOWED_RUNTIME_SOURCES = new Set([
  "canvas_pixel_rect",
  "largest_canvas_pixel_rect",
  "fallback_req_resolution",
]);

async function executeHitTestUiAtViewportPoint(context, requestBody) {
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
        error_code: "E_UI_HIT_TEST_QUERY_FAILED",
        message: "Unity hit_test_ui_at_viewport_point response is invalid",
      }),
    };
  }

  if (unityResponse.ok !== true) {
    const errorCode = normalizeNonEmptyString(unityResponse.error_code);
    const errorMessage =
      normalizeNonEmptyString(unityResponse.error_message) ||
      normalizeNonEmptyString(unityResponse.message) ||
      "Unity hit_test_ui_at_viewport_point query failed";
    return {
      statusCode: mapHitTestErrorToStatusCode(errorCode),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode || "E_UI_HIT_TEST_QUERY_FAILED",
        message: errorMessage,
      }),
    };
  }

  const normalizedData = normalizeHitTestData(unityResponse.data, payload);
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
  if (!normalizeNonEmptyString(payload.view)) {
    payload.view = "game";
  }
  if (!normalizeNonEmptyString(payload.coord_space)) {
    payload.coord_space = "viewport_px";
  }
  if (!normalizeNonEmptyString(payload.coord_origin)) {
    payload.coord_origin = "bottom_left";
  }
  return payload;
}

function normalizeHitTestData(data, payload) {
  const source = data && typeof data === "object" ? { ...data } : {};
  const requestPoint = {
    x: Number(payload.x),
    y: Number(payload.y),
  };
  source.view = normalizeNonEmptyString(source.view) || payload.view || "game";
  source.coord_space =
    normalizeNonEmptyString(source.coord_space) || payload.coord_space || "viewport_px";
  source.coord_origin =
    normalizeNonEmptyString(source.coord_origin) ||
    payload.coord_origin ||
    "bottom_left";
  source.requested_point = normalizePoint(source.requested_point) || requestPoint;

  const runtimeResolution =
    normalizeResolution(source.runtime_resolution) || normalizeResolution(payload.resolution);
  if (runtimeResolution) {
    source.runtime_resolution = runtimeResolution;
  }
  const runtimeSource = normalizeRuntimeSource(source.runtime_source);
  if (runtimeSource) {
    source.runtime_source = runtimeSource;
  } else if (runtimeResolution) {
    source.runtime_source = "fallback_req_resolution";
  }

  const mappedPoint = normalizePoint(source.mapped_point) || { ...source.requested_point };
  source.mapped_point = clampMappedPoint(mappedPoint, runtimeResolution);
  source.resolution = normalizeResolution(source.resolution) || normalizeResolution(payload.resolution);
  source.approximate = source.approximate === true;
  source.approx_reason = normalizeNonEmptyString(source.approx_reason) || null;
  source.confidence =
    normalizeNonEmptyString(source.confidence) || (source.approximate ? "low" : "high");
  source.hit_count = normalizeNonNegativeInteger(source.hit_count);
  source.hits = Array.isArray(source.hits) ? source.hits : [];
  if (!Number.isFinite(source.hit_count)) {
    source.hit_count = source.hits.length;
  }
  return source;
}

function clampMappedPoint(point, runtimeResolution) {
  const source = point && typeof point === "object" ? point : {};
  const mapped = {
    x: Number(source.x),
    y: Number(source.y),
  };
  if (
    runtimeResolution &&
    Number.isFinite(Number(runtimeResolution.width)) &&
    Number.isFinite(Number(runtimeResolution.height))
  ) {
    const maxX = Math.max(0, Math.floor(Number(runtimeResolution.width)) - 1);
    const maxY = Math.max(0, Math.floor(Number(runtimeResolution.height)) - 1);
    mapped.x = clampNumber(Math.round(mapped.x), 0, maxX);
    mapped.y = clampNumber(Math.round(mapped.y), 0, maxY);
    return mapped;
  }
  if (Number.isFinite(mapped.x)) {
    mapped.x = Math.round(mapped.x);
  } else {
    mapped.x = 0;
  }
  if (Number.isFinite(mapped.y)) {
    mapped.y = Math.round(mapped.y);
  } else {
    mapped.y = 0;
  }
  return mapped;
}

function mapFailure(error) {
  const source = error && typeof error === "object" ? error : {};
  const errorCode =
    normalizeNonEmptyString(source.error_code) ||
    normalizeNonEmptyString(source.errorCode) ||
    "E_UI_HIT_TEST_QUERY_FAILED";
  const message =
    normalizeNonEmptyString(source.message) ||
    normalizeNonEmptyString(source.error_message) ||
    "Unity hit_test_ui_at_viewport_point query failed";
  const suggestion = normalizeNonEmptyString(source.suggestion);
  const recoverable =
    typeof source.recoverable === "boolean" ? source.recoverable : undefined;
  return {
    statusCode: mapHitTestErrorToStatusCode(errorCode),
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: errorCode,
      message,
      ...(suggestion ? { suggestion } : {}),
      ...(recoverable === undefined ? {} : { recoverable }),
    }),
  };
}

function mapHitTestErrorToStatusCode(errorCode) {
  const code = normalizeNonEmptyString(errorCode);
  if (code === "E_SCHEMA_INVALID" || code === "E_UI_COORD_MAPPING_INVALID") {
    return 400;
  }
  if (code === "E_QUERY_TIMEOUT") {
    return 504;
  }
  if (code === "E_UNITY_NOT_CONNECTED") {
    return 503;
  }
  if (code === "E_UI_HIT_TEST_SOURCE_NOT_FOUND" || code === "E_TARGET_NOT_FOUND") {
    return 404;
  }
  return 409;
}

function normalizePoint(value) {
  const source = value && typeof value === "object" ? value : null;
  if (!source) {
    return null;
  }
  const x = Number(source.x);
  const y = Number(source.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x, y };
}

function normalizeResolution(value) {
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
  return ALLOWED_RUNTIME_SOURCES.has(source) ? source : "";
}

function normalizeNonNegativeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return NaN;
  }
  return Math.floor(n);
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return min;
  }
  return Math.min(max, Math.max(min, n));
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  executeHitTestUiAtViewportPoint,
};


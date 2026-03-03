"use strict";

const {
  validationError,
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");
const {
  validateGetUiOverlayReport,
} = require("./validator");

const QUERY_TYPE = "get_ui_overlay_report";
const ALLOWED_RECOMMENDED_CAPTURE_MODES = new Set([
  "render_output",
  "composite",
  "structural_only",
]);

async function executeGetUiOverlayReport(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload = normalizeRequestPayload(requestBody);
  const validation = validateGetUiOverlayReport(payload);
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
        error_code: "E_UI_OVERLAY_REPORT_QUERY_FAILED",
        message: "Unity get_ui_overlay_report response is invalid",
      }),
    };
  }

  if (unityResponse.ok !== true) {
    const errorCode = normalizeNonEmptyString(unityResponse.error_code);
    const errorMessage =
      normalizeNonEmptyString(unityResponse.error_message) ||
      normalizeNonEmptyString(unityResponse.message) ||
      "Unity get_ui_overlay_report query failed";
    return {
      statusCode: mapOverlayErrorToStatusCode(errorCode),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode || "E_UI_OVERLAY_REPORT_QUERY_FAILED",
        message: errorMessage,
      }),
    };
  }

  const data = normalizeResponseData(unityResponse.data, payload);
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

function normalizeRequestPayload(source) {
  const body = source && typeof source === "object" ? source : {};
  const payload = { ...body };
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

  if (payload.include_inactive === undefined) {
    payload.include_inactive = true;
  }
  if (payload.include_children_summary === undefined) {
    payload.include_children_summary = true;
  }
  if (payload.max_nodes === undefined) {
    payload.max_nodes = 256;
  }
  if (payload.max_children_per_canvas === undefined) {
    payload.max_children_per_canvas = 12;
  }

  return payload;
}

function normalizeResponseData(source, payload) {
  const result = source && typeof source === "object" ? { ...source } : {};
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

  result.include_inactive = payload.include_inactive === true;
  result.include_children_summary = payload.include_children_summary === true;
  result.max_nodes = toNonNegativeInteger(payload.max_nodes, 256);
  result.max_children_per_canvas = toNonNegativeInteger(
    payload.max_children_per_canvas,
    12
  );
  result.overlay_canvases = Array.isArray(result.overlay_canvases)
    ? result.overlay_canvases.map((item) => normalizeOverlayCanvas(item))
    : [];
  result.non_overlay_canvases_count = toNonNegativeInteger(
    result.non_overlay_canvases_count,
    0
  );
  result.overlay_total_coverage_percent = clampPercent(
    toNumberOrDefault(result.overlay_total_coverage_percent, 0)
  );
  result.returned_canvas_count = toNonNegativeInteger(
    result.returned_canvas_count,
    result.overlay_canvases.length
  );
  result.truncated = result.truncated === true;
  result.truncated_reason = normalizeNonEmptyString(result.truncated_reason);
  result.diagnosis_codes = Array.isArray(result.diagnosis_codes)
    ? result.diagnosis_codes
        .map((item) => normalizeNonEmptyString(item))
        .filter((item) => !!item)
    : [];
  result.diagnosis = normalizeNonEmptyString(result.diagnosis);

  const normalizedMode = normalizeRecommendedCaptureMode(
    result.recommended_capture_mode
  );
  result.recommended_capture_mode =
    normalizedMode ||
    deriveRecommendedCaptureMode({
      overlayCanvasCount: result.overlay_canvases.length,
      overlayCoveragePercent: result.overlay_total_coverage_percent,
      diagnosisCodes: result.diagnosis_codes,
    });
  if (!result.diagnosis && result.recommended_capture_mode === "composite") {
    result.diagnosis =
      "Overlay UI coverage is high. Prefer composite capture (when enabled) or run structural diagnostics first.";
  }
  if (!result.diagnosis && result.recommended_capture_mode === "structural_only") {
    result.diagnosis =
      "Overlay report indicates structural diagnostics should be preferred over screenshot-only verification.";
  }
  if (!result.diagnosis) {
    result.diagnosis =
      "Overlay UI coverage is limited. render_output screenshot is usually sufficient.";
  }

  return result;
}

function normalizeOverlayCanvas(source) {
  const item = source && typeof source === "object" ? { ...source } : {};
  item.object_id = normalizeNonEmptyString(item.object_id);
  item.path = normalizeNonEmptyString(item.path);
  item.name = normalizeNonEmptyString(item.name);
  item.active = item.active === true;
  item.render_mode = normalizeNonEmptyString(item.render_mode);
  item.sorting_layer_id = toInteger(item.sorting_layer_id, 0);
  item.sorting_order = toInteger(item.sorting_order, 0);
  item.screen_coverage_percent = clampPercent(
    toNumberOrDefault(item.screen_coverage_percent, 0)
  );
  item.interactable_elements = toNonNegativeInteger(item.interactable_elements, 0);
  item.children_summary = Array.isArray(item.children_summary)
    ? item.children_summary.map((child) => normalizeOverlayChild(child))
    : [];
  return item;
}

function normalizeOverlayChild(source) {
  const item = source && typeof source === "object" ? { ...source } : {};
  item.object_id = normalizeNonEmptyString(item.object_id);
  item.path = normalizeNonEmptyString(item.path);
  item.name = normalizeNonEmptyString(item.name);
  item.type = normalizeNonEmptyString(item.type);
  item.interactable = item.interactable === true;
  const rect =
    item.rect_screen_px && typeof item.rect_screen_px === "object"
      ? item.rect_screen_px
      : null;
  item.rect_screen_px = rect
    ? {
        x: toInteger(rect.x, 0),
        y: toInteger(rect.y, 0),
        width: toInteger(rect.width, 0),
        height: toInteger(rect.height, 0),
      }
    : null;
  return item;
}

function deriveRecommendedCaptureMode(input) {
  const source = input && typeof input === "object" ? input : {};
  const coveragePercent = clampPercent(
    toNumberOrDefault(source.overlayCoveragePercent, 0)
  );
  const overlayCanvasCount = toNonNegativeInteger(source.overlayCanvasCount, 0);
  const diagnosisCodes = Array.isArray(source.diagnosisCodes)
    ? source.diagnosisCodes.map((item) => normalizeNonEmptyString(item))
    : [];
  if (diagnosisCodes.includes("RUNTIME_RESOLUTION_UNAVAILABLE")) {
    return "structural_only";
  }
  if (overlayCanvasCount <= 0) {
    return "render_output";
  }
  if (coveragePercent >= 35) {
    return "composite";
  }
  return "render_output";
}

function mapFailure(error) {
  const source = error && typeof error === "object" ? error : {};
  const errorCode =
    normalizeNonEmptyString(source.error_code) ||
    normalizeNonEmptyString(source.errorCode) ||
    "E_UI_OVERLAY_REPORT_QUERY_FAILED";
  const message =
    normalizeNonEmptyString(source.message) ||
    normalizeNonEmptyString(source.error_message) ||
    "Unity get_ui_overlay_report query failed";
  const suggestion = normalizeNonEmptyString(source.suggestion);
  const recoverable =
    typeof source.recoverable === "boolean" ? source.recoverable : undefined;
  return {
    statusCode: mapOverlayErrorToStatusCode(errorCode),
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: errorCode,
      message,
      ...(suggestion ? { suggestion } : {}),
      ...(recoverable === undefined ? {} : { recoverable }),
    }),
  };
}

function mapOverlayErrorToStatusCode(errorCode) {
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
    code === "E_UI_OVERLAY_REPORT_SOURCE_NOT_FOUND" ||
    code === "E_TARGET_NOT_FOUND"
  ) {
    return 404;
  }
  return 409;
}

function normalizeRecommendedCaptureMode(value) {
  const mode = normalizeNonEmptyString(value).toLowerCase();
  return ALLOWED_RECOMMENDED_CAPTURE_MODES.has(mode) ? mode : "";
}

function toNumberOrDefault(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.floor(parsed);
}

function toNonNegativeInteger(value, fallback) {
  const parsed = toInteger(value, fallback);
  if (!Number.isFinite(Number(parsed)) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function clampPercent(value) {
  const numeric = toNumberOrDefault(value, 0);
  if (numeric < 0) {
    return 0;
  }
  if (numeric > 100) {
    return 100;
  }
  return Math.round(numeric * 100) / 100;
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  executeGetUiOverlayReport,
};

"use strict";

const { withMcpErrorFeedback } = require("../../../application/mcpGateway/mcpErrorFeedback");

const QUERY_TYPE = "capture_scene_screenshot";
const DEFAULT_CAPTURE_MODE = "render_output";
const DISABLED_CAPTURE_MODES = new Set(["final_pixels", "editor_view"]);

async function executeCaptureSceneScreenshot(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const requestedCaptureMode =
    normalizeCaptureMode(payload.capture_mode) || DEFAULT_CAPTURE_MODE;

  if (DISABLED_CAPTURE_MODES.has(requestedCaptureMode)) {
    return {
      statusCode: mapScreenshotErrorToStatusCode("E_CAPTURE_MODE_DISABLED"),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_CAPTURE_MODE_DISABLED",
        message:
          `capture_mode '${requestedCaptureMode}' is disabled. ` +
          "Use capture_mode='render_output'.",
      }),
    };
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
        error_code: "E_SCREENSHOT_CAPTURE_FAILED",
        message: "Unity screenshot response is invalid",
      }),
    };
  }

  if (unityResponse.ok !== true) {
    const errorCode = normalizeNonEmptyString(unityResponse.error_code);
    const errorMessage =
      normalizeNonEmptyString(unityResponse.error_message) ||
      normalizeNonEmptyString(unityResponse.message) ||
      "Unity screenshot query failed";
    return {
      statusCode: mapScreenshotErrorToStatusCode(errorCode),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode || "E_SCREENSHOT_CAPTURE_FAILED",
        message: errorMessage,
      }),
    };
  }

  const data =
    unityResponse.data && typeof unityResponse.data === "object"
      ? unityResponse.data
      : {};
  const artifactUri = normalizeNonEmptyString(data.artifact_uri);
  const imageBase64 =
    normalizeNonEmptyString(data.image_base64) ||
    normalizeNonEmptyString(data.inline_base64);
  const effectiveCaptureMode =
    normalizeCaptureMode(data.capture_mode_effective) ||
    normalizeCaptureMode(data.capture_mode) ||
    requestedCaptureMode;
  const fallbackReasonRaw = normalizeNonEmptyString(data.fallback_reason);
  const fallbackReason =
    fallbackReasonRaw ||
    (effectiveCaptureMode !== requestedCaptureMode
      ? `fallback_to_${effectiveCaptureMode}`
      : "");
  const diagnosisTags = normalizeDiagnosisTags(data.diagnosis_tags);
  if (fallbackReason && !diagnosisTags.includes("FALLBACK")) {
    diagnosisTags.push("FALLBACK");
  }
  if (!artifactUri && !imageBase64) {
    return {
      statusCode: 502,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_SCREENSHOT_CAPTURE_FAILED",
        message:
          "Unity screenshot response must include artifact_uri or image_base64",
      }),
    };
  }

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
      data: {
        ...data,
        ...(artifactUri ? { artifact_uri: artifactUri } : {}),
        ...(imageBase64 ? { image_base64: imageBase64 } : {}),
        diagnosis_tags: diagnosisTags,
        capture_mode_effective: effectiveCaptureMode,
        ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
      },
      ...(readToken ? { read_token: readToken } : {}),
      captured_at:
        normalizeNonEmptyString(unityResponse.captured_at) ||
        (typeof ctx.nowIso === "function" ? ctx.nowIso() : new Date().toISOString()),
    },
  };
}

function mapFailure(error) {
  const source = error && typeof error === "object" ? error : {};
  const errorCode =
    normalizeNonEmptyString(source.error_code) ||
    normalizeNonEmptyString(source.errorCode) ||
    "E_SCREENSHOT_CAPTURE_FAILED";
  const message =
    normalizeNonEmptyString(source.message) ||
    normalizeNonEmptyString(source.error_message) ||
    "Unity screenshot query failed";
  const suggestion = normalizeNonEmptyString(source.suggestion);
  const recoverable =
    typeof source.recoverable === "boolean" ? source.recoverable : undefined;
  return {
    statusCode: mapScreenshotErrorToStatusCode(errorCode),
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: errorCode,
      message,
      ...(suggestion ? { suggestion } : {}),
      ...(recoverable === undefined ? {} : { recoverable }),
    }),
  };
}

function mapScreenshotErrorToStatusCode(errorCode) {
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
  if (code === "E_CAPTURE_MODE_DISABLED") {
    return 409;
  }
  if (
    code === "E_SCREENSHOT_VIEW_NOT_FOUND" ||
    code === "E_SCENE_NOT_LOADED" ||
    code === "E_TARGET_NOT_FOUND"
  ) {
    return 404;
  }
  return 409;
}

function normalizeCaptureMode(value) {
  const mode = normalizeNonEmptyString(value);
  if (
    mode === "render_output" ||
    mode === "final_pixels" ||
    mode === "editor_view"
  ) {
    return mode;
  }
  return "";
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeDiagnosisTags(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const tags = [];
  for (const item of value) {
    const normalized = normalizeNonEmptyString(item).toUpperCase();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tags.push(normalized);
  }
  return tags;
}

module.exports = {
  executeCaptureSceneScreenshot,
};

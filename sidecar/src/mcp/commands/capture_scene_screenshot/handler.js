"use strict";

const { withMcpErrorFeedback } = require("../../../application/mcpGateway/mcpErrorFeedback");

const QUERY_TYPE = "capture_scene_screenshot";
const DEFAULT_CAPTURE_MODE = "render_output";
const COMPOSITE_CAPTURE_MODE = "composite";
const DISABLED_CAPTURE_MODES = new Set(["final_pixels", "editor_view"]);
const COMPOSITE_CAPTURE_ENV = "CAPTURE_COMPOSITE_ENABLED";
const COMPOSITE_FUSED_TAG = "COMPOSITE_FUSED";
const FALLBACK_REASON_COMPOSITE_FUSED = "composite_fused";

async function executeCaptureSceneScreenshot(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const compositeCaptureEnabled = isCompositeCaptureEnabled(ctx);
  const compositeRuntime = resolveCompositeRuntime(ctx);
  const requestedCaptureMode =
    normalizeCaptureMode(payload.capture_mode) || DEFAULT_CAPTURE_MODE;
  const isCompositeRequested = requestedCaptureMode === COMPOSITE_CAPTURE_MODE;
  let compositeRequestMode = "";
  let compositeRequestHeld = false;

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
  if (isCompositeRequested && !compositeCaptureEnabled) {
    return {
      statusCode: mapScreenshotErrorToStatusCode("E_CAPTURE_MODE_DISABLED"),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_CAPTURE_MODE_DISABLED",
        message:
          "capture_mode 'composite' is disabled. Set CAPTURE_COMPOSITE_ENABLED=true and retry.",
      }),
    };
  }

  if (isCompositeRequested) {
    const start = compositeRuntime.tryStartRequest(Date.now());
    if (!start || start.ok !== true) {
      return {
        statusCode: mapScreenshotErrorToStatusCode("E_COMPOSITE_BUSY"),
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: "E_COMPOSITE_BUSY",
          message:
            "Composite capture is already in progress. Wait for current request to finish and retry.",
        }),
      };
    }
    compositeRequestMode =
      typeof start.mode === "string" && start.mode.trim()
        ? start.mode.trim().toLowerCase()
        : "normal";
    compositeRequestHeld = true;
  }
  const compositeFusedFallbackApplied =
    isCompositeRequested && compositeRequestMode === "fallback";
  const unityPayload = compositeFusedFallbackApplied
    ? {
        ...payload,
        capture_mode: DEFAULT_CAPTURE_MODE,
      }
    : payload;
  const expectedEffectiveModes = buildExpectedEffectiveCaptureModes({
    requestedCaptureMode,
    compositeCaptureEnabled,
    allowRenderOutputFallback: compositeFusedFallbackApplied,
  });

  try {
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
        payload: unityPayload,
        timeoutMs: payload.timeout_ms,
      });
    } catch (error) {
      if (isCompositeRequested && !compositeFusedFallbackApplied) {
        compositeRuntime.recordCompositeFailure({
          kind: "error",
          mode: compositeRequestMode,
          reason:
            normalizeNonEmptyString(error && error.error_code) ||
            normalizeNonEmptyString(error && error.message) ||
            "unity_query_error",
          nowMs: Date.now(),
        });
      }
      return mapFailure(error);
    }

    if (!unityResponse || typeof unityResponse !== "object") {
      if (isCompositeRequested && !compositeFusedFallbackApplied) {
        compositeRuntime.recordCompositeFailure({
          kind: "error",
          mode: compositeRequestMode,
          reason: "invalid_unity_response",
          nowMs: Date.now(),
        });
      }
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
      if (isCompositeRequested && !compositeFusedFallbackApplied) {
        compositeRuntime.recordCompositeFailure({
          kind: "error",
          mode: compositeRequestMode,
          reason: errorCode || "unity_query_failed",
          nowMs: Date.now(),
        });
      }
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
    const reportedCaptureMode =
      normalizeCaptureModeLoose(data.capture_mode_effective) ||
      normalizeCaptureModeLoose(data.capture_mode) ||
      "";
    const effectiveCaptureMode =
      reportedCaptureMode ||
      (compositeFusedFallbackApplied ? DEFAULT_CAPTURE_MODE : requestedCaptureMode);
    const fallbackReasonRaw = normalizeNonEmptyString(data.fallback_reason);
    const compositeRenderOutputFallbackFromUnity =
      isCompositeRequested &&
      effectiveCaptureMode === DEFAULT_CAPTURE_MODE &&
      !compositeFusedFallbackApplied &&
      !!fallbackReasonRaw;
    if (
      !expectedEffectiveModes.has(effectiveCaptureMode) &&
      !compositeRenderOutputFallbackFromUnity
    ) {
      if (isCompositeRequested && !compositeFusedFallbackApplied) {
        compositeRuntime.recordCompositeFailure({
          kind: "error",
          mode: compositeRequestMode,
          reason: "unexpected_effective_mode",
          nowMs: Date.now(),
        });
      }
      return {
        statusCode: mapScreenshotErrorToStatusCode("E_CAPTURE_MODE_DISABLED"),
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: "E_CAPTURE_MODE_DISABLED",
          message:
            `Unity returned capture_mode_effective='${effectiveCaptureMode}', ` +
            `but current baseline only allows '${Array.from(expectedEffectiveModes).join("|")}'.`,
        }),
      };
    }

    const diagnosisTags = normalizeDiagnosisTags(data.diagnosis_tags);
    if (
      compositeRenderOutputFallbackFromUnity &&
      !diagnosisTags.includes("COMPOSITE_FALLBACK_RENDER_OUTPUT")
    ) {
      diagnosisTags.push("COMPOSITE_FALLBACK_RENDER_OUTPUT");
    }
    const allBlack = isAllBlackScreenshot(data, diagnosisTags);
    if (isCompositeRequested && !compositeFusedFallbackApplied) {
      if (allBlack) {
        compositeRuntime.recordCompositeFailure({
          kind: "black",
          mode: compositeRequestMode,
          reason: "ALL_BLACK",
          nowMs: Date.now(),
        });
      } else {
        compositeRuntime.recordCompositeSuccess({
          mode: compositeRequestMode,
          nowMs: Date.now(),
        });
      }
    }

    let fallbackReason =
      fallbackReasonRaw ||
      (effectiveCaptureMode !== requestedCaptureMode
        ? `fallback_to_${effectiveCaptureMode}`
        : "");
    if (compositeFusedFallbackApplied) {
      fallbackReason = appendFallbackReason(
        fallbackReason,
        FALLBACK_REASON_COMPOSITE_FUSED
      );
      if (!diagnosisTags.includes(COMPOSITE_FUSED_TAG)) {
        diagnosisTags.push(COMPOSITE_FUSED_TAG);
      }
    }
    if (fallbackReason && !diagnosisTags.includes("FALLBACK")) {
      diagnosisTags.push("FALLBACK");
    }
    const visualEvidence = normalizeVisualEvidence(data.visual_evidence, artifactUri);
    if (!artifactUri && !imageBase64) {
      if (isCompositeRequested && !compositeFusedFallbackApplied) {
        compositeRuntime.recordCompositeFailure({
          kind: "error",
          mode: compositeRequestMode,
          reason: "missing_screenshot_payload",
          nowMs: Date.now(),
        });
      }
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
          visual_evidence: visualEvidence,
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
  } finally {
    if (compositeRequestHeld) {
      compositeRuntime.endRequest();
    }
  }
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
  if (
    code === "E_COMPOSITE_BUSY" ||
    code === "E_COMPOSITE_PLAYMODE_REQUIRED" ||
    code === "E_COMPOSITE_CAPTURE_RESTRICTED"
  ) {
    return 409;
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
  const mode = normalizeCaptureModeLoose(value);
  if (
    mode === "render_output" ||
    mode === COMPOSITE_CAPTURE_MODE ||
    mode === "final_pixels" ||
    mode === "editor_view"
  ) {
    return mode;
  }
  return "";
}

function buildExpectedEffectiveCaptureModes(input) {
  const options = input && typeof input === "object" ? input : {};
  const requestedCaptureMode = normalizeCaptureMode(options.requestedCaptureMode);
  const compositeCaptureEnabled = options.compositeCaptureEnabled === true;
  const allowRenderOutputFallback = options.allowRenderOutputFallback === true;
  const modes = new Set();
  if (requestedCaptureMode === COMPOSITE_CAPTURE_MODE) {
    if (compositeCaptureEnabled) {
      modes.add(COMPOSITE_CAPTURE_MODE);
    }
    if (allowRenderOutputFallback) {
      modes.add(DEFAULT_CAPTURE_MODE);
    }
    return modes;
  }
  if (requestedCaptureMode === DEFAULT_CAPTURE_MODE) {
    modes.add(DEFAULT_CAPTURE_MODE);
    return modes;
  }
  if (compositeCaptureEnabled) {
    modes.add(COMPOSITE_CAPTURE_MODE);
  }
  modes.add(DEFAULT_CAPTURE_MODE);
  return modes;
}

function isCompositeCaptureEnabled(context) {
  if (context && typeof context.captureCompositeEnabled === "boolean") {
    return context.captureCompositeEnabled;
  }
  return readEnvBoolean(COMPOSITE_CAPTURE_ENV, false);
}

function readEnvBoolean(name, fallback) {
  const raw = process && process.env ? process.env[name] : undefined;
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  ) {
    return true;
  }
  if (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  ) {
    return false;
  }
  return fallback;
}

function normalizeCaptureModeLoose(value) {
  const mode = normalizeNonEmptyString(value).toLowerCase();
  return mode || "";
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function appendFallbackReason(existing, reason) {
  const current = normalizeNonEmptyString(existing);
  const next = normalizeNonEmptyString(reason);
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  return `${current};${next}`;
}

function isAllBlackScreenshot(data, diagnosisTags) {
  const payload = data && typeof data === "object" ? data : {};
  const sanity =
    payload.pixel_sanity && typeof payload.pixel_sanity === "object"
      ? payload.pixel_sanity
      : null;
  if (sanity && sanity.is_all_black === true) {
    return true;
  }
  return Array.isArray(diagnosisTags) && diagnosisTags.includes("ALL_BLACK");
}

function resolveCompositeRuntime(context) {
  const candidate =
    context && context.captureCompositeRuntime
      ? context.captureCompositeRuntime
      : null;
  if (
    candidate &&
    typeof candidate.tryStartRequest === "function" &&
    typeof candidate.endRequest === "function" &&
    typeof candidate.recordCompositeSuccess === "function" &&
    typeof candidate.recordCompositeFailure === "function"
  ) {
    return candidate;
  }
  return {
    tryStartRequest() {
      return { ok: true, mode: "normal" };
    },
    endRequest() {},
    recordCompositeSuccess() {},
    recordCompositeFailure() {},
  };
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

function normalizeVisualEvidence(value, artifactUri) {
  const source = value && typeof value === "object" ? value : null;
  return {
    artifact_uri:
      normalizeNonEmptyString(source && source.artifact_uri) || artifactUri || "",
    pixel_hash: normalizeNonEmptyString(source && source.pixel_hash),
    diff_summary: normalizeNonEmptyString(source && source.diff_summary),
  };
}

module.exports = {
  executeCaptureSceneScreenshot,
};

"use strict";

const {
  assertBlockRuntimePort,
  executeToolPlan: executeToolPlanViaPort,
} = require("../runtime");

const EXISTING_RUNTIME_BRIDGE_VERSION = "phase1_step2a_t4_v1";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeMappedToolPlan(mappedToolPlan) {
  const plan = isPlainObject(mappedToolPlan) ? mappedToolPlan : {};
  const toolName = normalizeString(plan.tool_name);
  const payload = isPlainObject(plan.payload) ? plan.payload : null;
  if (!toolName) {
    throw new TypeError(
      "[ExistingRuntimeBridge] mapped tool plan requires non-empty tool_name"
    );
  }
  if (!payload) {
    throw new TypeError("[ExistingRuntimeBridge] mapped tool plan payload must be object");
  }
  return {
    tool_name: toolName,
    payload,
  };
}

function normalizeRuntimePortOutcome(runtimeOutcome, toolName) {
  const outcome = isPlainObject(runtimeOutcome) ? runtimeOutcome : null;
  if (!outcome) {
    throw new TypeError(
      `[ExistingRuntimeBridge] runtime outcome must be object for tool: ${toolName}`
    );
  }
  const statusCode = Number(outcome.status_code);
  if (!Number.isFinite(statusCode)) {
    throw new TypeError(
      `[ExistingRuntimeBridge] runtime outcome status_code must be finite number for tool: ${toolName}`
    );
  }
  const ok = outcome.ok === true;
  const body = isPlainObject(outcome.body) ? outcome.body : {};
  return {
    ok,
    status_code: statusCode,
    body,
    tool_name: toolName,
  };
}

function buildRuntimeFailure(outcome) {
  const body = isPlainObject(outcome.body) ? outcome.body : {};
  const errorCode = normalizeString(body.error_code) || "E_SSOT_ROUTE_FAILED";
  const errorMessage =
    normalizeString(body.error_message) ||
    normalizeString(body.message) ||
    `Runtime execution failed for tool: ${outcome.tool_name}`;
  const suggestedAction = normalizeString(body.suggested_action);
  const retryPolicy = isPlainObject(body.retry_policy) ? body.retry_policy : null;

  const error = {
    error_code: errorCode,
    error_message: errorMessage,
  };
  const blockErrorCode = normalizeString(body.block_error_code);
  if (blockErrorCode) {
    error.block_error_code = blockErrorCode;
  }
  if (typeof body.recoverable === "boolean") {
    error.recoverable = body.recoverable;
  } else if (retryPolicy && typeof retryPolicy.can_retry === "boolean") {
    error.recoverable = retryPolicy.can_retry;
  }
  if (suggestedAction) {
    error.suggested_action = suggestedAction;
  }
  if (retryPolicy) {
    error.retry_policy = retryPolicy;
  }
  return error;
}

function pickSceneRevision(body, outputData) {
  const fromData =
    isPlainObject(outputData) && normalizeString(outputData.scene_revision);
  if (fromData) {
    return fromData;
  }
  return normalizeString(body.scene_revision);
}

function pickReadTokenCandidate(body, outputData) {
  const fromData =
    isPlainObject(outputData) && normalizeString(outputData.read_token_candidate);
  if (fromData) {
    return fromData;
  }
  return normalizeString(body.read_token_candidate);
}

function normalizeBridgeResult(outcome) {
  const body = isPlainObject(outcome.body) ? outcome.body : {};
  const bodyData = isPlainObject(body.data) ? body.data : {};
  if (outcome.ok !== true) {
    return {
      ok: false,
      tool_name: outcome.tool_name,
      status_code: outcome.status_code,
      error: buildRuntimeFailure(outcome),
      runtime_body: body,
      output_data: bodyData,
      scene_revision: "",
      read_token_candidate: "",
    };
  }

  const outputData = bodyData;
  return {
    ok: true,
    tool_name: outcome.tool_name,
    status_code: outcome.status_code,
    output_data: outputData,
    scene_revision: pickSceneRevision(body, outputData),
    read_token_candidate: pickReadTokenCandidate(body, outputData),
    runtime_body: body,
    error: null,
  };
}

function createExistingRuntimeBridge(options = {}) {
  const input = isPlainObject(options) ? options : {};
  const runtimePort = assertBlockRuntimePort(input.runtimePort, {
    label: "runtimePort",
  });

  return {
    async executeMappedToolPlan(mappedToolPlan) {
      const normalizedPlan = normalizeMappedToolPlan(mappedToolPlan);
      const runtimeOutcome = await executeToolPlanViaPort(
        runtimePort,
        normalizedPlan.tool_name,
        normalizedPlan.payload
      );
      const normalizedOutcome = normalizeRuntimePortOutcome(
        runtimeOutcome,
        normalizedPlan.tool_name
      );
      return normalizeBridgeResult(normalizedOutcome);
    },
  };
}

module.exports = {
  EXISTING_RUNTIME_BRIDGE_VERSION,
  createExistingRuntimeBridge,
};

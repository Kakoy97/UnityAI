"use strict";

const {
  BLOCK_TYPE,
  validateBlockResult,
} = require("../contracts");
const {
  mapBlockSpecToToolPlan,
  VERIFY_LOCAL_TOOL_NAME,
} = require("./BlockToToolPlanMapper");
const {
  EXISTING_RUNTIME_BRIDGE_VERSION,
  createExistingRuntimeBridge,
} = require("./ExistingRuntimeBridge");
const {
  materializeBlockSpecWithEffectiveToken,
} = require("./TokenFlowResolver");
const {
  createGenericPropertyFallbackPolicy,
} = require("./GenericPropertyFallbackPolicy");
const {
  buildSerializedPropertyFallbackPayload,
} = require("./GenericPropertyFallbackPayloadBuilder");
const {
  getGenericPropertyFallbackMetricsCollectorSingleton,
} = require("./genericPropertyFallbackMetricsCollector");

const EXECUTION_CHANNEL_ADAPTER_VERSION = "phase1_step2a_t4_v1";
const DEFAULT_CHANNEL_ID = "execution";
const DEFAULT_EXECUTION_SHAPE = "single_step";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeExecutionContext(context) {
  const source = isPlainObject(context) ? context : {};
  const channel = normalizeString(source.channel) || DEFAULT_CHANNEL_ID;
  const shape = normalizeString(source.shape) || DEFAULT_EXECUTION_SHAPE;
  const shapeReason = normalizeString(source.shape_reason);
  const shapeDegraded = source.shape_degraded === true;
  const planInitialReadToken = normalizeString(source.plan_initial_read_token);
  const previousReadTokenCandidate = normalizeString(
    source.previous_read_token_candidate
  );
  const transactionReadTokenCandidate = normalizeString(
    source.transaction_read_token_candidate
  );
  return {
    channel,
    shape,
    shape_reason: shapeReason,
    shape_degraded: shapeDegraded,
    plan_initial_read_token: planInitialReadToken,
    previous_read_token_candidate: previousReadTokenCandidate,
    transaction_read_token_candidate: transactionReadTokenCandidate,
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneMappingMeta(mappingMeta) {
  return isPlainObject(mappingMeta) ? { ...mappingMeta } : {};
}

function withFallbackMappingMeta(mappingMeta, updates = {}) {
  return {
    ...cloneMappingMeta(mappingMeta),
    ...updates,
  };
}

function summarizeBridgeFailure(bridgeResult, primaryToolName) {
  const source = isPlainObject(bridgeResult) ? bridgeResult : {};
  const error = isPlainObject(source.error) ? source.error : {};
  const outputData = isPlainObject(source.output_data) ? source.output_data : {};
  return {
    tool_name: normalizeString(primaryToolName),
    error_code: normalizeString(error.error_code) || "E_SSOT_ROUTE_FAILED",
    error_message:
      normalizeString(error.error_message) || "Primary tool execution failed",
    status_code: Number.isFinite(Number(source.status_code))
      ? Number(source.status_code)
      : 0,
    output_data: outputData,
  };
}

function mergeFallbackOutputData(baseOutputData, primaryFailureSummary) {
  const merged = {
    ...(isPlainObject(baseOutputData) ? baseOutputData : {}),
  };
  if (isPlainObject(primaryFailureSummary)) {
    merged.fallback_primary_failure = primaryFailureSummary;
  }
  return merged;
}

function selectFallbackToolName(mappingMeta) {
  const meta = cloneMappingMeta(mappingMeta);
  const candidates = normalizeArray(meta.fallback_candidates)
    .map((item) => normalizeString(item))
    .filter((item) => !!item);
  return candidates.length > 0 ? candidates[0] : "";
}

function shouldAttemptFallback(mappingMeta) {
  const meta = cloneMappingMeta(mappingMeta);
  const fallbackPolicyMode = normalizeString(meta.fallback_policy_mode);
  return (
    fallbackPolicyMode === "controlled" &&
    normalizeString(selectFallbackToolName(meta)).length > 0
  );
}

function classifyFallbackBlockedEvent(error) {
  const blockErrorCode = normalizeString(error && error.block_error_code);
  if (blockErrorCode === "E_BLOCK_FALLBACK_NOT_ALLOWED") {
    return "blocked_not_allowed";
  }
  return "blocked_precondition";
}

function buildFallbackPreflightFailureError({
  fallbackToolName,
  fallbackPayload,
  preflightBody,
  fallbackStatusCode = 0,
  bridgeError = null,
}) {
  const preflight = isPlainObject(preflightBody && preflightBody.preflight)
    ? preflightBody.preflight
    : {};
  const blockingErrors = Array.isArray(preflight.blocking_errors)
    ? preflight.blocking_errors
    : [];
  const firstBlockingError = isPlainObject(blockingErrors[0]) ? blockingErrors[0] : {};
  const fallbackMessage =
    normalizeString(firstBlockingError.message) ||
    normalizeString(bridgeError && bridgeError.error_message) ||
    "generic fallback preflight validation failed";
  return {
    error_code: "E_SCHEMA_INVALID",
    error_message: fallbackMessage,
    suggested_action: "preflight_validate_write_payload",
    retry_policy: {
      can_retry: true,
    },
    details: {
      fallback_tool_name: fallbackToolName,
      fallback_status_code: fallbackStatusCode,
      fallback_payload_preview: {
        target_object_id: normalizeString(fallbackPayload.target_object_id),
        target_path: normalizeString(fallbackPayload.target_path),
        component_type: normalizeString(fallbackPayload.component_type),
        property_path: normalizeString(fallbackPayload.property_path),
      },
      preflight,
      blocking_errors: blockingErrors,
    },
  };
}

function recordFallbackMetric(collector, eventType, familyKey, reasonCode) {
  if (!collector || typeof collector.recordDecision !== "function") {
    return;
  }
  collector.recordDecision({
    event_type: normalizeString(eventType),
    family_key: normalizeString(familyKey),
    reason_code: normalizeString(reasonCode),
  });
}

function buildExecutionMeta({
  executionContext,
  toolName,
  statusCode,
  mappingMeta,
  runtimeBridgeVersion,
  effectiveTokenSource = "",
}) {
  const meta = {
    channel: executionContext.channel,
    shape: executionContext.shape,
    adapter_version: EXECUTION_CHANNEL_ADAPTER_VERSION,
  };
  if (executionContext.shape_degraded === true) {
    meta.shape_degraded = true;
  }
  if (normalizeString(executionContext.shape_reason)) {
    meta.shape_reason = normalizeString(executionContext.shape_reason);
  }
  if (normalizeString(toolName)) {
    meta.tool_name = normalizeString(toolName);
  }
  if (Number.isFinite(Number(statusCode))) {
    meta.runtime_status_code = Number(statusCode);
  }
  if (isPlainObject(mappingMeta)) {
    meta.mapping_meta = mappingMeta;
  }
  if (normalizeString(runtimeBridgeVersion)) {
    meta.runtime_bridge_version = normalizeString(runtimeBridgeVersion);
  }
  const normalizedTokenSource = normalizeString(effectiveTokenSource);
  if (normalizedTokenSource) {
    meta.effective_read_token_source = normalizedTokenSource;
  }
  return meta;
}

function buildFailedBlockResult({
  blockSpec,
  executionContext,
  error,
  toolName = "",
  statusCode = 0,
  mappingMeta = null,
  runtimeBridgeVersion = "",
  effectiveTokenSource = "",
  outputData = null,
}) {
  const normalizedOutputData = isPlainObject(outputData) ? outputData : {};
  const result = {
    block_id: normalizeString(blockSpec && blockSpec.block_id) || "unknown_block",
    status: "failed",
    output_data: normalizedOutputData,
    execution_meta: buildExecutionMeta({
      executionContext,
      toolName,
      statusCode,
      mappingMeta,
      runtimeBridgeVersion,
      effectiveTokenSource,
    }),
    error: {
      error_code:
        normalizeString(error && error.error_code) || "E_BLOCK_EXECUTION_FAILED",
      error_message:
        normalizeString(error && error.error_message) ||
        "Block execution failed in execution adapter",
    },
  };
  const blockErrorCode = normalizeString(error && error.block_error_code);
  if (blockErrorCode) {
    result.error.block_error_code = blockErrorCode;
  }
  if (typeof (error && error.recoverable) === "boolean") {
    result.error.recoverable = error.recoverable;
  }
  const suggestedAction = normalizeString(error && error.suggested_action);
  if (suggestedAction) {
    result.error.suggested_action = suggestedAction;
  }
  if (isPlainObject(error && error.retry_policy)) {
    result.error.retry_policy = error.retry_policy;
  }
  if (typeof normalizedOutputData.transaction_rollback_applied === "boolean") {
    result.execution_meta.transaction_rollback_applied =
      normalizedOutputData.transaction_rollback_applied;
  }
  if (Array.isArray(normalizedOutputData.failed_blocks)) {
    result.execution_meta.failed_blocks = normalizedOutputData.failed_blocks;
  }
  return result;
}

function buildSucceededBlockResult({
  blockSpec,
  executionContext,
  bridgeResult,
  mappingMeta = null,
  runtimeBridgeVersion = "",
  effectiveTokenSource = "",
}) {
  const result = {
    block_id: normalizeString(blockSpec && blockSpec.block_id) || "unknown_block",
    status: "succeeded",
    output_data: isPlainObject(bridgeResult.output_data) ? bridgeResult.output_data : {},
    execution_meta: buildExecutionMeta({
      executionContext,
      toolName: bridgeResult.tool_name,
      statusCode: bridgeResult.status_code,
      mappingMeta,
      runtimeBridgeVersion,
      effectiveTokenSource,
    }),
  };
  const sceneRevision = normalizeString(bridgeResult.scene_revision);
  if (sceneRevision) {
    result.scene_revision = sceneRevision;
  }
  const readTokenCandidate = normalizeString(bridgeResult.read_token_candidate);
  if (readTokenCandidate) {
    result.read_token_candidate = readTokenCandidate;
  }
  return result;
}

function assertBlockResult(result, sourceLabel) {
  const outcome = validateBlockResult(result);
  if (!outcome.ok) {
    const details = JSON.stringify(outcome.errors || []);
    throw new TypeError(
      `[ExecutionChannelAdapter] invalid BlockResult from ${sourceLabel}: ${details}`
    );
  }
  return result;
}

function buildLocalVerifyBridgeResult(mappingOutcome) {
  const payload =
    mappingOutcome && isPlainObject(mappingOutcome.payload)
      ? mappingOutcome.payload
      : {};
  return {
    ok: true,
    status_code: 200,
    tool_name: VERIFY_LOCAL_TOOL_NAME,
    output_data: {
      verify_local_executed: true,
      verify_intent_key: normalizeString(payload.verify_intent_key),
      verify_input: isPlainObject(payload.verify_input) ? payload.verify_input : {},
    },
    scene_revision: "",
    read_token_candidate: "",
  };
}

function createExecutionChannelAdapter(options = {}) {
  const input = isPlainObject(options) ? options : {};
  const runtimeBridgeVersion =
    normalizeString(input.runtimeBridgeVersion) || EXISTING_RUNTIME_BRIDGE_VERSION;
  const runtimeBridge =
    isPlainObject(input.runtimeBridge) &&
    typeof input.runtimeBridge.executeMappedToolPlan === "function"
      ? input.runtimeBridge
      : createExistingRuntimeBridge({ runtimePort: input.runtimePort });
  const genericPropertyFallbackPolicy =
    input.genericPropertyFallbackPolicy &&
    typeof input.genericPropertyFallbackPolicy.evaluate === "function"
      ? input.genericPropertyFallbackPolicy
      : createGenericPropertyFallbackPolicy(input.genericPropertyFallbackPolicyContract);
  const genericPropertyFallbackMetricsCollector =
    input.genericPropertyFallbackMetricsCollector &&
    typeof input.genericPropertyFallbackMetricsCollector.recordDecision ===
      "function"
      ? input.genericPropertyFallbackMetricsCollector
      : getGenericPropertyFallbackMetricsCollectorSingleton();

  return {
    async executeBlock(blockSpec, context = {}) {
      const executionContext = normalizeExecutionContext(context);
      const materializedOutcome = materializeBlockSpecWithEffectiveToken(
        blockSpec,
        executionContext
      );
      const effectiveTokenSource = normalizeString(
        materializedOutcome &&
          materializedOutcome.token_flow &&
          materializedOutcome.token_flow.source
      );
      const effectiveBlockSpec =
        materializedOutcome &&
        materializedOutcome.block_spec &&
        typeof materializedOutcome.block_spec === "object"
          ? materializedOutcome.block_spec
          : blockSpec;

      const mappingOutcome = mapBlockSpecToToolPlan(effectiveBlockSpec);
      if (!mappingOutcome.ok) {
        return assertBlockResult(
          buildFailedBlockResult({
            blockSpec: effectiveBlockSpec,
            executionContext,
            error: mappingOutcome,
            mappingMeta: null,
            runtimeBridgeVersion,
            effectiveTokenSource,
          }),
          "mapping"
        );
      }

      if (normalizeString(mappingOutcome.tool_name) === VERIFY_LOCAL_TOOL_NAME) {
        return assertBlockResult(
          buildSucceededBlockResult({
            blockSpec: effectiveBlockSpec,
            executionContext,
            bridgeResult: buildLocalVerifyBridgeResult(mappingOutcome),
            mappingMeta: cloneMappingMeta(mappingOutcome.mapping_meta),
            runtimeBridgeVersion,
            effectiveTokenSource,
          }),
          "verify_local"
        );
      }

      const mappingMetaBase = cloneMappingMeta(mappingOutcome.mapping_meta);
      const bridgeResult = await runtimeBridge.executeMappedToolPlan({
        tool_name: mappingOutcome.tool_name,
        payload: mappingOutcome.payload,
      });

      if (!bridgeResult || typeof bridgeResult !== "object") {
        return assertBlockResult(
          buildFailedBlockResult({
            blockSpec: effectiveBlockSpec,
            executionContext,
            error: {
              error_code: "E_SSOT_ROUTE_FAILED",
              error_message: "Runtime bridge returned invalid outcome",
            },
            toolName: mappingOutcome.tool_name,
            mappingMeta: mappingMetaBase,
            runtimeBridgeVersion,
            effectiveTokenSource,
          }),
          "bridge_invalid"
        );
      }

      if (bridgeResult.ok !== true) {
        const primaryFailureSummary = summarizeBridgeFailure(
          bridgeResult,
          mappingOutcome.tool_name
        );
        const familyKey = normalizeString(mappingMetaBase.family_key);
        if (shouldAttemptFallback(mappingMetaBase)) {
          const fallbackToolName = selectFallbackToolName(mappingMetaBase);
          const fallbackPolicyDecision = genericPropertyFallbackPolicy.evaluate({
            block_spec: effectiveBlockSpec,
            mapping_meta: mappingMetaBase,
            fallback_tool_name: fallbackToolName,
            primary_bridge_error: primaryFailureSummary,
            primary_attempted: true,
          });
          recordFallbackMetric(
            genericPropertyFallbackMetricsCollector,
            "attempt",
            familyKey,
            normalizeString(fallbackPolicyDecision.reason_code) || "attempted"
          );
          if (!fallbackPolicyDecision.ok) {
            const blockedEventType = classifyFallbackBlockedEvent(
              fallbackPolicyDecision.error
            );
            recordFallbackMetric(
              genericPropertyFallbackMetricsCollector,
              blockedEventType,
              familyKey,
              normalizeString(fallbackPolicyDecision.reason_code) || blockedEventType
            );
            return assertBlockResult(
              buildFailedBlockResult({
                blockSpec: effectiveBlockSpec,
                executionContext,
                error: fallbackPolicyDecision.error,
                toolName: mappingOutcome.tool_name,
                statusCode: bridgeResult.status_code,
                mappingMeta: withFallbackMappingMeta(mappingMetaBase, {
                  fallback_attempted: true,
                  fallback_used: false,
                  fallback_reason:
                    normalizeString(fallbackPolicyDecision.fallback_reason) ||
                    "fallback_blocked",
                  selected_tool_name:
                    normalizeString(mappingMetaBase.primary_tool_name) ||
                    mappingOutcome.tool_name,
                }),
                runtimeBridgeVersion,
                effectiveTokenSource,
                outputData: mergeFallbackOutputData(
                  bridgeResult.output_data,
                  primaryFailureSummary
                ),
              }),
              "fallback_blocked"
            );
          }

          const fallbackPayloadOutcome = buildSerializedPropertyFallbackPayload({
            primary_payload: mappingOutcome.payload,
            block_spec: effectiveBlockSpec,
          });
          if (!fallbackPayloadOutcome.ok) {
            recordFallbackMetric(
              genericPropertyFallbackMetricsCollector,
              "blocked_precondition",
              familyKey,
              "fallback_payload_invalid"
            );
            return assertBlockResult(
              buildFailedBlockResult({
                blockSpec: effectiveBlockSpec,
                executionContext,
                error: fallbackPayloadOutcome.error,
                toolName: mappingOutcome.tool_name,
                statusCode: bridgeResult.status_code,
                mappingMeta: withFallbackMappingMeta(mappingMetaBase, {
                  fallback_attempted: true,
                  fallback_used: false,
                  fallback_reason: "fallback_payload_invalid",
                  selected_tool_name:
                    normalizeString(mappingMetaBase.primary_tool_name) ||
                    mappingOutcome.tool_name,
                }),
                runtimeBridgeVersion,
                effectiveTokenSource,
                outputData: mergeFallbackOutputData(
                  bridgeResult.output_data,
                  primaryFailureSummary
                ),
              }),
              "fallback_payload_invalid"
            );
          }

          const fallbackPreflightResult = await runtimeBridge.executeMappedToolPlan({
            tool_name: "preflight_validate_write_payload",
            payload: {
              tool_name: fallbackToolName,
              payload: fallbackPayloadOutcome.payload,
            },
          });
          const fallbackPreflightBody = isPlainObject(
            fallbackPreflightResult && fallbackPreflightResult.runtime_body
          )
            ? fallbackPreflightResult.runtime_body
            : {};
          const fallbackPreflightValid =
            fallbackPreflightResult &&
            fallbackPreflightResult.ok === true &&
            isPlainObject(fallbackPreflightBody.preflight) &&
            fallbackPreflightBody.preflight.valid === true;
          if (!fallbackPreflightValid) {
            recordFallbackMetric(
              genericPropertyFallbackMetricsCollector,
              "blocked_precondition",
              familyKey,
              "fallback_preflight_failed"
            );
            return assertBlockResult(
              buildFailedBlockResult({
                blockSpec: effectiveBlockSpec,
                executionContext,
                error: buildFallbackPreflightFailureError({
                  fallbackToolName,
                  fallbackPayload: fallbackPayloadOutcome.payload,
                  preflightBody: fallbackPreflightBody,
                  fallbackStatusCode:
                    Number.isFinite(
                      Number(fallbackPreflightResult && fallbackPreflightResult.status_code)
                    )
                      ? Number(fallbackPreflightResult.status_code)
                      : 0,
                  bridgeError:
                    fallbackPreflightResult && fallbackPreflightResult.error,
                }),
                toolName: fallbackToolName,
                statusCode:
                  Number.isFinite(
                    Number(fallbackPreflightResult && fallbackPreflightResult.status_code)
                  )
                    ? Number(fallbackPreflightResult.status_code)
                    : 0,
                mappingMeta: withFallbackMappingMeta(mappingMetaBase, {
                  fallback_attempted: true,
                  fallback_used: false,
                  fallback_reason: "fallback_preflight_failed",
                  selected_tool_name:
                    normalizeString(mappingMetaBase.primary_tool_name) ||
                    mappingOutcome.tool_name,
                }),
                runtimeBridgeVersion,
                effectiveTokenSource,
                outputData: mergeFallbackOutputData(
                  bridgeResult.output_data,
                  primaryFailureSummary
                ),
              }),
              "fallback_preflight_failed"
            );
          }

          recordFallbackMetric(
            genericPropertyFallbackMetricsCollector,
            "used",
            familyKey,
            normalizeString(fallbackPolicyDecision.reason_code) || "fallback_used"
          );
          const fallbackBridgeResult = await runtimeBridge.executeMappedToolPlan({
            tool_name: fallbackToolName,
            payload: fallbackPayloadOutcome.payload,
          });
          if (!fallbackBridgeResult || typeof fallbackBridgeResult !== "object") {
            recordFallbackMetric(
              genericPropertyFallbackMetricsCollector,
              "failure",
              familyKey,
              "fallback_bridge_invalid"
            );
            return assertBlockResult(
              buildFailedBlockResult({
                blockSpec: effectiveBlockSpec,
                executionContext,
                error: {
                  error_code: "E_SSOT_ROUTE_FAILED",
                  error_message:
                    "Runtime bridge returned invalid outcome during generic fallback",
                },
                toolName: fallbackToolName,
                mappingMeta: withFallbackMappingMeta(mappingMetaBase, {
                  fallback_attempted: true,
                  fallback_used: true,
                  fallback_reason:
                    normalizeString(fallbackPolicyDecision.fallback_reason) ||
                    "fallback_bridge_invalid",
                  selected_tool_name: fallbackToolName,
                }),
                runtimeBridgeVersion,
                effectiveTokenSource,
                outputData: mergeFallbackOutputData(
                  bridgeResult.output_data,
                  primaryFailureSummary
                ),
              }),
              "fallback_bridge_invalid"
            );
          }

          if (fallbackBridgeResult.ok !== true) {
            recordFallbackMetric(
              genericPropertyFallbackMetricsCollector,
              "failure",
              familyKey,
              normalizeString(
                fallbackBridgeResult.error && fallbackBridgeResult.error.error_code
              ) || "fallback_runtime_failure"
            );
            return assertBlockResult(
              buildFailedBlockResult({
                blockSpec: effectiveBlockSpec,
                executionContext,
                error: fallbackBridgeResult.error,
                toolName: fallbackBridgeResult.tool_name || fallbackToolName,
                statusCode: fallbackBridgeResult.status_code,
                mappingMeta: withFallbackMappingMeta(mappingMetaBase, {
                  fallback_attempted: true,
                  fallback_used: true,
                  fallback_reason:
                    normalizeString(fallbackPolicyDecision.fallback_reason) ||
                    "fallback_runtime_failure",
                  selected_tool_name: fallbackToolName,
                }),
                runtimeBridgeVersion,
                effectiveTokenSource,
                outputData: mergeFallbackOutputData(
                  fallbackBridgeResult.output_data,
                  primaryFailureSummary
                ),
              }),
              "fallback_runtime_failure"
            );
          }

          recordFallbackMetric(
            genericPropertyFallbackMetricsCollector,
            "success",
            familyKey,
            normalizeString(fallbackPolicyDecision.reason_code) || "fallback_success"
          );
          return assertBlockResult(
            buildSucceededBlockResult({
              blockSpec: effectiveBlockSpec,
              executionContext,
              bridgeResult: {
                ...fallbackBridgeResult,
                output_data: mergeFallbackOutputData(
                  fallbackBridgeResult.output_data,
                  primaryFailureSummary
                ),
              },
              mappingMeta: withFallbackMappingMeta(mappingMetaBase, {
                fallback_attempted: true,
                fallback_used: true,
                fallback_reason:
                  normalizeString(fallbackPolicyDecision.fallback_reason) ||
                  "controlled_generic_property_fallback",
                selected_tool_name: fallbackToolName,
              }),
              runtimeBridgeVersion,
              effectiveTokenSource,
            }),
            "runtime_success_fallback"
          );
        }

        return assertBlockResult(
          buildFailedBlockResult({
            blockSpec: effectiveBlockSpec,
            executionContext,
            error: bridgeResult.error,
            toolName: bridgeResult.tool_name || mappingOutcome.tool_name,
            statusCode: bridgeResult.status_code,
            mappingMeta: mappingMetaBase,
            runtimeBridgeVersion,
            effectiveTokenSource,
            outputData: bridgeResult.output_data,
          }),
          "runtime_failure"
        );
      }

      return assertBlockResult(
        buildSucceededBlockResult({
          blockSpec: effectiveBlockSpec,
          executionContext,
          bridgeResult,
          mappingMeta: mappingMetaBase,
          runtimeBridgeVersion,
          effectiveTokenSource,
        }),
        "runtime_success"
      );
    },

    supports(blockSpec) {
      const blockType = normalizeString(blockSpec && blockSpec.block_type);
      return (
        blockType === BLOCK_TYPE.READ_STATE ||
        blockType === BLOCK_TYPE.CREATE ||
        blockType === BLOCK_TYPE.MUTATE ||
        blockType === BLOCK_TYPE.VERIFY
      );
    },
  };
}

module.exports = {
  DEFAULT_CHANNEL_ID,
  DEFAULT_EXECUTION_SHAPE,
  EXECUTION_CHANNEL_ADAPTER_VERSION,
  createExecutionChannelAdapter,
};

"use strict";

const {
  FAMILY_TOOL_MIGRATION_MATRIX,
  FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE,
  INTENT_KEY_SOURCE,
  INTENT_TO_TOOL_BY_BLOCK_TYPE,
  MAPPING_VERSION,
  VERIFY_LOCAL_TOOL_NAME,
  mapBlockSpecToToolPlan,
  resolveMappingByIntent,
  isLegacyConcreteKeyCompatEnabled,
  resolveDisabledFamilyKeySet,
} = require("./BlockToToolPlanMapper");
const {
  EXISTING_RUNTIME_BRIDGE_VERSION,
  createExistingRuntimeBridge,
} = require("./ExistingRuntimeBridge");
const {
  DEFAULT_CHANNEL_ID,
  DEFAULT_EXECUTION_SHAPE,
  EXECUTION_CHANNEL_ADAPTER_VERSION,
  createExecutionChannelAdapter,
} = require("./ExecutionChannelAdapter");
const {
  GENERIC_PROPERTY_FALLBACK_POLICY_VERSION,
  createGenericPropertyFallbackPolicy,
} = require("./GenericPropertyFallbackPolicy");
const {
  FALLBACK_POLICY_GUARD_VERSION,
  GENERIC_FALLBACK_STRICT_ENV_KEY,
  resolveGenericFallbackStrictEnabled,
  evaluateFallbackPolicyGuard,
} = require("./FallbackPolicyGuard");
const {
  buildSerializedPropertyFallbackPayload,
} = require("./GenericPropertyFallbackPayloadBuilder");
const {
  METRICS_SCHEMA_VERSION: GENERIC_PROPERTY_FALLBACK_METRICS_SCHEMA_VERSION,
  GenericPropertyFallbackMetricsCollector,
  getGenericPropertyFallbackMetricsCollectorSingleton,
  resetGenericPropertyFallbackMetricsCollectorSingleton,
} = require("./genericPropertyFallbackMetricsCollector");
const {
  TOKEN_FLOW_RESOLVER_VERSION,
  EFFECTIVE_TOKEN_SOURCE,
  resolveEffectiveReadTokenForBlock,
  materializeBlockSpecWithEffectiveToken,
  extractReadTokenCandidateFromBlockResult,
} = require("./TokenFlowResolver");

module.exports = {
  FAMILY_TOOL_MIGRATION_MATRIX,
  FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE,
  INTENT_KEY_SOURCE,
  INTENT_TO_TOOL_BY_BLOCK_TYPE,
  MAPPING_VERSION,
  VERIFY_LOCAL_TOOL_NAME,
  mapBlockSpecToToolPlan,
  resolveMappingByIntent,
  isLegacyConcreteKeyCompatEnabled,
  resolveDisabledFamilyKeySet,
  EXISTING_RUNTIME_BRIDGE_VERSION,
  createExistingRuntimeBridge,
  DEFAULT_CHANNEL_ID,
  DEFAULT_EXECUTION_SHAPE,
  EXECUTION_CHANNEL_ADAPTER_VERSION,
  createExecutionChannelAdapter,
  FALLBACK_POLICY_GUARD_VERSION,
  GENERIC_FALLBACK_STRICT_ENV_KEY,
  resolveGenericFallbackStrictEnabled,
  evaluateFallbackPolicyGuard,
  GENERIC_PROPERTY_FALLBACK_POLICY_VERSION,
  createGenericPropertyFallbackPolicy,
  buildSerializedPropertyFallbackPayload,
  GENERIC_PROPERTY_FALLBACK_METRICS_SCHEMA_VERSION,
  GenericPropertyFallbackMetricsCollector,
  getGenericPropertyFallbackMetricsCollectorSingleton,
  resetGenericPropertyFallbackMetricsCollectorSingleton,
  TOKEN_FLOW_RESOLVER_VERSION,
  EFFECTIVE_TOKEN_SOURCE,
  resolveEffectiveReadTokenForBlock,
  materializeBlockSpecWithEffectiveToken,
  extractReadTokenCandidateFromBlockResult,
};

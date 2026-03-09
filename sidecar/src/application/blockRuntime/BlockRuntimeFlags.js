"use strict";

const BLOCK_RUNTIME_FLAGS_VERSION = "phase1_step2b_t2_v1";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function resolveBlockRuntimeFlags(input = {}) {
  const source = isPlainObject(input) ? input : {};
  if (
    typeof source.pipeline_enabled === "boolean" &&
    typeof source.bypass_router === "boolean" &&
    typeof source.force_single_step === "boolean" &&
    typeof source.verify_recovery_enabled === "boolean"
  ) {
    const pipelineEnabled = source.pipeline_enabled;
    const bypassRouter = pipelineEnabled ? source.bypass_router : false;
    const forceSingleStep = pipelineEnabled ? source.force_single_step : false;
    const verifyRecoveryEnabled = pipelineEnabled
      ? source.verify_recovery_enabled
      : false;
    return Object.freeze({
      version:
        typeof source.version === "string" && source.version.trim()
          ? source.version.trim()
          : BLOCK_RUNTIME_FLAGS_VERSION,
      pipeline_enabled: pipelineEnabled,
      bypass_router: bypassRouter,
      force_single_step: forceSingleStep,
      verify_recovery_enabled: verifyRecoveryEnabled,
      router_mode: pipelineEnabled
        ? bypassRouter
          ? "bypass_router"
          : "router"
        : "disabled",
      shape_mode: pipelineEnabled
        ? forceSingleStep
          ? "force_single_step"
          : "dynamic"
        : "disabled",
      verify_recovery_mode: verifyRecoveryEnabled ? "enabled" : "disabled",
    });
  }

  const pipelineEnabled = normalizeBoolean(source.blockPipelineEnabled, false);
  const bypassRouterRequested = normalizeBoolean(source.bypassRouter, true);
  const forceSingleStepRequested = normalizeBoolean(source.forceSingleStep, false);
  const verifyRecoveryRequested = normalizeBoolean(
    source.verifyRecoveryEnabled,
    false
  );

  const bypassRouter = pipelineEnabled ? bypassRouterRequested : false;
  const forceSingleStep = pipelineEnabled ? forceSingleStepRequested : false;
  const verifyRecoveryEnabled = pipelineEnabled ? verifyRecoveryRequested : false;

  return Object.freeze({
    version: BLOCK_RUNTIME_FLAGS_VERSION,
    pipeline_enabled: pipelineEnabled,
    bypass_router: bypassRouter,
    force_single_step: forceSingleStep,
    verify_recovery_enabled: verifyRecoveryEnabled,
    router_mode: pipelineEnabled
      ? bypassRouter
        ? "bypass_router"
        : "router"
      : "disabled",
    shape_mode: pipelineEnabled
      ? forceSingleStep
        ? "force_single_step"
        : "dynamic"
      : "disabled",
    verify_recovery_mode: verifyRecoveryEnabled ? "enabled" : "disabled",
  });
}

function applyBlockRuntimeFlagsToExecutionContext(flags, context = {}) {
  const resolved = resolveBlockRuntimeFlags(flags);
  const source = isPlainObject(context) ? { ...context } : {};
  if (resolved.force_single_step) {
    source.shape = "single_step";
    source.shape_reason = "forced_by_block_runtime_flag";
    source.shape_degraded = true;
  }
  return {
    flags: resolved,
    execution_context: source,
  };
}

module.exports = {
  BLOCK_RUNTIME_FLAGS_VERSION,
  resolveBlockRuntimeFlags,
  applyBlockRuntimeFlagsToExecutionContext,
};

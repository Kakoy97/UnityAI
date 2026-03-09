"use strict";
/**
 * R11-ARCH-01 Responsibility boundary:
 * - TurnService coordinates shared application services and orchestration primitives.
 * - TurnService must not expose MCP stdio tool catalogs or raw HTTP route branching.
 * - Command-specific schemas/policies belong to validators + command modules, not adapters.
 */

const {
  validateUnitySelectionSnapshot,
  validateUnityCapabilitiesReport,
  validateUnityRuntimePing,
} = require("../domain/validators");
const {
  normalizeSelectionComponentIndex,
} = require("../utils/turnUtils");
const { ResponseCacheService } = require("./responseCacheService");
const { UnitySnapshotService } = require("./unitySnapshotService");
const { QueryStore } = require("./queryRuntime/queryStore");
const { QueryCoordinator } = require("./queryCoordinator");
const { CapabilityStore } = require("./capabilityStore");
const {
  normalizeRequestId,
  buildValidationErrorResponse: buildValidationErrorResponseHelper,
} = require("./turnServiceWriteSupport");
const { UnityTestRunnerService } = require("./unityTestRunnerService");
const {
  createCaptureCompositeRuntime,
} = require("./captureCompositeRuntime");
const {
  getPlannerDirectCompatibilityMetricsCollectorSingleton,
} = require("./blockRuntime/visibility/plannerDirectCompatibilityMetricsCollector");
const {
  getGenericPropertyFallbackMetricsCollectorSingleton,
} = require("./blockRuntime/execution/genericPropertyFallbackMetricsCollector");
const { dispatchSsotRequest } = require("./ssotRuntime/dispatchSsotRequest");
const {
  getValidatorRegistrySingleton,
} = require("./ssotRuntime/validatorRegistry");
const {
  getSsotTokenRegistrySingleton,
} = require("./ssotRuntime/ssotTokenRegistry");
const {
  getSsotRevisionStateSingleton,
} = require("./ssotRuntime/ssotRevisionState");
const { validateSsotWriteToken } = require("./ssotRuntime/ssotWriteTokenGuard");
const {
  getTokenLifecycleOrchestratorSingleton,
} = require("./ssotRuntime/tokenLifecycleOrchestrator");
const {
  getTokenLifecycleMetricsCollectorSingleton,
} = require("./ssotRuntime/tokenLifecycleMetricsCollector");
const {
  getTokenDriftRecoveryCoordinatorSingleton,
} = require("./ssotRuntime/tokenDriftRecoveryCoordinator");
const {
  getActionCatalogView,
  getActionSchemaView,
  getToolSchemaView,
  getWriteContractBundleView,
} = require("./ssotRuntime/staticContractViews");
const {
  guardExecuteUnityTransactionSteps,
} = require("./ssotRuntime/transactionPolicyGuard");
const {
  setupCursorMcp,
  verifyCursorMcpSetup,
} = require("./cursorMcpSetupService");
const { withMcpErrorFeedback } = require("./errorFeedback/mcpErrorFeedback");
const {
  normalizeSsotErrorCodeForMcp,
} = require("./errorFeedback/ssotErrorCodeCanon");
const {
  normalizeFailureContext,
  projectFailureDataFromContext,
} = require("./errorFeedback/failureContextNormalizer");
const {
  createExecutionChannelAdapter,
} = require("./blockRuntime/execution");
const {
  createTurnServiceRuntimePort,
} = require("./blockRuntime/runtime");
const {
  createThinBlockRouter,
} = require("./blockRuntime/routing");
const {
  createExecutionShapeDecider,
} = require("./blockRuntime/shape");
const {
  createVerifyHook,
  createRecoveryHook,
} = require("./blockRuntime/hooks");
const {
  createPlannerEntryTranslator,
  createPlannerEntryNormalizer,
  createPlannerEntryErrorHintBuilder,
  getPlannerUxMetricsCollectorSingleton,
  createInternalToolInvoker,
  createPlannerExitPolicy,
} = require("./blockRuntime/entry");
const {
  resolveBlockRuntimeFlags,
  applyBlockRuntimeFlagsToExecutionContext,
} = require("./blockRuntime/BlockRuntimeFlags");
const {
  createPlannerVisibilityProfileRuntime,
} = require("./blockRuntime/visibility/PlannerVisibilityProfileRuntime");
const {
  createPlannerDirectCompatibilityRuntime,
} = require("./blockRuntime/visibility/PlannerDirectCompatibilityRuntime");
const {
  MCP_ENTRY_GOVERNANCE_CONTRACT,
  MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT,
  MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT,
  MCP_PLANNER_EXIT_POLICY_CONTRACT,
  MCP_PLANNER_GENERIC_PROPERTY_FALLBACK_POLICY_CONTRACT,
} = require("../ports/contracts");

const SESSION_CACHE_TTL_MS = 15 * 60 * 1000;

function mapSetupCursorMcpErrorToStatusCode(errorCode) {
  const code =
    typeof errorCode === "string" && errorCode.trim()
      ? errorCode.trim().toUpperCase()
      : "";
  if (code === "E_SCHEMA_INVALID" || code === "E_SSOT_SCHEMA_INVALID") {
    return 400;
  }
  if (code === "E_CURSOR_MCP_PATH_NOT_ALLOWED") {
    return 409;
  }
  if (code === "E_CURSOR_MCP_SERVER_NOT_FOUND") {
    return 500;
  }
  return 500;
}

function mapRunUnityTestsErrorToStatusCode(errorCode) {
  const code =
    typeof errorCode === "string" && errorCode.trim()
      ? errorCode.trim().toUpperCase()
      : "";
  if (
    code === "E_SCHEMA_INVALID" ||
    code === "E_SSOT_SCHEMA_INVALID"
  ) {
    return 400;
  }
  if (code === "E_UNITY_TEST_QUERY_UNAVAILABLE") {
    return 502;
  }
  if (code === "E_UNITY_TEST_EDITOR_BUSY") {
    return 409;
  }
  if (code === "E_UNITY_TEST_TIMEOUT") {
    return 504;
  }
  if (code === "E_UNITY_TEST_RUN_FAILED") {
    return 502;
  }
  return 500;
}

function toNonNegativeMetric(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function mergeShapeDecisionIntoExecutionContext(executionContext, shapeDecision) {
  const context =
    executionContext &&
    typeof executionContext === "object" &&
    !Array.isArray(executionContext)
      ? { ...executionContext }
      : {};
  const decision =
    shapeDecision && typeof shapeDecision === "object" && !Array.isArray(shapeDecision)
      ? shapeDecision
      : null;
  if (!decision) {
    return context;
  }
  if (typeof decision.shape === "string" && decision.shape.trim()) {
    context.shape = decision.shape.trim();
  }
  if (typeof decision.shape_reason === "string" && decision.shape_reason.trim()) {
    context.shape_reason = decision.shape_reason.trim();
  }
  if (typeof decision.shape_degraded === "boolean") {
    context.shape_degraded = decision.shape_degraded;
  }
  if (typeof decision.original_shape === "string" && decision.original_shape.trim()) {
    context.original_shape = decision.original_shape.trim();
  } else {
    delete context.original_shape;
  }
  if (typeof decision.degraded_reason === "string" && decision.degraded_reason.trim()) {
    context.degraded_reason = decision.degraded_reason.trim();
  } else {
    delete context.degraded_reason;
  }
  return context;
}

function normalizeTokenAutomationEnvelope(source) {
  const raw =
    source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const rawData =
    raw.data && typeof raw.data === "object" && !Array.isArray(raw.data)
      ? raw.data
      : {};
  const topLevel =
    raw.token_automation &&
    typeof raw.token_automation === "object" &&
    !Array.isArray(raw.token_automation)
      ? raw.token_automation
      : null;
  const dataLevel =
    rawData.token_automation &&
    typeof rawData.token_automation === "object" &&
    !Array.isArray(rawData.token_automation)
      ? rawData.token_automation
      : null;

  const envelope = topLevel ? { ...topLevel } : dataLevel ? { ...dataLevel } : {};
  if (typeof envelope.auto_refreshed !== "boolean") {
    envelope.auto_refreshed =
      typeof rawData.read_token_candidate === "string" &&
      rawData.read_token_candidate.trim().length > 0;
  }
  if (typeof envelope.auto_retry_attempted !== "boolean") {
    envelope.auto_retry_attempted = false;
  }
  if (typeof envelope.auto_retry_succeeded !== "boolean") {
    envelope.auto_retry_succeeded = false;
  }
  if (typeof envelope.auto_recovery_triggered !== "boolean") {
    envelope.auto_recovery_triggered = false;
  }
  return envelope;
}

function buildTokenAutomationBridge(source) {
  const tokenAutomation = normalizeTokenAutomationEnvelope(source);
  const bridge = {
    token_automation: tokenAutomation,
  };
  const passthroughKeys = [
    "auto_refreshed",
    "auto_retry_attempted",
    "auto_retry_succeeded",
    "auto_retry_failure_reason",
    "auto_retry_timeout",
    "auto_recovery_triggered",
    "auto_recovery_reason",
    "auto_recovery_duration_ms",
    "auto_recovery_blocked_reason",
    "recovery_source",
    "refreshed_token_issued",
  ];
  for (const key of passthroughKeys) {
    if (Object.prototype.hasOwnProperty.call(tokenAutomation, key)) {
      bridge[key] = tokenAutomation[key];
    }
  }
  return bridge;
}

function attachTokenAutomationToData(data, tokenAutomation) {
  const source =
    data && typeof data === "object" && !Array.isArray(data) ? data : {};
  const automation =
    tokenAutomation &&
    typeof tokenAutomation === "object" &&
    !Array.isArray(tokenAutomation)
      ? tokenAutomation
      : null;
  if (!automation) {
    return source;
  }
  if (
    source.token_automation &&
    typeof source.token_automation === "object" &&
    !Array.isArray(source.token_automation)
  ) {
    return source;
  }
  return {
    ...source,
    token_automation: automation,
  };
}

function buildTokenAutomationMetricsSnapshot(
  tokenLifecycleMetrics,
  tokenRecoveryMetrics
) {
  const lifecycleTotals =
    tokenLifecycleMetrics &&
    tokenLifecycleMetrics.totals &&
    typeof tokenLifecycleMetrics.totals === "object"
      ? tokenLifecycleMetrics.totals
      : {};
  const recoveryTotals =
    tokenRecoveryMetrics &&
    tokenRecoveryMetrics.totals &&
    typeof tokenRecoveryMetrics.totals === "object"
      ? tokenRecoveryMetrics.totals
      : {};
  const recoveryDuration =
    tokenRecoveryMetrics &&
    tokenRecoveryMetrics.duration_ms &&
    typeof tokenRecoveryMetrics.duration_ms === "object"
      ? tokenRecoveryMetrics.duration_ms
      : {};

  return {
    schema_version: "token_automation_metrics.v1",
    token_auto_refresh_total: toNonNegativeMetric(
      lifecycleTotals.continuation_issued_total
    ),
    token_auto_retry_attempt_total: toNonNegativeMetric(
      recoveryTotals.attempt_total
    ),
    token_auto_retry_success_total: toNonNegativeMetric(
      recoveryTotals.success_total
    ),
    token_auto_retry_fail_total: toNonNegativeMetric(recoveryTotals.fail_total),
    token_auto_retry_blocked_total: toNonNegativeMetric(
      recoveryTotals.blocked_total
    ),
    token_auto_retry_duration_p95_ms: toNonNegativeMetric(recoveryDuration.p95),
  };
}

const MCP_ENTRY_MODE = Object.freeze({
  LEGACY: "legacy",
  OBSERVE: "observe",
  REJECT: "reject",
});

function normalizeMcpEntryMode(value) {
  const normalized =
    typeof value === "string" && value.trim() ? value.trim().toLowerCase() : "";
  if (
    normalized === MCP_ENTRY_MODE.LEGACY ||
    normalized === MCP_ENTRY_MODE.OBSERVE ||
    normalized === MCP_ENTRY_MODE.REJECT
  ) {
    return normalized;
  }
  return MCP_ENTRY_MODE.REJECT;
}

function resolveMcpEntryGovernanceState(deps = {}) {
  const source = deps && typeof deps === "object" ? deps : {};
  const contract =
    MCP_ENTRY_GOVERNANCE_CONTRACT &&
    typeof MCP_ENTRY_GOVERNANCE_CONTRACT === "object"
      ? MCP_ENTRY_GOVERNANCE_CONTRACT
      : {};
  const enabled =
    typeof source.mcpEntryGovernanceEnabled === "boolean"
      ? source.mcpEntryGovernanceEnabled
      : contract.enabled === true;
  const requestedMode = normalizeMcpEntryMode(
    typeof source.mcpEntryMode === "string" && source.mcpEntryMode.trim()
      ? source.mcpEntryMode
      : contract.mode
  );
  const observeShadow =
    typeof source.mcpEntryObserveShadow === "boolean"
      ? source.mcpEntryObserveShadow
      : contract.observe_shadow === true;
  return Object.freeze({
    enabled,
    requested_mode: requestedMode,
    active_mode: enabled ? requestedMode : MCP_ENTRY_MODE.LEGACY,
    observe_shadow: observeShadow,
    planner_primary_tool_name:
      typeof contract.planner_primary_tool_name === "string" &&
      contract.planner_primary_tool_name.trim()
        ? contract.planner_primary_tool_name.trim()
        : "planner_execute_mcp",
    planner_alias_tool_name:
      typeof contract.planner_alias_tool_name === "string" &&
      contract.planner_alias_tool_name.trim()
        ? contract.planner_alias_tool_name.trim()
        : "",
    supported_modes: Array.isArray(contract.supported_modes)
      ? contract.supported_modes
      : [MCP_ENTRY_MODE.LEGACY, MCP_ENTRY_MODE.OBSERVE, MCP_ENTRY_MODE.REJECT],
  });
}

class TurnService {
  constructor(deps) {
    this.turnStore = deps.turnStore;
    this.nowIso = deps.nowIso;
    this.fileActionExecutor = deps.fileActionExecutor;
    this.sessionCacheTtlMs =
      Number(deps.sessionCacheTtlMs) > 0
        ? Number(deps.sessionCacheTtlMs)
        : SESSION_CACHE_TTL_MS;
    this.v1PolishMetricsCollector =
      deps.v1PolishMetricsCollector &&
      typeof deps.v1PolishMetricsCollector === "object"
        ? deps.v1PolishMetricsCollector
        : null;
    this.captureCompositeEnabled = deps.captureCompositeEnabled === true;
    this.blockRuntimeFlags = resolveBlockRuntimeFlags({
      blockPipelineEnabled: deps.blockPipelineEnabled === true,
      bypassRouter: deps.blockBypassRouter !== false,
      forceSingleStep: deps.blockForceSingleStep === true,
      verifyRecoveryEnabled: deps.blockVerifyRecoveryEnabled === true,
    });
    this.mcpEntryGovernanceState = resolveMcpEntryGovernanceState(deps);
    this.blockRuntimeExecutionAdapter = null;
    this.blockRuntimeRouter = null;
    this.blockRuntimeShapeDecider = null;
    this.blockRuntimeVerifyHook = null;
    this.blockRuntimeRecoveryHook = null;
    this.plannerEntryTranslator = null;
    this.plannerEntryNormalizer = null;
    this.plannerEntryErrorHintBuilder = null;
    this.plannerUxMetricsCollector =
      deps.plannerUxMetricsCollector &&
      typeof deps.plannerUxMetricsCollector.recordAttempt === "function" &&
      typeof deps.plannerUxMetricsCollector.getSnapshot === "function"
        ? deps.plannerUxMetricsCollector
        : getPlannerUxMetricsCollectorSingleton();
    this.internalToolInvoker = null;
    this.plannerExitPolicy =
      deps.plannerExitPolicy && typeof deps.plannerExitPolicy.evaluate === "function"
        ? deps.plannerExitPolicy
        : null;
    this.captureCompositeRuntime = createCaptureCompositeRuntime({
      enabled: this.captureCompositeEnabled,
      fuseFailureThreshold: deps.captureCompositeFuseFailureThreshold,
      fuseCooldownMs: deps.captureCompositeFuseCooldownMs,
    });
    this.unityQueryContractVersion =
      typeof deps.unityQueryContractVersion === "string" &&
      deps.unityQueryContractVersion.trim()
        ? deps.unityQueryContractVersion.trim()
        : "unity.query.v2";

    this.responseCacheService = new ResponseCacheService({
      sessionCacheTtlMs: this.sessionCacheTtlMs,
    });
    this.unitySnapshotService = new UnitySnapshotService({
      nowIso: this.nowIso,
      readTokenHardMaxAgeMs: deps.readTokenHardMaxAgeMs,
    });
    this.capabilityStore = new CapabilityStore({
      nowIso: this.nowIso,
      capabilityStaleAfterMs: deps.mcpCapabilityStaleAfterMs,
    });
    this.queryStore = new QueryStore({
      terminalRetentionMs: deps.unityQueryTerminalRetentionMs,
      maxEntries: deps.unityQueryMaxEntries,
    });
    this.queryCoordinator = new QueryCoordinator({
      nowIso: this.nowIso,
      queryStore: this.queryStore,
      defaultTimeoutMs: deps.unityQueryTimeoutMs,
      maxTimeoutMs: deps.unityQueryMaxTimeoutMs,
      defaultQueryContractVersion: this.unityQueryContractVersion,
    });
    this.ssotValidatorRegistry = getValidatorRegistrySingleton();
    this.ssotTokenRegistry = getSsotTokenRegistrySingleton({
      nowIso: this.nowIso,
    });
    this.ssotRevisionState = getSsotRevisionStateSingleton({
      nowIso: this.nowIso,
    });
    this.ssotTokenLifecycleOrchestrator = getTokenLifecycleOrchestratorSingleton({
      validatorRegistry: this.ssotValidatorRegistry,
      tokenRegistry: this.ssotTokenRegistry,
      revisionState: this.ssotRevisionState,
      tokenAutoIssueEnabled: deps.tokenAutoIssueEnabled !== false,
    });
    this.tokenLifecycleMetricsCollector =
      getTokenLifecycleMetricsCollectorSingleton();
    this.tokenAutoRetryEnabled = deps.tokenAutoRetryEnabled === true;
    this.ssotTokenDriftRecoveryCoordinator =
      getTokenDriftRecoveryCoordinatorSingleton({
        shadowModeEnabled: deps.tokenAutoRetryShadowEnabled !== false,
        autoRetryEnabled: this.tokenAutoRetryEnabled,
      });
    this.unityTestRunnerService = new UnityTestRunnerService({
      nowIso: this.nowIso,
      enqueueAndWaitForUnityQuery: this.enqueueAndWaitForUnityQuery.bind(this),
    });
    this.plannerDirectCompatibilityMetricsCollector =
      deps.plannerDirectCompatibilityMetricsCollector &&
      typeof deps.plannerDirectCompatibilityMetricsCollector === "object"
        ? deps.plannerDirectCompatibilityMetricsCollector
        : getPlannerDirectCompatibilityMetricsCollectorSingleton();
    this.genericPropertyFallbackMetricsCollector =
      deps.genericPropertyFallbackMetricsCollector &&
      typeof deps.genericPropertyFallbackMetricsCollector === "object"
        ? deps.genericPropertyFallbackMetricsCollector
        : getGenericPropertyFallbackMetricsCollectorSingleton();
    this.plannerVisibilityProfileRuntime = createPlannerVisibilityProfileRuntime(
      MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT
    );
    this.plannerDirectCompatibilityRuntime = createPlannerDirectCompatibilityRuntime(
      MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT,
      {
        metricsCollector: this.plannerDirectCompatibilityMetricsCollector,
      }
    );
  }

  getBlockRuntimeExecutionAdapter() {
    if (
      this.blockRuntimeExecutionAdapter &&
      typeof this.blockRuntimeExecutionAdapter.executeBlock === "function"
    ) {
      return this.blockRuntimeExecutionAdapter;
    }
    const internalToolInvoker = this.getInternalToolInvoker();
    const runtimePort = createTurnServiceRuntimePort({
      turnService: this,
      internalToolInvoker,
    });
    this.blockRuntimeExecutionAdapter = createExecutionChannelAdapter({
      runtimePort,
      genericPropertyFallbackPolicyContract:
        MCP_PLANNER_GENERIC_PROPERTY_FALLBACK_POLICY_CONTRACT,
      genericPropertyFallbackMetricsCollector:
        this.genericPropertyFallbackMetricsCollector,
    });
    return this.blockRuntimeExecutionAdapter;
  }

  getInternalToolInvoker() {
    if (
      this.internalToolInvoker &&
      typeof this.internalToolInvoker.invokeTool === "function"
    ) {
      return this.internalToolInvoker;
    }
    this.internalToolInvoker = createInternalToolInvoker({
      turnService: this,
    });
    return this.internalToolInvoker;
  }

  getBlockRuntimeRouter() {
    if (
      this.blockRuntimeRouter &&
      typeof this.blockRuntimeRouter.routeBlock === "function"
    ) {
      return this.blockRuntimeRouter;
    }
    this.blockRuntimeRouter = createThinBlockRouter();
    return this.blockRuntimeRouter;
  }

  getExecutionShapeDecider() {
    if (
      this.blockRuntimeShapeDecider &&
      typeof this.blockRuntimeShapeDecider.decideExecutionShape === "function"
    ) {
      return this.blockRuntimeShapeDecider;
    }
    this.blockRuntimeShapeDecider = createExecutionShapeDecider();
    return this.blockRuntimeShapeDecider;
  }

  getBlockRuntimeVerifyHook() {
    if (
      this.blockRuntimeVerifyHook &&
      typeof this.blockRuntimeVerifyHook.runVerify === "function"
    ) {
      return this.blockRuntimeVerifyHook;
    }
    this.blockRuntimeVerifyHook = createVerifyHook();
    return this.blockRuntimeVerifyHook;
  }

  getBlockRuntimeRecoveryHook() {
    if (
      this.blockRuntimeRecoveryHook &&
      typeof this.blockRuntimeRecoveryHook.runRecovery === "function"
    ) {
      return this.blockRuntimeRecoveryHook;
    }
    this.blockRuntimeRecoveryHook = createRecoveryHook();
    return this.blockRuntimeRecoveryHook;
  }

  getPlannerEntryTranslator() {
    if (
      this.plannerEntryTranslator &&
      typeof this.plannerEntryTranslator.translateBlockSpec === "function"
    ) {
      return this.plannerEntryTranslator;
    }
    this.plannerEntryTranslator = createPlannerEntryTranslator();
    return this.plannerEntryTranslator;
  }

  getPlannerEntryNormalizer() {
    if (
      this.plannerEntryNormalizer &&
      typeof this.plannerEntryNormalizer.normalizePayload === "function"
    ) {
      return this.plannerEntryNormalizer;
    }
    this.plannerEntryNormalizer = createPlannerEntryNormalizer();
    return this.plannerEntryNormalizer;
  }

  getPlannerEntryErrorHintBuilder() {
    if (
      this.plannerEntryErrorHintBuilder &&
      typeof this.plannerEntryErrorHintBuilder.buildHints === "function"
    ) {
      return this.plannerEntryErrorHintBuilder;
    }
    this.plannerEntryErrorHintBuilder = createPlannerEntryErrorHintBuilder();
    return this.plannerEntryErrorHintBuilder;
  }

  buildPlannerEntryErrorOverlay(input) {
    const source =
      input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const builder = this.getPlannerEntryErrorHintBuilder();
    if (!builder || typeof builder.buildHints !== "function") {
      return {
        feedback_fields: {},
        repair_data: {},
      };
    }
    const hints = builder.buildHints({
      error_code:
        typeof source.error_code === "string" ? source.error_code : "",
      error_message:
        typeof source.error_message === "string" ? source.error_message : "",
      error_details:
        source.error_details &&
        typeof source.error_details === "object" &&
        !Array.isArray(source.error_details)
          ? source.error_details
          : {},
    });
    if (!hints || typeof hints !== "object" || Array.isArray(hints)) {
      return {
        feedback_fields: {},
        repair_data: {},
      };
    }
    return {
      feedback_fields: {
        ...(typeof hints.suggested_action === "string" && hints.suggested_action.trim()
          ? { suggested_action: hints.suggested_action.trim() }
          : {}),
        ...(typeof hints.suggested_tool === "string" && hints.suggested_tool.trim()
          ? { suggested_tool: hints.suggested_tool.trim() }
          : {}),
        ...(typeof hints.fix_hint === "string" && hints.fix_hint.trim()
          ? { fix_hint: hints.fix_hint.trim() }
          : {}),
        ...(typeof hints.contextual_hint === "string" && hints.contextual_hint.trim()
          ? { contextual_hint: hints.contextual_hint.trim() }
          : {}),
        ...(Array.isArray(hints.missing_fields)
          ? { missing_fields: hints.missing_fields }
          : {}),
        ...(Array.isArray(hints.fix_steps) ? { fix_steps: hints.fix_steps } : {}),
      },
      repair_data:
        hints.repair_payload &&
        typeof hints.repair_payload === "object" &&
        !Array.isArray(hints.repair_payload)
          ? { planner_entry_repair: hints.repair_payload }
          : {},
    };
  }

  getPlannerExitPolicy() {
    if (
      this.plannerExitPolicy &&
      typeof this.plannerExitPolicy.evaluate === "function"
    ) {
      return this.plannerExitPolicy;
    }
    this.plannerExitPolicy = createPlannerExitPolicy(
      MCP_PLANNER_EXIT_POLICY_CONTRACT
    );
    return this.plannerExitPolicy;
  }

  recordPlannerEntryUxMetrics(input) {
    const collector = this.plannerUxMetricsCollector;
    if (!collector || typeof collector.recordAttempt !== "function") {
      return;
    }
    const source =
      input && typeof input === "object" && !Array.isArray(input) ? input : {};
    collector.recordAttempt(source);
  }

  async runVerifyRecoveryHooksForBlock({
    blockSpec,
    executionContext,
    adapter,
    blockResult,
  }) {
    let currentBlockResult = blockResult;
    const verifyHook = this.getBlockRuntimeVerifyHook();

    const initialVerifyOutcome = verifyHook.runVerify({
      blockSpec,
      blockResult: currentBlockResult,
    });
    if (
      initialVerifyOutcome &&
      initialVerifyOutcome.block_result &&
      typeof initialVerifyOutcome.block_result === "object"
    ) {
      currentBlockResult = initialVerifyOutcome.block_result;
    }
    if (initialVerifyOutcome && initialVerifyOutcome.ok !== true) {
      return currentBlockResult;
    }
    if (!currentBlockResult || currentBlockResult.status !== "failed") {
      return currentBlockResult;
    }

    const recoveryHook = this.getBlockRuntimeRecoveryHook();
    const recoveryOutcome = await recoveryHook.runRecovery({
      blockSpec,
      executionContext,
      blockResult: currentBlockResult,
      recoveryAttemptCount: 0,
      retryExecutor: async ({ blockSpec: retryBlockSpec, executionContext: retryContext }) =>
        adapter.executeBlock(
          retryBlockSpec &&
            typeof retryBlockSpec === "object" &&
            !Array.isArray(retryBlockSpec)
            ? retryBlockSpec
            : blockSpec,
          retryContext &&
            typeof retryContext === "object" &&
            !Array.isArray(retryContext)
            ? retryContext
            : executionContext
        ),
    });
    if (
      recoveryOutcome &&
      recoveryOutcome.block_result &&
      typeof recoveryOutcome.block_result === "object"
    ) {
      currentBlockResult = recoveryOutcome.block_result;
    }
    if (!currentBlockResult || currentBlockResult.status !== "succeeded") {
      return currentBlockResult;
    }

    const verifyAfterRecoveryOutcome = verifyHook.runVerify({
      blockSpec,
      blockResult: currentBlockResult,
    });
    if (
      verifyAfterRecoveryOutcome &&
      verifyAfterRecoveryOutcome.block_result &&
      typeof verifyAfterRecoveryOutcome.block_result === "object"
    ) {
      currentBlockResult = verifyAfterRecoveryOutcome.block_result;
    }
    return currentBlockResult;
  }

  async executeBlockSpecForMvp(body) {
    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const runtimeFlags = this.blockRuntimeFlags;
    const defaultPlannerNormalizationMeta = {
      normalizer_version: "",
      rules_source: "none",
      alias_hits: [],
      auto_filled_fields: [],
      generated_fields: [],
    };
    let plannerNormalizationMeta = { ...defaultPlannerNormalizationMeta };
    let plannerUxMetricRecorded = false;
    const recordPlannerUxMetricOnce = ({ success, failure_stage, error_code }) => {
      if (plannerUxMetricRecorded) {
        return;
      }
      this.recordPlannerEntryUxMetrics({
        success: success === true,
        failure_stage:
          typeof failure_stage === "string" ? failure_stage : "unknown",
        error_code: typeof error_code === "string" ? error_code : "",
        normalization_meta: plannerNormalizationMeta,
      });
      plannerUxMetricRecorded = true;
    };
    if (!runtimeFlags || runtimeFlags.pipeline_enabled !== true) {
      recordPlannerUxMetricOnce({
        success: false,
        failure_stage: "before_dispatch",
        error_code: "E_BLOCK_PIPELINE_DISABLED",
      });
      return {
        statusCode: 409,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: "E_BLOCK_PIPELINE_DISABLED",
          message: "Block runtime pipeline is disabled by feature flag",
          tool_name: "planner_execute_mcp",
          context: {
            stage: "before_dispatch",
            previous_operation: "execute_planner_entry_for_mcp",
          },
        }),
      };
    }
    const plannerEntryNormalizer = this.getPlannerEntryNormalizer();
    const normalizationOutcome = plannerEntryNormalizer.normalizePayload(payload);
    if (!normalizationOutcome || normalizationOutcome.ok !== true) {
      const normalizedErrorCode =
        normalizationOutcome &&
        typeof normalizationOutcome.error_code === "string" &&
        normalizationOutcome.error_code.trim()
          ? normalizationOutcome.error_code.trim()
          : "E_SCHEMA_INVALID";
      const normalizedErrorMessage =
        normalizationOutcome &&
        typeof normalizationOutcome.error_message === "string" &&
        normalizationOutcome.error_message.trim()
          ? normalizationOutcome.error_message.trim()
          : "planner entry payload normalization failed";
      const normalizationDetails =
        normalizationOutcome &&
        normalizationOutcome.details &&
        typeof normalizationOutcome.details === "object" &&
        !Array.isArray(normalizationOutcome.details)
          ? normalizationOutcome.details
          : {};
      const plannerRepairOverlay = this.buildPlannerEntryErrorOverlay({
        error_code: normalizedErrorCode,
        error_message: normalizedErrorMessage,
        error_details: normalizationDetails,
      });
      plannerNormalizationMeta =
        normalizationOutcome &&
        normalizationOutcome.normalization_meta &&
        typeof normalizationOutcome.normalization_meta === "object" &&
        !Array.isArray(normalizationOutcome.normalization_meta)
          ? normalizationOutcome.normalization_meta
          : { ...defaultPlannerNormalizationMeta };
      recordPlannerUxMetricOnce({
        success: false,
        failure_stage: "before_dispatch",
        error_code: normalizedErrorCode,
      });
      return {
        statusCode: 400,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: normalizedErrorCode,
          message: normalizedErrorMessage,
          tool_name: "planner_execute_mcp",
          ...plannerRepairOverlay.feedback_fields,
          data: {
            planner_entry_normalization: {
              ...(normalizationOutcome &&
              normalizationOutcome.normalization_meta &&
              typeof normalizationOutcome.normalization_meta === "object" &&
              !Array.isArray(normalizationOutcome.normalization_meta)
                ? normalizationOutcome.normalization_meta
                : {}),
              ...(Object.keys(normalizationDetails).length > 0
                ? { error_details: normalizationDetails }
                : {}),
            },
            ...plannerRepairOverlay.repair_data,
          },
          context: {
            stage: "before_dispatch",
            previous_operation: "normalize_planner_entry_payload",
          },
        }),
      };
    }
    const normalizedPayload =
      normalizationOutcome.payload &&
      typeof normalizationOutcome.payload === "object" &&
      !Array.isArray(normalizationOutcome.payload)
        ? normalizationOutcome.payload
        : payload;
    plannerNormalizationMeta =
      normalizationOutcome.normalization_meta &&
      typeof normalizationOutcome.normalization_meta === "object" &&
      !Array.isArray(normalizationOutcome.normalization_meta)
        ? normalizationOutcome.normalization_meta
        : { ...defaultPlannerNormalizationMeta };
    const rawBlockSpec =
      normalizedPayload.block_spec &&
      typeof normalizedPayload.block_spec === "object" &&
      !Array.isArray(normalizedPayload.block_spec)
        ? normalizedPayload.block_spec
        : null;
    if (!rawBlockSpec) {
      const plannerRepairOverlay = this.buildPlannerEntryErrorOverlay({
        error_code: "E_SCHEMA_INVALID",
        error_message: "block_spec must be a plain object",
        error_details: {
          missing_fields: ["block_spec"],
        },
      });
      recordPlannerUxMetricOnce({
        success: false,
        failure_stage: "before_dispatch",
        error_code: "E_SCHEMA_INVALID",
      });
      return {
        statusCode: 400,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: "E_SCHEMA_INVALID",
          message: "block_spec must be a plain object",
          tool_name: "planner_execute_mcp",
          ...plannerRepairOverlay.feedback_fields,
          data: {
            planner_entry_normalization: plannerNormalizationMeta,
            ...plannerRepairOverlay.repair_data,
          },
          context: {
            stage: "before_dispatch",
            previous_operation: "validate_block_spec",
          },
        }),
      };
    }
    const plannerEntryTranslator = this.getPlannerEntryTranslator();
    const translationOutcome =
      plannerEntryTranslator.translateBlockSpec(rawBlockSpec);
    if (!translationOutcome || translationOutcome.ok !== true) {
      const translationErrorCode =
        translationOutcome &&
        typeof translationOutcome.error_code === "string" &&
        translationOutcome.error_code.trim()
          ? translationOutcome.error_code.trim()
          : "E_SCHEMA_INVALID";
      const translationErrorMessage =
        translationOutcome &&
        typeof translationOutcome.error_message === "string" &&
        translationOutcome.error_message.trim()
          ? translationOutcome.error_message.trim()
          : "planner entry translation failed";
      const translationDetails =
        translationOutcome &&
        translationOutcome.details &&
        typeof translationOutcome.details === "object" &&
        !Array.isArray(translationOutcome.details)
          ? translationOutcome.details
          : {};
      const plannerRepairOverlay = this.buildPlannerEntryErrorOverlay({
        error_code: translationErrorCode,
        error_message: translationErrorMessage,
        error_details: translationDetails,
      });
      recordPlannerUxMetricOnce({
        success: false,
        failure_stage: "before_dispatch",
        error_code: translationErrorCode,
      });
      return {
        statusCode: 400,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: translationErrorCode,
          message: translationErrorMessage,
          tool_name: "planner_execute_mcp",
          ...plannerRepairOverlay.feedback_fields,
          data: {
            planner_entry_normalization: plannerNormalizationMeta,
            ...(Object.keys(translationDetails).length > 0
              ? {
                  planner_entry_translation: translationDetails,
                }
              : {}),
            ...plannerRepairOverlay.repair_data,
          },
          context: {
            stage: "before_dispatch",
            previous_operation: "translate_planner_entry_payload",
          },
        }),
      };
    }
    const blockSpec = translationOutcome.block_spec;

    const rawExecutionContext =
      normalizedPayload.execution_context &&
      typeof normalizedPayload.execution_context === "object" &&
      !Array.isArray(normalizedPayload.execution_context)
        ? { ...normalizedPayload.execution_context }
        : {};
    if (
      typeof rawExecutionContext.plan_initial_read_token !== "string" &&
      typeof normalizedPayload.plan_initial_read_token === "string" &&
      normalizedPayload.plan_initial_read_token.trim()
    ) {
      rawExecutionContext.plan_initial_read_token =
        normalizedPayload.plan_initial_read_token.trim();
    }
    if (
      typeof rawExecutionContext.previous_read_token_candidate !== "string" &&
      typeof normalizedPayload.previous_read_token_candidate === "string" &&
      normalizedPayload.previous_read_token_candidate.trim()
    ) {
      rawExecutionContext.previous_read_token_candidate =
        normalizedPayload.previous_read_token_candidate.trim();
    }
    if (
      typeof rawExecutionContext.transaction_read_token_candidate !== "string" &&
      typeof normalizedPayload.transaction_read_token_candidate === "string" &&
      normalizedPayload.transaction_read_token_candidate.trim()
    ) {
      rawExecutionContext.transaction_read_token_candidate =
        normalizedPayload.transaction_read_token_candidate.trim();
    }
    const contextApplied = applyBlockRuntimeFlagsToExecutionContext(
      runtimeFlags,
      rawExecutionContext
    );
    let executionContext = contextApplied.execution_context;
    let routeResult = null;

    if (runtimeFlags.bypass_router !== true) {
      const router = this.getBlockRuntimeRouter();
      routeResult = router.routeBlock(blockSpec, executionContext);
      if (!routeResult || routeResult.ok !== true) {
        const errorCode = normalizeSsotErrorCodeForMcp(
          routeResult && typeof routeResult.error_code === "string"
            ? routeResult.error_code
            : "E_PRECONDITION_FAILED"
        );
        const blockErrorCode =
          routeResult && typeof routeResult.block_error_code === "string"
            ? routeResult.block_error_code.trim()
            : "";
        const routeDetails =
          routeResult &&
          routeResult.details &&
          typeof routeResult.details === "object" &&
          !Array.isArray(routeResult.details)
            ? routeResult.details
            : {};
        const routeMessage =
          routeResult &&
          typeof routeResult.message === "string" &&
          routeResult.message.trim()
            ? routeResult.message.trim()
            : "Block router rejected route request";
        const plannerRepairOverlay = this.buildPlannerEntryErrorOverlay({
          error_code: errorCode,
          error_message: routeMessage,
          error_details: routeDetails,
        });
        recordPlannerUxMetricOnce({
          success: false,
          failure_stage: "before_dispatch",
          error_code: errorCode,
        });
        return {
          statusCode: errorCode === "E_SCHEMA_INVALID" ? 400 : 409,
          body: withMcpErrorFeedback({
            status: "failed",
            error_code: errorCode,
            message: routeMessage,
            tool_name: "planner_execute_mcp",
            ...plannerRepairOverlay.feedback_fields,
            ...(blockErrorCode ? { block_error_code: blockErrorCode } : {}),
            data: {
              planner_entry_normalization: plannerNormalizationMeta,
              runtime_flags: runtimeFlags,
              route_result: routeResult || {},
              ...(blockErrorCode ? { block_error_code: blockErrorCode } : {}),
              ...plannerRepairOverlay.repair_data,
            },
            context: {
              stage: "before_dispatch",
              previous_operation: "route_block_to_channel",
              route_reason:
                routeResult && typeof routeResult.route_reason === "string"
                  ? routeResult.route_reason
                  : "",
            },
          }),
        };
      }
      executionContext = {
        ...executionContext,
        channel:
          typeof routeResult.channel_id === "string" &&
          routeResult.channel_id.trim()
            ? routeResult.channel_id.trim()
            : "execution",
      };
      const shapeDecider = this.getExecutionShapeDecider();
      const shapeDecision = shapeDecider.decideExecutionShape({
        block_spec: blockSpec,
        execution_context: executionContext,
        runtime_flags: runtimeFlags,
      });
      executionContext = mergeShapeDecisionIntoExecutionContext(
        executionContext,
        shapeDecision
      );
    }

    try {
      const adapter = this.getBlockRuntimeExecutionAdapter();
      let blockResult = await adapter.executeBlock(blockSpec, executionContext);
      if (runtimeFlags.verify_recovery_enabled === true) {
        blockResult = await this.runVerifyRecoveryHooksForBlock({
          blockSpec,
          executionContext,
          adapter,
          blockResult,
        });
      }
      if (blockResult && blockResult.status === "succeeded") {
        recordPlannerUxMetricOnce({
          success: true,
          failure_stage: "none",
          error_code: "",
        });
        return {
          statusCode: 200,
          body: {
            ok: true,
            status: "succeeded",
            query_type: "block.request",
            data: {
              ...blockResult,
              planner_entry_normalization: plannerNormalizationMeta,
              runtime_flags: runtimeFlags,
              ...(routeResult ? { route_result: routeResult } : {}),
            },
          },
        };
      }

      const plannerExitPolicy = this.getPlannerExitPolicy();
      const plannerExitDecision =
        plannerExitPolicy && typeof plannerExitPolicy.evaluate === "function"
          ? plannerExitPolicy.evaluate({
              request_payload: normalizedPayload,
              block_spec: blockSpec,
              block_result: blockResult,
            })
          : null;
      const failureData = {
        planner_entry_normalization: plannerNormalizationMeta,
        block_result: blockResult || {},
        runtime_flags: runtimeFlags,
        ...(routeResult ? { route_result: routeResult } : {}),
      };
      if (
        plannerExitDecision &&
        plannerExitDecision.applied === true &&
        plannerExitDecision.action === "escape"
      ) {
        const escapeToolName =
          plannerExitDecision &&
          typeof plannerExitDecision.escape_tool_name === "string" &&
          plannerExitDecision.escape_tool_name.trim()
            ? plannerExitDecision.escape_tool_name.trim()
            : "";
        const escapePayload =
          plannerExitDecision &&
          plannerExitDecision.escape_payload &&
          typeof plannerExitDecision.escape_payload === "object" &&
          !Array.isArray(plannerExitDecision.escape_payload)
            ? plannerExitDecision.escape_payload
            : {};
        const internalToolInvoker = this.getInternalToolInvoker();
        const escapeOutcome = await internalToolInvoker.invokeTool(
          escapeToolName,
          escapePayload
        );
        const escapeStatusCode = Number(
          escapeOutcome && escapeOutcome.statusCode
        );
        const normalizedEscapeStatusCode = Number.isFinite(escapeStatusCode)
          ? escapeStatusCode
          : 0;
        const escapeBody =
          escapeOutcome &&
          escapeOutcome.body &&
          typeof escapeOutcome.body === "object" &&
          !Array.isArray(escapeOutcome.body)
            ? escapeOutcome.body
            : {};
        if (normalizedEscapeStatusCode >= 200 && normalizedEscapeStatusCode < 300) {
          recordPlannerUxMetricOnce({
            success: true,
            failure_stage: "none",
            error_code: "",
          });
          return {
            statusCode: 200,
            body: {
              ok: true,
              status: "succeeded",
              query_type: "planner.exit",
              tool_name: escapeToolName,
              data: {
                status: "succeeded",
                planner_exit: plannerExitDecision,
                block_result: blockResult || {},
                escape_result:
                  escapeBody.data &&
                  typeof escapeBody.data === "object" &&
                  !Array.isArray(escapeBody.data)
                    ? escapeBody.data
                    : escapeBody,
                runtime_flags: runtimeFlags,
                ...(routeResult ? { route_result: routeResult } : {}),
              },
            },
          };
        }

        const escapeErrorCode =
          typeof escapeBody.error_code === "string" && escapeBody.error_code.trim()
            ? escapeBody.error_code.trim()
            : "E_PLANNER_NO_SAFE_FALLBACK";
        recordPlannerUxMetricOnce({
          success: false,
          failure_stage: "during_dispatch",
          error_code: escapeErrorCode,
        });
        return {
          statusCode: normalizedEscapeStatusCode > 0 ? normalizedEscapeStatusCode : 409,
          body: withMcpErrorFeedback({
            status: "failed",
            error_code: escapeErrorCode,
            message:
              typeof escapeBody.message === "string" && escapeBody.message.trim()
                ? escapeBody.message.trim()
                : typeof escapeBody.error_message === "string" &&
                    escapeBody.error_message.trim()
                  ? escapeBody.error_message.trim()
                  : "planner exit backend dispatch failed",
            tool_name: "planner_execute_mcp",
            data: {
              ...failureData,
              planner_exit: plannerExitDecision,
              escape_tool_name: escapeToolName,
              escape_status_code: normalizedEscapeStatusCode,
              escape_body: escapeBody,
            },
            context: {
              stage: "during_dispatch",
              previous_operation: "planner_exit_escape_dispatch",
              failed_block_id:
                blockResult && typeof blockResult.block_id === "string"
                  ? blockResult.block_id
                  : "",
              failed_tool_name: escapeToolName,
            },
          }),
        };
      }
      if (
        plannerExitDecision &&
        plannerExitDecision.applied === true &&
        plannerExitDecision.action === "fail_closed"
      ) {
        const plannerExitErrorCode =
          typeof plannerExitDecision.error_code === "string" &&
          plannerExitDecision.error_code.trim()
            ? plannerExitDecision.error_code.trim()
            : "E_PLANNER_EXIT_NOT_ALLOWED";
        recordPlannerUxMetricOnce({
          success: false,
          failure_stage: "during_dispatch",
          error_code: plannerExitErrorCode,
        });
        return {
          statusCode: 409,
          body: withMcpErrorFeedback({
            status: "failed",
            error_code: plannerExitErrorCode,
            message:
              typeof plannerExitDecision.error_message === "string" &&
              plannerExitDecision.error_message.trim()
                ? plannerExitDecision.error_message.trim()
                : "planner entry exit policy failed closed",
            tool_name: "planner_execute_mcp",
            data: {
              ...failureData,
              planner_exit: plannerExitDecision,
            },
            context: {
              stage: "during_dispatch",
              previous_operation: "planner_exit_policy_fail_closed",
              failed_block_id:
                blockResult && typeof blockResult.block_id === "string"
                  ? blockResult.block_id
                  : "",
              failed_tool_name:
                blockResult &&
                blockResult.execution_meta &&
                typeof blockResult.execution_meta === "object" &&
                typeof blockResult.execution_meta.tool_name === "string"
                  ? blockResult.execution_meta.tool_name
                  : "",
            },
          }),
        };
      }

      const blockError =
        blockResult &&
        blockResult.error &&
        typeof blockResult.error === "object" &&
        !Array.isArray(blockResult.error)
          ? blockResult.error
          : {};
      const errorCode =
        typeof blockError.error_code === "string" && blockError.error_code.trim()
          ? blockError.error_code.trim()
          : "E_BLOCK_EXECUTION_FAILED";
      const message =
        typeof blockError.error_message === "string" &&
        blockError.error_message.trim()
          ? blockError.error_message.trim()
          : "Block execution failed";
      const blockErrorDetails =
        blockError &&
        blockError.details &&
        typeof blockError.details === "object" &&
        !Array.isArray(blockError.details)
          ? blockError.details
          : {};
      const plannerRepairOverlay = this.buildPlannerEntryErrorOverlay({
        error_code: errorCode,
        error_message: message,
        error_details: blockErrorDetails,
      });
      recordPlannerUxMetricOnce({
        success: false,
        failure_stage: "during_dispatch",
        error_code: errorCode,
      });
      if (
        typeof blockError.block_error_code === "string" &&
        blockError.block_error_code.trim()
      ) {
        failureData.block_error_code = blockError.block_error_code.trim();
      }
      return {
        statusCode: 409,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode,
          message,
          tool_name: "planner_execute_mcp",
          ...plannerRepairOverlay.feedback_fields,
          ...(failureData.block_error_code
            ? { block_error_code: failureData.block_error_code }
            : {}),
          data: {
            ...failureData,
            ...plannerRepairOverlay.repair_data,
          },
          context: {
            stage: "during_dispatch",
            previous_operation: "execute_planner_entry_for_mcp",
            failed_block_id:
              blockResult && typeof blockResult.block_id === "string"
                ? blockResult.block_id
                : "",
            failed_tool_name:
              blockResult &&
              blockResult.execution_meta &&
              typeof blockResult.execution_meta === "object" &&
              typeof blockResult.execution_meta.tool_name === "string"
                ? blockResult.execution_meta.tool_name
                : "",
          },
        }),
      };
    } catch (error) {
      const errorCode =
        error && typeof error.errorCode === "string" && error.errorCode.trim()
          ? error.errorCode.trim()
          : "E_BLOCK_EXECUTION_FAILED";
      const message =
        error && typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "planner_execute_mcp failed unexpectedly";
      recordPlannerUxMetricOnce({
        success: false,
        failure_stage: "during_dispatch",
        error_code: errorCode,
      });
      return {
        statusCode: 500,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode,
          message,
          tool_name: "planner_execute_mcp",
          data: {
            planner_entry_normalization: plannerNormalizationMeta,
          },
          context: {
            stage: "during_dispatch",
            previous_operation: "execute_planner_entry_for_mcp",
          },
        }),
      };
    }
  }

  async executePlannerEntryForMcp(body) {
    return this.executeBlockSpecForMvp(body);
  }

  getHealthPayload() {
    if (this.turnStore && typeof this.turnStore.sweep === "function") {
      this.turnStore.sweep();
    }
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    const queryRuntime = this.getQueryRuntimeSnapshot();
    return {
      ok: true,
      service: "codex-unity-sidecar-mvp",
      timestamp: this.nowIso(),
      active_request_id: "",
      active_state: "",
      active_query_count: Number(queryRuntime.total) || 0,
      unity_connection_state:
        this.capabilityStore.getSnapshot().unity_connection_state,
    };
  }

  getStateSnapshotPayload() {
    if (this.turnStore && typeof this.turnStore.sweep === "function") {
      this.turnStore.sweep();
    }
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    const queryRuntime = this.getQueryRuntimeSnapshot();
    const turnSnapshot =
      this.turnStore && typeof this.turnStore.getSnapshot === "function"
        ? this.turnStore.getSnapshot()
        : { turns: [] };
    const tokenLifecycleMetrics =
      this.tokenLifecycleMetricsCollector &&
      typeof this.tokenLifecycleMetricsCollector.getSnapshot === "function"
        ? this.tokenLifecycleMetricsCollector.getSnapshot()
        : null;
    const tokenShadowMetrics =
      this.ssotTokenDriftRecoveryCoordinator &&
      typeof this.ssotTokenDriftRecoveryCoordinator.getShadowMetricsSnapshot ===
        "function"
        ? this.ssotTokenDriftRecoveryCoordinator.getShadowMetricsSnapshot()
        : null;
    const tokenRecoveryMetrics =
      this.ssotTokenDriftRecoveryCoordinator &&
      typeof this.ssotTokenDriftRecoveryCoordinator.getRecoveryMetricsSnapshot ===
        "function"
        ? this.ssotTokenDriftRecoveryCoordinator.getRecoveryMetricsSnapshot()
        : null;
    const plannerDirectCompatibilityMetrics =
      this.plannerDirectCompatibilityMetricsCollector &&
      typeof this.plannerDirectCompatibilityMetricsCollector.getSnapshot ===
        "function"
        ? this.plannerDirectCompatibilityMetricsCollector.getSnapshot()
        : null;
    const plannerVisibilityProfileState =
      this.plannerVisibilityProfileRuntime &&
      typeof this.plannerVisibilityProfileRuntime.getState === "function"
        ? this.plannerVisibilityProfileRuntime.getState()
        : null;
    const genericPropertyFallbackMetrics =
      this.genericPropertyFallbackMetricsCollector &&
      typeof this.genericPropertyFallbackMetricsCollector.getSnapshot ===
        "function"
        ? this.genericPropertyFallbackMetricsCollector.getSnapshot()
        : null;
    const plannerUxMetrics =
      this.plannerUxMetricsCollector &&
      typeof this.plannerUxMetricsCollector.getSnapshot === "function"
        ? this.plannerUxMetricsCollector.getSnapshot()
        : null;
    return {
      ...turnSnapshot,
      mcp_runtime: {
        running_job_id: "",
        queued_job_ids: [],
        jobs: [],
        capabilities: this.capabilityStore.getSnapshot(),
        query_runtime: queryRuntime,
        token_drift_recovery_shadow: tokenShadowMetrics,
        token_drift_recovery_execute: tokenRecoveryMetrics,
        planner_visibility_profile: plannerVisibilityProfileState,
        planner_direct_compatibility: plannerDirectCompatibilityMetrics,
        mcp_entry_governance: this.mcpEntryGovernanceState,
        generic_property_fallback: genericPropertyFallbackMetrics,
        planner_entry_ux_metrics: plannerUxMetrics,
        token_automation_metrics: buildTokenAutomationMetricsSnapshot(
          tokenLifecycleMetrics,
          tokenRecoveryMetrics
        ),
      },
    };
  }

  pullUnityQuery(body) {
    return this.queryCoordinator.pullQuery(body);
  }

  reportUnityQuery(body) {
    return this.queryCoordinator.reportQueryResult(body);
  }

  enqueueAndWaitForUnityQuery(options) {
    const input = options && typeof options === "object" ? options : {};
    return this.queryCoordinator.enqueueAndWaitForUnityQuery({
      queryType: input.queryType,
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      timeoutMs: input.timeoutMs,
      requestId: input.requestId,
      threadId: input.threadId,
      turnId: input.turnId,
      queryContractVersion: input.queryContractVersion,
      queryPayloadJson: input.queryPayloadJson,
    });
  }

  reportUnitySelectionSnapshot(body) {
    const validation = validateUnitySelectionSnapshot(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const payload = body && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};
    const reason =
      typeof payload.reason === "string" && payload.reason.trim()
        ? payload.reason.trim()
        : "unknown";
    if (payload.selection_empty === true) {
      this.unitySnapshotService.clearLatestSelectionSnapshot();
      return {
        statusCode: 200,
        body: {
          ok: true,
          event: "unity.selection.snapshot.accepted",
          selection_empty: true,
          reason,
          message: "Selection snapshot cleared",
        },
      };
    }

    this.recordLatestSelectionContext(payload.context, {
      source: "unity.selection.snapshot",
      requestId: normalizeRequestId(body.request_id),
      threadId: typeof body.thread_id === "string" ? body.thread_id : "",
      turnId: typeof body.turn_id === "string" ? body.turn_id : "",
    });
    const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
    if (!snapshot || !snapshot.selection) {
      return {
        statusCode: 409,
        body: {
          ok: false,
          event: "unity.selection.snapshot.rejected",
          error_code: "E_SELECTION_UNAVAILABLE",
          message: "Selection snapshot payload did not include a valid target path",
        },
      };
    }
    snapshot.component_index = Array.isArray(payload.component_index)
      ? normalizeSelectionComponentIndex(payload.component_index)
      : [];
    return {
      statusCode: 200,
      body: {
        ok: true,
        event: "unity.selection.snapshot.accepted",
        selection_empty: false,
        reason,
        scene_revision: snapshot.scene_revision || "",
        target_object_id: snapshot.selection.object_id || "",
        target_object_path: snapshot.selection.target_object_path || "",
        captured_at: snapshot.captured_at || this.nowIso(),
      },
    };
  }

  reportUnityRuntimePing(body) {
    const validation = validateUnityRuntimePing(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }
    this.capabilityStore.markUnitySignal();
    return {
      statusCode: 200,
      body: {
        ok: true,
        event: "unity.runtime.pong",
        recovered: false,
        message: "No active job to recover",
        stage: "idle",
        state: "idle",
      },
    };
  }

  reportUnityCapabilities(body) {
    const validation = validateUnityCapabilitiesReport(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }
    const payload = body && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};
    const snapshot = this.capabilityStore.reportCapabilities(payload);
    return {
      statusCode: 200,
      body: {
        ok: true,
        event: "unity.capabilities.accepted",
        unity_connection_state: snapshot.unity_connection_state,
        capability_version: snapshot.capability_version,
        capability_updated_at: snapshot.capability_updated_at,
        action_count: snapshot.action_count,
      },
    };
  }

  setupCursorMcpForMcp(body) {
    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};
    try {
      const result = setupCursorMcp({
        mode:
          typeof payload.mode === "string"
            ? payload.mode.trim().toLowerCase()
            : "native",
        sidecarBaseUrl:
          typeof payload.sidecar_base_url === "string"
            ? payload.sidecar_base_url.trim()
            : undefined,
        dryRun: payload.dry_run === true,
      });
      return {
        statusCode: 200,
        body: {
          ok: true,
          data: result,
          captured_at:
            typeof this.nowIso === "function"
              ? this.nowIso()
              : new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorCode =
        error && typeof error.errorCode === "string" && error.errorCode.trim()
          ? error.errorCode.trim()
          : "E_CURSOR_MCP_SETUP_FAILED";
      const message =
        error && typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "setup_cursor_mcp execution failed";
      return {
        statusCode: mapSetupCursorMcpErrorToStatusCode(errorCode),
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode,
          message,
        }),
      };
    }
  }

  verifyMcpSetupForMcp(body) {
    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};
    try {
      const report = verifyCursorMcpSetup({
        mode:
          typeof payload.mode === "string"
            ? payload.mode.trim().toLowerCase()
            : "auto",
      });
      return {
        statusCode: 200,
        body: {
          ok: true,
          data: report,
          captured_at:
            typeof this.nowIso === "function"
              ? this.nowIso()
              : new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorCode =
        error && typeof error.errorCode === "string" && error.errorCode.trim()
          ? error.errorCode.trim()
          : "E_CURSOR_MCP_VERIFY_FAILED";
      const message =
        error && typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "verify_mcp_setup execution failed";
      return {
        statusCode:
          errorCode === "E_SCHEMA_INVALID" ||
          errorCode === "E_SSOT_SCHEMA_INVALID"
            ? 400
            : 500,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode,
          message,
        }),
      };
    }
  }

  getActionCatalogForMcp(body) {
    return getActionCatalogView(body);
  }

  getActionSchemaForMcp(body) {
    return getActionSchemaView(body);
  }

  getToolSchemaForMcp(body) {
    return getToolSchemaView(body);
  }

  getWriteContractBundleForMcp(body) {
    return getWriteContractBundleView(body);
  }

  async runUnityTestsForMcp(body) {
    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};
    try {
      const result = await this.unityTestRunnerService.runUnityTests(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          data: result,
          captured_at:
            typeof this.nowIso === "function"
              ? this.nowIso()
              : new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorCode =
        error && typeof error.errorCode === "string" && error.errorCode.trim()
          ? error.errorCode.trim()
          : "E_UNITY_TEST_RUN_FAILED";
      const message =
        error && typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "run_unity_tests execution failed";
      const context =
        error &&
        error.context &&
        typeof error.context === "object" &&
        !Array.isArray(error.context)
          ? error.context
          : {};
      return {
        statusCode: mapRunUnityTestsErrorToStatusCode(errorCode),
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode,
          message,
          tool_name: "run_unity_tests",
          context: {
            stage: "during_dispatch",
            previous_operation: "run_unity_tests",
            ...context,
          },
        }),
      };
    }
  }

  async dispatchSsotToolForMcp(toolName, body) {
    const normalizedToolName =
      typeof toolName === "string" && toolName.trim() ? toolName.trim() : "";
    if (!normalizedToolName) {
      return {
        statusCode: 400,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: "E_SSOT_ROUTE_FAILED",
          message: "SSOT tool name is required",
          tool_name: normalizedToolName,
          context: {
            stage: "before_dispatch",
            previous_operation: "validate_tool_name",
          },
        }),
      };
    }

    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const toolMetadata =
      this.ssotValidatorRegistry &&
      typeof this.ssotValidatorRegistry.getToolMetadata === "function"
        ? this.ssotValidatorRegistry.getToolMetadata(normalizedToolName)
        : null;
    if (normalizedToolName === "execute_unity_transaction") {
      const policyGuardResult = guardExecuteUnityTransactionSteps(payload);
      if (!policyGuardResult.ok) {
        return {
          statusCode: 409,
          body: withMcpErrorFeedback({
            status: "failed",
            error_code: policyGuardResult.error_code,
            message: policyGuardResult.message,
            tool_name: normalizedToolName,
            data: {
              failed_step_index: policyGuardResult.failed_step_index,
              failed_step_id: policyGuardResult.failed_step_id,
              failed_tool_name: policyGuardResult.failed_tool_name,
            },
            context: {
              stage: "during_transaction",
              previous_operation: "guard_execute_unity_transaction_steps",
            },
          }),
        };
      }
    }

    try {
      const unityResponse = await dispatchSsotRequest({
        enqueueAndWaitForUnityQuery: this.enqueueAndWaitForUnityQuery.bind(this),
        toolName: normalizedToolName,
        payload,
        threadId: typeof payload.thread_id === "string" ? payload.thread_id : "",
        requestId: normalizeRequestId(payload.request_id || payload.idempotency_key),
        turnId: typeof payload.turn_id === "string" ? payload.turn_id : "",
        tokenLifecycleOrchestrator: this.ssotTokenLifecycleOrchestrator,
        tokenDriftRecoveryCoordinator: this.ssotTokenDriftRecoveryCoordinator,
        tokenAutoRetryEnabled: this.tokenAutoRetryEnabled,
      });

      if (!unityResponse || typeof unityResponse !== "object") {
        return {
          statusCode: 502,
          body: withMcpErrorFeedback({
            status: "failed",
            error_code: "E_SSOT_ROUTE_FAILED",
            message: "Unity SSOT query response is invalid",
            tool_name: normalizedToolName,
            context: {
              stage: "during_dispatch",
              previous_operation: "dispatch_ssot_request",
            },
          }),
        };
      }
      const tokenAutomationBridge = buildTokenAutomationBridge(unityResponse);
      if (unityResponse.ok !== true) {
        const rawErrorCode =
          typeof unityResponse.error_code === "string" &&
          unityResponse.error_code.trim()
            ? unityResponse.error_code.trim()
            : "E_SSOT_ROUTE_FAILED";
        const errorCode = normalizeSsotErrorCodeForMcp(rawErrorCode);
        const errorMessage =
          typeof unityResponse.error_message === "string" &&
          unityResponse.error_message.trim()
            ? unityResponse.error_message.trim()
            : typeof unityResponse.message === "string" &&
                unityResponse.message.trim()
              ? unityResponse.message.trim()
              : "Unity SSOT query failed";
        const responseContext =
          unityResponse.context && typeof unityResponse.context === "object"
            ? unityResponse.context
            : {};
        const responseDataSource =
          unityResponse.data &&
          typeof unityResponse.data === "object" &&
          !Array.isArray(unityResponse.data)
            ? unityResponse.data
            : {};
        const failureContext = normalizeFailureContext({
          errorCode,
          context: {
            ...(unityResponse && typeof unityResponse === "object"
              ? unityResponse
              : {}),
            ...responseContext,
          },
          data: responseDataSource,
          nowMs: Date.now(),
        });
        const responseData = projectFailureDataFromContext(failureContext.context);
        const responseDataWithAutomation = attachTokenAutomationToData(
          responseData,
          tokenAutomationBridge.token_automation
        );
        const l3Context =
          failureContext.context.l3_context &&
          typeof failureContext.context.l3_context === "object"
            ? failureContext.context.l3_context
            : {
                old_revision:
                  typeof unityResponse.old_revision === "string"
                    ? unityResponse.old_revision
                    : "",
                new_revision:
                  typeof unityResponse.new_revision === "string"
                    ? unityResponse.new_revision
                    : "",
                failed_property_path:
                  typeof unityResponse.failed_property_path === "string"
                    ? unityResponse.failed_property_path
                    : "",
                failed_component_type:
                  typeof unityResponse.failed_component_type === "string"
                    ? unityResponse.failed_component_type
                    : "",
              };
        return {
          statusCode: 409,
          body: withMcpErrorFeedback({
            status: "failed",
            error_code: errorCode,
            message: errorMessage,
            tool_name: normalizedToolName,
            ...tokenAutomationBridge,
            data: responseDataWithAutomation,
            context: {
              stage:
                typeof failureContext.context.stage === "string" &&
                failureContext.context.stage.trim()
                  ? failureContext.context.stage.trim()
                  : "during_dispatch",
              previous_operation:
                typeof failureContext.context.previous_operation === "string" &&
                failureContext.context.previous_operation.trim()
                  ? failureContext.context.previous_operation.trim()
                  : "dispatch_ssot_request",
              scene_revision_changed:
                typeof failureContext.context.scene_revision_changed === "boolean"
                  ? failureContext.context.scene_revision_changed
                  : null,
              error_context_issued_at:
                typeof failureContext.context.error_context_issued_at === "string"
                  ? failureContext.context.error_context_issued_at
                  : "",
              error_context_version:
                typeof failureContext.context.error_context_version === "string"
                  ? failureContext.context.error_context_version
                  : "",
              requires_context_refresh:
                failureContext.requires_context_refresh === true,
              l3_context: l3Context,
            },
          }),
        };
      }

      const responseData = attachTokenAutomationToData(
        unityResponse.data && typeof unityResponse.data === "object"
          ? unityResponse.data
          : unityResponse,
        tokenAutomationBridge.token_automation
      );
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: normalizedToolName,
          ...tokenAutomationBridge,
          data: responseData,
        },
      };
    } catch (error) {
      const rawErrorCode =
        error &&
        typeof error === "object" &&
        typeof error.error_code === "string" &&
        error.error_code.trim()
          ? error.error_code.trim()
          : "E_SSOT_ROUTE_FAILED";
      const errorCode = normalizeSsotErrorCodeForMcp(rawErrorCode);
      const errorContext =
        error &&
        typeof error === "object" &&
        error.context &&
        typeof error.context === "object"
          ? error.context
          : {
              stage:
                toolMetadata && toolMetadata.kind === "write"
                  ? "during_write_dispatch"
                  : "during_dispatch",
              previous_operation: "dispatch_ssot_request",
            };
      const failureContext = normalizeFailureContext({
        errorCode,
        context: {
          ...(error && typeof error === "object" ? error : {}),
          ...errorContext,
        },
        data:
          error &&
          typeof error === "object" &&
          error.data &&
          typeof error.data === "object" &&
          !Array.isArray(error.data)
            ? error.data
            : {},
        nowMs: Date.now(),
      });
      const tokenAutomationBridge = buildTokenAutomationBridge(error);
      return {
        statusCode: 409,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode,
          message:
            error && typeof error.message === "string" && error.message.trim()
              ? error.message.trim()
              : "Unity SSOT dispatch failed",
          tool_name: normalizedToolName,
          ...tokenAutomationBridge,
          data: attachTokenAutomationToData(
            projectFailureDataFromContext(failureContext.context),
            tokenAutomationBridge.token_automation
          ),
          context: {
            ...errorContext,
            stage:
              typeof failureContext.context.stage === "string" &&
              failureContext.context.stage.trim()
                ? failureContext.context.stage.trim()
                : typeof errorContext.stage === "string" && errorContext.stage.trim()
                  ? errorContext.stage.trim()
                  : "during_dispatch",
            previous_operation:
              typeof failureContext.context.previous_operation === "string" &&
              failureContext.context.previous_operation.trim()
                ? failureContext.context.previous_operation.trim()
                : typeof errorContext.previous_operation === "string" &&
                    errorContext.previous_operation.trim()
                  ? errorContext.previous_operation.trim()
                  : "dispatch_ssot_request",
            requires_context_refresh:
              failureContext.requires_context_refresh === true,
          },
        }),
      };
    }
  }

  preflightValidateWritePayloadForMcp(body) {
    const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const toolName =
      typeof source.tool_name === "string" && source.tool_name.trim()
        ? source.tool_name.trim()
        : "";
    const payload =
      source.payload && typeof source.payload === "object" && !Array.isArray(source.payload)
        ? source.payload
        : {};
    if (!toolName) {
      return {
        statusCode: 400,
        body: {
          ok: false,
          error_code: "E_SSOT_SCHEMA_INVALID",
          message: "tool_name is required for SSOT preflight",
        },
      };
    }

    const ssotRegistry =
      this.ssotValidatorRegistry &&
      typeof this.ssotValidatorRegistry.getToolMetadata === "function" &&
      typeof this.ssotValidatorRegistry.validateToolInput === "function"
        ? this.ssotValidatorRegistry
        : null;
    if (!ssotRegistry) {
      return {
        statusCode: 500,
        body: {
          ok: false,
          error_code: "E_SSOT_SCHEMA_UNAVAILABLE",
          message: "SSOT validator registry is unavailable",
        },
      };
    }

    const toolMetadata = ssotRegistry.getToolMetadata(toolName);
    if (!toolMetadata) {
      return {
        statusCode: 404,
        body: {
          ok: false,
          error_code: "E_TOOL_SCHEMA_NOT_FOUND",
          message: `Tool schema not found for '${toolName}'`,
        },
      };
    }
    if (toolMetadata.kind !== "write") {
      return {
        statusCode: 200,
        body: {
          ok: true,
          lifecycle: "stable",
          preflight: {
            valid: false,
            tool_name: toolName,
            blocking_errors: [
              {
                error_code: "E_SSOT_WRITE_TOOL_REQUIRED",
                message:
                  "preflight_validate_write_payload only supports SSOT write tools",
              },
            ],
            token_validation: {
              ok: false,
              error_code: "E_SSOT_WRITE_TOOL_REQUIRED",
              message:
                "preflight_validate_write_payload only supports SSOT write tools",
            },
          },
        },
      };
    }

    const tokenValidation = this.validateSsotTokenForMcp(
      payload.based_on_read_token
    );
    if (!tokenValidation.ok) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          lifecycle: "stable",
          preflight: {
            valid: false,
            tool_name: toolName,
            blocking_errors: [
              {
                error_code: tokenValidation.error_code,
                message: tokenValidation.message,
              },
            ],
            token_validation: {
              ok: false,
              error_code: tokenValidation.error_code,
              message: tokenValidation.message,
            },
          },
        },
      };
    }

    const schemaValidation = ssotRegistry.validateToolInput(toolName, payload);
    if (!schemaValidation || schemaValidation.ok !== true) {
      const firstError =
        schemaValidation &&
        Array.isArray(schemaValidation.errors) &&
        schemaValidation.errors.length > 0 &&
        schemaValidation.errors[0] &&
        typeof schemaValidation.errors[0] === "object"
          ? schemaValidation.errors[0]
          : null;
      const path =
        firstError && typeof firstError.instancePath === "string" && firstError.instancePath
          ? firstError.instancePath
          : "/";
      const message =
        firstError && typeof firstError.message === "string" && firstError.message
          ? firstError.message
          : "Request schema invalid";
      return {
        statusCode: 200,
        body: {
          ok: true,
          lifecycle: "stable",
          preflight: {
            valid: false,
            tool_name: toolName,
            blocking_errors: [
              {
                error_code: "E_SSOT_SCHEMA_INVALID",
                message: `Request schema invalid at ${path}: ${message}`,
              },
            ],
            token_validation: {
              ok: true,
            },
          },
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        lifecycle: "stable",
        preflight: {
          valid: true,
          tool_name: toolName,
          blocking_errors: [],
          token_validation: {
            ok: true,
          },
        },
      },
    };
  }

  validateSsotTokenForMcp(tokenValue) {
    return validateSsotWriteToken({
      tokenRegistry: this.ssotTokenRegistry,
      revisionState: this.ssotRevisionState,
      token: tokenValue,
    });
  }

  getCapabilitiesForMcp() {
    return {
      statusCode: 200,
      body: {
        ok: true,
        ...this.capabilityStore.getSnapshot(),
      },
    };
  }

  recordMcpToolInvocation(input) {
    const source = input && typeof input === "object" ? input : {};
    const toolName =
      typeof source.command_name === "string" ? source.command_name.trim() : "";
    if (
      toolName &&
      this.plannerDirectCompatibilityRuntime &&
      typeof this.plannerDirectCompatibilityRuntime.evaluateDirectCall === "function" &&
      typeof this.plannerDirectCompatibilityRuntime.recordDecision === "function"
    ) {
      const decision = this.plannerDirectCompatibilityRuntime.evaluateDirectCall(
        toolName
      );
      this.plannerDirectCompatibilityRuntime.recordDecision(decision);
    }
    if (
      this.v1PolishMetricsCollector &&
      typeof this.v1PolishMetricsCollector.recordToolInvocation === "function"
    ) {
      this.v1PolishMetricsCollector.recordToolInvocation(input);
    }
  }

  recordLatestSelectionContext(context, metadata) {
    this.unitySnapshotService.recordLatestSelectionContext(context, metadata);
  }

  cleanupSessionCache() {
    this.responseCacheService.cleanupSessionCache();
  }

  cleanupFileActionCache() {
    this.responseCacheService.cleanupFileActionCache();
  }

  getQueryRuntimeSnapshot() {
    return this.queryCoordinator &&
      typeof this.queryCoordinator.getStats === "function"
      ? this.queryCoordinator.getStats()
      : {
          total: 0,
          pending: 0,
          dispatched: 0,
          terminal: 0,
          waiters: 0,
          default_timeout_ms: 0,
          max_timeout_ms: 0,
        };
  }

  validationError(validation) {
    return buildValidationErrorResponseHelper(validation);
  }

}

module.exports = {
  TurnService,
};

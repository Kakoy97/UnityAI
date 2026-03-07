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

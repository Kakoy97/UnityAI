"use strict";
/**
 * R11-ARCH-01 Responsibility boundary:
 * - TurnService coordinates shared application services and orchestration primitives.
 * - TurnService must not expose MCP stdio tool catalogs or raw HTTP route branching.
 * - Command-specific schemas/policies belong to validators + command modules, not adapters.
 */

const {
  validateFileActionsApply,
  validateUnitySelectionSnapshot,
  validateUnityConsoleSnapshot,
  validateUnityCapabilitiesReport,
} = require("../domain/validators");
const {
  normalizeSelectionComponentIndex,
  normalizeConsoleSnapshotErrors,
} = require("../utils/turnUtils");
const { ResponseCacheService } = require("./responseCacheService");
const { UnitySnapshotService } = require("./unitySnapshotService");
const { PreconditionService } = require("./preconditionService");
const { McpGateway } = require("./mcpGateway/mcpGateway");
const { McpEyesService } = require("./mcpGateway/mcpEyesService");
const { QueryStore } = require("./queryRuntime/queryStore");
const { QueryCoordinator } = require("./queryCoordinator");
const { CapabilityStore } = require("./capabilityStore");
const {
  normalizeRequestId,
  normalizeString,
  isObject,
  buildUnityActionRequestEnvelopeWithIds:
    buildUnityActionRequestEnvelopeWithIdsHelper,
  buildValidationErrorResponse: buildValidationErrorResponseHelper,
  normalizeWriteOutcome: normalizeWriteOutcomeHelper,
  mapFileErrorToStatus: mapFileErrorToStatusHelper,
} = require("./turnServiceWriteSupport");
const {
  createCaptureCompositeRuntime,
} = require("./captureCompositeRuntime");

const SESSION_CACHE_TTL_MS = 15 * 60 * 1000;

class TurnService {
  constructor(deps) {
    this.turnStore = deps.turnStore;
    this.nowIso = deps.nowIso;
    this.fileActionExecutor = deps.fileActionExecutor;
    this.sessionCacheTtlMs =
      Number(deps.sessionCacheTtlMs) > 0
        ? Number(deps.sessionCacheTtlMs)
        : SESSION_CACHE_TTL_MS;
    this.enableMcpEyes = deps.enableMcpEyes === true;
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
    this.mcpGateway = new McpGateway({
      nowIso: this.nowIso,
      enableMcpAdapter: deps.enableMcpAdapter,
      unitySnapshotService: this.unitySnapshotService,
      resolveUnityConnectionState: () =>
        this.capabilityStore.getSnapshot().unity_connection_state,
      mcpMaxQueue: deps.mcpMaxQueue,
      mcpJobTtlMs: deps.mcpJobTtlMs,
      mcpStreamMaxEvents: deps.mcpStreamMaxEvents,
      mcpStreamMaxSubscribers: deps.mcpStreamMaxSubscribers,
      mcpStreamRecoveryJobsMax: deps.mcpStreamRecoveryJobsMax,
      mcpLeaseHeartbeatTimeoutMs: deps.mcpLeaseHeartbeatTimeoutMs,
      mcpLeaseMaxRuntimeMs: deps.mcpLeaseMaxRuntimeMs,
      mcpRebootWaitTimeoutMs: deps.mcpRebootWaitTimeoutMs,
      mcpLeaseJanitorIntervalMs: deps.mcpLeaseJanitorIntervalMs,
      legacyAnchorMode: deps.legacyAnchorMode,
      legacyAnchorDenySignoff: deps.legacyAnchorDenySignoff,
      mcpSnapshotStore: deps.mcpSnapshotStore,
      fileActionExecutor: this.fileActionExecutor,
      v1PolishMetricsCollector: this.v1PolishMetricsCollector,
      getCaptureCompositeMetricsSnapshot: () =>
        this.captureCompositeRuntime.getMetricsSnapshot(Date.now()),
      getProtocolGovernanceMetricsSnapshot: () =>
        this.mcpEyesService &&
        typeof this.mcpEyesService.getProtocolGovernanceMetricsSnapshot ===
          "function"
          ? this.mcpEyesService.getProtocolGovernanceMetricsSnapshot()
          : null,
    });
    this.preconditionService = new PreconditionService({
      turnStore: this.turnStore,
      unitySnapshotService: this.unitySnapshotService,
      mcpGateway: this.mcpGateway,
    });
    this.mcpEyesService = new McpEyesService({
      nowIso: this.nowIso,
      enableMcpEyes: this.enableMcpEyes,
      unitySnapshotService: this.unitySnapshotService,
      preconditionService: this.preconditionService,
      mcpGateway: this.mcpGateway,
      capabilityStore: this.capabilityStore,
      enqueueAndWaitForUnityQuery: this.enqueueAndWaitForUnityQuery.bind(this),
      submitUnityQueryAndWait: this.submitUnityQueryAndWait.bind(this),
      queryContractVersion: this.unityQueryContractVersion,
      v1PolishMetricsCollector: this.v1PolishMetricsCollector,
      retryFuseEnabled: deps.retryFuseEnabled,
      retryFuseWindowMs: deps.retryFuseWindowMs,
      retryFuseMaxAttempts: deps.retryFuseMaxAttempts,
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

    // Compatibility alias for existing tests/harness.
    this.mcpService = this.mcpGateway;
  }

  getHealthPayload() {
    if (this.turnStore && typeof this.turnStore.sweep === "function") {
      this.turnStore.sweep();
    }
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });
    return {
      ok: true,
      service: "codex-unity-sidecar-mvp",
      timestamp: this.nowIso(),
      active_request_id: this.mcpGateway.lockManager.getRunningJobId(),
      active_state: this.mcpGateway.lockManager.hasRunningJob() ? "running" : "",
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
    this.refreshMcpJobs({ drainQueue: true });
    const turnSnapshot =
      this.turnStore && typeof this.turnStore.getSnapshot === "function"
        ? this.turnStore.getSnapshot()
        : { turns: [] };
    return {
      ...turnSnapshot,
      mcp_runtime: {
        running_job_id: this.mcpGateway.lockManager.getRunningJobId(),
        queued_job_ids: this.mcpGateway.jobQueue.list(),
        jobs: this.mcpGateway.jobStore.listJobs(),
        capabilities: this.capabilityStore.getSnapshot(),
      },
    };
  }

  startSession(body) {
    return {
      statusCode: 410,
      body: {
        error_code: "E_GONE",
        message: "session.start is removed in gateway mode",
      },
    };
  }

  sendTurn() {
    return {
      statusCode: 410,
      body: {
        error_code: "E_GONE",
        message: "turn.send is removed in gateway mode",
      },
    };
  }

  getTurnStatus() {
    return {
      statusCode: 410,
      body: {
        error_code: "E_GONE",
        message: "turn.status is removed in gateway mode",
      },
    };
  }

  cancelTurn() {
    return {
      statusCode: 410,
      body: {
        error_code: "E_GONE",
        message: "turn.cancel is removed in gateway mode",
      },
    };
  }

  applyFileActions(body) {
    if (this.turnStore && typeof this.turnStore.sweep === "function") {
      this.turnStore.sweep();
    }
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateFileActionsApply(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }
    const requestId = normalizeRequestId(body.request_id);
    const existing = this.responseCacheService.getFileActionReceipt(requestId);
    if (existing) {
      return {
        statusCode: existing.statusCode,
        body: {
          ...existing.body,
          replay: true,
        },
      };
    }
    if (!this.fileActionExecutor || typeof this.fileActionExecutor.execute !== "function") {
      return {
        statusCode: 500,
        body: {
          error_code: "E_INTERNAL",
          message: "fileActionExecutor is not configured",
        },
      };
    }

    const execution = this.fileActionExecutor.execute(body.payload.file_actions);
    if (!execution || execution.ok !== true) {
      const statusCode = this.mapFileErrorToStatus(execution && execution.errorCode);
      const errorBody = {
        event: "turn.error",
        request_id: body.request_id,
        thread_id: body.thread_id,
        turn_id: body.turn_id,
        timestamp: this.nowIso(),
        payload: {
          error_code: (execution && execution.errorCode) || "E_FILE_WRITE_FAILED",
          error_message:
            (execution && execution.message) || "File action execution failed",
          files_changed:
            execution && Array.isArray(execution.changes) ? execution.changes : [],
        },
        error_code: (execution && execution.errorCode) || "E_FILE_WRITE_FAILED",
        message: (execution && execution.message) || "File action execution failed",
      };
      this.responseCacheService.cacheFileActionReceipt(requestId, statusCode, errorBody);
      return {
        statusCode,
        body: errorBody,
      };
    }

    const responseBody = {
      event: "files.changed",
      request_id: body.request_id,
      thread_id: body.thread_id,
      turn_id: body.turn_id,
      timestamp: this.nowIso(),
      replay: false,
      payload: {
        changes: execution.changes || [],
        compile_request: {
          event: "unity.compile.request",
          request_id: body.request_id,
          thread_id: body.thread_id,
          turn_id: body.turn_id,
          reason: "file_actions_applied",
          refresh_assets: true,
        },
      },
    };
    this.responseCacheService.cacheFileActionReceipt(requestId, 200, responseBody);
    return {
      statusCode: 200,
      body: responseBody,
    };
  }

  reportCompileResult(body) {
    this.capabilityStore.markUnitySignal();
    const normalizedBody =
      this.mcpGateway &&
      typeof this.mcpGateway.normalizeUnityCompileResultBody === "function"
        ? this.mcpGateway.normalizeUnityCompileResultBody(body)
        : body;
    this.unitySnapshotService.captureLatestCompileSnapshot(normalizedBody);
    return this.mcpGateway.handleUnityCompileResult(normalizedBody);
  }

  reportUnityActionResult(body) {
    this.capabilityStore.markUnitySignal();
    const normalizedBody =
      this.mcpGateway &&
      typeof this.mcpGateway.normalizeUnityActionResultBody === "function"
        ? this.mcpGateway.normalizeUnityActionResultBody(body)
        : body;
    this.unitySnapshotService.captureLatestActionErrorSnapshot(normalizedBody);
    return this.mcpGateway.handleUnityActionResult(normalizedBody);
  }

  pullUnityQuery(body) {
    return this.queryCoordinator.pullQuery(body);
  }

  reportUnityQuery(body) {
    const normalizedBody =
      this.mcpGateway &&
      typeof this.mcpGateway.normalizeUnityQueryReportBody === "function"
        ? this.mcpGateway.normalizeUnityQueryReportBody(body)
        : body;
    return this.queryCoordinator.reportQueryResult(normalizedBody);
  }

  submitUnityQueryAndWait(queryType, payload, options) {
    const opts = options && typeof options === "object" ? options : {};
    return this.enqueueAndWaitForUnityQuery({
      queryType,
      payload: payload && typeof payload === "object" ? payload : {},
      timeoutMs: opts.timeout_ms,
      requestId: opts.request_id,
      threadId: opts.thread_id,
      turnId: opts.turn_id,
      queryContractVersion: opts.query_contract_version,
      queryPayloadJson: opts.query_payload_json,
    });
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

  reportUnityQueryComponentsResult() {
    return {
      statusCode: 410,
      body: {
        error_code: "E_GONE",
        message: "unity.query.components.result is removed in gateway mode",
      },
    };
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

  reportUnityConsoleSnapshot(body) {
    const validation = validateUnityConsoleSnapshot(body);
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
    const errors = normalizeConsoleSnapshotErrors(payload.errors);
    this.unitySnapshotService.setLatestConsoleSnapshot({
      source: "unity.console.snapshot",
      captured_at: this.nowIso(),
      request_id: normalizeRequestId(body.request_id),
      thread_id: typeof body.thread_id === "string" ? body.thread_id : "",
      turn_id: typeof body.turn_id === "string" ? body.turn_id : "",
      reason,
      errors,
    });
    return {
      statusCode: 200,
      body: {
        ok: true,
        event: "unity.console.snapshot.accepted",
        reason,
        total_errors: errors.length,
      },
    };
  }

  reportUnityRuntimePing(body) {
    this.capabilityStore.markUnitySignal();
    return this.mcpGateway.handleUnityRuntimePing(body);
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

  submitUnityTask(body) {
    return this.normalizeWriteOutcome(this.mcpGateway.submitUnityTask(body));
  }

  getUnityTaskStatus(jobId) {
    return this.normalizeWriteOutcome(this.mcpGateway.getUnityTaskStatus(jobId));
  }

  cancelUnityTask(body) {
    return this.normalizeWriteOutcome(this.mcpGateway.cancelUnityTask(body));
  }

  heartbeatMcp(body) {
    return this.mcpGateway.heartbeat(body);
  }

  applyScriptActionsForMcp(body) {
    return this.normalizeWriteOutcome(this.mcpEyesService.applyScriptActions(body));
  }

  applyVisualActionsForMcp(body) {
    return this.normalizeWriteOutcome(this.mcpEyesService.applyVisualActions(body));
  }

  setUiPropertiesForMcp(body) {
    return this.normalizeWriteOutcome(this.mcpEyesService.setUiProperties(body));
  }

  preflightValidateWritePayloadForMcp(body) {
    return this.normalizeWriteOutcome(
      this.mcpEyesService.preflightValidateWritePayload(body)
    );
  }

  getCurrentSelectionForMcp() {
    return this.mcpEyesService.getCurrentSelection();
  }

  getGameObjectComponentsForMcp(body) {
    return this.mcpEyesService.getGameObjectComponents(body);
  }

  getHierarchySubtreeForMcp(body) {
    return this.mcpEyesService.getHierarchySubtree(body);
  }

  getPrefabInfoForMcp(body) {
    return this.mcpEyesService.getPrefabInfo(body);
  }

  getCompileStateForMcp() {
    return this.mcpEyesService.getCompileState();
  }

  getConsoleErrorsForMcp(body) {
    return this.mcpEyesService.getConsoleErrors(body);
  }

  async listAssetsInFolderForMcp(body) {
    return this.mcpEyesService.listAssetsInFolder(body);
  }

  async getSceneRootsForMcp(body) {
    return this.mcpEyesService.getSceneRoots(body);
  }

  async findObjectsByComponentForMcp(body) {
    return this.mcpEyesService.findObjectsByComponent(body);
  }

  async queryPrefabInfoForMcp(body) {
    return this.mcpEyesService.queryPrefabInfo(body);
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

  listMcpResources() {
    return this.mcpEyesService.listResources();
  }

  readMcpResource(uri) {
    return this.mcpEyesService.readResource(uri);
  }

  getMcpMetrics() {
    return {
      statusCode: 200,
      body: this.mcpGateway.getMcpMetrics(),
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

  registerMcpStreamSubscriber(options) {
    return this.mcpGateway.registerMcpStreamSubscriber(options);
  }

  unregisterMcpStreamSubscriber(subscriberId) {
    this.mcpGateway.unregisterMcpStreamSubscriber(subscriberId);
  }

  refreshMcpJobs(options) {
    return this.mcpGateway.refreshJobs(options);
  }

  drainMcpQueue() {
    return this.mcpGateway.refreshJobs({ drainQueue: true });
  }

  resolveTurnApprovalMode(requestId) {
    return this.mcpGateway.resolveApprovalModeByRequestId(requestId);
  }

  recordLatestSelectionContext(context, metadata) {
    this.unitySnapshotService.recordLatestSelectionContext(context, metadata);
  }

  captureLatestCompileSnapshot(body) {
    this.unitySnapshotService.captureLatestCompileSnapshot(body);
  }

  captureLatestActionErrorSnapshot(body) {
    this.unitySnapshotService.captureLatestActionErrorSnapshot(body);
  }

  cleanupSessionCache() {
    this.responseCacheService.cleanupSessionCache();
  }

  cleanupFileActionCache() {
    this.responseCacheService.cleanupFileActionCache();
  }

  buildUnityActionRequestEnvelope(body, action) {
    return this.buildUnityActionRequestEnvelopeWithIds(
      body && body.request_id,
      body && body.thread_id,
      body && body.turn_id,
      action
    );
  }

  buildUnityActionRequestEnvelopeWithIds(requestId, threadId, turnId, action) {
    return buildUnityActionRequestEnvelopeWithIdsHelper({
      requestId,
      threadId,
      turnId,
      action,
      nowIso: this.nowIso,
      resolveApprovalMode: (normalizedRequestId) =>
        this.resolveTurnApprovalMode(normalizedRequestId),
    });
  }

  validationError(validation) {
    return buildValidationErrorResponseHelper(validation);
  }

  normalizeWriteOutcome(outcome) {
    return normalizeWriteOutcomeHelper(outcome, {
      resolveRequestIdFromFailureBody: (failureBody) =>
        this.resolveRequestIdFromFailureBody(failureBody),
    });
  }

  resolveRequestIdFromFailureBody(body) {
    if (!isObject(body)) {
      return "";
    }
    const jobId = normalizeString(body.job_id);
    if (!jobId || !this.mcpGateway || !this.mcpGateway.jobStore) {
      return "";
    }
    const job =
      typeof this.mcpGateway.jobStore.getJob === "function"
        ? this.mcpGateway.jobStore.getJob(jobId)
        : null;
    if (!job || typeof job !== "object") {
      return "";
    }
    return normalizeString(job.request_id);
  }

  mapFileErrorToStatus(errorCode) {
    return mapFileErrorToStatusHelper(errorCode);
  }
}

module.exports = {
  TurnService,
};

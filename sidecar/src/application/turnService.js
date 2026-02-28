"use strict";

const {
  validateFileActionsApply,
  validateUnitySelectionSnapshot,
  validateUnityConsoleSnapshot,
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
const { QueryCoordinator } = require("./queryRuntime/queryCoordinator");

const SESSION_CACHE_TTL_MS = 15 * 60 * 1000;

function normalizeRequestId(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
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
    this.enableMcpEyes = deps.enableMcpEyes === true;

    this.responseCacheService = new ResponseCacheService({
      sessionCacheTtlMs: this.sessionCacheTtlMs,
    });
    this.unitySnapshotService = new UnitySnapshotService({
      nowIso: this.nowIso,
      readTokenHardMaxAgeMs: deps.readTokenHardMaxAgeMs,
    });
    this.mcpGateway = new McpGateway({
      nowIso: this.nowIso,
      enableMcpAdapter: deps.enableMcpAdapter,
      unitySnapshotService: this.unitySnapshotService,
      mcpMaxQueue: deps.mcpMaxQueue,
      mcpJobTtlMs: deps.mcpJobTtlMs,
      mcpStreamMaxEvents: deps.mcpStreamMaxEvents,
      mcpStreamMaxSubscribers: deps.mcpStreamMaxSubscribers,
      mcpStreamRecoveryJobsMax: deps.mcpStreamRecoveryJobsMax,
      mcpLeaseHeartbeatTimeoutMs: deps.mcpLeaseHeartbeatTimeoutMs,
      mcpLeaseMaxRuntimeMs: deps.mcpLeaseMaxRuntimeMs,
      mcpRebootWaitTimeoutMs: deps.mcpRebootWaitTimeoutMs,
      mcpLeaseJanitorIntervalMs: deps.mcpLeaseJanitorIntervalMs,
      mcpSnapshotStore: deps.mcpSnapshotStore,
      fileActionExecutor: this.fileActionExecutor,
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
      submitUnityQueryAndWait: this.submitUnityQueryAndWait.bind(this),
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
    const normalizedBody =
      this.mcpGateway &&
      typeof this.mcpGateway.normalizeUnityCompileResultBody === "function"
        ? this.mcpGateway.normalizeUnityCompileResultBody(body)
        : body;
    this.unitySnapshotService.captureLatestCompileSnapshot(normalizedBody);
    return this.mcpGateway.handleUnityCompileResult(normalizedBody);
  }

  reportUnityActionResult(body) {
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
    return this.queryCoordinator.enqueueAndWait({
      query_type: queryType,
      payload: payload && typeof payload === "object" ? payload : {},
      timeout_ms: opts.timeout_ms,
      request_id: opts.request_id,
      thread_id: opts.thread_id,
      turn_id: opts.turn_id,
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
    return this.mcpGateway.handleUnityRuntimePing(body);
  }

  submitUnityTask(body) {
    return this.mcpGateway.submitUnityTask(body);
  }

  getUnityTaskStatus(jobId) {
    return this.mcpGateway.getUnityTaskStatus(jobId);
  }

  cancelUnityTask(body) {
    return this.mcpGateway.cancelUnityTask(body);
  }

  heartbeatMcp(body) {
    return this.mcpGateway.heartbeat(body);
  }

  applyScriptActionsForMcp(body) {
    return this.mcpEyesService.applyScriptActions(body);
  }

  applyVisualActionsForMcp(body) {
    return this.mcpEyesService.applyVisualActions(body);
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
    const item = action && typeof action === "object" ? action : {};
    const normalizedRequestId = normalizeRequestId(requestId);
    const approvalMode = this.resolveTurnApprovalMode(normalizedRequestId);
    return {
      event: "unity.action.request",
      request_id: normalizedRequestId,
      thread_id: typeof threadId === "string" ? threadId : "",
      turn_id: typeof turnId === "string" ? turnId : "",
      timestamp: this.nowIso(),
      payload: {
        action_type: typeof item.type === "string" ? item.type : "",
        target: typeof item.target === "string" ? item.target : "",
        target_object_path:
          typeof item.target_object_path === "string" ? item.target_object_path : "",
        target_object_id:
          typeof item.target_object_id === "string" ? item.target_object_id : "",
        component_assembly_qualified_name:
          typeof item.component_assembly_qualified_name === "string"
            ? item.component_assembly_qualified_name
            : "",
        component_name:
          typeof item.component_name === "string" ? item.component_name : "",
        remove_mode:
          typeof item.remove_mode === "string" ? item.remove_mode : "single",
        expected_count:
          Number.isFinite(Number(item.expected_count)) &&
          Number(item.expected_count) >= 0
            ? Math.floor(Number(item.expected_count))
            : 1,
        requires_confirmation: approvalMode === "require_user",
      },
    };
  }

  validationError(validation) {
    const expected =
      validation && validation.expected && typeof validation.expected === "object"
        ? validation.expected
        : null;
    const actual =
      validation && validation.actual && typeof validation.actual === "object"
        ? validation.actual
        : null;
    const diff =
      validation && Array.isArray(validation.diff) ? validation.diff : null;
    return {
      statusCode: validation.statusCode,
      body: {
        error_code: validation.errorCode,
        message: validation.message,
        ...(expected ? { expected } : {}),
        ...(actual ? { actual } : {}),
        ...(diff ? { diff } : {}),
      },
    };
  }

  mapFileErrorToStatus(errorCode) {
    if (errorCode === "E_FILE_EXISTS_BLOCKED") {
      return 409;
    }
    if (errorCode === "E_FILE_PATH_FORBIDDEN") {
      return 403;
    }
    if (errorCode === "E_FILE_SIZE_EXCEEDED") {
      return 413;
    }
    if (errorCode === "E_FILE_NOT_FOUND") {
      return 404;
    }
    if (errorCode === "E_SCHEMA_INVALID") {
      return 400;
    }
    return 500;
  }
}

module.exports = {
  TurnService,
};

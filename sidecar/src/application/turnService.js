"use strict";
const SESSION_CACHE_TTL_MS = 15 * 60 * 1000;
const FINALIZE_TIMEOUT_MS = 30000;
const MCP_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MCP_MAX_QUEUE = 1;
const MCP_STREAM_MAX_EVENTS = 500;
const MCP_STREAM_MAX_SUBSCRIBERS = 32;
const MCP_STREAM_RECOVERY_JOBS_MAX = 20;
const {
  validateSessionStart,
  validateTurnSend,
  validateTurnCancel,
  validateMcpSubmitUnityTask,
  validateMcpGetUnityTaskStatus,
  validateMcpCancelUnityTask,
  validateFileActionsApply,
  validateUnityCompileResult,
  validateUnityActionResult,
  validateUnityRuntimePing,
  validateUnityQueryComponentsResult,
  validatePlannerOutputGuard,
} = require("../domain/validators");

function normalizeRequestId(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

class TurnService {
  /**
   * @param {{
   *  turnStore: import("../domain/turnStore").TurnStore,
   *  nowIso: () => string,
   *  sessionCacheTtlMs?: number,
   *  unityComponentQueryTimeoutMs?: number,
   *  enableMcpAdapter?: boolean,
   *  mcpMaxQueue?: number,
   *  mcpJobTtlMs?: number,
   *  mcpStreamMaxEvents?: number,
   *  mcpStreamMaxSubscribers?: number,
   *  mcpStreamRecoveryJobsMax?: number,
   *  mcpSnapshotStore?: { loadSnapshot: () => any, saveSnapshot: (snapshot: any) => boolean },
   *  enableTimeoutAbortCleanup?: boolean,
   *  fileActionExecutor: { execute: (actions: Array<any>) => { ok: boolean, changes: Array<{type: string, path: string}>, errorCode?: string, message?: string } },
   *  codexPlanner?: {
   *    enabled?: boolean,
   *    planTurn: (input: { requestId: string, threadId: string, turnId: string, userMessage: string, context: any, signal?: AbortSignal, onDelta?: (delta: string) => void, onMessage?: (message: string) => void, onProgress?: (event?: any) => void, queryUnityComponents?: (arg: { targetPath: string }) => Promise<{ components?: Array<{short_name: string, assembly_qualified_name: string}>, error_code?: string, error_message?: string }> }) => Promise<{ assistant_text?: string, task_allocation?: any }>,
   *    finalizeTurn?: (input: { requestId: string, threadId: string, turnId: string, executionReport: any, signal?: AbortSignal, onDelta?: (delta: string) => void, onMessage?: (message: string) => void, onProgress?: (event?: any) => void }) => Promise<string>,
   *    recordExecutionMemory?: (input: { threadId: string, executionReport: any, finalMessage: string }) => void
   *  },
   *  autoFixExecutor?: {
   *    attemptCompileFix: (errors: Array<any>) => { ok: boolean, reason?: string, changes?: Array<{type: string, path: string}>, errorCode?: string, message?: string },
   *    attemptActionFix: (pendingAction: any, actionPayload: any) => { ok: boolean, reason?: string, patchedAction?: any, errorCode?: string, message?: string }
   *  }
   * }} deps
   */
  constructor(deps) {
    this.turnStore = deps.turnStore;
    this.nowIso = deps.nowIso;
    this.sessionCacheTtlMs =
      Number(deps.sessionCacheTtlMs) > 0
        ? Number(deps.sessionCacheTtlMs)
        : SESSION_CACHE_TTL_MS;
    this.unityComponentQueryTimeoutMs =
      Number(deps.unityComponentQueryTimeoutMs) > 0
        ? Math.floor(Number(deps.unityComponentQueryTimeoutMs))
        : 5000;
    this.enableMcpAdapter = deps.enableMcpAdapter === true;
    this.mcpMaxQueue =
      Number.isFinite(Number(deps.mcpMaxQueue)) && Number(deps.mcpMaxQueue) >= 0
        ? Math.floor(Number(deps.mcpMaxQueue))
        : MCP_MAX_QUEUE;
    this.mcpJobTtlMs =
      Number.isFinite(Number(deps.mcpJobTtlMs)) && Number(deps.mcpJobTtlMs) > 0
        ? Math.floor(Number(deps.mcpJobTtlMs))
        : MCP_JOB_TTL_MS;
    this.mcpStreamMaxEvents =
      Number.isFinite(Number(deps.mcpStreamMaxEvents)) &&
      Number(deps.mcpStreamMaxEvents) > 0
        ? Math.floor(Number(deps.mcpStreamMaxEvents))
        : MCP_STREAM_MAX_EVENTS;
    this.mcpStreamMaxSubscribers =
      Number.isFinite(Number(deps.mcpStreamMaxSubscribers)) &&
      Number(deps.mcpStreamMaxSubscribers) > 0
        ? Math.floor(Number(deps.mcpStreamMaxSubscribers))
        : MCP_STREAM_MAX_SUBSCRIBERS;
    this.mcpStreamRecoveryJobsMax =
      Number.isFinite(Number(deps.mcpStreamRecoveryJobsMax)) &&
      Number(deps.mcpStreamRecoveryJobsMax) >= 0
        ? Math.floor(Number(deps.mcpStreamRecoveryJobsMax))
        : MCP_STREAM_RECOVERY_JOBS_MAX;
    this.enableTimeoutAbortCleanup = deps.enableTimeoutAbortCleanup !== false;
    this.fileActionExecutor = deps.fileActionExecutor;
    this.codexPlanner = deps.codexPlanner || null;
    this.autoFixExecutor = deps.autoFixExecutor || null;
    this.mcpSnapshotStore = deps.mcpSnapshotStore || null;
    /** @type {Map<string, () => void>} */
    this.pendingPlanningCancels = new Map();
    /** @type {Map<string, {statusCode: number, body: Record<string, unknown>, expiresAt: number}>} */
    this.sessionReceiptByRequestId = new Map();
    /** @type {Map<string, {statusCode: number, body: Record<string, unknown>, expiresAt: number}>} */
    this.fileActionReceiptByRequestId = new Map();
    /** @type {Map<string, {requestId: string, resolve: (value: any) => void, reject: (reason?: any) => void, timer: NodeJS.Timeout | null}>} */
    this.pendingUnityComponentQueries = new Map();
    /** @type {Map<string, any>} */
    this.mcpJobsById = new Map();
    /** @type {Map<string, string>} */
    this.mcpIdempotencyToJobId = new Map();
    /** @type {string[]} */
    this.mcpQueuedJobIds = [];
    this.mcpRunningJobId = "";
    /** @type {Map<string, { thread_id: string, onEvent: (event: any) => void }>} */
    this.mcpStreamSubscribers = new Map();
    /** @type {Array<any>} */
    this.mcpStreamRecentEvents = [];
    this.mcpStreamNextEventSeq = 1;
    this.mcpStreamNextSubscriberSeq = 1;
    this.mcpMetrics = {
      status_query_calls: 0,
      stream_connect_calls: 0,
      stream_events_published: 0,
      stream_events_delivered: 0,
      stream_replay_events_sent: 0,
      stream_recovery_jobs_sent: 0,
      stream_subscriber_rejects: 0,
      stream_subscriber_drops: 0,
    };

    if (this.enableMcpAdapter) {
      this.restoreMcpJobsFromSnapshot();
      this.refreshMcpJobs({ drainQueue: true });
    }

    if (
      this.enableTimeoutAbortCleanup &&
      this.turnStore &&
      typeof this.turnStore.setTimeoutAbortHandler === "function"
    ) {
      this.turnStore.setTimeoutAbortHandler((details) => {
        const requestId =
          details && typeof details.requestId === "string"
            ? details.requestId
            : "";
        if (!requestId) {
          return;
        }
        const timeoutReason =
          details && typeof details.reason === "string"
            ? details.reason
            : "timeout_abort";
        const timeoutCode =
          details && typeof details.errorCode === "string"
            ? details.errorCode
            : "E_INTERNAL";
        const timeoutMessage =
          details && typeof details.message === "string"
            ? details.message
            : "Turn timeout reached";
        this.turnStore.appendEvent(requestId, "diag.timeout.abort", {
          phase:
            details && typeof details.phase === "string"
              ? details.phase
              : "",
          stage:
            details && typeof details.stage === "string"
              ? details.stage
              : "",
          error_code: timeoutCode,
          message: `${timeoutReason}: ${timeoutMessage}`,
        });
        this.cancelPlanningTask(requestId, timeoutReason);
      });
    } else if (
      this.turnStore &&
      typeof this.turnStore.setTimeoutAbortHandler === "function"
    ) {
      this.turnStore.setTimeoutAbortHandler(null);
    }
  }

  getHealthPayload() {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.refreshMcpJobs({ drainQueue: true });
    return {
      ok: true,
      service: "codex-unity-sidecar-mvp",
      timestamp: this.nowIso(),
      active_request_id: this.turnStore.getActiveRequestId(),
      active_state: this.turnStore.getActiveState(),
    };
  }

  getStateSnapshotPayload() {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });
    return this.turnStore.getSnapshot();
  }

  submitUnityTask(body) {
    if (!this.enableMcpAdapter) {
      return {
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_NOT_FOUND",
          message: "MCP adapter is disabled",
        }),
      };
    }

    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateMcpSubmitUnityTask(body);
    if (!validation.ok) {
      return this.mcpValidationError(validation);
    }

    const idempotencyKey = String(body.idempotency_key || "").trim();
    const replayJobId = this.mcpIdempotencyToJobId.get(idempotencyKey) || "";
    if (replayJobId) {
      const existingJob = this.mcpJobsById.get(replayJobId) || null;
      if (existingJob) {
        return {
          statusCode: 200,
          body: {
            status: "accepted",
            job_id: existingJob.job_id,
            idempotent_replay: true,
            job_status: existingJob.status,
            approval_mode: normalizeApprovalMode(existingJob.approval_mode, "auto"),
            running_job_id: this.mcpRunningJobId || "",
            error_code: existingJob.error_code || "",
            error_message: existingJob.error_message || "",
            suggestion: existingJob.suggestion || "",
            recoverable: existingJob.recoverable === true,
            message: "Idempotency hit. Returning existing job.",
          },
        };
      }
      this.mcpIdempotencyToJobId.delete(idempotencyKey);
      this.persistMcpJobs();
    }

    const runningJobId = this.mcpRunningJobId || "";
    const hasRunning = !!runningJobId;
    if (hasRunning && this.mcpQueuedJobIds.length >= this.mcpMaxQueue) {
      const conflict = this.withMcpErrorFeedback({
        status: "rejected",
        error_code: "E_JOB_CONFLICT",
        message: "Another Unity job is already running",
      });
      return {
        statusCode: 409,
        body: {
          ...conflict,
          reason_code: conflict.error_code,
          running_job_id: runningJobId,
        },
      };
    }

    const createdAt = Date.now();
    const threadId = String(body.thread_id || "").trim();
    const approvalMode =
      body.approval_mode === "require_user" ? "require_user" : "auto";
    const context =
      body.context && typeof body.context === "object"
        ? body.context
        : buildDefaultTurnContext();
    const job = {
      job_id: createMcpJobId(createdAt),
      idempotency_key: idempotencyKey,
      approval_mode: approvalMode,
      user_intent: String(body.user_intent || ""),
      thread_id: threadId,
      request_id: createMcpRequestId(createdAt),
      turn_id: createMcpTurnId(createdAt),
      context,
      status: hasRunning ? "queued" : "pending",
      stage: hasRunning ? "queued" : "codex_pending",
      progress_message: hasRunning
        ? "Queued and waiting for running job to finish"
        : "Task accepted and pending",
      error_code: "",
      error_message: "",
      suggestion: "",
      recoverable: false,
      execution_report: null,
      created_at: createdAt,
      updated_at: createdAt,
      terminal_at: 0,
    };

    this.mcpJobsById.set(job.job_id, job);
    this.mcpIdempotencyToJobId.set(job.idempotency_key, job.job_id);

    if (hasRunning) {
      this.mcpQueuedJobIds.push(job.job_id);
      this.persistMcpJobs();
      this.publishMcpJobEvent("job.progress", job);
      return {
        statusCode: 202,
        body: {
          status: "queued",
          job_id: job.job_id,
          approval_mode: job.approval_mode,
          running_job_id: runningJobId,
          message: "Task queued",
        },
      };
    }

    const startOutcome = this.startMcpJob(job);
    if (!startOutcome.ok) {
      if (startOutcome.queued) {
        return {
          statusCode: 202,
          body: {
            status: "queued",
            job_id: job.job_id,
            approval_mode: job.approval_mode,
            running_job_id: this.mcpRunningJobId || "",
            message: "Task queued",
          },
        };
      }
      return {
        statusCode: 500,
        body: this.withMcpErrorFeedback({
          status: "failed",
          job_id: job.job_id,
          error_code: job.error_code || "E_INTERNAL",
          error_message: job.error_message || "Failed to start job",
          suggestion: job.suggestion || "",
          recoverable: job.recoverable === true,
        }),
      };
    }

    this.persistMcpJobs();

    return {
      statusCode: 202,
      body: {
        status: "accepted",
        job_id: job.job_id,
        approval_mode: job.approval_mode,
        message: "Task accepted. Progress can be queried with get_unity_task_status.",
      },
    };
  }

  getUnityTaskStatus(jobId) {
    if (!this.enableMcpAdapter) {
      return {
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_NOT_FOUND",
          message: "MCP adapter is disabled",
        }),
      };
    }

    this.turnStore.sweep();
    this.refreshMcpJobs({ drainQueue: true });
    this.mcpMetrics.status_query_calls += 1;

    const validation = validateMcpGetUnityTaskStatus(jobId);
    if (!validation.ok) {
      return this.mcpValidationError(validation);
    }

    const normalizedJobId = String(jobId || "").trim();
    const job = this.mcpJobsById.get(normalizedJobId) || null;
    if (!job) {
      return {
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: "E_JOB_NOT_FOUND",
          message: "job_id not found",
        }),
      };
    }

    return {
      statusCode: 200,
      body: this.buildMcpJobStatusPayload(job),
    };
  }

  cancelUnityTask(body) {
    if (!this.enableMcpAdapter) {
      return {
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_NOT_FOUND",
          message: "MCP adapter is disabled",
        }),
      };
    }

    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateMcpCancelUnityTask(body);
    if (!validation.ok) {
      return this.mcpValidationError(validation);
    }

    const jobId = String(body.job_id || "").trim();
    const job = this.mcpJobsById.get(jobId) || null;
    if (!job) {
      return {
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: "E_JOB_NOT_FOUND",
          message: "job_id not found",
        }),
      };
    }

    if (job.status === "queued") {
      this.mcpQueuedJobIds = this.mcpQueuedJobIds.filter((item) => item !== jobId);
      job.status = "cancelled";
      job.stage = "cancelled";
      job.progress_message = "Job cancelled while in queue";
      job.updated_at = Date.now();
      job.terminal_at = job.updated_at;
      job.error_code = "";
      job.error_message = "";
      job.suggestion = "";
      job.recoverable = false;
      this.persistMcpJobs();
      this.publishMcpJobEvent("job.completed", job);
      this.refreshMcpJobs({ drainQueue: true });
      return {
        statusCode: 200,
        body: {
          status: "cancelled",
          job_id: jobId,
          message: "Queued job cancelled",
        },
      };
    }

    if (isTerminalMcpStatus(job.status)) {
      return {
        statusCode: 200,
        body: {
          status: job.status,
          job_id: jobId,
          message: "Job is already terminal",
        },
      };
    }

    const cancelEnvelope = this.buildMcpTurnCancelEnvelope(job);
    const cancelOutcome = this.cancelTurn(cancelEnvelope, {
      skipMcpRefresh: true,
    });
    if (cancelOutcome.statusCode >= 400) {
      const failure = this.withMcpErrorFeedback({
        status: "failed",
        error_code:
          cancelOutcome.body && cancelOutcome.body.error_code
            ? cancelOutcome.body.error_code
            : "E_INTERNAL",
        message:
          cancelOutcome.body && cancelOutcome.body.message
            ? cancelOutcome.body.message
            : "Failed to cancel job",
      });
      return {
        statusCode: cancelOutcome.statusCode,
        body: {
          job_id: jobId,
          ...failure,
        },
      };
    }

    this.refreshMcpJobs({ drainQueue: true });
    return {
      statusCode: 200,
      body: {
        status: "cancelled",
        job_id: jobId,
        message: "Cancel requested",
      },
    };
  }

  startSession(body) {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateSessionStart(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const requestId = normalizeRequestId(body.request_id);
    const existing = this.getSessionReceipt(requestId);
    if (existing) {
      return {
        statusCode: existing.statusCode,
        body: {
          ...existing.body,
          replay: true,
        },
      };
    }

    const responseBody = {
      ok: true,
      event: "session.started",
      timestamp: this.nowIso(),
      replay: false,
    };

    this.sessionReceiptByRequestId.set(requestId, {
      statusCode: 200,
      body: responseBody,
      expiresAt: Date.now() + this.sessionCacheTtlMs,
    });

    return {
      statusCode: 200,
      body: responseBody,
    };
  }

  sendTurn(body, options) {
    const opts = options && typeof options === "object" ? options : {};
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    if (opts.skipMcpRefresh !== true) {
      this.refreshMcpJobs({ drainQueue: true });
    }

    const validation = validateTurnSend(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const requestId = normalizeRequestId(body.request_id);
    const existing = this.turnStore.getTurn(requestId);
    if (existing && existing.state !== "running") {
      return {
        statusCode: 200,
        body: {
          accepted: true,
          replay: true,
          ...this.turnStore.buildTurnStatus(existing),
        },
      };
    }

    if (this.turnStore.hasOtherActiveTurn(requestId)) {
      return {
        statusCode: 429,
        body: {
          error_code: "E_TOO_MANY_ACTIVE_TURNS",
          message: "Only one active turn is allowed in MVP mode",
          active_request_id: this.turnStore.getActiveRequestId(),
        },
      };
    }

    if (existing && existing.state === "running") {
      return {
        statusCode: 202,
        body: {
          accepted: true,
          replay: true,
          ...this.turnStore.buildTurnStatus(existing),
        },
      };
    }

    const created = this.turnStore.startTurn(requestId, 0);

    if (this.codexPlanner && this.codexPlanner.enabled) {
      this.runCodexPlanningInBackground(requestId, body);
      return {
        statusCode: 202,
        body: {
          accepted: true,
          replay: false,
          ...this.turnStore.buildTurnStatus(created),
        },
      };
    }

    this.turnStore.failTurn(
      requestId,
      "E_PLANNING_FAILED",
      "Codex planner is not configured"
    );
    const failed = this.turnStore.getTurn(requestId);
    return {
      statusCode: 200,
      body: {
        accepted: false,
        replay: false,
        ...(failed ? this.turnStore.buildTurnStatus(failed) : {}),
      },
    };
  }

  getTurnStatus(queryRequestId, queryCursor) {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const requestId = normalizeRequestId(queryRequestId);
    if (!requestId) {
      return {
        statusCode: 400,
        body: {
          error_code: "E_SCHEMA_INVALID",
          message: "request_id query parameter is required",
        },
      };
    }

    const entry = this.turnStore.getTurn(requestId);
    if (!entry) {
      return {
        statusCode: 404,
        body: {
          error_code: "E_REQUEST_NOT_FOUND",
          message: "request_id not found",
        },
      };
    }

    const cursor = Number(queryCursor);
    return {
      statusCode: 200,
      body: this.turnStore.buildTurnStatus(entry, {
        cursor: Number.isFinite(cursor) && cursor > 0 ? cursor : 0,
      }),
    };
  }

  cancelTurn(body, options) {
    const opts = options && typeof options === "object" ? options : {};
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    if (opts.skipMcpRefresh !== true) {
      this.refreshMcpJobs({ drainQueue: true });
    }

    const validation = validateTurnCancel(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const requestId = normalizeRequestId(body.request_id);
    const activeRequestId = this.turnStore.getActiveRequestId();

    if (!activeRequestId) {
      const existing = requestId ? this.turnStore.getTurn(requestId) : null;
      if (existing && existing.state === "cancelled") {
        return {
          statusCode: 200,
          body: {
            ok: true,
            replay: true,
            ...this.turnStore.buildTurnStatus(existing),
          },
        };
      }
    }

    if (!activeRequestId) {
      return {
        statusCode: 404,
        body: {
          error_code: "E_CANCEL_NOT_FOUND",
          message: "No active turn to cancel",
        },
      };
    }

    if (requestId && requestId !== activeRequestId) {
      return {
        statusCode: 409,
        body: {
          error_code: "E_REQUEST_ID_MISMATCH",
          message: "request_id does not match current active request",
          active_request_id: activeRequestId,
        },
      };
    }

    const targetRequestId = requestId || activeRequestId;
    this.cancelPlanningTask(targetRequestId);
    const cancelled = this.turnStore.cancelTurn(
      targetRequestId,
      "Turn cancelled by user command"
    );

    if (!cancelled) {
      return {
        statusCode: 500,
        body: {
          error_code: "E_INTERNAL",
          message: "Failed to cancel active turn",
        },
      };
    }

    const entry = this.turnStore.getTurn(targetRequestId);
    return {
      statusCode: 200,
      body: {
        ok: true,
        replay: false,
        ...(entry
          ? this.turnStore.buildTurnStatus(entry)
          : { event: "turn.cancelled" }),
      },
    };
  }

  buildMcpJobStatusPayload(job) {
    const item = job && typeof job === "object" ? job : {};
    return {
      job_id: item.job_id || "",
      status: item.status || "pending",
      stage: item.stage || "",
      progress_message: item.progress_message || "",
      error_code: item.error_code || "",
      error_message: item.error_message || "",
      suggestion: item.suggestion || "",
      recoverable: item.recoverable === true,
      request_id: item.request_id || "",
      running_job_id: this.mcpRunningJobId || "",
      execution_report:
        item.execution_report && typeof item.execution_report === "object"
          ? item.execution_report
          : null,
      approval_mode: item.approval_mode || "auto",
      created_at:
        Number.isFinite(item.created_at) && item.created_at > 0
          ? new Date(item.created_at).toISOString()
          : this.nowIso(),
      updated_at:
        Number.isFinite(item.updated_at) && item.updated_at > 0
          ? new Date(item.updated_at).toISOString()
          : this.nowIso(),
    };
  }

  startMcpJob(job, options) {
    const item = job && typeof job === "object" ? job : null;
    if (!item) {
      return {
        ok: false,
      };
    }
    const opts = options && typeof options === "object" ? options : {};
    const fromQueue = opts.fromQueue === true;
    const envelope = this.buildMcpTurnSendEnvelope(item);
    const outcome = this.sendTurn(envelope, {
      skipMcpRefresh: true,
    });
    const now = Date.now();
    item.updated_at = now;

    const accepted =
      outcome &&
      outcome.body &&
      typeof outcome.body.accepted === "boolean" &&
      outcome.body.accepted === true;
    if (accepted) {
      item.status = "pending";
      item.stage =
        outcome.body && typeof outcome.body.stage === "string"
          ? outcome.body.stage
          : "codex_pending";
      item.progress_message =
        outcome.body && typeof outcome.body.message === "string"
          ? outcome.body.message
          : "Job pending";
      item.error_code = "";
      item.error_message = "";
      item.suggestion = "";
      item.recoverable = false;
      this.mcpRunningJobId = item.job_id;
      this.persistMcpJobs();
      this.publishMcpJobEvent("job.progress", item);
      return {
        ok: true,
      };
    }

    if (outcome && outcome.statusCode === 429) {
      item.status = "queued";
      item.stage = "queued";
      item.progress_message = "Queued and waiting for running job to finish";
      if (!this.mcpQueuedJobIds.includes(item.job_id)) {
        this.mcpQueuedJobIds.push(item.job_id);
      }
      this.persistMcpJobs();
      this.publishMcpJobEvent("job.progress", item);
      if (!fromQueue) {
        return {
          ok: false,
          queued: true,
        };
      }
      return {
        ok: false,
        retryable: true,
      };
    }

    item.status = "failed";
    item.stage = "failed";
    item.error_code =
      outcome &&
      outcome.body &&
      typeof outcome.body.error_code === "string"
        ? outcome.body.error_code
        : "E_INTERNAL";
    item.error_message =
      outcome &&
      outcome.body &&
      ((typeof outcome.body.error_message === "string" &&
        outcome.body.error_message) ||
        (typeof outcome.body.message === "string" && outcome.body.message))
        ? typeof outcome.body.error_message === "string" &&
          outcome.body.error_message
          ? outcome.body.error_message
          : outcome.body.message
        : "Failed to start Unity job";
    const feedback = mapMcpErrorFeedback(item.error_code, item.error_message);
    item.suggestion = feedback.suggestion;
    item.recoverable = feedback.recoverable;
    item.progress_message = item.error_message;
    item.terminal_at = now;
    this.persistMcpJobs();
    this.publishMcpJobEvent("job.completed", item);
    return {
      ok: false,
    };
  }

  buildMcpTurnSendEnvelope(job) {
    return {
      event: "turn.send",
      request_id: job.request_id,
      thread_id: job.thread_id,
      turn_id: job.turn_id,
      timestamp: this.nowIso(),
      payload: {
        user_message: job.user_intent,
        approval_mode: normalizeApprovalMode(job.approval_mode, "auto"),
        context:
          job.context && typeof job.context === "object"
            ? job.context
            : buildDefaultTurnContext(),
      },
    };
  }

  buildMcpTurnCancelEnvelope(job) {
    return {
      event: "turn.cancel",
      request_id: job.request_id,
      thread_id: job.thread_id,
      turn_id: job.turn_id,
      timestamp: this.nowIso(),
      payload: {
        reason: "mcp_cancel_unity_task",
      },
    };
  }

  refreshMcpJobs(options) {
    if (!this.enableMcpAdapter) {
      return;
    }

    const opts = options && typeof options === "object" ? options : {};
    const now = Date.now();
    const activeRequestId = this.turnStore.getActiveRequestId() || "";
    let changed = false;
    let runningJobId = "";
    const jobsToEmit = [];

    const prevQueued = this.mcpQueuedJobIds.join("|");
    this.mcpQueuedJobIds = this.mcpQueuedJobIds.filter((jobId) => {
      const job = this.mcpJobsById.get(jobId);
      return !!job && job.status === "queued";
    });
    if (prevQueued !== this.mcpQueuedJobIds.join("|")) {
      changed = true;
    }

    for (const [jobId, job] of this.mcpJobsById.entries()) {
      if (!job || typeof job !== "object") {
        this.mcpJobsById.delete(jobId);
        changed = true;
        continue;
      }
      if (
        isTerminalMcpStatus(job.status) &&
        Number.isFinite(job.terminal_at) &&
        job.terminal_at > 0 &&
        now - job.terminal_at > this.mcpJobTtlMs
      ) {
        if (typeof job.idempotency_key === "string" && job.idempotency_key) {
          this.mcpIdempotencyToJobId.delete(job.idempotency_key);
        }
        this.mcpQueuedJobIds = this.mcpQueuedJobIds.filter((item) => item !== jobId);
        this.mcpJobsById.delete(jobId);
        changed = true;
        continue;
      }

      let jobChanged = false;
      const turn =
        typeof job.request_id === "string" && job.request_id
          ? this.turnStore.getTurn(job.request_id)
          : null;
      if (!turn) {
        if (job.status === "pending") {
          const isActivePending = !!activeRequestId && job.request_id === activeRequestId;
          if (!isActivePending) {
            if (job.status !== "failed") {
              job.status = "failed";
              jobChanged = true;
            }
            if (job.stage !== "failed") {
              job.stage = "failed";
              jobChanged = true;
            }
            if (job.error_code !== "E_JOB_RECOVERY_STALE") {
              job.error_code = "E_JOB_RECOVERY_STALE";
              jobChanged = true;
            }
            const recoveredMessage = "Recovered pending job without active running turn";
            if (job.error_message !== recoveredMessage) {
              job.error_message = recoveredMessage;
              jobChanged = true;
            }
            const feedback = mapMcpErrorFeedback(job.error_code, job.error_message);
            if (job.suggestion !== feedback.suggestion) {
              job.suggestion = feedback.suggestion;
              jobChanged = true;
            }
            if (job.recoverable !== feedback.recoverable) {
              job.recoverable = feedback.recoverable;
              jobChanged = true;
            }
            if (job.progress_message !== recoveredMessage) {
              job.progress_message = recoveredMessage;
              jobChanged = true;
            }
            if (!job.terminal_at) {
              job.terminal_at = now;
              jobChanged = true;
            }
          }
        }
        if (jobChanged) {
          job.updated_at = now;
          changed = true;
          jobsToEmit.push(job);
        }
        continue;
      }

      const mappedStatus = mapTurnStateToMcpStatus(turn.state);
      const mappedStage = typeof turn.stage === "string" ? turn.stage : "";
      const mappedMessage = typeof turn.message === "string" ? turn.message : "";
      if (job.stage !== mappedStage) {
        job.stage = mappedStage;
        jobChanged = true;
      }
      if (job.progress_message !== mappedMessage) {
        job.progress_message = mappedMessage;
        jobChanged = true;
      }

      if (mappedStatus === "pending") {
        if (job.status !== "queued" && job.status !== "pending") {
          job.status = "pending";
          jobChanged = true;
        }
        if (job.status !== "queued") {
          if (job.error_code || job.error_message || job.suggestion || job.recoverable) {
            job.error_code = "";
            job.error_message = "";
            job.suggestion = "";
            job.recoverable = false;
            jobChanged = true;
          }
        }
      } else if (mappedStatus === "succeeded") {
        if (job.status !== "succeeded") {
          job.status = "succeeded";
          jobChanged = true;
        }
        const executionReport =
          turn.execution_report && typeof turn.execution_report === "object"
            ? turn.execution_report
            : null;
        if (!sameJson(job.execution_report, executionReport)) {
          job.execution_report = executionReport;
          jobChanged = true;
        }
        if (job.error_code || job.error_message || job.suggestion || job.recoverable) {
          job.error_code = "";
          job.error_message = "";
          job.suggestion = "";
          job.recoverable = false;
          jobChanged = true;
        }
        if (!job.terminal_at) {
          job.terminal_at = now;
          jobChanged = true;
        }
      } else if (mappedStatus === "failed") {
        if (job.status !== "failed") {
          job.status = "failed";
          jobChanged = true;
        }
        const nextErrorCode = typeof turn.error_code === "string" ? turn.error_code : "";
        const nextErrorMessage = typeof turn.message === "string" ? turn.message : "";
        if (job.error_code !== nextErrorCode) {
          job.error_code = nextErrorCode;
          jobChanged = true;
        }
        if (job.error_message !== nextErrorMessage) {
          job.error_message = nextErrorMessage;
          jobChanged = true;
        }
        const feedback = mapMcpErrorFeedback(job.error_code, job.error_message);
        if (job.suggestion !== feedback.suggestion) {
          job.suggestion = feedback.suggestion;
          jobChanged = true;
        }
        if (job.recoverable !== feedback.recoverable) {
          job.recoverable = feedback.recoverable;
          jobChanged = true;
        }
        const executionReport =
          turn.execution_report && typeof turn.execution_report === "object"
            ? turn.execution_report
            : null;
        if (!sameJson(job.execution_report, executionReport)) {
          job.execution_report = executionReport;
          jobChanged = true;
        }
        if (!job.terminal_at) {
          job.terminal_at = now;
          jobChanged = true;
        }
      } else if (mappedStatus === "cancelled") {
        if (job.status !== "cancelled") {
          job.status = "cancelled";
          jobChanged = true;
        }
        if (job.error_code || job.error_message || job.suggestion || job.recoverable) {
          job.error_code = "";
          job.error_message = "";
          job.suggestion = "";
          job.recoverable = false;
          jobChanged = true;
        }
        if (!job.terminal_at) {
          job.terminal_at = now;
          jobChanged = true;
        }
      }

      if (jobChanged) {
        job.updated_at = now;
        changed = true;
        jobsToEmit.push(job);
      }

      if (
        !isTerminalMcpStatus(job.status) &&
        activeRequestId &&
        job.request_id === activeRequestId
      ) {
        runningJobId = job.job_id;
      }
    }

    if (this.mcpRunningJobId !== runningJobId) {
      this.mcpRunningJobId = runningJobId;
      changed = true;
    }
    if (changed) {
      this.persistMcpJobs();
    }
    for (const changedJob of jobsToEmit) {
      this.publishMcpJobEvent(
        isTerminalMcpStatus(changedJob.status) ? "job.completed" : "job.progress",
        changedJob
      );
    }
    if (opts.drainQueue === true) {
      this.drainMcpQueue();
    }
  }

  drainMcpQueue() {
    if (!this.enableMcpAdapter) {
      return;
    }
    if (this.mcpRunningJobId) {
      return;
    }
    let queueChanged = false;
    while (this.mcpQueuedJobIds.length > 0) {
      const nextJobId = this.mcpQueuedJobIds.shift();
      queueChanged = true;
      if (!nextJobId) {
        continue;
      }
      const job = this.mcpJobsById.get(nextJobId);
      if (!job || job.status !== "queued") {
        continue;
      }
      const start = this.startMcpJob(job, { fromQueue: true });
      if (start.ok) {
        break;
      }
      if (start.retryable) {
        this.mcpQueuedJobIds.unshift(nextJobId);
        queueChanged = true;
        break;
      }
    }
    if (queueChanged) {
      this.persistMcpJobs();
    }
  }

  validationError(validation) {
    return {
      statusCode: validation.statusCode,
      body: {
        error_code: validation.errorCode,
        message: validation.message,
      },
    };
  }

  mcpValidationError(validation) {
    return {
      statusCode: validation.statusCode,
      body: this.withMcpErrorFeedback({
        status: "rejected",
        error_code: validation.errorCode,
        message: validation.message,
      }),
    };
  }

  withMcpErrorFeedback(body) {
    const source = body && typeof body === "object" ? body : {};
    const errorCode = normalizeErrorCode(source.error_code, "E_INTERNAL");
    const errorMessage =
      typeof source.error_message === "string" && source.error_message.trim()
        ? source.error_message.trim()
        : typeof source.message === "string" && source.message.trim()
          ? source.message.trim()
          : "Unknown error";
    const feedback = mapMcpErrorFeedback(errorCode, errorMessage);
    return {
      ...source,
      error_code: errorCode,
      error_message: errorMessage,
      suggestion:
        typeof source.suggestion === "string" && source.suggestion.trim()
          ? source.suggestion.trim()
          : feedback.suggestion,
      recoverable:
        typeof source.recoverable === "boolean"
          ? source.recoverable
          : feedback.recoverable,
      message:
        typeof source.message === "string" && source.message.trim()
          ? source.message.trim()
          : errorMessage,
    };
  }

  resolveTurnApprovalMode(requestId) {
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!normalizedRequestId) {
      return "require_user";
    }
    for (const job of this.mcpJobsById.values()) {
      if (!job || typeof job !== "object") {
        continue;
      }
      if (
        typeof job.request_id === "string" &&
        job.request_id === normalizedRequestId
      ) {
        return normalizeApprovalMode(job.approval_mode, "auto");
      }
    }
    return "require_user";
  }

  registerMcpStreamSubscriber(options) {
    if (!this.enableMcpAdapter) {
      return {
        ok: false,
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_NOT_FOUND",
          message: "MCP adapter is disabled",
        }),
      };
    }
    const opts = options && typeof options === "object" ? options : {};
    if (typeof opts.onEvent !== "function") {
      return {
        ok: false,
        statusCode: 400,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_SCHEMA_INVALID",
          message: "onEvent callback is required",
        }),
      };
    }
    if (this.mcpStreamSubscribers.size >= this.mcpStreamMaxSubscribers) {
      this.mcpMetrics.stream_subscriber_rejects += 1;
      return {
        ok: false,
        statusCode: 429,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_STREAM_SUBSCRIBERS_EXCEEDED",
          message: `Too many active MCP stream subscribers (${this.mcpStreamSubscribers.size}/${this.mcpStreamMaxSubscribers})`,
        }),
      };
    }
    this.refreshMcpJobs({ drainQueue: true });
    const threadId = typeof opts.thread_id === "string" ? opts.thread_id.trim() : "";
    const cursor =
      Number.isFinite(Number(opts.cursor)) && Number(opts.cursor) >= 0
        ? Math.floor(Number(opts.cursor))
        : 0;
    const replayEvents = this.listMcpStreamEventsSince(cursor, threadId);
    const oldestEventSeq = this.getOldestMcpStreamSeq(threadId);
    const latestEventSeq = this.mcpStreamNextEventSeq - 1;
    const replayTruncated =
      Number.isFinite(oldestEventSeq) &&
      oldestEventSeq > 0 &&
      cursor + 1 < oldestEventSeq;
    const replayFromSeq =
      replayEvents.length > 0 &&
      Number.isFinite(Number(replayEvents[0].seq)) &&
      Number(replayEvents[0].seq) > 0
        ? Math.floor(Number(replayEvents[0].seq))
        : 0;
    const recoveryJobs =
      replayTruncated && threadId
        ? this.listMcpJobRecoverySnapshot(threadId, this.mcpStreamRecoveryJobsMax)
        : [];
    const subscriberId = `mcp_sub_${Date.now()}_${this.mcpStreamNextSubscriberSeq++}`;
    this.mcpStreamSubscribers.set(subscriberId, {
      thread_id: threadId,
      onEvent: opts.onEvent,
    });
    this.mcpMetrics.stream_connect_calls += 1;
    this.mcpMetrics.stream_replay_events_sent += replayEvents.length;
    this.mcpMetrics.stream_recovery_jobs_sent += recoveryJobs.length;
    return {
      ok: true,
      subscriber_id: subscriberId,
      requested_cursor: cursor,
      replay_events: replayEvents,
      replay_from_seq: replayFromSeq,
      replay_truncated: replayTruncated,
      recovery_jobs_count: recoveryJobs.length,
      recovery_jobs: recoveryJobs,
      oldest_event_seq: oldestEventSeq,
      latest_event_seq: latestEventSeq,
    };
  }

  unregisterMcpStreamSubscriber(subscriberId) {
    const id = typeof subscriberId === "string" ? subscriberId : "";
    if (!id) {
      return false;
    }
    return this.mcpStreamSubscribers.delete(id);
  }

  listMcpStreamEventsSince(cursor, threadId) {
    const since =
      Number.isFinite(Number(cursor)) && Number(cursor) >= 0
        ? Math.floor(Number(cursor))
        : 0;
    const normalizedThreadId =
      typeof threadId === "string" ? threadId.trim() : "";
    return this.mcpStreamRecentEvents.filter((eventItem) => {
      if (!eventItem || typeof eventItem !== "object") {
        return false;
      }
      if (!Number.isFinite(eventItem.seq) || eventItem.seq <= since) {
        return false;
      }
      if (normalizedThreadId && eventItem.thread_id !== normalizedThreadId) {
        return false;
      }
      return true;
    });
  }

  getOldestMcpStreamSeq(threadId) {
    const normalizedThreadId =
      typeof threadId === "string" ? threadId.trim() : "";
    let oldest = 0;
    for (const eventItem of this.mcpStreamRecentEvents) {
      if (!eventItem || typeof eventItem !== "object") {
        continue;
      }
      if (normalizedThreadId && eventItem.thread_id !== normalizedThreadId) {
        continue;
      }
      const seq =
        Number.isFinite(Number(eventItem.seq)) && Number(eventItem.seq) > 0
          ? Math.floor(Number(eventItem.seq))
          : 0;
      if (!seq) {
        continue;
      }
      if (!oldest || seq < oldest) {
        oldest = seq;
      }
    }
    return oldest;
  }

  listMcpJobRecoverySnapshot(threadId, limit) {
    const normalizedThreadId =
      typeof threadId === "string" ? threadId.trim() : "";
    if (!normalizedThreadId) {
      return [];
    }
    const maxItems =
      Number.isFinite(Number(limit)) && Number(limit) >= 0
        ? Math.floor(Number(limit))
        : MCP_STREAM_RECOVERY_JOBS_MAX;
    if (maxItems <= 0) {
      return [];
    }
    const candidates = [];
    for (const job of this.mcpJobsById.values()) {
      if (!job || typeof job !== "object") {
        continue;
      }
      if (
        typeof job.thread_id !== "string" ||
        job.thread_id !== normalizedThreadId
      ) {
        continue;
      }
      const updatedAt =
        Number.isFinite(Number(job.updated_at)) && Number(job.updated_at) > 0
          ? Math.floor(Number(job.updated_at))
          : 0;
      candidates.push({
        updated_at: updatedAt,
        payload: this.buildMcpJobStatusPayload(job),
      });
    }
    candidates.sort((a, b) => b.updated_at - a.updated_at);
    return candidates.slice(0, maxItems).map((item) => item.payload);
  }

  publishMcpJobEvent(eventName, job) {
    if (!this.enableMcpAdapter) {
      return null;
    }
    const item = job && typeof job === "object" ? job : null;
    if (!item) {
      return null;
    }
    const seq = this.mcpStreamNextEventSeq++;
    const payload = this.buildMcpJobStreamEventPayload(seq, eventName, item);
    this.mcpMetrics.stream_events_published += 1;
    this.mcpStreamRecentEvents.push(payload);
    if (this.mcpStreamRecentEvents.length > this.mcpStreamMaxEvents) {
      this.mcpStreamRecentEvents = this.mcpStreamRecentEvents.slice(
        this.mcpStreamRecentEvents.length - this.mcpStreamMaxEvents
      );
    }
    for (const [subscriberId, subscriber] of this.mcpStreamSubscribers.entries()) {
      if (!subscriber || typeof subscriber !== "object") {
        continue;
      }
      if (
        subscriber.thread_id &&
        subscriber.thread_id !== payload.thread_id
      ) {
        continue;
      }
      try {
        subscriber.onEvent(payload);
        this.mcpMetrics.stream_events_delivered += 1;
      } catch {
        // Drop bad subscribers on write failures to avoid persistent leaks.
        this.mcpStreamSubscribers.delete(subscriberId);
        this.mcpMetrics.stream_subscriber_drops += 1;
      }
    }
    return payload;
  }

  getMcpMetrics() {
    if (!this.enableMcpAdapter) {
      return {
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_NOT_FOUND",
          message: "MCP adapter is disabled",
        }),
      };
    }
    this.turnStore.sweep();
    this.refreshMcpJobs({ drainQueue: true });
    const statusQueries =
      Number.isFinite(Number(this.mcpMetrics.status_query_calls)) &&
      Number(this.mcpMetrics.status_query_calls) >= 0
        ? Math.floor(Number(this.mcpMetrics.status_query_calls))
        : 0;
    const pushEventsTotal =
      (Number.isFinite(Number(this.mcpMetrics.stream_events_delivered)) &&
      Number(this.mcpMetrics.stream_events_delivered) >= 0
        ? Math.floor(Number(this.mcpMetrics.stream_events_delivered))
        : 0) +
      (Number.isFinite(Number(this.mcpMetrics.stream_replay_events_sent)) &&
      Number(this.mcpMetrics.stream_replay_events_sent) >= 0
        ? Math.floor(Number(this.mcpMetrics.stream_replay_events_sent))
        : 0);
    return {
      statusCode: 200,
      body: {
        status: "ok",
        timestamp: this.nowIso(),
        status_query_calls: statusQueries,
        stream_connect_calls:
          Number.isFinite(Number(this.mcpMetrics.stream_connect_calls)) &&
          Number(this.mcpMetrics.stream_connect_calls) >= 0
            ? Math.floor(Number(this.mcpMetrics.stream_connect_calls))
            : 0,
        stream_events_published:
          Number.isFinite(Number(this.mcpMetrics.stream_events_published)) &&
          Number(this.mcpMetrics.stream_events_published) >= 0
            ? Math.floor(Number(this.mcpMetrics.stream_events_published))
            : 0,
        stream_events_delivered:
          Number.isFinite(Number(this.mcpMetrics.stream_events_delivered)) &&
          Number(this.mcpMetrics.stream_events_delivered) >= 0
            ? Math.floor(Number(this.mcpMetrics.stream_events_delivered))
            : 0,
        stream_replay_events_sent:
          Number.isFinite(Number(this.mcpMetrics.stream_replay_events_sent)) &&
          Number(this.mcpMetrics.stream_replay_events_sent) >= 0
            ? Math.floor(Number(this.mcpMetrics.stream_replay_events_sent))
            : 0,
        stream_recovery_jobs_sent:
          Number.isFinite(Number(this.mcpMetrics.stream_recovery_jobs_sent)) &&
          Number(this.mcpMetrics.stream_recovery_jobs_sent) >= 0
            ? Math.floor(Number(this.mcpMetrics.stream_recovery_jobs_sent))
            : 0,
        stream_subscriber_rejects:
          Number.isFinite(Number(this.mcpMetrics.stream_subscriber_rejects)) &&
          Number(this.mcpMetrics.stream_subscriber_rejects) >= 0
            ? Math.floor(Number(this.mcpMetrics.stream_subscriber_rejects))
            : 0,
        stream_subscriber_drops:
          Number.isFinite(Number(this.mcpMetrics.stream_subscriber_drops)) &&
          Number(this.mcpMetrics.stream_subscriber_drops) >= 0
            ? Math.floor(Number(this.mcpMetrics.stream_subscriber_drops))
            : 0,
        push_events_total: pushEventsTotal,
        query_to_push_ratio:
          pushEventsTotal > 0
            ? Number((statusQueries / pushEventsTotal).toFixed(4))
            : null,
        active_stream_subscribers: this.mcpStreamSubscribers.size,
        stream_max_subscribers: this.mcpStreamMaxSubscribers,
        stream_recovery_jobs_max: this.mcpStreamRecoveryJobsMax,
        recent_stream_buffer_size: this.mcpStreamRecentEvents.length,
        running_job_id: this.mcpRunningJobId || "",
      },
    };
  }

  buildMcpJobStreamEventPayload(seq, eventName, job) {
    const statusPayload = this.buildMcpJobStatusPayload(job);
    const eventType = normalizeMcpStreamEventType(eventName, statusPayload.status);
    return {
      seq,
      event: eventType,
      timestamp: this.nowIso(),
      thread_id: typeof job.thread_id === "string" ? job.thread_id : "",
      job_id: statusPayload.job_id,
      status: statusPayload.status,
      stage: statusPayload.stage,
      message: statusPayload.progress_message,
      progress_message: statusPayload.progress_message,
      error_code: statusPayload.error_code,
      error_message: statusPayload.error_message,
      suggestion: statusPayload.suggestion,
      recoverable: statusPayload.recoverable,
      request_id: statusPayload.request_id,
      running_job_id: statusPayload.running_job_id,
      approval_mode: statusPayload.approval_mode,
      execution_report: statusPayload.execution_report,
      created_at: statusPayload.created_at,
      updated_at: statusPayload.updated_at,
    };
  }

  persistMcpJobs() {
    if (
      !this.enableMcpAdapter ||
      !this.mcpSnapshotStore ||
      typeof this.mcpSnapshotStore.saveSnapshot !== "function"
    ) {
      return;
    }
    const snapshot = {
      version: 1,
      saved_at: this.nowIso(),
      running_job_id: this.mcpRunningJobId || "",
      queued_job_ids: this.mcpQueuedJobIds.slice(),
      jobs: Array.from(this.mcpJobsById.values()).map((job) =>
        this.buildPersistableMcpJob(job)
      ),
    };
    this.mcpSnapshotStore.saveSnapshot(snapshot);
  }

  restoreMcpJobsFromSnapshot() {
    if (
      !this.enableMcpAdapter ||
      !this.mcpSnapshotStore ||
      typeof this.mcpSnapshotStore.loadSnapshot !== "function"
    ) {
      return;
    }
    const snapshot = this.mcpSnapshotStore.loadSnapshot();
    if (!snapshot || typeof snapshot !== "object" || !Array.isArray(snapshot.jobs)) {
      return;
    }

    this.mcpJobsById.clear();
    this.mcpIdempotencyToJobId.clear();
    this.mcpQueuedJobIds = [];
    this.mcpRunningJobId = "";

    const queuedSet = new Set();
    if (Array.isArray(snapshot.queued_job_ids)) {
      for (const jobId of snapshot.queued_job_ids) {
        if (typeof jobId === "string" && jobId.trim()) {
          queuedSet.add(jobId.trim());
        }
      }
    }

    for (const item of snapshot.jobs) {
      const job = normalizeMcpJobSnapshotItem(item);
      if (!job) {
        continue;
      }
      if (queuedSet.has(job.job_id)) {
        job.status = "queued";
        job.stage = "queued";
      }
      this.mcpJobsById.set(job.job_id, job);
      if (job.idempotency_key) {
        this.mcpIdempotencyToJobId.set(job.idempotency_key, job.job_id);
      }
      if (job.status === "queued") {
        this.mcpQueuedJobIds.push(job.job_id);
      }
    }

    if (this.mcpQueuedJobIds.length === 0) {
      this.mcpQueuedJobIds = Array.from(this.mcpJobsById.values())
        .filter((job) => job && job.status === "queued")
        .sort((a, b) => a.created_at - b.created_at)
        .map((job) => job.job_id);
    }

    const restoredRunningJobId =
      typeof snapshot.running_job_id === "string" ? snapshot.running_job_id.trim() : "";
    if (restoredRunningJobId) {
      const restoredRunningJob = this.mcpJobsById.get(restoredRunningJobId);
      if (restoredRunningJob && !isTerminalMcpStatus(restoredRunningJob.status)) {
        this.mcpRunningJobId = restoredRunningJobId;
      }
    }
  }

  buildPersistableMcpJob(job) {
    const item = job && typeof job === "object" ? job : {};
    return {
      job_id: item.job_id || "",
      idempotency_key: item.idempotency_key || "",
      approval_mode: normalizeApprovalMode(item.approval_mode, "auto"),
      user_intent: item.user_intent || "",
      thread_id: item.thread_id || "",
      request_id: item.request_id || "",
      turn_id: item.turn_id || "",
      context:
        item.context && typeof item.context === "object"
          ? item.context
          : buildDefaultTurnContext(),
      status: item.status || "pending",
      stage: item.stage || "",
      progress_message: item.progress_message || "",
      error_code: item.error_code || "",
      error_message: item.error_message || "",
      suggestion: item.suggestion || "",
      recoverable: item.recoverable === true,
      execution_report:
        item.execution_report && typeof item.execution_report === "object"
          ? item.execution_report
          : null,
      created_at: Number.isFinite(item.created_at) ? Number(item.created_at) : Date.now(),
      updated_at: Number.isFinite(item.updated_at) ? Number(item.updated_at) : Date.now(),
      terminal_at: Number.isFinite(item.terminal_at) ? Number(item.terminal_at) : 0,
    };
  }

  getSessionReceipt(requestId) {
    if (!requestId) {
      return null;
    }
    const entry = this.sessionReceiptByRequestId.get(requestId);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.sessionReceiptByRequestId.delete(requestId);
      return null;
    }
    return entry;
  }

  cleanupSessionCache() {
    const now = Date.now();
    for (const [requestId, entry] of this.sessionReceiptByRequestId.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.sessionReceiptByRequestId.delete(requestId);
      }
    }
  }

  applyFileActions(body) {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateFileActionsApply(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const requestId = normalizeRequestId(body.request_id);
    const existing = this.getFileActionReceipt(requestId);
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
    if (!execution.ok) {
      const statusCode = this.mapFileErrorToStatus(execution.errorCode);
      const errorBody = {
        event: "turn.error",
        request_id: body.request_id,
        thread_id: body.thread_id,
        turn_id: body.turn_id,
        timestamp: this.nowIso(),
        payload: {
          error_code: execution.errorCode || "E_FILE_WRITE_FAILED",
          error_message: execution.message || "File action execution failed",
          files_changed: execution.changes || [],
        },
        error_code: execution.errorCode || "E_FILE_WRITE_FAILED",
        message: execution.message || "File action execution failed",
      };
      this.cacheFileActionReceipt(requestId, statusCode, errorBody);
      return {
        statusCode,
        body: errorBody,
      };
    }

    let turn = this.turnStore.getTurn(requestId);
    if (!turn) {
      turn = this.turnStore.startTurn(requestId, 0);
    }
    if (turn && turn.state === "running") {
      this.turnStore.setCompilePending(
        requestId,
        Array.isArray(body.payload.visual_layer_actions)
          ? body.payload.visual_layer_actions
          : []
      );
    }

    const responseBody = {
      event: "files.changed",
      request_id: body.request_id,
      thread_id: body.thread_id,
      turn_id: body.turn_id,
      timestamp: this.nowIso(),
      replay: false,
      payload: {
        changes: execution.changes,
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

    this.cacheFileActionReceipt(requestId, 200, responseBody);
    return {
      statusCode: 200,
      body: responseBody,
    };
  }

  reportCompileResult(body) {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateUnityCompileResult(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const requestId = normalizeRequestId(body.request_id);
    const turn = this.turnStore.getTurn(requestId);
    if (!turn) {
      return {
        statusCode: 404,
        body: {
          error_code: "E_REQUEST_NOT_FOUND",
          message: "request_id not found",
        },
      };
    }

    if (turn.state !== "running") {
      if (turn.state === "completed" || turn.state === "error" || turn.state === "cancelled") {
        return {
          statusCode: 200,
          body: {
            ok: true,
            replay: true,
            ...this.turnStore.buildTurnStatus(turn),
          },
        };
      }
      return {
        statusCode: 409,
        body: {
          ...this.turnStore.buildTurnStatus(turn),
          error_code: "E_PHASE_INVALID",
          message: "turn is not active",
        },
      };
    }

    if (turn.stage !== "compile_pending") {
      return {
        statusCode: 409,
        body: {
          ...this.turnStore.buildTurnStatus(turn),
          error_code: "E_PHASE_INVALID",
          message: "turn is not in compile_pending stage",
        },
      };
    }

    if (body.payload.success) {
      const pendingAction = this.turnStore.getPendingVisualAction(requestId);
      if (pendingAction) {
        this.turnStore.setActionConfirmPending(requestId);
        const unityActionRequest = this.buildUnityActionRequestEnvelope(
          body,
          pendingAction
        );
        this.turnStore.appendEvent(requestId, "chat.message", {
          phase: "planning",
          role: "assistant",
          message: "Compile succeeded. Please confirm the visual action.",
          stage: "action_confirm_pending",
          unity_action_request: unityActionRequest,
        });
        this.turnStore.appendEvent(requestId, "unity.action.request", {
          phase: "planning",
          message: "Action confirmation required.",
          stage: "action_confirm_pending",
          unity_action_request: unityActionRequest,
        });
        const pending = this.turnStore.getTurn(requestId);
        return {
          statusCode: 200,
          body: {
            ok: true,
            compile_success: true,
            ...(pending ? this.turnStore.buildTurnStatus(pending) : {}),
            unity_action_request: unityActionRequest,
          },
        };
      }

      return this.beginFinalizeTerminalPhase(requestId, body, {
        finalState: "completed",
        defaultMessage: "Compile succeeded. No visual actions pending in current phase.",
        executionReport: this.buildExecutionReport(requestId, {
          compile_success: true,
          action_success: true,
          outcome: "completed",
          reason: "compile_succeeded_without_visual_actions",
        }),
        immediatePayload: {
          ok: true,
          compile_success: true,
        },
      });
    }

    const summary = this.buildCompileFailureSummary(body.payload.errors);
    const autoFixOutcome = this.tryAutoFixCompileFailure(
      requestId,
      body,
      turn,
      summary
    );
    if (autoFixOutcome) {
      return autoFixOutcome;
    }

    return this.beginFinalizeTerminalPhase(requestId, body, {
      finalState: "error",
      errorCode: "E_COMPILE_FAILED",
      defaultMessage: summary,
      executionReport: this.buildExecutionReport(requestId, {
        compile_success: false,
        action_success: false,
        outcome: "failed",
        reason: "compile_failed",
        compile_errors: Array.isArray(body.payload.errors) ? body.payload.errors : [],
      }),
      immediatePayload: {
        ok: true,
        compile_success: false,
      },
    });
  }

  reportUnityActionResult(body) {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateUnityActionResult(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const requestId = normalizeRequestId(body.request_id);
    const turn = this.turnStore.getTurn(requestId);
    if (!turn) {
      return {
        statusCode: 404,
        body: {
          error_code: "E_REQUEST_NOT_FOUND",
          message: "request_id not found",
        },
      };
    }

    if (turn.state !== "running") {
      if (turn.state === "completed" || turn.state === "error" || turn.state === "cancelled") {
        return {
          statusCode: 200,
          body: {
            ok: true,
            replay: true,
            ...this.turnStore.buildTurnStatus(turn),
          },
        };
      }
      return {
        statusCode: 409,
        body: {
          ...this.turnStore.buildTurnStatus(turn),
          error_code: "E_PHASE_INVALID",
          message: "turn is not active",
        },
      };
    }

    if (
      turn.stage !== "action_confirm_pending" &&
      turn.stage !== "action_executing"
    ) {
      return {
        statusCode: 409,
        body: {
          ...this.turnStore.buildTurnStatus(turn),
          error_code: "E_PHASE_INVALID",
          message: "turn is not in action_confirm_pending/action_executing stage",
        },
      };
    }

    const pendingAction = this.turnStore.getPendingVisualAction(requestId);
    if (!pendingAction) {
      this.turnStore.failTurn(
        requestId,
        "E_INTERNAL",
        "No pending visual action while processing unity.action.result"
      );
      const failed = this.turnStore.getTurn(requestId);
      return {
        statusCode: 500,
        body: {
          error_code: "E_INTERNAL",
          message: "No pending visual action found",
          ...(failed ? this.turnStore.buildTurnStatus(failed) : {}),
        },
      };
    }

    const actionMatch = this.matchUnityActionResult(pendingAction, body.payload);
    if (!actionMatch.ok) {
      return {
        statusCode: 409,
        body: {
          ...this.turnStore.buildTurnStatus(turn),
          error_code: "E_SCHEMA_INVALID",
          message: actionMatch.message,
        },
      };
    }

    this.turnStore.setActionExecuting(requestId);

    if (!body.payload.success) {
      const errorCode = normalizeErrorCode(
        body.payload.error_code,
        "E_ACTION_EXECUTION_FAILED"
      );
      const summary = this.buildActionFailureSummary(body.payload);
      if (isUnityRebootWaitErrorCode(errorCode)) {
        this.turnStore.setActionConfirmPending(requestId);
        const pending = this.turnStore.getTurn(requestId);
        const unityActionRequest = this.buildUnityActionRequestEnvelope(
          body,
          pendingAction
        );
        this.turnStore.appendEvent(requestId, "chat.message", {
          phase: "planning",
          role: "assistant",
          message:
            "Unity reported domain reload in progress. Waiting for runtime ping to retry the pending visual action.",
          stage: "action_confirm_pending",
          error_code: errorCode,
          unity_action_request: unityActionRequest,
        });
        this.turnStore.appendEvent(requestId, "unity.action.request", {
          phase: "planning",
          message: "Action paused by domain reload; waiting for retry confirmation.",
          stage: "action_confirm_pending",
          error_code: errorCode,
          unity_action_request: unityActionRequest,
        });
        return {
          statusCode: 202,
          body: {
            ok: true,
            recoverable: true,
            waiting_for_unity_reboot: true,
            action_success: false,
            error_code: errorCode,
            message: summary,
            ...(pending ? this.turnStore.buildTurnStatus(pending) : {}),
            unity_action_request: unityActionRequest,
          },
        };
      }
      const autoFixOutcome = this.tryAutoFixActionFailure(
        requestId,
        body,
        turn,
        pendingAction,
        errorCode,
        summary
      );
      if (autoFixOutcome) {
        return autoFixOutcome;
      }

      return this.beginFinalizeTerminalPhase(requestId, body, {
        finalState: "error",
        errorCode,
        defaultMessage: summary,
        executionReport: this.buildExecutionReport(requestId, {
          compile_success: true,
          action_success: false,
          outcome: "failed",
          reason: "action_failed",
          action_error: {
            error_code: errorCode,
            error_message: body.payload.error_message || "",
            action_type: body.payload.action_type || "",
            target_object_path: body.payload.target_object_path || "",
          },
        }),
        immediatePayload: {
          ok: true,
          action_success: false,
        },
      });
    }

    this.turnStore.markCurrentVisualActionHandled(requestId);
    const nextAction = this.turnStore.getPendingVisualAction(requestId);
    if (nextAction) {
      this.turnStore.setActionConfirmPending(requestId);
      const unityActionRequest = this.buildUnityActionRequestEnvelope(
        body,
        nextAction
      );
      this.turnStore.appendEvent(requestId, "chat.message", {
        phase: "planning",
        role: "assistant",
        message: "Previous visual action completed. Please confirm the next action.",
        stage: "action_confirm_pending",
        unity_action_request: unityActionRequest,
      });
      this.turnStore.appendEvent(requestId, "unity.action.request", {
        phase: "planning",
        message: "Next action confirmation required.",
        stage: "action_confirm_pending",
        unity_action_request: unityActionRequest,
      });
      const pending = this.turnStore.getTurn(requestId);
      return {
        statusCode: 200,
        body: {
          ok: true,
          action_success: true,
          ...(pending ? this.turnStore.buildTurnStatus(pending) : {}),
          unity_action_request: unityActionRequest,
        },
      };
    }

    return this.beginFinalizeTerminalPhase(requestId, body, {
      finalState: "completed",
      defaultMessage: "Visual layer actions completed.",
      executionReport: this.buildExecutionReport(requestId, {
        compile_success: true,
        action_success: true,
        outcome: "completed",
        reason: "all_visual_actions_completed",
      }),
      immediatePayload: {
        ok: true,
        action_success: true,
      },
    });
  }

  reportUnityQueryComponentsResult(body) {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateUnityQueryComponentsResult(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const requestId = normalizeRequestId(body.request_id);
    const queryId =
      body &&
      body.payload &&
      typeof body.payload.query_id === "string"
        ? body.payload.query_id.trim()
        : "";
    if (!queryId) {
      return {
        statusCode: 400,
        body: {
          error_code: "E_SCHEMA_INVALID",
          message: "payload.query_id is required",
        },
      };
    }

    const pending = this.pendingUnityComponentQueries.get(queryId);
    if (!pending) {
      return {
        statusCode: 404,
        body: {
          error_code: "E_QUERY_REQUEST_NOT_FOUND",
          message: "No pending unity components query for query_id",
        },
      };
    }

    if (pending.requestId !== requestId) {
      return {
        statusCode: 409,
        body: {
          error_code: "E_REQUEST_ID_MISMATCH",
          message: "request_id does not match pending unity components query",
        },
      };
    }

    const components = Array.isArray(body.payload.components)
      ? body.payload.components
          .filter((item) => item && typeof item === "object")
          .map((item) => ({
            short_name: String(item.short_name || "").trim(),
            assembly_qualified_name: String(
              item.assembly_qualified_name || ""
            ).trim(),
          }))
          .filter(
            (item) => item.short_name && item.assembly_qualified_name
          )
      : [];
    const targetPath =
      typeof body.payload.target_path === "string"
        ? body.payload.target_path.trim()
        : "";
    const errorMessage =
      typeof body.payload.error_message === "string"
        ? body.payload.error_message
        : "";
    const errorCode = normalizeUnityQueryErrorCode(
      body.payload.error_code
    );

    this.pendingUnityComponentQueries.delete(queryId);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    try {
      pending.resolve({
        query_id: queryId,
        target_path: targetPath,
        components,
        error_code: errorCode,
        error_message: errorMessage,
      });
    } catch {
      // ignore resolve errors
    }

    this.touchCodexHeartbeat(requestId);
    const queryResultMessage = errorCode
      ? `Unity components query resolved with ${errorCode}: ${targetPath}`
      : `Unity components query resolved: ${targetPath} (${components.length})`;
    this.turnStore.appendEvent(requestId, "unity.query.components.result", {
      phase: "planning",
      stage: "codex_pending",
      message: queryResultMessage,
      unity_query_components_result: {
        event: "unity.query.components.result",
        request_id: requestId,
        thread_id: body.thread_id,
        turn_id: body.turn_id,
        timestamp: this.nowIso(),
        payload: {
          query_id: queryId,
          target_path: targetPath,
          components,
          error_code: errorCode,
          error_message: errorMessage,
        },
      },
    });

    const turn = this.turnStore.getTurn(requestId);
    return {
      statusCode: 200,
      body: {
        ok: true,
        request_id: requestId,
        query_id: queryId,
        components_count: components.length,
        error_code: errorCode,
        ...(turn ? this.turnStore.buildTurnStatus(turn) : {}),
      },
    };
  }

  reportUnityRuntimePing(body) {
    this.turnStore.sweep();
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    this.refreshMcpJobs({ drainQueue: true });

    const validation = validateUnityRuntimePing(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const activeRequestId = this.turnStore.getActiveRequestId();
    if (!activeRequestId) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          event: "unity.runtime.pong",
          recovered: false,
          message: "No active turn to recover",
          stage: "idle",
          state: "idle",
        },
      };
    }

    const turn = this.turnStore.getTurn(activeRequestId);
    if (!turn) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          event: "unity.runtime.pong",
          recovered: false,
          message: "Active turn reference not found",
          request_id: activeRequestId,
          stage: "unknown",
          state: "unknown",
        },
      };
    }

    if (turn.state !== "running") {
      return {
        statusCode: 200,
        body: {
          ok: true,
          recovered: false,
          ...this.turnStore.buildTurnStatus(turn),
          event: "unity.runtime.pong",
          message: "Turn is terminal; no runtime recovery action required",
        },
      };
    }

    const pendingAction = this.turnStore.getPendingVisualAction(activeRequestId);
    const canRecoverVisualAction =
      !!pendingAction &&
      (turn.stage === "action_confirm_pending" || turn.stage === "action_executing");

    if (canRecoverVisualAction) {
      this.turnStore.setActionConfirmPending(activeRequestId);
      const recoveredTurn = this.turnStore.getTurn(activeRequestId);
      return {
        statusCode: 200,
        body: {
          ok: true,
          recovered: true,
          ...(recoveredTurn ? this.turnStore.buildTurnStatus(recoveredTurn) : {}),
          unity_action_request: this.buildUnityActionRequestEnvelopeWithIds(
            activeRequestId,
            body.thread_id,
            body.turn_id,
            pendingAction
          ),
          event: "unity.runtime.pong",
          message: "Recovered pending visual action after runtime reload",
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        recovered: false,
        ...this.turnStore.buildTurnStatus(turn),
        event: "unity.runtime.pong",
        message: "No visual recovery action pending",
      },
    };
  }

  cacheFileActionReceipt(requestId, statusCode, body) {
    this.fileActionReceiptByRequestId.set(requestId, {
      statusCode,
      body,
      expiresAt: Date.now() + this.sessionCacheTtlMs,
    });
  }

  getFileActionReceipt(requestId) {
    if (!requestId) {
      return null;
    }
    const entry = this.fileActionReceiptByRequestId.get(requestId);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= Date.now()) {
      this.fileActionReceiptByRequestId.delete(requestId);
      return null;
    }
    return entry;
  }

  cleanupFileActionCache() {
    const now = Date.now();
    for (const [requestId, entry] of this.fileActionReceiptByRequestId.entries()) {
      if (!entry || entry.expiresAt <= now) {
        this.fileActionReceiptByRequestId.delete(requestId);
      }
    }
  }

  createStreamEmitter(requestId, phase) {
    let lastMessage = "";
    let lastDelta = "";
    const normalizedPhase = phase === "final" ? "final" : "planning";
    let textTurnStartedAt = 0;
    let textTurnStartEmitted = false;
    let textTurnCompleteEmitted = false;
    let extractionStartedAt = 0;
    let extractionStartEmitted = false;
    let extractionCompleteEmitted = false;

    const normalizePlannerMetrics = (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const normalized = {};
      for (const key of Object.keys(value)) {
        const raw = value[key];
        if (Number.isFinite(raw)) {
          normalized[key] = Number(raw);
          continue;
        }
        if (typeof raw === "string") {
          normalized[key] = raw;
          continue;
        }
        if (typeof raw === "boolean") {
          normalized[key] = raw;
        }
      }
      return Object.keys(normalized).length > 0 ? normalized : null;
    };

    const emitStageEvent = (eventName, message, plannerMetrics) => {
      this.turnStore.appendEvent(
        requestId,
        eventName,
        {
          phase: normalizedPhase,
          stage: "codex_pending",
          message: message || "",
          role: "system",
          planner_metrics: normalizePlannerMetrics(plannerMetrics),
        }
      );
    };

    const onPlannerProgress = (progressEvent) => {
      const stageName =
        progressEvent && typeof progressEvent.stage === "string"
          ? progressEvent.stage
          : "";
      if (!stageName) {
        return;
      }
      const timestamp =
        progressEvent && Number.isFinite(progressEvent.timestamp)
          ? Number(progressEvent.timestamp)
          : Date.now();
      const plannerMetrics = normalizePlannerMetrics(
        progressEvent && progressEvent.metrics
      );

      if (stageName === "text_turn.started") {
        if (!textTurnStartEmitted) {
          textTurnStartedAt = timestamp;
          textTurnStartEmitted = true;
          emitStageEvent(
            "text_turn_started",
            "text_turn started"
          );
        }
        return;
      }

      if (stageName === "text_turn.completed") {
        if (!textTurnCompleteEmitted) {
          if (!textTurnStartedAt) {
            textTurnStartedAt = timestamp;
          }
          const durationMs = Math.max(0, timestamp - textTurnStartedAt);
          textTurnCompleteEmitted = true;
          emitStageEvent(
            "text_turn_completed",
            `text_turn completed in ${durationMs}ms`
          );
        }
        return;
      }

      if (stageName === "text_turn.first_token") {
        const ttftMs =
          plannerMetrics && Number.isFinite(plannerMetrics.ttft_ms)
            ? Math.max(0, Number(plannerMetrics.ttft_ms))
            : 0;
        emitStageEvent(
          "text_turn_first_token",
          ttftMs > 0
            ? `text_turn first token in ${ttftMs}ms`
            : "text_turn first token",
          plannerMetrics
        );
        return;
      }

      if (stageName === "text_turn.usage") {
        const totalTokens =
          plannerMetrics && Number.isFinite(plannerMetrics.total_tokens)
            ? Number(plannerMetrics.total_tokens)
            : 0;
        emitStageEvent(
          "text_turn_usage",
          totalTokens > 0
            ? `text_turn usage total_tokens=${totalTokens}`
            : "text_turn usage received",
          plannerMetrics
        );
        return;
      }

      if (stageName === "text_turn.memory_policy") {
        const memoryInjected =
          plannerMetrics && plannerMetrics.memory_injected === true;
        const memoryLines =
          plannerMetrics && Number.isFinite(plannerMetrics.memory_lines)
            ? Number(plannerMetrics.memory_lines)
            : 0;
        const memorySourceLines =
          plannerMetrics && Number.isFinite(plannerMetrics.memory_source_lines)
            ? Number(plannerMetrics.memory_source_lines)
            : 0;
        const memorySavedLines =
          plannerMetrics && Number.isFinite(plannerMetrics.memory_saved_lines)
            ? Number(plannerMetrics.memory_saved_lines)
            : 0;
        const memoryCompactionRatio =
          plannerMetrics &&
          Number.isFinite(plannerMetrics.memory_compaction_ratio)
            ? Number(plannerMetrics.memory_compaction_ratio)
            : 0;
        const memoryRelevanceDroppedLines =
          plannerMetrics &&
          Number.isFinite(plannerMetrics.memory_relevance_dropped_lines)
            ? Number(plannerMetrics.memory_relevance_dropped_lines)
            : 0;
        const memoryNoiseDroppedLines =
          plannerMetrics &&
          Number.isFinite(plannerMetrics.memory_noise_dropped_lines)
            ? Number(plannerMetrics.memory_noise_dropped_lines)
            : 0;
        const memorySignalPinnedLines =
          plannerMetrics &&
          Number.isFinite(plannerMetrics.memory_signal_pinned_lines)
            ? Number(plannerMetrics.memory_signal_pinned_lines)
            : 0;
        const memorySignalPinCompactedLines =
          plannerMetrics &&
          Number.isFinite(plannerMetrics.memory_signal_pin_compacted_lines)
            ? Number(plannerMetrics.memory_signal_pin_compacted_lines)
            : 0;
        const memorySignalPinAddedChars =
          plannerMetrics &&
          Number.isFinite(plannerMetrics.memory_signal_pin_added_chars)
            ? Number(plannerMetrics.memory_signal_pin_added_chars)
            : 0;
        const capsuleMode =
          plannerMetrics && typeof plannerMetrics.memory_capsule_mode === "string"
            ? plannerMetrics.memory_capsule_mode
            : "";
        emitStageEvent(
          "text_turn_memory_policy",
          memoryInjected
            ? `memory capsule injected (${memoryLines}/${memorySourceLines} lines, saved=${memorySavedLines}, noise_dropped=${memoryNoiseDroppedLines}, relevance_dropped=${memoryRelevanceDroppedLines}, pinned=${memorySignalPinnedLines}, pin_compact=${memorySignalPinCompactedLines}, pin_chars=${memorySignalPinAddedChars}, ratio=${memoryCompactionRatio.toFixed(2)}, mode=${capsuleMode || "unknown"})`
            : "memory capsule not injected",
          plannerMetrics
        );
        return;
      }

      if (stageName === "text_turn.context_budget") {
        const pathHintsCount =
          plannerMetrics && Number.isFinite(plannerMetrics.path_hints_count)
            ? Number(plannerMetrics.path_hints_count)
            : 0;
        const pathHintsLimit =
          plannerMetrics && Number.isFinite(plannerMetrics.path_hints_limit)
            ? Number(plannerMetrics.path_hints_limit)
            : 0;
        const contextTruncated =
          plannerMetrics && plannerMetrics.context_truncated === true;
        emitStageEvent(
          "text_turn_context_budget",
          contextTruncated
            ? `context budget truncated (${pathHintsCount}/${pathHintsLimit} path hints)`
            : `context budget applied (${pathHintsCount}/${pathHintsLimit} path hints)`,
          plannerMetrics
        );
        return;
      }

      if (stageName === "extraction_turn.started") {
        if (!extractionStartEmitted) {
          extractionStartedAt = timestamp;
          extractionStartEmitted = true;
          emitStageEvent(
            "extraction_started",
            "extraction_turn started"
          );
        }
        return;
      }

      if (stageName === "extraction_turn.completed") {
        if (!extractionCompleteEmitted) {
          if (!extractionStartedAt) {
            extractionStartedAt = timestamp;
          }
          const durationMs = Math.max(0, timestamp - extractionStartedAt);
          extractionCompleteEmitted = true;
          emitStageEvent(
            "extraction_completed",
            `extraction_turn completed in ${durationMs}ms`
          );
        }
        return;
      }

      if (stageName === "extraction_turn.usage") {
        const totalTokens =
          plannerMetrics && Number.isFinite(plannerMetrics.total_tokens)
            ? Number(plannerMetrics.total_tokens)
            : 0;
        emitStageEvent(
          "extraction_turn_usage",
          totalTokens > 0
            ? `extraction_turn usage total_tokens=${totalTokens}`
            : "extraction_turn usage received",
          plannerMetrics
        );
        return;
      }

      if (stageName === "extraction_turn.failed") {
        const reason =
          plannerMetrics && typeof plannerMetrics.reason === "string"
            ? plannerMetrics.reason
            : "unknown";
        emitStageEvent(
          "extraction_turn_failed",
          `extraction_turn failed: ${reason}`,
          plannerMetrics
        );
      }
    };

    return {
      onDelta: (delta) => {
        if (!delta || typeof delta !== "string") {
          return;
        }
        if (delta === lastDelta) {
          return;
        }
        lastDelta = delta;
        this.touchCodexHeartbeat(requestId);
        this.turnStore.appendEvent(requestId, "chat.delta", {
          phase: phase || "planning",
          delta,
        }, { persist: false });
      },
      onMessage: (message) => {
        if (!message || typeof message !== "string") {
          return;
        }
        const normalized = message.trim();
        if (!normalized) {
          return;
        }
        if (normalized === lastMessage) {
          return;
        }
        lastMessage = normalized;
        this.touchCodexHeartbeat(requestId);
        this.turnStore.appendEvent(requestId, "chat.message", {
          phase: phase || "planning",
          role: "assistant",
          message: normalized,
        });
      },
      onProgress: (progressEvent) => {
        this.touchCodexHeartbeat(requestId);
        onPlannerProgress(progressEvent);
      },
      getLastMessage: () => lastMessage,
    };
  }

  async runCodexPlanningInBackground(requestId, body) {
    const turn = this.turnStore.getTurn(requestId);
    if (!turn || turn.state !== "running" || turn.stage !== "codex_pending") {
      return;
    }

    const controller = new AbortController();
    this.pendingPlanningCancels.set(requestId, () => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    });

    try {
      const payload = body && body.payload ? body.payload : {};
      const stream = this.createStreamEmitter(requestId, "planning");
      const plannerResult = await this.codexPlanner.planTurn({
        requestId,
        threadId: body.thread_id,
        turnId: body.turn_id,
        userMessage: payload.user_message || "",
        context: payload.context || {},
        signal: controller.signal,
        onDelta: stream.onDelta,
        onMessage: stream.onMessage,
        onProgress: stream.onProgress,
        queryUnityComponents: ({ targetPath }) =>
          this.requestUnityComponentsForPlanner({
            requestId,
            threadId: body.thread_id,
            turnId: body.turn_id,
            targetPath,
            signal: controller.signal,
          }),
      });

      const normalizedPlan = this.normalizePlannerPlan(
        plannerResult,
        body,
        requestId,
        stream.getLastMessage()
      );
      this.executePlanToCompilePending(requestId, body, normalizedPlan, {
        emitSummaryEvents: false,
        replay: false,
      });
    } catch (error) {
      const active = this.turnStore.getTurn(requestId);
      if (!active || active.state !== "running") {
        return;
      }
      const message =
        error && error.message
          ? `Codex planning failed: ${error.message}`
          : "Codex planning failed";
      this.turnStore.appendEvent(requestId, "chat.message", {
        phase: "planning",
        role: "assistant",
        message,
        error_code: "E_PLANNING_FAILED",
      });
      this.turnStore.failTurn(requestId, "E_PLANNING_FAILED", message);
    } finally {
      this.pendingPlanningCancels.delete(requestId);
    }
  }

  cancelPlanningTask(requestId, reason) {
    if (!requestId) {
      return;
    }
    const cancelReason =
      typeof reason === "string" && reason ? reason : "planner_cancelled";
    const cancel = this.pendingPlanningCancels.get(requestId);
    if (cancel) {
      this.pendingPlanningCancels.delete(requestId);
      try {
        cancel();
      } catch {
        // ignore cancel errors
      }
    }
    // Ensure unity query promises don't leak when request is cancelled/timed out.
    this.cancelUnityQueriesForRequest(requestId, cancelReason);
  }

  touchCodexHeartbeat(requestId) {
    if (!requestId || !this.turnStore) {
      return;
    }
    if (typeof this.turnStore.touchCodexHeartbeat !== "function") {
      return;
    }
    this.turnStore.touchCodexHeartbeat(requestId, { persist: false });
  }

  cancelUnityQueriesForRequest(requestId, reason) {
    if (!requestId || !this.pendingUnityComponentQueries.size) {
      return;
    }
    const rejectMessage =
      typeof reason === "string" && reason
        ? `unity components query cancelled: ${reason}`
        : "unity components query cancelled";
    for (const [queryId, pending] of this.pendingUnityComponentQueries.entries()) {
      if (!pending || pending.requestId !== requestId) {
        continue;
      }
      this.pendingUnityComponentQueries.delete(queryId);
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      try {
        if (typeof pending.reject === "function") {
          pending.reject(new Error(rejectMessage));
        }
      } catch {
        // ignore downstream rejection handlers
      }
    }
  }

  normalizePlannerPlan(plannerResult, body, requestId, streamedMessage) {
    if (!plannerResult || typeof plannerResult !== "object") {
      return {
        ok: false,
        errorCode: "E_PLANNING_FAILED",
        errorMessage: "Codex planner returned empty result",
        assistantText: streamedMessage || "",
      };
    }

    const assistantText =
      typeof plannerResult.assistant_text === "string" &&
      plannerResult.assistant_text.trim().length > 0
        ? plannerResult.assistant_text.trim()
        : typeof streamedMessage === "string"
          ? streamedMessage.trim()
          : "";

    const guarded = validatePlannerOutputGuard(plannerResult, {
      allowedScriptRoot: "Assets/Scripts/AIGenerated/",
    });
    if (!guarded.ok) {
      return {
        ok: false,
        errorCode: guarded.errorCode || "E_PLANNING_FAILED",
        errorMessage:
          guarded.message || "AI 违规尝试越权操作：规划输出校验失败",
        assistantText,
      };
    }

    if (guarded.task_allocation === null) {
      return {
        ok: true,
        assistantText,
        taskAllocation: {
          file_actions: [],
          visual_layer_actions: [],
        },
      };
    }

    return {
      ok: true,
      assistantText,
      taskAllocation: guarded.task_allocation,
    };
  }

  executePlanToCompilePending(requestId, body, plan, options) {
    const opts = options || {};
    const replay = !!opts.replay;

    const active = this.turnStore.getTurn(requestId);
    if (!active || active.state !== "running") {
      return {
        statusCode: 409,
        body: {
          accepted: false,
          replay,
          error_code: "E_PHASE_INVALID",
          message: "turn is not active",
        },
      };
    }

    const assistantText =
      plan && typeof plan.assistantText === "string"
        ? plan.assistantText.trim()
        : "";
    if (opts.emitSummaryEvents && assistantText) {
      this.turnStore.appendEvent(requestId, "chat.message", {
        phase: "planning",
        role: "assistant",
        message: assistantText,
      });
    }

    if (!plan.ok) {
      this.turnStore.appendEvent(requestId, "chat.message", {
        phase: "planning",
        role: "assistant",
        message: plan.errorMessage,
        error_code: plan.errorCode,
      });
      this.turnStore.failTurn(requestId, plan.errorCode, plan.errorMessage);
      const failed = this.turnStore.getTurn(requestId);
      return {
        statusCode: 200,
        body: {
          accepted: false,
          replay,
          assistant_text: assistantText,
          assistant_summary: assistantText,
          ...(failed ? this.turnStore.buildTurnStatus(failed) : {}),
        },
      };
    }

    if (
      !this.fileActionExecutor ||
      typeof this.fileActionExecutor.execute !== "function"
    ) {
      this.turnStore.appendEvent(requestId, "chat.message", {
        phase: "planning",
        role: "assistant",
        message: "Sidecar fileActionExecutor is not configured.",
        error_code: "E_INTERNAL",
      });
      this.turnStore.failTurn(
        requestId,
        "E_INTERNAL",
        "fileActionExecutor is not configured"
      );
      const failed = this.turnStore.getTurn(requestId);
      return {
        statusCode: 200,
        body: {
          accepted: false,
          replay,
          assistant_text: assistantText,
          assistant_summary: assistantText,
          task_allocation: plan.taskAllocation,
          ...(failed ? this.turnStore.buildTurnStatus(failed) : {}),
        },
      };
    }

    const fileActions = Array.isArray(plan.taskAllocation.file_actions)
      ? plan.taskAllocation.file_actions
      : [];
    const visualActions = Array.isArray(plan.taskAllocation.visual_layer_actions)
      ? plan.taskAllocation.visual_layer_actions
      : [];

    if (fileActions.length === 0 && visualActions.length === 0) {
      const completeMessage = assistantText || "No executable actions were produced.";
      if (!completeMessage) {
        this.turnStore.appendEvent(requestId, "chat.message", {
          phase: "planning",
          role: "assistant",
          message: "No executable actions were produced.",
        });
      }
      this.turnStore.completeTurn(requestId, completeMessage, {
        execution_report: this.buildExecutionReport(requestId, {
          outcome: "completed",
          reason: "chat_or_consultative_turn",
          compile_success: true,
          action_success: true,
          chat_only: true,
        }),
      });
      const completed = this.turnStore.getTurn(requestId);
      return {
        statusCode: 200,
        body: {
          accepted: true,
          replay,
          assistant_text: assistantText,
          assistant_summary: assistantText,
          task_allocation: plan.taskAllocation,
          files_changed: [],
          ...(completed ? this.turnStore.buildTurnStatus(completed) : {}),
        },
      };
    }

    if (fileActions.length === 0 && visualActions.length > 0) {
      this.turnStore.setActionConfirmPending(requestId, visualActions);
      const firstAction = this.turnStore.getPendingVisualAction(requestId);
      const actionRequest = firstAction
        ? this.buildUnityActionRequestEnvelope(body, firstAction)
        : null;
      this.turnStore.appendEvent(requestId, "turn.completed", {
        phase: "planning",
        message: "Planning phase completed. Waiting for action confirmation.",
        stage: "action_confirm_pending",
        task_allocation: plan.taskAllocation,
        unity_action_request: actionRequest,
      });
      const pending = this.turnStore.getTurn(requestId);
      return {
        statusCode: 202,
        body: {
          accepted: true,
          replay,
          assistant_text: assistantText,
          assistant_summary: assistantText,
          task_allocation: plan.taskAllocation,
          files_changed: [],
          ...(actionRequest ? { unity_action_request: actionRequest } : {}),
          ...(pending ? this.turnStore.buildTurnStatus(pending) : {}),
        },
      };
    }

    const execution = this.fileActionExecutor.execute(fileActions);
    if (!execution.ok) {
      return this.beginFinalizeTerminalPhase(requestId, body, {
        finalState: "error",
        errorCode: execution.errorCode || "E_FILE_WRITE_FAILED",
        defaultMessage: execution.message || "File action execution failed",
        executionReport: this.buildExecutionReport(requestId, {
          outcome: "failed",
          reason: "file_action_execution_failed",
          compile_success: false,
          action_success: false,
          files_changed: execution.changes || [],
          file_error: {
            error_code: execution.errorCode || "E_FILE_WRITE_FAILED",
            error_message: execution.message || "File action execution failed",
          },
        }),
        immediatePayload: {
          accepted: false,
          files_changed: execution.changes || [],
        },
      });
    }

    this.turnStore.setCompilePending(requestId, visualActions);
    const compileRequest = this.buildCompileRequestEnvelope(
      body,
      "file_actions_applied"
    );
    this.turnStore.appendEvent(requestId, "turn.completed", {
      phase: "planning",
      message: "Planning phase completed. Script layer actions applied.",
      stage: "compile_pending",
      task_allocation: plan.taskAllocation,
      files_changed: execution.changes || [],
      compile_request: compileRequest,
    });

    const pending = this.turnStore.getTurn(requestId);
    return {
      statusCode: 202,
      body: {
        accepted: true,
        replay,
        assistant_text: assistantText,
        assistant_summary: assistantText,
        task_allocation: plan.taskAllocation,
        files_changed: execution.changes || [],
        compile_request: compileRequest,
        ...(pending ? this.turnStore.buildTurnStatus(pending) : {}),
      },
    };
  }

  buildCompileRequestEnvelope(body, reason) {
    return {
      event: "unity.compile.request",
      request_id: body.request_id,
      thread_id: body.thread_id,
      turn_id: body.turn_id,
      reason: reason || "file_actions_applied",
      refresh_assets: true,
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

  buildCompileFailureSummary(errors) {
    if (!Array.isArray(errors) || errors.length === 0) {
      return "Compile failed";
    }
    const first = errors[0];
    if (!first || typeof first !== "object") {
      return "Compile failed";
    }
    const code = first.code ? String(first.code) : "UNKNOWN";
    const message = first.message ? String(first.message) : "Compile failed";
    return `Compile failed: ${code} ${message}`;
  }

  buildActionFailureSummary(payload) {
    const errorCode = normalizeErrorCode(
      payload && payload.error_code,
      "E_ACTION_EXECUTION_FAILED"
    );
    const errorMessage =
      payload && typeof payload.error_message === "string" && payload.error_message
        ? payload.error_message
        : "Visual action failed";
    return `Action failed: ${errorCode} ${errorMessage}`;
  }

  matchUnityActionResult(pendingAction, payload) {
    if (!pendingAction || typeof pendingAction !== "object") {
      return {
        ok: false,
        message: "unity.action.result pending visual action is missing",
      };
    }
    if (!payload || typeof payload !== "object") {
      return {
        ok: false,
        message: "unity.action.result payload is invalid",
      };
    }

    const expectedType = String(pendingAction.type || "").trim();
    const actualType = String(payload.action_type || "").trim();
    if (!expectedType || expectedType !== actualType) {
      return {
        ok: false,
        message: "unity.action.result action_type does not match pending visual action",
      };
    }

    const expectedTarget = String(pendingAction.target || "").trim();
    const actualTarget = String(payload.target || "").trim();
    if (expectedTarget && actualTarget && expectedTarget !== actualTarget) {
      return {
        ok: false,
        message: "unity.action.result target does not match pending visual action",
      };
    }

    const expectedPath = String(pendingAction.target_object_path || "").trim();
    const actualPath = String(payload.target_object_path || "").trim();
    if (expectedPath && actualPath && expectedPath !== actualPath) {
      return {
        ok: false,
        message: "unity.action.result target_object_path does not match pending visual action",
      };
    }

    if (expectedType === "add_component" || expectedType === "remove_component") {
      const expectedComponent = String(
        expectedType === "remove_component"
          ? pendingAction.component_name ||
            pendingAction.component_assembly_qualified_name ||
            ""
          : pendingAction.component_assembly_qualified_name || ""
      ).trim();
      const actualComponent = String(
        expectedType === "remove_component"
          ? payload.component_name ||
            payload.component_assembly_qualified_name ||
            ""
          : payload.component_assembly_qualified_name || ""
      ).trim();
      if (expectedComponent !== actualComponent) {
        return {
          ok: false,
          message:
            "unity.action.result component_assembly_qualified_name does not match pending visual action",
        };
      }
    } else if (expectedType === "replace_component") {
      const expectedSource = String(
        pendingAction.source_component_assembly_qualified_name || ""
      ).trim();
      const actualSource = String(
        payload.source_component_assembly_qualified_name || ""
      ).trim();
      if (expectedSource !== actualSource) {
        return {
          ok: false,
          message:
            "unity.action.result source_component_assembly_qualified_name does not match pending visual action",
        };
      }

      const expectedComponent = String(
        pendingAction.component_assembly_qualified_name || ""
      ).trim();
      const actualComponent = String(
        payload.component_assembly_qualified_name || ""
      ).trim();
      if (expectedComponent !== actualComponent) {
        return {
          ok: false,
          message:
            "unity.action.result component_assembly_qualified_name does not match pending visual action",
        };
      }
    } else if (expectedType === "create_gameobject") {
      const expectedName = String(pendingAction.name || "").trim();
      const actualName = String(payload.name || "").trim();
      if (expectedName && actualName && expectedName !== actualName) {
        return {
          ok: false,
          message: "unity.action.result name does not match pending visual action",
        };
      }

      const expectedParent = String(
        pendingAction.parent_path ||
          pendingAction.parent_object_path ||
          pendingAction.target_object_path ||
          ""
      ).trim();
      const actualParent = String(
        payload.parent_path ||
          payload.parent_object_path ||
          payload.target_object_path ||
          ""
      ).trim();
      if (expectedParent && actualParent && expectedParent !== actualParent) {
        return {
          ok: false,
          message:
            "unity.action.result parent/target object path does not match pending visual action",
        };
      }

      const expectedObjectType = String(
        pendingAction.object_type ||
          pendingAction.primitive_type ||
          pendingAction.ui_type ||
          ""
      ).trim();
      const actualObjectType = String(
        payload.object_type || payload.primitive_type || payload.ui_type || ""
      ).trim();
      if (
        expectedObjectType &&
        actualObjectType &&
        expectedObjectType !== actualObjectType
      ) {
        return {
          ok: false,
          message: "unity.action.result object_type does not match pending visual action",
        };
      }
    }

    return { ok: true };
  }

  buildUnityActionRequestEnvelope(body, action) {
    const approvalMode = this.resolveTurnApprovalMode(
      body && typeof body === "object" ? body.request_id : ""
    );
    return this.buildUnityActionRequestEnvelopeWithIds(
      body.request_id,
      body.thread_id,
      body.turn_id,
      action,
      { approvalMode }
    );
  }

  buildUnityActionRequestEnvelopeWithIds(requestId, threadId, turnId, action, options) {
    const opts = options && typeof options === "object" ? options : {};
    const approvalMode = normalizeApprovalMode(
      opts.approvalMode,
      this.resolveTurnApprovalMode(requestId)
    );
    const requiresConfirmation = approvalMode !== "auto";
    return {
      event: "unity.action.request",
      request_id: requestId,
      thread_id: threadId,
      turn_id: turnId,
      timestamp: this.nowIso(),
      payload: {
        requires_confirmation: requiresConfirmation,
        action: {
          type: action.type,
          target: action.target,
          target_object_path: action.target_object_path || "",
          component_assembly_qualified_name:
            action.component_assembly_qualified_name,
          component_name: action.component_name || "",
          source_component_assembly_qualified_name:
            action.source_component_assembly_qualified_name || "",
          name: action.name || "",
          parent_path: action.parent_path || "",
          object_type: action.object_type || "",
          parent_object_path: action.parent_object_path || "",
          primitive_type: action.primitive_type || "",
          ui_type: action.ui_type || "",
        },
      },
    };
  }

  requestUnityComponentsForPlanner(input) {
    const payload = input && typeof input === "object" ? input : {};
    const requestId = normalizeRequestId(payload.requestId);
    const threadId =
      typeof payload.threadId === "string" ? payload.threadId : "";
    const turnId = typeof payload.turnId === "string" ? payload.turnId : "";
    const targetPath =
      typeof payload.targetPath === "string" ? payload.targetPath.trim() : "";
    const signal = payload.signal;

    if (!requestId || !targetPath) {
      return Promise.reject(
        new Error("unity query request_id/target_path is required")
      );
    }

    const turn = this.turnStore.getTurn(requestId);
    if (!turn || turn.state !== "running") {
      return Promise.reject(new Error("turn is not active for unity query"));
    }

    const queryId = createUnityQueryId();
    const queryEnvelope = {
      event: "unity.query.components.request",
      request_id: requestId,
      thread_id: threadId,
      turn_id: turnId,
      timestamp: this.nowIso(),
      payload: {
        query_id: queryId,
        target_path: targetPath,
      },
    };

    this.touchCodexHeartbeat(requestId);
    this.turnStore.appendEvent(requestId, "unity.query.components.request", {
      phase: "planning",
      stage: "codex_pending",
      message: `Unity components query requested: ${targetPath}`,
      unity_query_components_request: queryEnvelope,
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        const pending = this.pendingUnityComponentQueries.get(queryId);
        if (pending) {
          if (pending.timer) {
            clearTimeout(pending.timer);
          }
          this.pendingUnityComponentQueries.delete(queryId);
        }
        if (signal && typeof signal.removeEventListener === "function") {
          signal.removeEventListener("abort", onAbort);
        }
      };

      const onAbort = () => {
        cleanup();
        reject(new Error("planner aborted"));
      };

      if (signal && signal.aborted) {
        cleanup();
        reject(new Error("planner aborted"));
        return;
      }

      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timeoutMs =
        Number.isFinite(this.unityComponentQueryTimeoutMs) &&
        this.unityComponentQueryTimeoutMs > 0
          ? this.unityComponentQueryTimeoutMs
          : 5000;
      const timer = setTimeout(() => {
        cleanup();
        const timeoutResult = {
          query_id: queryId,
          target_path: targetPath,
          components: [],
          error_code: "unity_busy_or_compiling",
          error_message: `Unity components query timed out after ${timeoutMs}ms`,
        };
        this.touchCodexHeartbeat(requestId);
        this.turnStore.appendEvent(requestId, "unity.query.components.result", {
          phase: "planning",
          stage: "codex_pending",
          message: `Unity components query timed out: ${targetPath}`,
          unity_query_components_result: {
            event: "unity.query.components.result",
            request_id: requestId,
            thread_id: threadId,
            turn_id: turnId,
            timestamp: this.nowIso(),
            payload: timeoutResult,
          },
        });
        resolve(timeoutResult);
      }, timeoutMs);
      if (timer && typeof timer.unref === "function") {
        timer.unref();
      }

      this.pendingUnityComponentQueries.set(queryId, {
        requestId,
        timer,
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (reason) => {
          cleanup();
          reject(reason);
        },
      });
    });
  }

  beginFinalizeTerminalPhase(requestId, body, intent) {
    const active = this.turnStore.getTurn(requestId);
    if (!active || active.state !== "running") {
      return {
        statusCode: 409,
        body: {
          error_code: "E_PHASE_INVALID",
          message: "turn is not active",
        },
      };
    }

    const terminalIntent = intent && typeof intent === "object" ? intent : {};
    const finalState =
      terminalIntent.finalState === "error" ? "error" : "completed";
    const normalizedErrorCode = normalizeErrorCode(
      terminalIntent.errorCode,
      "E_INTERNAL"
    );
    const defaultMessage =
      typeof terminalIntent.defaultMessage === "string" &&
      terminalIntent.defaultMessage
        ? terminalIntent.defaultMessage
        : "Turn finished.";
    const executionReport = this.buildExecutionReport(
      requestId,
      terminalIntent.executionReport || {}
    );

    const shouldUseCodexFinalize = this.shouldUseCodexFinalize(
      finalState,
      executionReport,
      terminalIntent
    );
    if (!shouldUseCodexFinalize) {
      if (finalState === "error") {
        this.turnStore.failTurn(requestId, normalizedErrorCode, defaultMessage, {
          execution_report: executionReport || null,
        });
      } else {
        this.turnStore.completeTurn(requestId, defaultMessage, {
          execution_report: executionReport || null,
        });
      }
      this.tryRecordExecutionMemory(
        body && body.thread_id,
        executionReport,
        defaultMessage
      );
      const done = this.turnStore.getTurn(requestId);
      return {
        statusCode: 200,
        body: {
          ...(terminalIntent.immediatePayload || {}),
          ...(done ? this.turnStore.buildTurnStatus(done) : {}),
          finalize_pending: false,
        },
      };
    }

    const setPending = this.turnStore.setCodexPending(requestId, {
      phase: "final",
      message: "Finalizing response with Codex",
    });
    if (!setPending) {
      return {
        statusCode: 409,
        body: {
          error_code: "E_PHASE_INVALID",
          message: "failed to enter finalize stage",
        },
      };
    }

    this.runFinalizeInBackground(requestId, body, {
      finalState,
      errorCode: normalizedErrorCode,
      defaultMessage,
      executionReport,
    });

    const pending = this.turnStore.getTurn(requestId);
    return {
      statusCode: 200,
      body: {
        ...(terminalIntent.immediatePayload || {}),
        ...(pending ? this.turnStore.buildTurnStatus(pending) : {}),
        finalize_pending: true,
      },
    };
  }

  async runFinalizeInBackground(requestId, body, intent) {
    const controller = new AbortController();
    this.pendingPlanningCancels.set(requestId, () => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    });

    const stream = this.createStreamEmitter(requestId, "final");
    let finalMessage =
      typeof intent.defaultMessage === "string" && intent.defaultMessage
        ? intent.defaultMessage
        : "Turn finished.";
    try {
      if (
        this.codexPlanner &&
        this.codexPlanner.enabled &&
        typeof this.codexPlanner.finalizeTurn === "function"
      ) {
        const summary = await withAbortTimeout(
          this.codexPlanner.finalizeTurn({
            requestId,
            threadId: body.thread_id,
            turnId: body.turn_id,
            executionReport: intent.executionReport,
          signal: controller.signal,
          onDelta: stream.onDelta,
          onMessage: stream.onMessage,
          onProgress: stream.onProgress,
        }),
          controller,
          FINALIZE_TIMEOUT_MS,
          "Finalize timed out"
        );
        if (summary && typeof summary === "string" && summary.trim()) {
          finalMessage = summary.trim();
        } else if (stream.getLastMessage()) {
          finalMessage = stream.getLastMessage();
        }
      }
    } catch {
      // Finalize failure should not break terminal result.
    } finally {
      this.pendingPlanningCancels.delete(requestId);
    }

    const active = this.turnStore.getTurn(requestId);
    if (!active || active.state !== "running") {
      return;
    }

    if (intent.finalState === "error") {
      this.turnStore.failTurn(
        requestId,
        intent.errorCode || "E_INTERNAL",
        finalMessage,
        {
          execution_report: intent.executionReport || null,
        }
      );
      this.tryRecordExecutionMemory(
        body && body.thread_id,
        intent.executionReport,
        finalMessage
      );
      return;
    }

    this.turnStore.completeTurn(requestId, finalMessage, {
      execution_report: intent.executionReport || null,
    });
    this.tryRecordExecutionMemory(
      body && body.thread_id,
      intent.executionReport,
      finalMessage
    );
  }

  buildExecutionReport(requestId, overrides) {
    const turn = this.turnStore.getTurn(requestId);
    const extra = overrides && typeof overrides === "object" ? overrides : {};
    const filesChanged =
      Array.isArray(extra.files_changed) && extra.files_changed.length > 0
        ? extra.files_changed
        : this.collectFilesChangedFromTurn(turn);

    return {
      request_id: requestId,
      files_changed: filesChanged,
      compile_success: toOptionalBoolean(extra.compile_success),
      action_success: toOptionalBoolean(extra.action_success),
      auto_fix_attempts:
        turn && Number.isFinite(turn.auto_fix_attempts)
          ? Number(turn.auto_fix_attempts)
          : 0,
      max_auto_fix_attempts:
        turn && Number.isFinite(turn.max_auto_fix_attempts)
          ? Number(turn.max_auto_fix_attempts)
          : 1,
      last_failure_code:
        turn && typeof turn.last_failure_code === "string"
          ? turn.last_failure_code
          : "",
      last_failure_message:
        turn && typeof turn.last_failure_message === "string"
          ? turn.last_failure_message
          : "",
      outcome:
        typeof extra.outcome === "string" && extra.outcome
          ? extra.outcome
          : "",
      reason:
        typeof extra.reason === "string" && extra.reason
          ? extra.reason
          : "",
      compile_errors: Array.isArray(extra.compile_errors)
        ? extra.compile_errors
        : [],
      action_error:
        extra.action_error && typeof extra.action_error === "object"
          ? extra.action_error
          : null,
      chat_only: !!extra.chat_only,
    };
  }

  tryRecordExecutionMemory(threadId, executionReport, finalMessage) {
    if (!threadId || typeof threadId !== "string") {
      return;
    }
    if (
      !this.codexPlanner ||
      !this.codexPlanner.enabled ||
      typeof this.codexPlanner.recordExecutionMemory !== "function"
    ) {
      return;
    }
    try {
      this.codexPlanner.recordExecutionMemory({
        threadId,
        executionReport: executionReport && typeof executionReport === "object"
          ? executionReport
          : {},
        finalMessage:
          typeof finalMessage === "string" ? finalMessage : "",
      });
    } catch {
      // memory persistence failures should not affect turn completion.
    }
  }

  shouldUseCodexFinalize(finalState, executionReport, terminalIntent) {
    const intent = terminalIntent && typeof terminalIntent === "object"
      ? terminalIntent
      : {};
    if (intent.forceFinalize === true) {
      return true;
    }
    if (
      !this.codexPlanner ||
      !this.codexPlanner.enabled ||
      typeof this.codexPlanner.finalizeTurn !== "function"
    ) {
      return false;
    }

    if (finalState === "error") {
      return true;
    }

    const report =
      executionReport && typeof executionReport === "object"
        ? executionReport
        : {};
    const filesChangedCount = Array.isArray(report.files_changed)
      ? report.files_changed.length
      : 0;
    const compileErrorsCount = Array.isArray(report.compile_errors)
      ? report.compile_errors.length
      : 0;
    const hasActionError = !!(report.action_error && typeof report.action_error === "object");
    const hasAutoFix = Number.isFinite(report.auto_fix_attempts)
      ? Number(report.auto_fix_attempts) > 0
      : false;
    const outcome = typeof report.outcome === "string" ? report.outcome : "";
    const hasFailureSignals =
      outcome === "failed" ||
      compileErrorsCount > 0 ||
      hasActionError ||
      hasAutoFix;
    if (hasFailureSignals) {
      return true;
    }

    const compileSuccess = report.compile_success === true;
    const actionSuccess = report.action_success === true;
    if (!compileSuccess || !actionSuccess) {
      return true;
    }

    // Skip finalize for simple successful flows to reduce token cost.
    if (filesChangedCount <= 1) {
      return false;
    }

    return true;
  }

  collectFilesChangedFromTurn(turn) {
    if (!turn || !Array.isArray(turn.events)) {
      return [];
    }
    const seen = new Set();
    const items = [];
    for (const event of turn.events) {
      if (!event || !Array.isArray(event.files_changed)) {
        continue;
      }
      for (const change of event.files_changed) {
        if (!change || typeof change !== "object") {
          continue;
        }
        const key = `${change.type || ""}|${change.path || ""}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push({
          type: change.type || "",
          path: change.path || "",
        });
      }
    }
    return items;
  }

  tryAutoFixCompileFailure(requestId, body, turn, summary) {
    if (!this.autoFixExecutor || typeof this.autoFixExecutor.attemptCompileFix !== "function") {
      return null;
    }

    const preview = this.autoFixExecutor.attemptCompileFix(
      body.payload.errors || [],
      true
    );
    if (!preview || !preview.ok) {
      return null;
    }

    const begin = this.turnStore.beginAutoFixAttempt(
      requestId,
      "E_COMPILE_FAILED",
      summary
    );
    if (!begin.ok) {
      if (begin.reachedLimit) {
        return this.failRetryLimitReached(
          requestId,
          "Compile failed after max auto-fix attempts",
          begin.attempts,
          begin.maxAttempts,
          {
            body,
            reason: "compile_retry_limit_reached",
            compile_errors: body && body.payload ? body.payload.errors || [] : [],
          }
        );
      }
      return null;
    }

    const execution = this.autoFixExecutor.attemptCompileFix(
      body.payload.errors || [],
      false
    );
    if (!execution || !execution.ok) {
      if (execution && execution.errorCode === "E_AUTO_FIX_UNAVAILABLE") {
        return null;
      }
      return this.failRetryLimitReached(
        requestId,
        `Compile auto-fix attempt ${begin.attempts} failed: ${execution && execution.message ? execution.message : "no strategy matched"}`,
        begin.attempts,
        begin.maxAttempts,
        {
          body,
          reason: "compile_auto_fix_attempt_failed",
          compile_errors: body && body.payload ? body.payload.errors || [] : [],
        }
      );
    }

    const remainingVisualActions = this.turnStore.getRemainingVisualActions(requestId);
    this.turnStore.setCompilePending(requestId, remainingVisualActions);
    const pending = this.turnStore.getTurn(requestId);
    return {
      statusCode: 200,
      body: {
        ok: true,
        compile_success: false,
        auto_fix_applied: true,
        auto_fix_attempts: begin.attempts,
        auto_fix_max_attempts: begin.maxAttempts,
        auto_fix_reason: execution.reason || "",
        files_changed: execution.changes || [],
        compile_request: {
          event: "unity.compile.request",
          request_id: body.request_id,
          thread_id: body.thread_id,
          turn_id: body.turn_id,
          reason: "auto_fix_applied",
          refresh_assets: true,
        },
        ...(pending ? this.turnStore.buildTurnStatus(pending) : {}),
      },
    };
  }

  tryAutoFixActionFailure(
    requestId,
    body,
    turn,
    pendingAction,
    errorCode,
    summary
  ) {
    if (!this.autoFixExecutor || typeof this.autoFixExecutor.attemptActionFix !== "function") {
      return null;
    }

    const execution = this.autoFixExecutor.attemptActionFix(
      pendingAction,
      body.payload
    );
    if (!execution || !execution.ok || !execution.patchedAction) {
      return null;
    }

    const begin = this.turnStore.beginAutoFixAttempt(
      requestId,
      errorCode,
      summary
    );
    if (!begin.ok) {
      if (begin.reachedLimit) {
        return this.failRetryLimitReached(
          requestId,
          "Action failed after max auto-fix attempts",
          begin.attempts,
          begin.maxAttempts,
          {
            body,
            reason: "action_retry_limit_reached",
            action_error: body && body.payload ? body.payload : {},
          }
        );
      }
      return null;
    }

    const replaced = this.turnStore.replacePendingVisualAction(
      requestId,
      execution.patchedAction
    );
    if (!replaced) {
      return this.failRetryLimitReached(
        requestId,
        "Action auto-fix failed: unable to patch pending visual action",
        begin.attempts,
        begin.maxAttempts,
        {
          body,
          reason: "action_auto_fix_patch_failed",
          action_error: body && body.payload ? body.payload : {},
        }
      );
    }

    this.turnStore.setActionConfirmPending(requestId);
    const pending = this.turnStore.getTurn(requestId);
    const nextAction = this.turnStore.getPendingVisualAction(requestId);
    return {
      statusCode: 200,
      body: {
        ok: true,
        action_success: false,
        auto_fix_applied: true,
        auto_fix_attempts: begin.attempts,
        auto_fix_max_attempts: begin.maxAttempts,
        auto_fix_reason: execution.reason || "",
        ...(pending ? this.turnStore.buildTurnStatus(pending) : {}),
        ...(nextAction
          ? {
              unity_action_request: this.buildUnityActionRequestEnvelope(
                body,
                nextAction
              ),
            }
          : {}),
      },
    };
  }

  failRetryLimitReached(requestId, message, attempts, maxAttempts, context) {
    const ctx = context && typeof context === "object" ? context : {};
    const body = ctx.body;
    if (!body || !body.request_id || !body.thread_id || !body.turn_id) {
      this.turnStore.failTurn(
        requestId,
        "E_RETRY_LIMIT_REACHED",
        message
      );
      const failed = this.turnStore.getTurn(requestId);
      return {
        statusCode: 200,
        body: {
          ok: true,
          recoverable: false,
          auto_fix_attempts: Number.isFinite(attempts) ? attempts : 0,
          auto_fix_max_attempts: Number.isFinite(maxAttempts) ? maxAttempts : 1,
          ...(failed ? this.turnStore.buildTurnStatus(failed) : {}),
        },
      };
    }

    return this.beginFinalizeTerminalPhase(requestId, body, {
      finalState: "error",
      errorCode: "E_RETRY_LIMIT_REACHED",
      defaultMessage: message,
      executionReport: this.buildExecutionReport(requestId, {
        outcome: "failed",
        reason: ctx.reason || "retry_limit_reached",
        compile_success: false,
        action_success: false,
        auto_fix_attempts: Number.isFinite(attempts) ? attempts : 0,
        auto_fix_max_attempts: Number.isFinite(maxAttempts) ? maxAttempts : 1,
        compile_errors: Array.isArray(ctx.compile_errors) ? ctx.compile_errors : [],
        action_error:
          ctx.action_error && typeof ctx.action_error === "object"
            ? ctx.action_error
            : null,
      }),
      immediatePayload: {
        ok: true,
        recoverable: false,
        auto_fix_attempts: Number.isFinite(attempts) ? attempts : 0,
        auto_fix_max_attempts: Number.isFinite(maxAttempts) ? maxAttempts : 1,
      },
    });
  }
}

function normalizeErrorCode(value, fallback) {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const code = value.trim();
  return code || fallback;
}

function normalizeApprovalMode(value, fallback) {
  if (value === "auto" || value === "require_user") {
    return value;
  }
  return fallback === "auto" ? "auto" : "require_user";
}

function normalizeUnityQueryErrorCode(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function toOptionalBoolean(value) {
  if (typeof value !== "boolean") {
    return null;
  }
  return value;
}

function withAbortTimeout(promise, controller, timeoutMs, message) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        if (controller && typeof controller.abort === "function") {
          controller.abort();
        }
      } catch {
        // ignore abort errors
      }
      reject(new Error(message || `operation timed out after ${ms}ms`));
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isUnityRebootWaitErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) {
    return false;
  }
  return (
    code === "WAITING_FOR_UNITY_REBOOT" ||
    code === "E_WAITING_FOR_UNITY_REBOOT"
  );
}

function createUnityQueryId() {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `uq_${stamp}_${rand}`;
}

function normalizeMcpJobSnapshotItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const jobId = typeof item.job_id === "string" ? item.job_id.trim() : "";
  if (!jobId) {
    return null;
  }
  const status = normalizeMcpJobStatus(item.status);
  const now = Date.now();
  const createdAt =
    Number.isFinite(Number(item.created_at)) && Number(item.created_at) > 0
      ? Math.floor(Number(item.created_at))
      : now;
  const updatedAt =
    Number.isFinite(Number(item.updated_at)) && Number(item.updated_at) > 0
      ? Math.floor(Number(item.updated_at))
      : createdAt;
  const terminalAt =
    Number.isFinite(Number(item.terminal_at)) && Number(item.terminal_at) > 0
      ? Math.floor(Number(item.terminal_at))
      : 0;
  return {
    job_id: jobId,
    idempotency_key:
      typeof item.idempotency_key === "string" ? item.idempotency_key.trim() : "",
    approval_mode: normalizeApprovalMode(item.approval_mode, "auto"),
    user_intent: typeof item.user_intent === "string" ? item.user_intent : "",
    thread_id: typeof item.thread_id === "string" ? item.thread_id : "",
    request_id: typeof item.request_id === "string" ? item.request_id : "",
    turn_id: typeof item.turn_id === "string" ? item.turn_id : "",
    context:
      item.context && typeof item.context === "object"
        ? item.context
        : buildDefaultTurnContext(),
    status,
    stage:
      typeof item.stage === "string" && item.stage
        ? item.stage
        : status === "queued"
          ? "queued"
          : status === "failed"
            ? "failed"
            : "",
    progress_message:
      typeof item.progress_message === "string" ? item.progress_message : "",
    error_code: typeof item.error_code === "string" ? item.error_code : "",
    error_message: typeof item.error_message === "string" ? item.error_message : "",
    suggestion: typeof item.suggestion === "string" ? item.suggestion : "",
    recoverable: item.recoverable === true,
    execution_report:
      item.execution_report && typeof item.execution_report === "object"
        ? item.execution_report
        : null,
    created_at: createdAt,
    updated_at: updatedAt,
    terminal_at: terminalAt,
  };
}

function normalizeMcpJobStatus(value) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    status === "queued" ||
    status === "pending" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "pending";
}

function sameJson(a, b) {
  if (a === b) {
    return true;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function normalizeMcpStreamEventType(value, statusHint) {
  const eventName = typeof value === "string" ? value.trim() : "";
  if (eventName === "job.progress" || eventName === "job.completed") {
    return eventName;
  }
  return isTerminalMcpStatus(statusHint) ? "job.completed" : "job.progress";
}

function mapMcpErrorFeedback(errorCode, errorMessage) {
  const code = normalizeErrorCode(errorCode, "E_INTERNAL");
  const message = typeof errorMessage === "string" ? errorMessage : "";
  switch (code) {
    case "E_SCHEMA_INVALID":
      return {
        recoverable: true,
        suggestion:
          "Fix request schema and resubmit. Ensure required fields are non-empty strings.",
      };
    case "E_CONTEXT_DEPTH_VIOLATION":
      return {
        recoverable: true,
        suggestion:
          "Set context.selection_tree.max_depth to 2 and retry submit_unity_task.",
      };
    case "E_JOB_CONFLICT":
      return {
        recoverable: true,
        suggestion:
          "Use running_job_id for status/cancel, then retry after the running job finishes.",
      };
    case "E_TOO_MANY_ACTIVE_TURNS":
      return {
        recoverable: true,
        suggestion:
          "Wait for the active turn to finish or cancel it before submitting another job.",
      };
    case "E_FILE_PATH_FORBIDDEN":
      return {
        recoverable: true,
        suggestion:
          "Write files only under Assets/Scripts/AIGenerated and retry with a safe path.",
      };
    case "E_FILE_SIZE_EXCEEDED":
      return {
        recoverable: true,
        suggestion:
          "Reduce file content size below the configured sidecar maxFileBytes limit and retry.",
      };
    case "E_FILE_EXISTS_BLOCKED":
      return {
        recoverable: true,
        suggestion:
          "Use overwrite_if_exists=true or choose a new file path before retrying.",
      };
    case "E_ACTION_COMPONENT_NOT_FOUND":
      return {
        recoverable: true,
        suggestion:
          "Query available components on target, then retry with a valid component name/type.",
      };
    case "WAITING_FOR_UNITY_REBOOT":
    case "E_WAITING_FOR_UNITY_REBOOT":
      return {
        recoverable: true,
        suggestion:
          "Wait for unity.runtime.ping recovery, then retry the pending visual action.",
      };
    case "E_JOB_NOT_FOUND":
      return {
        recoverable: false,
        suggestion: "Verify job_id and thread scope before polling or cancelling.",
      };
    case "E_JOB_RECOVERY_STALE":
      return {
        recoverable: true,
        suggestion:
          "Recovered stale pending job. Resubmit with a new idempotency_key if the task is still needed.",
      };
    case "E_STREAM_SUBSCRIBERS_EXCEEDED":
      return {
        recoverable: true,
        suggestion:
          "Too many active stream subscribers. Close stale streams and reconnect, or increase MCP_STREAM_MAX_SUBSCRIBERS.",
      };
    case "E_NOT_FOUND":
      return {
        recoverable: false,
        suggestion:
          "Enable MCP adapter (ENABLE_MCP_ADAPTER=true) or fallback to local direct endpoints.",
      };
    default:
      return {
        recoverable: false,
        suggestion:
          message && message.toLowerCase().includes("timeout")
            ? "Retry once after backoff. If timeout persists, reduce task scope or inspect sidecar logs."
            : "Inspect error_code/error_message, adjust task payload, then retry if safe.",
      };
  }
}

function mapTurnStateToMcpStatus(turnState) {
  const state = typeof turnState === "string" ? turnState : "";
  if (state === "completed") {
    return "succeeded";
  }
  if (state === "error") {
    return "failed";
  }
  if (state === "cancelled") {
    return "cancelled";
  }
  return "pending";
}

function isTerminalMcpStatus(status) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function createMcpJobId(nowMs) {
  const ts = Number.isFinite(nowMs) && nowMs > 0 ? Number(nowMs) : Date.now();
  const stamp = new Date(ts).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `job_${stamp}_${rand}`;
}

function createMcpRequestId(nowMs) {
  const ts = Number.isFinite(nowMs) && nowMs > 0 ? Number(nowMs) : Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `mcp_req_${ts}_${rand}`;
}

function createMcpTurnId(nowMs) {
  const ts = Number.isFinite(nowMs) && nowMs > 0 ? Number(nowMs) : Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `mcp_turn_${ts}_${rand}`;
}

function buildDefaultTurnContext() {
  return {
    selection: {
      mode: "selection",
      target_object_path: "Scene/Canvas/Image",
      prefab_path: "",
    },
    selection_tree: {
      max_depth: 2,
      root: {
        name: "Image",
        path: "Scene/Canvas/Image",
        depth: 0,
        components: ["Transform", "Image"],
        children: [],
      },
      truncated_node_count: 0,
      truncated_reason: "",
    },
  };
}

module.exports = {
  TurnService,
};

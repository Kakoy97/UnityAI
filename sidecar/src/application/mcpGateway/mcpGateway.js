"use strict";

const {
  validateMcpSubmitUnityTask,
  validateMcpGetUnityTaskStatus,
  validateMcpCancelUnityTask,
  validateMcpHeartbeat,
} = require("../../domain/validators");
const {
  cloneJson,
  normalizeApprovalMode,
  isTerminalMcpStatus,
  createMcpJobId,
  createMcpRequestId,
  createMcpTurnId,
} = require("../../utils/turnUtils");
const { LockManager } = require("../jobRuntime/lockManager");
const { JobQueue } = require("../jobRuntime/jobQueue");
const { JobStore } = require("../jobRuntime/jobStore");
const { JobRecovery } = require("../jobRuntime/jobRecovery");
const {
  DEFAULT_LEASE_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_LEASE_MAX_RUNTIME_MS,
  normalizeLease,
  touchLease,
  toIsoTimestamp,
} = require("../jobRuntime/jobLease");
const {
  JobLeaseJanitor,
  DEFAULT_LEASE_JANITOR_INTERVAL_MS,
  DEFAULT_REBOOT_WAIT_TIMEOUT_MS,
} = require("../jobRuntime/jobLeaseJanitor");
const { UnityDispatcher } = require("../unityDispatcher/unityDispatcher");
const {
  OCC_STALE_SNAPSHOT_SUGGESTION,
} = require("../unitySnapshotService");
const { OBSERVABILITY_FREEZE_CONTRACT } = require("../../ports/contracts");
const { McpStreamHub } = require("./mcpStreamHub");
const {
  withMcpErrorFeedback,
  validationError,
  getMcpErrorFeedbackMetricsSnapshot,
} = require("./mcpErrorFeedback");
const {
  startRunningJob,
  finalizeJob,
  publishJob,
  promoteNextQueuedJob,
} = require("./jobLifecycle");
const {
  handleUnityCompileResult,
  handleUnityActionResult,
  handleUnityRuntimePing,
} = require("./unityCallbacks");

const MCP_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MCP_MAX_QUEUE = 1;
const MCP_STREAM_MAX_EVENTS = 500;
const MCP_STREAM_MAX_SUBSCRIBERS = 32;
const MCP_STREAM_RECOVERY_JOBS_MAX = 20;

class McpGateway {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.enableMcpAdapter = opts.enableMcpAdapter === true;
    this.unitySnapshotService = opts.unitySnapshotService || null;
    this.mcpJobTtlMs =
      Number.isFinite(Number(opts.mcpJobTtlMs)) && Number(opts.mcpJobTtlMs) > 0
        ? Math.floor(Number(opts.mcpJobTtlMs))
        : MCP_JOB_TTL_MS;
    this.mcpMaxQueue =
      Number.isFinite(Number(opts.mcpMaxQueue)) && Number(opts.mcpMaxQueue) >= 0
        ? Math.floor(Number(opts.mcpMaxQueue))
        : MCP_MAX_QUEUE;
    this.leaseHeartbeatTimeoutMs =
      Number.isFinite(Number(opts.mcpLeaseHeartbeatTimeoutMs)) &&
      Number(opts.mcpLeaseHeartbeatTimeoutMs) >= 1000
        ? Math.floor(Number(opts.mcpLeaseHeartbeatTimeoutMs))
        : DEFAULT_LEASE_HEARTBEAT_TIMEOUT_MS;
    this.leaseMaxRuntimeMs =
      Number.isFinite(Number(opts.mcpLeaseMaxRuntimeMs)) &&
      Number(opts.mcpLeaseMaxRuntimeMs) >= 1000
        ? Math.floor(Number(opts.mcpLeaseMaxRuntimeMs))
        : DEFAULT_LEASE_MAX_RUNTIME_MS;
    this.rebootWaitTimeoutMs =
      Number.isFinite(Number(opts.mcpRebootWaitTimeoutMs)) &&
      Number(opts.mcpRebootWaitTimeoutMs) >= 1000
        ? Math.floor(Number(opts.mcpRebootWaitTimeoutMs))
        : DEFAULT_REBOOT_WAIT_TIMEOUT_MS;
    this.leaseJanitorIntervalMs =
      Number.isFinite(Number(opts.mcpLeaseJanitorIntervalMs)) &&
      Number(opts.mcpLeaseJanitorIntervalMs) >= 250
        ? Math.floor(Number(opts.mcpLeaseJanitorIntervalMs))
        : DEFAULT_LEASE_JANITOR_INTERVAL_MS;

    this.lockManager = new LockManager();
    this.jobQueue = new JobQueue(this.mcpMaxQueue);
    this.jobStore = new JobStore();
    this.jobRecovery = new JobRecovery({
      snapshotStore: opts.mcpSnapshotStore || null,
      jobStore: this.jobStore,
      jobQueue: this.jobQueue,
      lockManager: this.lockManager,
      jobTtlMs: this.mcpJobTtlMs,
    });
    this.streamHub = new McpStreamHub({
      nowIso: this.nowIso,
      maxEvents: opts.mcpStreamMaxEvents || MCP_STREAM_MAX_EVENTS,
      maxSubscribers: opts.mcpStreamMaxSubscribers || MCP_STREAM_MAX_SUBSCRIBERS,
      recoveryJobsMax:
        opts.mcpStreamRecoveryJobsMax || MCP_STREAM_RECOVERY_JOBS_MAX,
      withMcpErrorFeedback: (body) => this.withMcpErrorFeedback(body),
    });
    this.unityDispatcher = new UnityDispatcher({
      nowIso: this.nowIso,
      fileActionExecutor: opts.fileActionExecutor || null,
    });

    this.statusQueryCalls = 0;
    this.mcpJobsById = this.jobStore.jobsById;
    this.lifecycleMetrics = {
      auto_cancel_total: 0,
      auto_cancel_heartbeat_timeout_total: 0,
      auto_cancel_max_runtime_total: 0,
      auto_cancel_reboot_wait_timeout_total: 0,
      lock_release_total: 0,
      queue_promote_total: 0,
    };
    this.jobLeaseJanitor = new JobLeaseJanitor({
      nowMs: () => Date.now(),
      intervalMs: this.leaseJanitorIntervalMs,
      rebootWaitTimeoutMs: this.rebootWaitTimeoutMs,
      defaultHeartbeatTimeoutMs: this.leaseHeartbeatTimeoutMs,
      defaultMaxRuntimeMs: this.leaseMaxRuntimeMs,
      jobStore: this.jobStore,
      streamHub: this.streamHub,
      withMcpErrorFeedback: (body) => this.withMcpErrorFeedback(body),
      finalizeJob: (jobId, patch) => finalizeJob(this, jobId, patch),
      onAutoCancel: (reason) => this.recordAutoCancel(reason),
    });

    if (this.enableMcpAdapter) {
      this.jobRecovery.restore();
      this.refreshJobs({ drainQueue: true });
      this.jobLeaseJanitor.start();
    }
  }

  submitUnityTask(body) {
    if (!this.enableMcpAdapter) {
      return this.notFound("MCP adapter is disabled");
    }

    this.refreshJobs({ drainQueue: true });
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return this.validationError({
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "Body must be a JSON object",
        statusCode: 400,
      });
    }

    const payload = body;
    const tokenValidation = this.validateWriteReadToken(payload.based_on_read_token);
    if (!tokenValidation.ok) {
      return tokenValidation.outcome;
    }

    const validation = validateMcpSubmitUnityTask(payload);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const idempotencyKey = String(payload.idempotency_key || "").trim();
    const replayJob = this.jobStore.getJobByIdempotencyKey(idempotencyKey);
    if (replayJob) {
      return {
        statusCode: 200,
        body: {
          status: "accepted",
          job_id: replayJob.job_id,
          idempotent_replay: true,
          job_status: replayJob.status,
          approval_mode: replayJob.approval_mode,
          running_job_id: this.lockManager.getRunningJobId(),
          error_code: replayJob.error_code || "",
          error_message: replayJob.error_message || "",
          suggestion: replayJob.suggestion || "",
          recoverable: replayJob.recoverable === true,
          message: "Idempotency hit. Returning existing job.",
        },
      };
    }

    const runningJobId = this.lockManager.getRunningJobId();
    const hasRunning = !!runningJobId;
    if (hasRunning && !this.jobQueue.canEnqueue()) {
      const conflict = this.withMcpErrorFeedback({
        status: "rejected",
        error_code: "E_JOB_CONFLICT",
        message: "Another Unity job is already running",
      });
      return {
        statusCode: 409,
        body: {
          ...conflict,
          reason_code: "E_JOB_CONFLICT",
          running_job_id: runningJobId,
        },
      };
    }

    const now = Date.now();
    const threadId = String(payload.thread_id || "").trim();
    const fileActions = Array.isArray(payload.file_actions)
      ? cloneJson(payload.file_actions)
      : [];
    const visualActions = Array.isArray(payload.visual_layer_actions)
      ? cloneJson(payload.visual_layer_actions)
      : [];
    const lease = normalizeLease(null, {
      ownerClientId: threadId,
      nowMs: now,
      defaultHeartbeatTimeoutMs: this.leaseHeartbeatTimeoutMs,
      defaultMaxRuntimeMs: this.leaseMaxRuntimeMs,
    });
    const job = this.jobStore.upsertJob({
      job_id: createMcpJobId(now),
      idempotency_key: idempotencyKey,
      approval_mode: normalizeApprovalMode(payload.approval_mode, "auto"),
      user_intent: String(payload.user_intent || ""),
      thread_id: threadId,
      based_on_read_token:
        typeof payload.based_on_read_token === "string"
          ? payload.based_on_read_token.trim()
          : "",
      request_id: createMcpRequestId(now),
      turn_id: createMcpTurnId(now),
      context:
        payload.context && typeof payload.context === "object"
          ? cloneJson(payload.context)
          : null,
      write_anchor:
        payload.write_anchor && typeof payload.write_anchor === "object"
          ? cloneJson(payload.write_anchor)
          : null,
      runtime: {
        file_actions: fileActions,
        visual_actions: visualActions,
        file_actions_applied: false,
        files_changed: [],
        next_visual_index: 0,
        phase: "accepted",
        compile_success: null,
        last_compile_request: null,
        last_action_request: null,
        last_compile_result: null,
        last_action_result: null,
        last_action_error: null,
      },
      status: hasRunning ? "queued" : "pending",
      stage: hasRunning ? "queued" : "dispatch_pending",
      progress_message: hasRunning
        ? "Queued and waiting for running job to finish"
        : "Task accepted and dispatching",
      error_code: "",
      error_message: "",
      auto_cancel_reason: "",
      suggestion: "",
      recoverable: false,
      execution_report: null,
      lease,
      created_at: now,
      updated_at: now,
      terminal_at: 0,
    });
    if (!job) {
      return this.internal("Failed to create MCP job");
    }

    if (hasRunning) {
      const queued = this.jobQueue.enqueue(job.job_id);
      if (!queued.ok) {
        return this.error(
          409,
          "rejected",
          "E_JOB_CONFLICT",
          "Another Unity job is already running"
        );
      }
      this.jobRecovery.persist();
      publishJob(this, job.job_id, "job.progress");
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

    this.lockManager.acquire(job.job_id);
    publishJob(this, job.job_id, "job.progress");
    startRunningJob(this, job.job_id);
    this.jobRecovery.persist();
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
      return this.notFound("MCP adapter is disabled");
    }
    this.statusQueryCalls += 1;

    const validation = validateMcpGetUnityTaskStatus(jobId);
    if (!validation.ok) {
      return this.validationError(validation);
    }
    const job = this.jobStore.getJob(jobId);
    if (!job) {
      return this.error(404, "failed", "E_JOB_NOT_FOUND", "job_id not found");
    }
    this.touchLeaseByJobId(job.job_id, {
      source: "status_query",
      persist: false,
    });
    this.refreshJobs({ drainQueue: true });
    const current = this.jobStore.getJob(jobId) || job;
    return {
      statusCode: 200,
      body: this.buildJobStatusPayload(current),
    };
  }

  cancelUnityTask(body) {
    if (!this.enableMcpAdapter) {
      return this.notFound("MCP adapter is disabled");
    }
    this.refreshJobs({ drainQueue: true });
    const validation = validateMcpCancelUnityTask(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const jobId = String(body.job_id || "").trim();
    const job = this.jobStore.getJob(jobId);
    if (!job) {
      return this.error(404, "failed", "E_JOB_NOT_FOUND", "job_id not found");
    }
    if (isTerminalMcpStatus(job.status)) {
      return {
        statusCode: 200,
        body: this.withMcpErrorFeedback({
          status: "cancelled",
          ...this.buildJobStatusPayload(job),
          message: "Job already terminal",
        }),
      };
    }

    if (job.status === "queued") {
      this.jobQueue.remove(job.job_id);
      const finalized = finalizeJob(this, job.job_id, {
        status: "cancelled",
        stage: "cancelled",
        progress_message: "Job cancelled before execution",
      });
      return {
        statusCode: 200,
        body: this.withMcpErrorFeedback({
          status: "cancelled",
          ...(finalized ? this.buildJobStatusPayload(finalized) : {}),
        }),
      };
    }

    const finalized = finalizeJob(this, job.job_id, {
      status: "cancelled",
      stage: "cancelled",
      progress_message: "Job cancelled",
    });
    return {
      statusCode: 200,
      body: this.withMcpErrorFeedback({
        status: "cancelled",
        ...(finalized ? this.buildJobStatusPayload(finalized) : {}),
      }),
    };
  }

  heartbeat(body) {
    if (!this.enableMcpAdapter) {
      return this.notFound("MCP adapter is disabled");
    }
    const validation = validateMcpHeartbeat(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }
    const payload = body && typeof body === "object" ? body : {};
    const threadId =
      typeof payload.thread_id === "string" ? payload.thread_id.trim() : "";
    const jobId = typeof payload.job_id === "string" ? payload.job_id.trim() : "";
    const jobExists = jobId ? !!this.jobStore.getJob(jobId) : false;
    let touched = 0;
    if (jobId) {
      touched += this.touchLeaseByJobId(jobId, {
        source: "explicit_heartbeat",
        persist: false,
      });
    }
    if (threadId) {
      touched += this.touchLeaseByThreadId(threadId, {
        source: "explicit_heartbeat",
        persist: false,
      });
    }
    this.refreshJobs({ drainQueue: false });
    if (jobId && !threadId && touched === 0 && !jobExists) {
      return this.error(404, "failed", "E_JOB_NOT_FOUND", "job_id not found");
    }
    return {
      statusCode: 200,
      body: {
        ok: true,
        status: "accepted",
        touched_job_count: touched,
        thread_id: threadId,
        job_id: jobId,
        timestamp: this.nowIso(),
      },
    };
  }

  handleUnityCompileResult(body) {
    if (!this.enableMcpAdapter) {
      return this.notFound("MCP adapter is disabled");
    }
    return handleUnityCompileResult(this, body);
  }

  handleUnityActionResult(body) {
    if (!this.enableMcpAdapter) {
      return this.notFound("MCP adapter is disabled");
    }
    return handleUnityActionResult(this, body);
  }

  handleUnityRuntimePing(body) {
    if (!this.enableMcpAdapter) {
      return this.notFound("MCP adapter is disabled");
    }
    return handleUnityRuntimePing(this, body);
  }

  normalizeUnityCompileResultBody(body) {
    const source = body && typeof body === "object" ? cloneJson(body) : {};
    const payload =
      source.payload && typeof source.payload === "object" ? source.payload : null;
    if (!payload) {
      return source;
    }

    payload.success = payload.success === true;
    if (payload.duration_ms !== undefined) {
      const duration = Number(payload.duration_ms);
      payload.duration_ms =
        Number.isFinite(duration) && duration >= 0 ? Math.floor(duration) : 0;
    }
    if (!Array.isArray(payload.errors)) {
      payload.errors = [];
    }

    if (payload.success !== true) {
      const firstError =
        payload.errors.length > 0 &&
        payload.errors[0] &&
        typeof payload.errors[0] === "object"
          ? payload.errors[0]
          : null;
      const feedback = this.withMcpErrorFeedback({
        status: "failed",
        error_code:
          typeof payload.error_code === "string" && payload.error_code.trim()
            ? payload.error_code.trim()
            : firstError &&
                typeof firstError.code === "string" &&
                firstError.code.trim()
              ? firstError.code.trim()
              : "E_COMPILE_FAILED",
        message:
          typeof payload.error_message === "string" && payload.error_message.trim()
            ? payload.error_message.trim()
            : firstError &&
                typeof firstError.message === "string" &&
                firstError.message.trim()
              ? firstError.message.trim()
              : "Unity compile failed",
      });
      payload.error_code = feedback.error_code;
      payload.error_message = feedback.error_message;
      payload.suggestion = feedback.suggestion;
      payload.recoverable = feedback.recoverable;
      return source;
    }

    payload.error_code =
      typeof payload.error_code === "string" ? payload.error_code.trim() : "";
    payload.error_message =
      typeof payload.error_message === "string" ? payload.error_message : "";
    payload.suggestion =
      typeof payload.suggestion === "string" ? payload.suggestion : "";
    payload.recoverable = payload.recoverable === true;
    return source;
  }

  normalizeUnityActionResultBody(body) {
    const source = body && typeof body === "object" ? cloneJson(body) : {};
    const payload =
      source.payload && typeof source.payload === "object" ? source.payload : null;
    if (!payload) {
      return source;
    }

    if (
      (!payload.action_type || typeof payload.action_type !== "string") &&
      payload.action &&
      typeof payload.action === "object" &&
      typeof payload.action.type === "string"
    ) {
      payload.action_type = payload.action.type.trim();
    } else {
      payload.action_type =
        typeof payload.action_type === "string" ? payload.action_type.trim() : "";
    }
    payload.success = payload.success === true;

    if (payload.success !== true) {
      const feedback = this.withMcpErrorFeedback({
        status: "failed",
        error_code:
          typeof payload.error_code === "string" && payload.error_code.trim()
            ? payload.error_code.trim()
            : "E_ACTION_EXECUTION_FAILED",
        message:
          typeof payload.error_message === "string" && payload.error_message.trim()
            ? payload.error_message.trim()
            : typeof payload.message === "string" && payload.message.trim()
              ? payload.message.trim()
              : "Unity visual action failed",
      });
      payload.error_code = feedback.error_code;
      payload.error_message = feedback.error_message;
      payload.suggestion = feedback.suggestion;
      payload.recoverable = feedback.recoverable;
      return source;
    }

    payload.error_code =
      typeof payload.error_code === "string" ? payload.error_code.trim() : "";
    payload.error_message =
      typeof payload.error_message === "string" ? payload.error_message : "";
    payload.suggestion =
      typeof payload.suggestion === "string" ? payload.suggestion : "";
    payload.recoverable = payload.recoverable === true;
    return source;
  }

  normalizeUnityQueryReportBody(body) {
    const source = body && typeof body === "object" ? cloneJson(body) : {};
    if (typeof source.query_id === "string") {
      source.query_id = source.query_id.trim();
    }

    let result = null;
    if (source.result && typeof source.result === "object") {
      result = source.result;
    } else if (source.response && typeof source.response === "object") {
      result = source.response;
    } else {
      return source;
    }

    if (this.resolveUnityQueryResultSuccess(result)) {
      if (result.ok === undefined) {
        result.ok = true;
      }
      if (result.success === undefined) {
        result.success = true;
      }
      return source;
    }

    const feedback = this.withMcpErrorFeedback({
      status: "failed",
      error_code:
        typeof result.error_code === "string" && result.error_code.trim()
          ? result.error_code.trim()
          : "E_QUERY_FAILED",
      message:
        typeof result.error_message === "string" && result.error_message.trim()
          ? result.error_message.trim()
          : typeof result.message === "string" && result.message.trim()
            ? result.message.trim()
            : "Unity query failed",
    });
    result.ok = false;
    result.success = false;
    result.error_code = feedback.error_code;
    result.error_message = feedback.error_message;
    result.suggestion = feedback.suggestion;
    result.recoverable = feedback.recoverable;
    return source;
  }

  resolveUnityQueryResultSuccess(result) {
    const source = result && typeof result === "object" ? result : {};
    if (typeof source.ok === "boolean") {
      return source.ok;
    }
    if (typeof source.success === "boolean") {
      return source.success;
    }
    if (typeof source.error_code === "string" && source.error_code.trim()) {
      return false;
    }
    return true;
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
    this.refreshJobs({ drainQueue: true });
    const registration = this.streamHub.registerSubscriber({
      thread_id: options && options.thread_id,
      cursor: options && options.cursor,
      onEvent: options && options.onEvent,
      getRecoveryJobs: (threadId, limit) => this.listRecoveryJobs(threadId, limit),
    });
    if (!registration.ok) {
      return registration;
    }
    const threadId =
      options && typeof options.thread_id === "string"
        ? options.thread_id.trim()
        : "";
    if (threadId) {
      this.touchLeaseByThreadId(threadId, {
        source: "stream_subscribe",
        persist: false,
      });
    } else {
      const runningJobId = this.lockManager.getRunningJobId();
      if (runningJobId) {
        this.touchLeaseByJobId(runningJobId, {
          source: "stream_subscribe",
          persist: false,
        });
      }
    }
    return registration;
  }

  unregisterMcpStreamSubscriber(subscriberId) {
    return this.streamHub.unregisterSubscriber(subscriberId);
  }

  refreshJobs(options) {
    if (!this.enableMcpAdapter) {
      return;
    }
    this.jobLeaseJanitor.sweep(Date.now());
    this.jobRecovery.cleanupExpired(Date.now());
    this.jobRecovery.reconcileState();

    const runningJob = this.getRunningJob();
    if (runningJob && isTerminalMcpStatus(runningJob.status)) {
      const released = this.lockManager.release(runningJob.job_id);
      if (released) {
        this.recordLockRelease();
      }
    }

    const opts = options && typeof options === "object" ? options : {};
    if (opts.drainQueue === true) {
      promoteNextQueuedJob(this);
    }
  }

  getMcpMetrics() {
    const errorFeedbackMetrics = getMcpErrorFeedbackMetricsSnapshot();
    const observabilityPhase =
      OBSERVABILITY_FREEZE_CONTRACT &&
      typeof OBSERVABILITY_FREEZE_CONTRACT.phase === "string"
        ? OBSERVABILITY_FREEZE_CONTRACT.phase
        : "phase6_freeze";
    return this.streamHub.getMetricsSnapshot({
      observability_phase: observabilityPhase,
      status_query_calls: this.statusQueryCalls,
      running_job_id: this.lockManager.getRunningJobId(),
      queued_job_count: this.jobQueue.size(),
      total_job_count: this.jobStore.listJobs().length,
      auto_cleanup_enforced: true,
      lease_heartbeat_timeout_ms: this.leaseHeartbeatTimeoutMs,
      lease_max_runtime_ms: this.leaseMaxRuntimeMs,
      reboot_wait_timeout_ms: this.rebootWaitTimeoutMs,
      lease_janitor_interval_ms: this.leaseJanitorIntervalMs,
      auto_cancel_total: this.lifecycleMetrics.auto_cancel_total,
      auto_cancel_heartbeat_timeout_total:
        this.lifecycleMetrics.auto_cancel_heartbeat_timeout_total,
      auto_cancel_max_runtime_total:
        this.lifecycleMetrics.auto_cancel_max_runtime_total,
      auto_cancel_reboot_wait_timeout_total:
        this.lifecycleMetrics.auto_cancel_reboot_wait_timeout_total,
      lock_release_total: this.lifecycleMetrics.lock_release_total,
      queue_promote_total: this.lifecycleMetrics.queue_promote_total,
      error_feedback_normalized_total:
        errorFeedbackMetrics.error_feedback_normalized_total,
      error_stack_sanitized_total:
        errorFeedbackMetrics.error_stack_sanitized_total,
      error_path_sanitized_total:
        errorFeedbackMetrics.error_path_sanitized_total,
      error_message_truncated_total:
        errorFeedbackMetrics.error_message_truncated_total,
      error_fixed_suggestion_enforced_total:
        errorFeedbackMetrics.error_fixed_suggestion_enforced_total,
      error_feedback_by_code: errorFeedbackMetrics.error_feedback_by_code,
    });
  }

  getRunningJob() {
    const jobId = this.lockManager.getRunningJobId();
    if (!jobId) {
      return null;
    }
    return this.jobStore.getJob(jobId);
  }

  isRunningJob(jobId) {
    const normalizedJobId = typeof jobId === "string" ? jobId.trim() : "";
    return !!normalizedJobId && this.lockManager.getRunningJobId() === normalizedJobId;
  }

  resolveApprovalModeByRequestId(requestId) {
    const normalizedRequestId = String(requestId || "").trim();
    if (!normalizedRequestId) {
      return "require_user";
    }
    const job = this.jobStore.getJobByRequestId(normalizedRequestId);
    if (!job) {
      // Compatibility fallback for harnesses that write directly to mcpJobsById.
      for (const item of this.mcpJobsById.values()) {
        if (!item || typeof item !== "object") {
          continue;
        }
        if (
          typeof item.request_id === "string" &&
          item.request_id === normalizedRequestId
        ) {
          return normalizeApprovalMode(item.approval_mode, "auto");
        }
      }
      return "require_user";
    }
    return normalizeApprovalMode(job.approval_mode, "auto");
  }

  listRecoveryJobs(threadId, limit) {
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
    return this.jobStore
      .listJobs()
      .filter((job) => job && job.thread_id === normalizedThreadId)
      .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
      .slice(0, maxItems)
      .map((job) => this.buildJobStatusPayload(job));
  }

  touchLeaseByJobId(jobId, options) {
    const normalizedJobId = typeof jobId === "string" ? jobId.trim() : "";
    if (!normalizedJobId) {
      return 0;
    }
    const job = this.jobStore.getJob(normalizedJobId);
    if (!job || isTerminalMcpStatus(job.status)) {
      return 0;
    }
    const opts = options && typeof options === "object" ? options : {};
    const nowMs =
      Number.isFinite(Number(opts.nowMs)) && Number(opts.nowMs) > 0
        ? Math.floor(Number(opts.nowMs))
        : Date.now();
    const ownerClientId =
      typeof job.thread_id === "string" && job.thread_id.trim()
        ? job.thread_id.trim()
        : "";
    const lease = touchLease(job.lease, {
      nowMs,
      ownerClientId,
      defaultHeartbeatTimeoutMs: this.leaseHeartbeatTimeoutMs,
      defaultMaxRuntimeMs: this.leaseMaxRuntimeMs,
    });
    if (typeof opts.source === "string" && opts.source.trim()) {
      lease.last_heartbeat_source = opts.source.trim();
    }
    const updated = this.jobStore.updateJob(normalizedJobId, { lease });
    if (updated && opts.persist === true) {
      this.jobRecovery.persist();
    }
    return updated ? 1 : 0;
  }

  touchLeaseByThreadId(threadId, options) {
    const normalizedThreadId =
      typeof threadId === "string" ? threadId.trim() : "";
    if (!normalizedThreadId) {
      return 0;
    }
    const opts = options && typeof options === "object" ? options : {};
    const nowMs =
      Number.isFinite(Number(opts.nowMs)) && Number(opts.nowMs) > 0
        ? Math.floor(Number(opts.nowMs))
        : Date.now();
    let touched = 0;
    for (const job of this.jobStore.listJobs()) {
      if (!job || isTerminalMcpStatus(job.status)) {
        continue;
      }
      if (
        typeof job.thread_id !== "string" ||
        job.thread_id.trim() !== normalizedThreadId
      ) {
        continue;
      }
      const lease = touchLease(job.lease, {
        nowMs,
        ownerClientId: normalizedThreadId,
        defaultHeartbeatTimeoutMs: this.leaseHeartbeatTimeoutMs,
        defaultMaxRuntimeMs: this.leaseMaxRuntimeMs,
      });
      if (typeof opts.source === "string" && opts.source.trim()) {
        lease.last_heartbeat_source = opts.source.trim();
      }
      const updated = this.jobStore.updateJob(job.job_id, { lease });
      if (updated) {
        touched += 1;
      }
    }
    if (touched > 0 && opts.persist === true) {
      this.jobRecovery.persist();
    }
    return touched;
  }

  recordAutoCancel(reason) {
    this.lifecycleMetrics.auto_cancel_total += 1;
    const key = typeof reason === "string" ? reason.trim() : "";
    if (key === "heartbeat_timeout") {
      this.lifecycleMetrics.auto_cancel_heartbeat_timeout_total += 1;
      return;
    }
    if (key === "max_runtime_timeout") {
      this.lifecycleMetrics.auto_cancel_max_runtime_total += 1;
      return;
    }
    if (key === "reboot_wait_timeout") {
      this.lifecycleMetrics.auto_cancel_reboot_wait_timeout_total += 1;
    }
  }

  recordLockRelease() {
    this.lifecycleMetrics.lock_release_total += 1;
  }

  recordQueuePromote() {
    this.lifecycleMetrics.queue_promote_total += 1;
  }

  sweepLeaseJanitor(nowMs) {
    return this.jobLeaseJanitor.sweep(nowMs);
  }

  buildJobStatusPayload(job) {
    const item = job && typeof job === "object" ? job : {};
    const runtime =
      item.runtime && typeof item.runtime === "object" ? item.runtime : null;
    const visualActions =
      runtime && Array.isArray(runtime.visual_actions) ? runtime.visual_actions : [];
    const nextVisualIndex =
      runtime &&
      Number.isFinite(Number(runtime.next_visual_index)) &&
      Number(runtime.next_visual_index) >= 0
        ? Math.floor(Number(runtime.next_visual_index))
        : 0;
    const pendingVisualAction =
      visualActions[nextVisualIndex] &&
      typeof visualActions[nextVisualIndex] === "object"
        ? cloneJson(visualActions[nextVisualIndex])
        : null;
    const pendingVisualActionCount = pendingVisualAction
      ? Math.max(visualActions.length - nextVisualIndex, 0)
      : 0;
    const unityActionRequest =
      runtime &&
      runtime.last_action_request &&
      typeof runtime.last_action_request === "object"
        ? cloneJson(runtime.last_action_request)
        : null;
    const lease = normalizeLease(item.lease, {
      ownerClientId: item.thread_id || "",
      nowMs:
        Number.isFinite(Number(item.updated_at)) && Number(item.updated_at) > 0
          ? Number(item.updated_at)
          : Date.now(),
      defaultHeartbeatTimeoutMs: this.leaseHeartbeatTimeoutMs,
      defaultMaxRuntimeMs: this.leaseMaxRuntimeMs,
    });

    return {
      job_id: item.job_id || "",
      thread_id: item.thread_id || "",
      status: item.status || "pending",
      stage: item.stage || "",
      progress_message: item.progress_message || "",
      error_code: item.error_code || "",
      error_message: item.error_message || "",
      auto_cancel_reason: item.auto_cancel_reason || "",
      suggestion: item.suggestion || "",
      recoverable: item.recoverable === true,
      lease_state: lease.state || "",
      lease_owner_client_id: lease.owner_client_id || "",
      lease_last_heartbeat_at: toIsoTimestamp(lease.last_heartbeat_at),
      lease_heartbeat_timeout_ms: lease.heartbeat_timeout_ms,
      lease_max_runtime_ms: lease.max_runtime_ms,
      lease_orphaned: lease.orphaned === true,
      request_id: item.request_id || "",
      running_job_id: this.lockManager.getRunningJobId(),
      execution_report:
        item.execution_report && typeof item.execution_report === "object"
          ? cloneJson(item.execution_report)
          : null,
      pending_visual_action_count: pendingVisualActionCount,
      pending_visual_action: pendingVisualAction,
      unity_action_request: unityActionRequest,
      approval_mode: item.approval_mode || "auto",
      created_at:
        Number.isFinite(Number(item.created_at)) && Number(item.created_at) > 0
          ? new Date(Number(item.created_at)).toISOString()
          : this.nowIso(),
      updated_at:
        Number.isFinite(Number(item.updated_at)) && Number(item.updated_at) > 0
          ? new Date(Number(item.updated_at)).toISOString()
          : this.nowIso(),
    };
  }

  validationError(validation) {
    return validationError(validation);
  }

  validateWriteReadToken(tokenValue) {
    if (
      !this.unitySnapshotService ||
      typeof this.unitySnapshotService.validateReadTokenForWrite !== "function"
    ) {
      return {
        ok: false,
        outcome: this.error(
          500,
          "failed",
          "E_INTERNAL",
          "OCC read token validator is not configured"
        ),
      };
    }

    const validation = this.unitySnapshotService.validateReadTokenForWrite(tokenValue);
    if (validation && validation.ok === true) {
      return {
        ok: true,
      };
    }

    return {
      ok: false,
      outcome: {
        statusCode:
          Number.isFinite(Number(validation && validation.statusCode)) &&
          Number(validation.statusCode) > 0
            ? Math.floor(Number(validation.statusCode))
            : 409,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code:
            validation && validation.error_code
              ? validation.error_code
              : "E_STALE_SNAPSHOT",
          message:
            validation && validation.message
              ? validation.message
              : "Read token validation failed",
          suggestion:
            validation && validation.suggestion
              ? validation.suggestion
              : OCC_STALE_SNAPSHOT_SUGGESTION,
        }),
      },
    };
  }

  notFound(message) {
    return this.error(404, "rejected", "E_NOT_FOUND", message);
  }

  internal(message) {
    return this.error(500, "failed", "E_INTERNAL", message);
  }

  error(statusCode, status, errorCode, message) {
    return {
      statusCode,
      body: this.withMcpErrorFeedback({
        status,
        error_code: errorCode,
        message,
      }),
    };
  }

  withMcpErrorFeedback(body) {
    return withMcpErrorFeedback(body);
  }
}

module.exports = {
  McpGateway,
};

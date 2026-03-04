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
const {
  LEGACY_ANCHOR_MIGRATION_CONTRACT,
} = require("../../ports/contracts");
const { McpStreamHub } = require("./mcpStreamHub");
const {
  withMcpErrorFeedback,
  validationError,
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
const {
  normalizeUnityCompileResultBody,
  normalizeUnityActionResultBody,
  normalizeUnityQueryReportBody,
  resolveUnityQueryResultSuccess,
} = require("./unityReportNormalizer");
const {
  listRecoveryJobs,
  touchLeaseByJobId,
  touchLeaseByThreadId,
  sweepLeaseJanitor,
} = require("./leaseFacade");
const {
  getMcpMetrics,
  buildJobStatusPayload,
} = require("./metricsView");

const MCP_JOB_TTL_MS = 24 * 60 * 60 * 1000;
const MCP_MAX_QUEUE = 1;
const MCP_STREAM_MAX_EVENTS = 500;
const MCP_STREAM_MAX_SUBSCRIBERS = 32;
const MCP_STREAM_RECOVERY_JOBS_MAX = 20;
const LEGACY_ANCHOR_DAYS_IN_MS = 24 * 60 * 60 * 1000;

class McpGateway {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.enableMcpAdapter = opts.enableMcpAdapter === true;
    this.resolveUnityConnectionState =
      typeof opts.resolveUnityConnectionState === "function"
        ? opts.resolveUnityConnectionState
        : null;
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
    this.legacyAnchorModeRequested = this.normalizeLegacyAnchorMode(
      opts.legacyAnchorMode
    );
    this.legacyAnchorDenySignoff = opts.legacyAnchorDenySignoff === true;
    this.legacyAnchorDenyRequiredDays =
      Number.isFinite(Number(opts.legacyAnchorDenyRequiredDays)) &&
      Number(opts.legacyAnchorDenyRequiredDays) >= 0
        ? Math.floor(Number(opts.legacyAnchorDenyRequiredDays))
        : Number.isFinite(
            Number(
              LEGACY_ANCHOR_MIGRATION_CONTRACT &&
                LEGACY_ANCHOR_MIGRATION_CONTRACT.deny_switch_gate &&
                LEGACY_ANCHOR_MIGRATION_CONTRACT.deny_switch_gate
                  .required_zero_hit_days
            )
          )
          ? Math.floor(
              Number(
                LEGACY_ANCHOR_MIGRATION_CONTRACT.deny_switch_gate
                  .required_zero_hit_days
              )
            )
          : 7;
    this.legacyAnchorModeMetrics = {
      warn_hits_total: 0,
      warn_hits_by_action: {},
      last_hit_at: "",
      last_hit_at_ms: 0,
      requested_deny_blocked_total: 0,
    };
    this.actionErrorCodeMissingTotal = 0;
    this.v1PolishMetricsCollector =
      opts.v1PolishMetricsCollector &&
      typeof opts.v1PolishMetricsCollector === "object"
        ? opts.v1PolishMetricsCollector
        : null;
    this.getCaptureCompositeMetricsSnapshot =
      typeof opts.getCaptureCompositeMetricsSnapshot === "function"
        ? opts.getCaptureCompositeMetricsSnapshot
        : null;
    this.getProtocolGovernanceMetricsSnapshot =
      typeof opts.getProtocolGovernanceMetricsSnapshot === "function"
        ? opts.getProtocolGovernanceMetricsSnapshot
        : null;
    this.legacyAnchorGateObservedSinceMs = Date.now();

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
    const legacyAnchorGateSnapshot = this.getLegacyAnchorGateSnapshot();
    this.legacyAnchorModeEffective =
      this.legacyAnchorModeRequested === "deny" &&
      !legacyAnchorGateSnapshot.ready
        ? "warn"
        : this.legacyAnchorModeRequested;
    if (
      this.legacyAnchorModeRequested === "deny" &&
      this.legacyAnchorModeEffective !== "deny"
    ) {
      this.legacyAnchorModeMetrics.requested_deny_blocked_total += 1;
    }
    this.unityDispatcher = new UnityDispatcher({
      nowIso: this.nowIso,
      fileActionExecutor: opts.fileActionExecutor || null,
      legacyAnchorMode: this.legacyAnchorModeEffective,
      onLegacyAnchorFallback: (entry) => this.recordLegacyAnchorFallback(entry),
    });

    this.statusQueryCalls = 0;
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

    const readiness = this.isUnityReadyForWrite();
    if (!readiness.ok) {
      return this.buildUnityNotReadyWriteOutcome(readiness.state);
    }

    const payload = body;
    const tokenValidation = this.validateWriteReadToken(payload.based_on_read_token);
    if (!tokenValidation.ok) {
      return tokenValidation.outcome;
    }

    const validation = validateMcpSubmitUnityTask(payload);
    if (!validation.ok) {
      return this.validationError(validation, {
        requestBody: payload,
        toolName: "submit_unity_task",
      });
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
    return normalizeUnityCompileResultBody(this, body);
  }

  normalizeUnityActionResultBody(body) {
    return normalizeUnityActionResultBody(this, body);
  }

  normalizeUnityQueryReportBody(body) {
    return normalizeUnityQueryReportBody(this, body);
  }

  resolveUnityQueryResultSuccess(result) {
    return resolveUnityQueryResultSuccess(result);
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
    return getMcpMetrics(this);
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
      return "require_user";
    }
    return normalizeApprovalMode(job.approval_mode, "auto");
  }

  listRecoveryJobs(threadId, limit) {
    return listRecoveryJobs(this, threadId, limit, MCP_STREAM_RECOVERY_JOBS_MAX);
  }

  touchLeaseByJobId(jobId, options) {
    return touchLeaseByJobId(this, jobId, options);
  }

  touchLeaseByThreadId(threadId, options) {
    return touchLeaseByThreadId(this, threadId, options);
  }

  normalizeLegacyAnchorMode(value) {
    return value === "deny" ? "deny" : "warn";
  }

  getLegacyAnchorGateSnapshot() {
    const nowMs = Date.now();
    const requiredDays =
      Number.isFinite(Number(this.legacyAnchorDenyRequiredDays)) &&
      Number(this.legacyAnchorDenyRequiredDays) >= 0
        ? Math.floor(Number(this.legacyAnchorDenyRequiredDays))
        : 7;
    const requiredWindowMs = requiredDays * LEGACY_ANCHOR_DAYS_IN_MS;
    const windowStartMs =
      Number.isFinite(Number(this.legacyAnchorModeMetrics.last_hit_at_ms)) &&
      Number(this.legacyAnchorModeMetrics.last_hit_at_ms) > 0
        ? Math.floor(Number(this.legacyAnchorModeMetrics.last_hit_at_ms))
        : Number.isFinite(Number(this.legacyAnchorGateObservedSinceMs)) &&
            Number(this.legacyAnchorGateObservedSinceMs) > 0
          ? Math.floor(Number(this.legacyAnchorGateObservedSinceMs))
          : nowMs;
    const zeroHitWindowMs = Math.max(0, nowMs - windowStartMs);
    const zeroHitWindowDays = Math.floor(zeroHitWindowMs / LEGACY_ANCHOR_DAYS_IN_MS);
    return {
      requiredDays,
      requiredWindowMs,
      zeroHitWindowDays,
      ready:
        this.legacyAnchorDenySignoff === true && zeroHitWindowMs >= requiredWindowMs,
    };
  }

  recordLegacyAnchorFallback(entry) {
    const item = entry && typeof entry === "object" ? entry : {};
    const actionType =
      typeof item.action_type === "string" && item.action_type.trim()
        ? item.action_type.trim()
        : "unknown";
    this.legacyAnchorModeMetrics.warn_hits_total += 1;
    this.legacyAnchorModeMetrics.warn_hits_by_action[actionType] =
      (this.legacyAnchorModeMetrics.warn_hits_by_action[actionType] || 0) + 1;
    const now = this.nowIso();
    this.legacyAnchorModeMetrics.last_hit_at = now;
    this.legacyAnchorModeMetrics.last_hit_at_ms = Date.now();
  }

  recordActionErrorCodeMissing() {
    this.actionErrorCodeMissingTotal += 1;
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

  recordReadTokenValidation(input) {
    if (
      this.v1PolishMetricsCollector &&
      typeof this.v1PolishMetricsCollector.recordReadTokenValidation === "function"
    ) {
      this.v1PolishMetricsCollector.recordReadTokenValidation(input);
    }
  }

  recordWriteJobFinalized(input) {
    if (
      this.v1PolishMetricsCollector &&
      typeof this.v1PolishMetricsCollector.recordWriteJobFinalized === "function"
    ) {
      this.v1PolishMetricsCollector.recordWriteJobFinalized(input);
    }
  }

  getV1PolishMetricsSnapshot() {
    if (
      this.v1PolishMetricsCollector &&
      typeof this.v1PolishMetricsCollector.getSnapshot === "function"
    ) {
      return this.v1PolishMetricsCollector.getSnapshot();
    }
    return null;
  }

  sweepLeaseJanitor(nowMs) {
    return sweepLeaseJanitor(this, nowMs);
  }

  buildJobStatusPayload(job) {
    return buildJobStatusPayload(this, job);
  }

  validationError(validation, options) {
    return validationError(validation, options);
  }

  getUnityConnectionState() {
    if (!this.resolveUnityConnectionState) {
      return "";
    }
    const stateRaw = this.resolveUnityConnectionState();
    const state =
      typeof stateRaw === "string" ? stateRaw.trim().toLowerCase() : "";
    if (
      state === "offline" ||
      state === "connecting" ||
      state === "ready" ||
      state === "stale"
    ) {
      return state;
    }
    return "";
  }

  isUnityReadyForWrite() {
    const state = this.getUnityConnectionState();
    if (!state) {
      return {
        ok: true,
        state: "",
      };
    }
    return {
      ok: state === "ready",
      state,
    };
  }

  buildUnityNotReadyWriteOutcome(state) {
    const normalizedState =
      typeof state === "string" && state.trim() ? state.trim().toLowerCase() : "";
    const suffix = normalizedState ? ` Current state: ${normalizedState}.` : "";
    return {
      statusCode: 503,
      body: this.withMcpErrorFeedback({
        status: "rejected",
        error_code: "E_UNITY_NOT_CONNECTED",
        message:
          "Unity Editor connection is not ready for write operations." + suffix,
        unity_connection_state: normalizedState || "unknown",
      }),
    };
  }

  validateWriteReadToken(tokenValue) {
    if (
      !this.unitySnapshotService ||
      typeof this.unitySnapshotService.validateReadTokenForWrite !== "function"
    ) {
      this.recordReadTokenValidation({
        ok: false,
        source: "mcp_gateway",
        error_code: "E_INTERNAL",
        message: "OCC read token validator is not configured",
      });
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
      this.recordReadTokenValidation({
        ok: true,
        source: "mcp_gateway",
        error_code: "",
        message: "",
      });
      return {
        ok: true,
      };
    }

    this.recordReadTokenValidation({
      ok: false,
      source: "mcp_gateway",
      error_code:
        validation && validation.error_code
          ? validation.error_code
          : "E_STALE_SNAPSHOT",
      message:
        validation && validation.message
          ? validation.message
          : "Read token validation failed",
    });

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

"use strict";

const { cloneJson, isTerminalMcpStatus } = require("../../utils/turnUtils");

function startRunningJob(gateway, jobId) {
  const job = gateway.jobStore.getJob(jobId);
  if (!job || job.status !== "pending") {
    return;
  }
  const transition = gateway.unityDispatcher.start(job);
  applyDispatcherTransition(gateway, jobId, transition, {
    suppressErrorBody: true,
  });
}

function applyDispatcherTransition(gateway, jobId, transition, options) {
  const t = transition && typeof transition === "object" ? transition : {};
  const opts = options && typeof options === "object" ? options : {};
  if (t.kind === "invalid" || t.kind === "mismatch") {
    return {
      statusCode:
        Number.isFinite(Number(t.statusCode)) && Number(t.statusCode) > 0
          ? Math.floor(Number(t.statusCode))
          : 409,
      body: {
        ...gateway.withMcpErrorFeedback({
          status: "failed",
          error_code: t.error_code || "E_PHASE_INVALID",
          message: t.message || "State transition rejected",
        }),
        ...(t.expected ? { expected: t.expected } : {}),
        ...(t.actual ? { actual: t.actual } : {}),
        ...(Array.isArray(t.diff) ? { diff: t.diff } : {}),
      },
    };
  }

  if (t.kind === "waiting_compile") {
    const updated = updateJob(gateway, jobId, {
      status: "pending",
      stage: "compile_pending",
      progress_message: "File actions applied. Waiting for compile result.",
      error_code: "",
      error_message: "",
      suggestion: "",
      recoverable: false,
      runtime: t.runtime,
    });
    publishJob(gateway, jobId, "job.progress");
    return {
      statusCode: 200,
      body: {
        ...(opts.successExtras || {}),
        ...(updated ? gateway.buildJobStatusPayload(updated) : {}),
        compile_request: t.compile_request || null,
        files_changed: Array.isArray(t.files_changed) ? t.files_changed : [],
      },
    };
  }

  if (t.kind === "waiting_action") {
    const updated = updateJob(gateway, jobId, {
      status: "pending",
      stage: "action_pending",
      progress_message: "Waiting for Unity action result.",
      error_code: "",
      error_message: "",
      suggestion: "",
      recoverable: false,
      runtime: t.runtime,
    });
    publishJob(gateway, jobId, "job.progress");
    return {
      statusCode: 200,
      body: {
        ...(opts.successExtras || {}),
        ...(updated ? gateway.buildJobStatusPayload(updated) : {}),
        unity_action_request: t.unity_action_request || null,
      },
    };
  }

  if (t.kind === "suspended") {
    const suspended = gateway.withMcpErrorFeedback({
      status: "pending",
      error_code: t.error_code || "WAITING_FOR_UNITY_REBOOT",
      message:
        t.error_message ||
        "Unity reported domain reload in progress. Waiting for unity.runtime.ping.",
    });
    const updated = updateJob(gateway, jobId, {
      status: "pending",
      stage: "WAITING_FOR_UNITY_REBOOT",
      progress_message: suspended.error_message,
      error_code: suspended.error_code,
      error_message: suspended.error_message,
      suggestion: suspended.suggestion,
      recoverable: suspended.recoverable,
      runtime: t.runtime,
    });
    publishJob(gateway, jobId, "job.progress");
    return {
      statusCode: 202,
      body: {
        ...(updated ? gateway.buildJobStatusPayload(updated) : {}),
        ok: true,
        recoverable: true,
        waiting_for_unity_reboot: true,
        error_code: suspended.error_code,
        error_message: suspended.error_message,
        suggestion: suspended.suggestion,
      },
    };
  }

  if (t.kind === "completed") {
    const finalized = finalizeJob(gateway, jobId, {
      status: "succeeded",
      stage: "completed",
      progress_message: "Job completed",
      execution_report: t.execution_report || null,
      runtime: t.runtime,
    });
    return {
      statusCode: 200,
      body: {
        ...(opts.successExtras || {}),
        ...(finalized ? gateway.buildJobStatusPayload(finalized) : {}),
        ok: true,
      },
    };
  }

  if (t.kind === "failed") {
    const failure = gateway.withMcpErrorFeedback({
      status: "failed",
      error_code: t.error_code || "E_INTERNAL",
      error_message: t.error_message || "Job failed",
    });
    const finalized = finalizeJob(gateway, jobId, {
      status: "failed",
      stage: "failed",
      progress_message: failure.error_message,
      error_code: failure.error_code,
      error_message: failure.error_message,
      suggestion: failure.suggestion,
      recoverable: failure.recoverable,
      execution_report: t.execution_report || null,
      runtime: t.runtime,
    });
    return {
      statusCode: opts.suppressErrorBody === true ? 200 : 500,
      body:
        opts.suppressErrorBody === true
          ? {
              ...(finalized ? gateway.buildJobStatusPayload(finalized) : {}),
              ok: false,
            }
          : gateway.withMcpErrorFeedback({
              status: "failed",
              ...(finalized ? gateway.buildJobStatusPayload(finalized) : {}),
            }),
    };
  }

  return {
    statusCode: 200,
    body: {
      ...(opts.successExtras || {}),
    },
  };
}

function finalizeJob(gateway, jobId, patch) {
  const job = gateway.jobStore.getJob(jobId);
  if (!job) {
    return null;
  }
  if (gateway.jobQueue && typeof gateway.jobQueue.remove === "function") {
    gateway.jobQueue.remove(jobId);
  }
  if (isTerminalMcpStatus(job.status)) {
    return job;
  }
  const now = Date.now();
  const merged = {
    status: patch && patch.status ? patch.status : job.status,
    stage: patch && patch.stage ? patch.stage : job.stage,
    progress_message:
      patch && patch.progress_message ? patch.progress_message : job.progress_message,
    error_code: patch && typeof patch.error_code === "string" ? patch.error_code : "",
    error_message:
      patch && typeof patch.error_message === "string" ? patch.error_message : "",
    auto_cancel_reason:
      patch && typeof patch.auto_cancel_reason === "string"
        ? patch.auto_cancel_reason
        : typeof job.auto_cancel_reason === "string"
          ? job.auto_cancel_reason
          : "",
    suggestion: patch && typeof patch.suggestion === "string" ? patch.suggestion : "",
    recoverable: patch && patch.recoverable === true,
    execution_report:
      patch && patch.execution_report && typeof patch.execution_report === "object"
        ? cloneJson(patch.execution_report)
        : job.execution_report,
    runtime:
      patch && patch.runtime && typeof patch.runtime === "object"
        ? cloneJson(patch.runtime)
        : job.runtime,
    lease:
      patch && patch.lease && typeof patch.lease === "object"
        ? cloneJson(patch.lease)
        : job.lease,
    terminal_at: now,
    updated_at: now,
  };
  const updated = gateway.jobStore.updateJob(jobId, merged);
  const released = gateway.lockManager.release(jobId);
  if (released && typeof gateway.recordLockRelease === "function") {
    gateway.recordLockRelease();
  }
  publishJob(gateway, jobId, "job.completed");
  gateway.jobRecovery.persist();
  promoteNextQueuedJob(gateway);
  return updated;
}

function updateJob(gateway, jobId, patch) {
  const now = Date.now();
  const normalizedPatch = {
    ...(patch && typeof patch === "object" ? patch : {}),
    updated_at: now,
  };
  const updated = gateway.jobStore.updateJob(jobId, normalizedPatch);
  if (updated) {
    gateway.jobRecovery.persist();
  }
  return updated;
}

function publishJob(gateway, jobId, eventName) {
  const job = gateway.jobStore.getJob(jobId);
  if (!job) {
    return null;
  }
  return gateway.streamHub.publishJobEvent(
    eventName,
    gateway.buildJobStatusPayload(job)
  );
}

function promoteNextQueuedJob(gateway) {
  if (gateway.lockManager.hasRunningJob()) {
    return "";
  }
  while (gateway.jobQueue.size() > 0) {
    const nextJobId = gateway.jobQueue.dequeue();
    const nextJob = gateway.jobStore.getJob(nextJobId);
    if (!nextJob || nextJob.status !== "queued") {
      continue;
    }
    gateway.lockManager.acquire(nextJob.job_id);
    if (typeof gateway.recordQueuePromote === "function") {
      gateway.recordQueuePromote();
    }
    updateJob(gateway, nextJob.job_id, {
      status: "pending",
      stage: "dispatch_pending",
      progress_message: "Task accepted and dispatching",
      error_code: "",
      error_message: "",
      suggestion: "",
      recoverable: false,
    });
    publishJob(gateway, nextJob.job_id, "job.progress");
    startRunningJob(gateway, nextJob.job_id);
    gateway.jobRecovery.persist();
    return nextJob.job_id;
  }
  return "";
}

module.exports = {
  startRunningJob,
  applyDispatcherTransition,
  finalizeJob,
  updateJob,
  publishJob,
  promoteNextQueuedJob,
};

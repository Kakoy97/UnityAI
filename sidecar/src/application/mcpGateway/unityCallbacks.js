"use strict";

const {
  validateUnityCompileResult,
  validateUnityActionResult,
  validateUnityRuntimePing,
} = require("../../domain/validators");
const { isTerminalMcpStatus } = require("../../utils/turnUtils");
const {
  applyDispatcherTransition,
  updateJob,
  publishJob,
} = require("./jobLifecycle");

function handleUnityCompileResult(gateway, body) {
  gateway.refreshJobs({ drainQueue: true });
  const normalizedBody =
    gateway && typeof gateway.normalizeUnityCompileResultBody === "function"
      ? gateway.normalizeUnityCompileResultBody(body)
      : body;
  const validation = validateUnityCompileResult(normalizedBody);
  if (!validation.ok) {
    return gateway.validationError(validation);
  }

  const requestId = String(
    normalizedBody && normalizedBody.request_id ? normalizedBody.request_id : ""
  ).trim();
  const job = gateway.jobStore.getJobByRequestId(requestId);
  if (!job) {
    return gateway.error(404, "failed", "E_REQUEST_NOT_FOUND", "request_id not found");
  }
  if (isTerminalMcpStatus(job.status)) {
    return {
      statusCode: 200,
      body: {
        ok: true,
        replay: true,
        ...gateway.buildJobStatusPayload(job),
      },
    };
  }
  if (!gateway.isRunningJob(job.job_id)) {
    return gateway.error(409, "failed", "E_PHASE_INVALID", "job is not active");
  }
  gateway.touchLeaseByJobId(job.job_id, {
    source: "unity_compile_result",
    persist: false,
  });

  const transition = gateway.unityDispatcher.handleCompileResult(job, normalizedBody);
  return applyDispatcherTransition(gateway, job.job_id, transition, {
    successExtras: {
      ok: true,
      compile_success:
        normalizedBody &&
        normalizedBody.payload &&
        normalizedBody.payload.success === true,
    },
  });
}

function handleUnityActionResult(gateway, body) {
  gateway.refreshJobs({ drainQueue: true });
  const normalizedBody =
    gateway && typeof gateway.normalizeUnityActionResultBody === "function"
      ? gateway.normalizeUnityActionResultBody(body)
      : body;
  const validation = validateUnityActionResult(normalizedBody);
  if (!validation.ok) {
    return gateway.validationError(validation);
  }

  const requestId = String(
    normalizedBody && normalizedBody.request_id ? normalizedBody.request_id : ""
  ).trim();
  const job = gateway.jobStore.getJobByRequestId(requestId);
  if (!job) {
    return gateway.error(404, "failed", "E_REQUEST_NOT_FOUND", "request_id not found");
  }
  if (isTerminalMcpStatus(job.status)) {
    return {
      statusCode: 200,
      body: {
        ok: true,
        replay: true,
        ...gateway.buildJobStatusPayload(job),
      },
    };
  }
  if (!gateway.isRunningJob(job.job_id)) {
    return gateway.error(409, "failed", "E_PHASE_INVALID", "job is not active");
  }
  gateway.touchLeaseByJobId(job.job_id, {
    source: "unity_action_result",
    persist: false,
  });

  const transition = gateway.unityDispatcher.handleActionResult(job, normalizedBody);
  return applyDispatcherTransition(gateway, job.job_id, transition, {
    successExtras: {
      ok: true,
      action_success:
        normalizedBody &&
        normalizedBody.payload &&
        normalizedBody.payload.success === true,
    },
  });
}

function handleUnityRuntimePing(gateway, body) {
  gateway.refreshJobs({ drainQueue: true });
  const validation = validateUnityRuntimePing(body);
  if (!validation.ok) {
    return gateway.validationError(validation);
  }
  const threadId =
    body && typeof body.thread_id === "string" ? body.thread_id.trim() : "";
  if (threadId) {
    gateway.touchLeaseByThreadId(threadId, {
      source: "unity_runtime_ping",
      persist: false,
    });
  }

  const runningJob = gateway.getRunningJob();
  if (!runningJob) {
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
  gateway.touchLeaseByJobId(runningJob.job_id, {
    source: "unity_runtime_ping",
    persist: false,
  });

  const transition = gateway.unityDispatcher.handleRuntimePing(runningJob, body);
  if (transition.kind !== "waiting_action") {
    return {
      statusCode: 200,
      body: {
        ok: true,
        event: "unity.runtime.pong",
        recovered: false,
        message: "No visual recovery action pending",
        ...gateway.buildJobStatusPayload(runningJob),
      },
    };
  }

  const updated = updateJob(gateway, runningJob.job_id, {
    status: "pending",
    stage: "action_pending",
    progress_message: "Unity runtime recovered. Resuming pending visual action.",
    error_code: "",
    error_message: "",
    suggestion: "",
    recoverable: false,
    runtime: transition.runtime,
  });
  publishJob(gateway, runningJob.job_id, "job.progress");
  return {
    statusCode: 200,
    body: {
      ok: true,
      event: "unity.runtime.pong",
      recovered: true,
      ...(updated ? gateway.buildJobStatusPayload(updated) : {}),
      unity_action_request: transition.unity_action_request || null,
    },
  };
}

module.exports = {
  handleUnityCompileResult,
  handleUnityActionResult,
  handleUnityRuntimePing,
};

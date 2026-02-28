"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { finalizeJob } = require("../../src/application/mcpGateway/jobLifecycle");
const { JobStore } = require("../../src/application/jobRuntime/jobStore");
const { JobQueue } = require("../../src/application/jobRuntime/jobQueue");
const { LockManager } = require("../../src/application/jobRuntime/lockManager");

function createLifecycleHarness() {
  const jobStore = new JobStore();
  const jobQueue = new JobQueue(2);
  const lockManager = new LockManager();
  const metrics = {
    publish: 0,
    persist: 0,
    lockRelease: 0,
    queuePromote: 0,
  };
  const gateway = {
    jobStore,
    jobQueue,
    lockManager,
    streamHub: {
      publishJobEvent() {
        metrics.publish += 1;
        return true;
      },
    },
    buildJobStatusPayload(job) {
      return job;
    },
    jobRecovery: {
      persist() {
        metrics.persist += 1;
      },
    },
    recordLockRelease() {
      metrics.lockRelease += 1;
    },
    recordQueuePromote() {
      metrics.queuePromote += 1;
    },
    unityDispatcher: {
      start() {
        return {
          kind: "noop",
        };
      },
    },
    withMcpErrorFeedback(body) {
      return body;
    },
  };
  return {
    gateway,
    metrics,
  };
}

function upsertJob(jobStore, overrides) {
  const nowMs = Date.now();
  const patch = overrides && typeof overrides === "object" ? overrides : {};
  return jobStore.upsertJob({
    job_id: patch.job_id || "job_lifecycle_default",
    idempotency_key: patch.idempotency_key || `idem_${patch.job_id || "default"}`,
    approval_mode: "auto",
    user_intent: "",
    thread_id: patch.thread_id || "thread_lifecycle",
    based_on_read_token: "",
    request_id: patch.request_id || `req_${patch.job_id || "default"}`,
    turn_id: patch.turn_id || `turn_${patch.job_id || "default"}`,
    context: null,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    runtime: null,
    status: patch.status || "pending",
    stage: patch.stage || "dispatch_pending",
    progress_message: patch.progress_message || "",
    error_code: "",
    error_message: "",
    auto_cancel_reason: "",
    suggestion: "",
    recoverable: false,
    execution_report: null,
    lease: null,
    created_at: nowMs,
    updated_at: nowMs,
    terminal_at: 0,
  });
}

test("finalizeJob is idempotent for terminal jobs", () => {
  const { gateway, metrics } = createLifecycleHarness();
  const jobId = "job_lifecycle_idempotent";
  upsertJob(gateway.jobStore, {
    job_id: jobId,
    status: "pending",
    stage: "dispatch_pending",
  });
  gateway.lockManager.acquire(jobId);

  const first = finalizeJob(gateway, jobId, {
    status: "cancelled",
    stage: "cancelled",
    progress_message: "cancelled once",
  });
  assert.ok(first);
  assert.equal(first.status, "cancelled");
  const terminalAt = first.terminal_at;
  assert.ok(terminalAt > 0);
  assert.equal(metrics.lockRelease, 1);
  assert.equal(metrics.publish, 1);
  assert.equal(metrics.persist, 1);

  const second = finalizeJob(gateway, jobId, {
    status: "cancelled",
    stage: "cancelled",
    progress_message: "cancelled twice",
  });
  assert.ok(second);
  assert.equal(second.status, "cancelled");
  assert.equal(second.terminal_at, terminalAt);
  assert.equal(metrics.lockRelease, 1);
  assert.equal(metrics.publish, 1);
  assert.equal(metrics.persist, 1);
});

test("finalizeJob removes queued job from queue before terminal write", () => {
  const { gateway, metrics } = createLifecycleHarness();
  const queuedJobId = "job_lifecycle_queued";
  upsertJob(gateway.jobStore, {
    job_id: queuedJobId,
    status: "queued",
    stage: "queued",
  });
  const enqueue = gateway.jobQueue.enqueue(queuedJobId);
  assert.equal(enqueue.ok, true);
  assert.equal(gateway.jobQueue.size(), 1);

  const finalized = finalizeJob(gateway, queuedJobId, {
    status: "cancelled",
    stage: "cancelled",
    progress_message: "queued cancelled",
  });
  assert.ok(finalized);
  assert.equal(finalized.status, "cancelled");
  assert.equal(gateway.jobQueue.size(), 0);
  assert.equal(metrics.lockRelease, 0);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");

function createService() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
    turnStore,
    nowIso: () => new Date().toISOString(),
    enableMcpAdapter: true,
    enableMcpEyes: true,
    mcpLeaseJanitorIntervalMs: 60 * 60 * 1000,
    mcpLeaseHeartbeatTimeoutMs: 60 * 1000,
    mcpLeaseMaxRuntimeMs: 5 * 60 * 1000,
    mcpRebootWaitTimeoutMs: 3 * 60 * 1000,
    fileActionExecutor: {
      execute(actions) {
        return {
          ok: true,
          changes: Array.isArray(actions) ? actions : [],
        };
      },
    },
  });
  return {
    service,
    dispose() {
      turnStore.stopMaintenance();
      if (
        service &&
        service.mcpGateway &&
        service.mcpGateway.jobLeaseJanitor &&
        typeof service.mcpGateway.jobLeaseJanitor.stop === "function"
      ) {
        service.mcpGateway.jobLeaseJanitor.stop();
      }
    },
  };
}

function seedSelectionSnapshot(service, sceneRevision) {
  service.recordLatestSelectionContext(
    {
      scene_revision: sceneRevision,
      selection: {
        mode: "selection",
        object_id: "go_root",
        target_object_path: "Scene/Root",
      },
      selection_tree: {
        max_depth: 2,
        truncated_node_count: 0,
        truncated_reason: "",
        root: {
          name: "Root",
          object_id: "go_root",
          path: "Scene/Root",
          depth: 0,
          active: true,
          prefab_path: "",
          components: [
            {
              short_name: "Transform",
              assembly_qualified_name:
                "UnityEngine.Transform, UnityEngine.CoreModule",
            },
          ],
          children: [],
          children_truncated_count: 0,
        },
      },
    },
    {
      source: "job-lease-janitor-test",
      requestId: "req_seed",
      threadId: "thread_seed",
      turnId: "turn_seed",
    }
  );
}

function issueReadToken(service) {
  const outcome = service.getCurrentSelectionForMcp();
  assert.equal(outcome.statusCode, 200);
  assert.ok(outcome.body && outcome.body.read_token);
  return outcome.body.read_token.token;
}

function submitJob(service, token, idSuffix, threadId) {
  const outcome = service.submitUnityTask({
    thread_id: threadId,
    idempotency_key: `idem_${idSuffix}`,
    user_intent: "janitor test submit",
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    file_actions: [
      {
        type: "delete_file",
        path: "Assets/Scripts/AIGenerated/JanitorTest.cs",
      },
    ],
  });
  assert.equal(outcome.statusCode, 202);
  assert.ok(outcome.body && outcome.body.job_id);
  return outcome.body.job_id;
}

test("janitor auto-cancels on heartbeat timeout", () => {
  const { service, dispose } = createService();
  try {
    seedSelectionSnapshot(service, "scene_rev_lease_hb");
    const token = issueReadToken(service);
    const jobId = submitJob(service, token, "hb_timeout", "thread_hb");
    const nowMs = Date.now();
    const job = service.mcpGateway.jobStore.getJob(jobId);
    service.mcpGateway.jobStore.updateJob(jobId, {
      lease: {
        ...job.lease,
        last_heartbeat_at: nowMs - 120000,
      },
      created_at: nowMs - 10000,
    });

    const sweep = service.mcpGateway.sweepLeaseJanitor(nowMs);
    assert.equal(sweep.auto_cancelled, 1);
    const cancelled = service.mcpGateway.jobStore.getJob(jobId);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.error_code, "E_JOB_HEARTBEAT_TIMEOUT");
    assert.equal(cancelled.auto_cancel_reason, "heartbeat_timeout");
    assert.equal(cancelled.lease.orphaned, true);
  } finally {
    dispose();
  }
});

test("janitor auto-cancels on max runtime timeout", () => {
  const { service, dispose } = createService();
  try {
    seedSelectionSnapshot(service, "scene_rev_lease_runtime");
    const token = issueReadToken(service);
    const jobId = submitJob(service, token, "max_runtime", "thread_runtime");
    const nowMs = Date.now();
    const job = service.mcpGateway.jobStore.getJob(jobId);
    service.mcpGateway.jobStore.updateJob(jobId, {
      lease: {
        ...job.lease,
        last_heartbeat_at: nowMs,
      },
      created_at: nowMs - 400000,
    });

    const sweep = service.mcpGateway.sweepLeaseJanitor(nowMs);
    assert.equal(sweep.auto_cancelled, 1);
    const cancelled = service.mcpGateway.jobStore.getJob(jobId);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.error_code, "E_JOB_MAX_RUNTIME_EXCEEDED");
    assert.equal(cancelled.auto_cancel_reason, "max_runtime_timeout");
    const metrics = service.getMcpMetrics().body;
    assert.ok(metrics.auto_cancel_total >= 1);
    assert.ok(metrics.auto_cancel_max_runtime_total >= 1);
  } finally {
    dispose();
  }
});

test("janitor auto-cancels WAITING_FOR_UNITY_REBOOT on reboot wait timeout", () => {
  const { service, dispose } = createService();
  try {
    seedSelectionSnapshot(service, "scene_rev_lease_reboot");
    const token = issueReadToken(service);
    const jobId = submitJob(service, token, "reboot_wait", "thread_reboot");
    const nowMs = Date.now();
    const job = service.mcpGateway.jobStore.getJob(jobId);
    service.mcpGateway.jobStore.updateJob(jobId, {
      stage: "WAITING_FOR_UNITY_REBOOT",
      runtime: {
        ...(job.runtime || {}),
        phase: "waiting_for_unity_reboot",
        reboot_wait_started_at: nowMs - 200000,
      },
      lease: {
        ...job.lease,
        last_heartbeat_at: nowMs,
      },
      updated_at: nowMs - 1000,
      created_at: nowMs - 10000,
    });

    const sweep = service.mcpGateway.sweepLeaseJanitor(nowMs);
    assert.equal(sweep.auto_cancelled, 1);
    const cancelled = service.mcpGateway.jobStore.getJob(jobId);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.error_code, "E_WAITING_FOR_UNITY_REBOOT_TIMEOUT");
    assert.equal(cancelled.auto_cancel_reason, "reboot_wait_timeout");
    const metrics = service.getMcpMetrics().body;
    assert.ok(metrics.auto_cancel_total >= 1);
    assert.ok(metrics.auto_cancel_reboot_wait_timeout_total >= 1);
  } finally {
    dispose();
  }
});

test("queued auto-cancel removes stale queue entry immediately", () => {
  const { service, dispose } = createService();
  try {
    seedSelectionSnapshot(service, "scene_rev_queue_cleanup");
    const token = issueReadToken(service);
    const runningJobId = submitJob(service, token, "queue_cleanup_running", "thread_qc");
    const queuedJobId = submitJob(service, token, "queue_cleanup_queued", "thread_qc");
    const queuedBefore = service.mcpGateway.jobStore.getJob(queuedJobId);
    assert.equal(queuedBefore.status, "queued");
    assert.equal(service.mcpGateway.jobQueue.size(), 1);

    const nowMs = Date.now();
    const runningJob = service.mcpGateway.jobStore.getJob(runningJobId);
    const queuedJob = service.mcpGateway.jobStore.getJob(queuedJobId);
    service.mcpGateway.jobStore.updateJob(runningJobId, {
      created_at: nowMs - 10000,
      lease: {
        ...runningJob.lease,
        last_heartbeat_at: nowMs,
      },
    });
    service.mcpGateway.jobStore.updateJob(queuedJobId, {
      created_at: nowMs - 400000,
      lease: {
        ...queuedJob.lease,
        last_heartbeat_at: nowMs,
      },
    });

    const sweep = service.mcpGateway.sweepLeaseJanitor(nowMs);
    assert.equal(sweep.auto_cancelled, 1);
    const queuedAfter = service.mcpGateway.jobStore.getJob(queuedJobId);
    assert.equal(queuedAfter.status, "cancelled");
    assert.equal(service.mcpGateway.jobQueue.size(), 0);

    const thirdSubmit = service.submitUnityTask({
      thread_id: "thread_qc",
      idempotency_key: "idem_queue_cleanup_third",
      user_intent: "queue cleanup third",
      based_on_read_token: token,
      write_anchor: {
        object_id: "go_root",
        path: "Scene/Root",
      },
      file_actions: [
        {
          type: "delete_file",
          path: "Assets/Scripts/AIGenerated/JanitorQueueCleanupThird.cs",
        },
      ],
    });
    assert.equal(thirdSubmit.statusCode, 202);
    assert.equal(thirdSubmit.body.status, "queued");
  } finally {
    dispose();
  }
});

test("auto-cancel releases lock and promotes next queued job", () => {
  const { service, dispose } = createService();
  try {
    seedSelectionSnapshot(service, "scene_rev_lease_queue");
    const token = issueReadToken(service);
    const firstJobId = submitJob(service, token, "queue_first", "thread_queue");
    const secondJobId = submitJob(service, token, "queue_second", "thread_queue");
    const queued = service.mcpGateway.jobStore.getJob(secondJobId);
    assert.equal(queued.status, "queued");

    const nowMs = Date.now();
    const firstJob = service.mcpGateway.jobStore.getJob(firstJobId);
    service.mcpGateway.jobStore.updateJob(firstJobId, {
      lease: {
        ...firstJob.lease,
        last_heartbeat_at: nowMs - 120000,
      },
      created_at: nowMs - 10000,
    });

    const sweep = service.mcpGateway.sweepLeaseJanitor(nowMs);
    assert.equal(sweep.auto_cancelled, 1);

    const cancelled = service.mcpGateway.jobStore.getJob(firstJobId);
    assert.equal(cancelled.status, "cancelled");
    const promoted = service.mcpGateway.jobStore.getJob(secondJobId);
    assert.notEqual(promoted.status, "queued");

    const metrics = service.getMcpMetrics().body;
    assert.ok(metrics.lock_release_total >= 1);
    assert.ok(metrics.queue_promote_total >= 1);
    assert.ok(metrics.auto_cancel_total >= 1);
    assert.ok(metrics.auto_cancel_heartbeat_timeout_total >= 1);
  } finally {
    dispose();
  }
});

test("status query and explicit heartbeat refresh lease heartbeat timestamp", () => {
  const { service, dispose } = createService();
  try {
    seedSelectionSnapshot(service, "scene_rev_lease_touch");
    const token = issueReadToken(service);
    const jobId = submitJob(service, token, "touch", "thread_touch");
    const nowMs = Date.now();
    const job = service.mcpGateway.jobStore.getJob(jobId);
    const stale = nowMs - 90000;
    service.mcpGateway.jobStore.updateJob(jobId, {
      lease: {
        ...job.lease,
        last_heartbeat_at: stale,
      },
      created_at: nowMs - 5000,
    });

    const status = service.getUnityTaskStatus(jobId);
    assert.equal(status.statusCode, 200);
    const touchedByStatus = service.mcpGateway.jobStore.getJob(jobId);
    assert.ok(touchedByStatus.lease.last_heartbeat_at > stale);

    const staleAgain = nowMs - 80000;
    service.mcpGateway.jobStore.updateJob(jobId, {
      lease: {
        ...touchedByStatus.lease,
        last_heartbeat_at: staleAgain,
      },
    });
    const heartbeatOutcome = service.heartbeatMcp({
      job_id: jobId,
    });
    assert.equal(heartbeatOutcome.statusCode, 200);
    assert.equal(heartbeatOutcome.body.ok, true);
    assert.equal(heartbeatOutcome.body.touched_job_count, 1);
    const touchedByExplicit = service.mcpGateway.jobStore.getJob(jobId);
    assert.ok(touchedByExplicit.lease.last_heartbeat_at > staleAgain);
  } finally {
    dispose();
  }
});

test("continuous keepalive heartbeat prevents heartbeat auto-cancel", () => {
  const { service, dispose } = createService();
  try {
    seedSelectionSnapshot(service, "scene_rev_lease_keepalive");
    const token = issueReadToken(service);
    const jobId = submitJob(service, token, "keepalive", "thread_keepalive");
    const baseNow = Date.now();
    const job = service.mcpGateway.jobStore.getJob(jobId);
    service.mcpGateway.jobStore.updateJob(jobId, {
      lease: {
        ...job.lease,
        last_heartbeat_at: baseNow - 59000,
      },
      created_at: baseNow - 10000,
    });

    for (let i = 0; i < 3; i += 1) {
      const nowMs = baseNow + (i + 1) * 59000;
      const touched = service.mcpGateway.touchLeaseByJobId(jobId, {
        nowMs,
        source: "test_keepalive",
        persist: false,
      });
      assert.equal(touched, 1);
      const sweep = service.mcpGateway.sweepLeaseJanitor(nowMs);
      assert.equal(sweep.auto_cancelled, 0);
      const current = service.mcpGateway.jobStore.getJob(jobId);
      assert.equal(current.status, "pending");
      assert.equal(current.error_code, "");
      assert.equal(current.auto_cancel_reason, "");
    }

    const metrics = service.getMcpMetrics().body;
    assert.equal(metrics.auto_cancel_total, 0);
    assert.equal(metrics.auto_cancel_heartbeat_timeout_total, 0);
  } finally {
    dispose();
  }
});

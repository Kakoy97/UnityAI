"use strict";

const { isTerminalMcpStatus } = require("../../utils/turnUtils");
const { touchLease } = require("../jobRuntime/jobLease");

function listRecoveryJobs(gateway, threadId, limit, fallbackLimit) {
  const normalizedThreadId =
    typeof threadId === "string" ? threadId.trim() : "";
  if (!normalizedThreadId) {
    return [];
  }
  const maxItems =
    Number.isFinite(Number(limit)) && Number(limit) >= 0
      ? Math.floor(Number(limit))
      : Number.isFinite(Number(fallbackLimit)) && Number(fallbackLimit) >= 0
        ? Math.floor(Number(fallbackLimit))
        : 20;
  if (maxItems <= 0) {
    return [];
  }
  return gateway.jobStore
    .listJobs()
    .filter((job) => job && job.thread_id === normalizedThreadId)
    .sort((a, b) => Number(b.updated_at || 0) - Number(a.updated_at || 0))
    .slice(0, maxItems)
    .map((job) => gateway.buildJobStatusPayload(job));
}

function touchLeaseByJobId(gateway, jobId, options) {
  const normalizedJobId = typeof jobId === "string" ? jobId.trim() : "";
  if (!normalizedJobId) {
    return 0;
  }
  const job = gateway.jobStore.getJob(normalizedJobId);
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
    defaultHeartbeatTimeoutMs: gateway.leaseHeartbeatTimeoutMs,
    defaultMaxRuntimeMs: gateway.leaseMaxRuntimeMs,
  });
  if (typeof opts.source === "string" && opts.source.trim()) {
    lease.last_heartbeat_source = opts.source.trim();
  }
  const updated = gateway.jobStore.updateJob(normalizedJobId, { lease });
  if (updated && opts.persist === true) {
    gateway.jobRecovery.persist();
  }
  return updated ? 1 : 0;
}

function touchLeaseByThreadId(gateway, threadId, options) {
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
  for (const job of gateway.jobStore.listJobs()) {
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
      defaultHeartbeatTimeoutMs: gateway.leaseHeartbeatTimeoutMs,
      defaultMaxRuntimeMs: gateway.leaseMaxRuntimeMs,
    });
    if (typeof opts.source === "string" && opts.source.trim()) {
      lease.last_heartbeat_source = opts.source.trim();
    }
    const updated = gateway.jobStore.updateJob(job.job_id, { lease });
    if (updated) {
      touched += 1;
    }
  }
  if (touched > 0 && opts.persist === true) {
    gateway.jobRecovery.persist();
  }
  return touched;
}

function sweepLeaseJanitor(gateway, nowMs) {
  return gateway.jobLeaseJanitor.sweep(nowMs);
}

module.exports = {
  listRecoveryJobs,
  touchLeaseByJobId,
  touchLeaseByThreadId,
  sweepLeaseJanitor,
};


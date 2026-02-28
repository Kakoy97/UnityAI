"use strict";

const { isTerminalMcpStatus } = require("../../utils/turnUtils");
const {
  normalizeLease,
  touchLease,
} = require("./jobLease");

const DEFAULT_LEASE_JANITOR_INTERVAL_MS = 1000;
const DEFAULT_REBOOT_WAIT_TIMEOUT_MS = 3 * 60 * 1000;

class JobLeaseJanitor {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.nowMs = typeof opts.nowMs === "function" ? opts.nowMs : () => Date.now();
    this.intervalMs =
      Number.isFinite(Number(opts.intervalMs)) && Number(opts.intervalMs) > 0
        ? Math.floor(Number(opts.intervalMs))
        : DEFAULT_LEASE_JANITOR_INTERVAL_MS;
    this.rebootWaitTimeoutMs =
      Number.isFinite(Number(opts.rebootWaitTimeoutMs)) &&
      Number(opts.rebootWaitTimeoutMs) > 0
        ? Math.floor(Number(opts.rebootWaitTimeoutMs))
        : DEFAULT_REBOOT_WAIT_TIMEOUT_MS;
    this.jobStore = opts.jobStore || null;
    this.streamHub = opts.streamHub || null;
    this.defaultHeartbeatTimeoutMs = opts.defaultHeartbeatTimeoutMs;
    this.defaultMaxRuntimeMs = opts.defaultMaxRuntimeMs;
    this.finalizeJob =
      typeof opts.finalizeJob === "function" ? opts.finalizeJob : null;
    this.withMcpErrorFeedback =
      typeof opts.withMcpErrorFeedback === "function"
        ? opts.withMcpErrorFeedback
        : (body) => body;
    this.onAutoCancel =
      typeof opts.onAutoCancel === "function" ? opts.onAutoCancel : null;

    this.timer = null;
    this.sweepInFlight = false;
  }

  start() {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.sweep();
    }, this.intervalMs);
    if (this.timer && typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop() {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
  }

  sweep(nowValue) {
    if (
      !this.jobStore ||
      typeof this.jobStore.listJobs !== "function" ||
      typeof this.jobStore.updateJob !== "function" ||
      typeof this.finalizeJob !== "function"
    ) {
      return {
        auto_cancelled: 0,
      };
    }
    if (this.sweepInFlight) {
      return {
        auto_cancelled: 0,
        skipped: true,
      };
    }

    this.sweepInFlight = true;
    try {
      const nowMs = this.resolveNowMs(nowValue);
      this.refreshHeartbeatsFromStreams(nowMs);

      const jobs = this.jobStore
        .listJobs()
        .filter((job) => job && !isTerminalMcpStatus(job.status))
        .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
      let cancelled = 0;
      for (const job of jobs) {
        const timeout = this.resolveTimeout(job, nowMs);
        if (!timeout) {
          continue;
        }
        if (this.autoCancel(job, timeout, nowMs)) {
          cancelled += 1;
        }
      }

      return {
        auto_cancelled: cancelled,
      };
    } finally {
      this.sweepInFlight = false;
    }
  }

  refreshHeartbeatsFromStreams(nowMs) {
    if (!this.streamHub || typeof this.jobStore.listJobs !== "function") {
      return 0;
    }
    const touched = new Set();
    const hasGlobalSubscriber =
      typeof this.streamHub.hasGlobalSubscriber === "function" &&
      this.streamHub.hasGlobalSubscriber() === true;
    if (hasGlobalSubscriber) {
      for (const job of this.jobStore.listJobs()) {
        if (!job || isTerminalMcpStatus(job.status)) {
          continue;
        }
        if (this.touchJobLease(job, nowMs, "stream.global")) {
          touched.add(job.job_id);
        }
      }
      return touched.size;
    }

    const activeThreadIds =
      typeof this.streamHub.listActiveThreadIds === "function"
        ? this.streamHub.listActiveThreadIds()
        : [];
    if (!Array.isArray(activeThreadIds) || activeThreadIds.length === 0) {
      return 0;
    }

    const idSet = new Set(
      activeThreadIds
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => !!item)
    );
    if (idSet.size === 0) {
      return 0;
    }

    for (const job of this.jobStore.listJobs()) {
      if (!job || isTerminalMcpStatus(job.status)) {
        continue;
      }
      const threadId = typeof job.thread_id === "string" ? job.thread_id.trim() : "";
      if (!threadId || !idSet.has(threadId)) {
        continue;
      }
      if (this.touchJobLease(job, nowMs, "stream.thread")) {
        touched.add(job.job_id);
      }
    }
    return touched.size;
  }

  touchJobLease(job, nowMs, source) {
    const item = job && typeof job === "object" ? job : null;
    if (!item || !item.job_id || isTerminalMcpStatus(item.status)) {
      return false;
    }
    const ownerClientId =
      typeof item.thread_id === "string" && item.thread_id.trim()
        ? item.thread_id.trim()
        : "";
    const lease = touchLease(item.lease, {
      nowMs,
      ownerClientId,
      defaultHeartbeatTimeoutMs: this.defaultHeartbeatTimeoutMs,
      defaultMaxRuntimeMs: this.defaultMaxRuntimeMs,
    });
    if (source) {
      lease.last_heartbeat_source = source;
    }
    const updated = this.jobStore.updateJob(item.job_id, {
      lease,
    });
    return !!updated;
  }

  resolveTimeout(job, nowMs) {
    const item = job && typeof job === "object" ? job : null;
    if (!item || isTerminalMcpStatus(item.status)) {
      return null;
    }

    const lease = normalizeLease(item.lease, {
      ownerClientId: item.thread_id,
      nowMs,
      defaultHeartbeatTimeoutMs: this.defaultHeartbeatTimeoutMs,
      defaultMaxRuntimeMs: this.defaultMaxRuntimeMs,
    });
    const createdAt =
      Number.isFinite(Number(item.created_at)) && Number(item.created_at) > 0
        ? Math.floor(Number(item.created_at))
        : nowMs;
    const heartbeatAge = nowMs - lease.last_heartbeat_at;
    const runtimeAge = nowMs - createdAt;
    const stage = typeof item.stage === "string" ? item.stage.trim().toLowerCase() : "";
    const runtime =
      item.runtime && typeof item.runtime === "object" ? item.runtime : null;
    const runtimePhase =
      runtime && typeof runtime.phase === "string"
        ? runtime.phase.trim().toLowerCase()
        : "";
    const updatedAt =
      Number.isFinite(Number(item.updated_at)) && Number(item.updated_at) > 0
        ? Math.floor(Number(item.updated_at))
        : createdAt;
    const rebootWaitStartedAt = this.resolveTimestampMs(
      runtime ? runtime.reboot_wait_started_at : 0,
      updatedAt
    );
    const rebootWaitAge = nowMs - rebootWaitStartedAt;

    if (
      (stage === "waiting_for_unity_reboot" ||
        runtimePhase === "waiting_for_unity_reboot") &&
      rebootWaitAge > this.rebootWaitTimeoutMs
    ) {
      return {
        errorCode: "E_WAITING_FOR_UNITY_REBOOT_TIMEOUT",
        reason: "reboot_wait_timeout",
        message:
          "Waiting for unity.runtime.ping exceeded reboot_wait_timeout_ms. Job auto-cancelled.",
      };
    }

    if (runtimeAge > lease.max_runtime_ms) {
      return {
        errorCode: "E_JOB_MAX_RUNTIME_EXCEEDED",
        reason: "max_runtime_timeout",
        message: "Job runtime exceeded max_runtime_ms. Job auto-cancelled.",
      };
    }

    if (heartbeatAge > lease.heartbeat_timeout_ms) {
      return {
        errorCode: "E_JOB_HEARTBEAT_TIMEOUT",
        reason: "heartbeat_timeout",
        message: "Job lease heartbeat timed out. Job auto-cancelled.",
      };
    }

    return null;
  }

  autoCancel(job, timeout, nowMs) {
    const item = job && typeof job === "object" ? job : null;
    if (!item || !item.job_id) {
      return false;
    }
    const timeoutInfo = timeout && typeof timeout === "object" ? timeout : null;
    if (!timeoutInfo) {
      return false;
    }

    const currentLease = normalizeLease(item.lease, {
      ownerClientId: item.thread_id,
      nowMs,
      defaultHeartbeatTimeoutMs: this.defaultHeartbeatTimeoutMs,
      defaultMaxRuntimeMs: this.defaultMaxRuntimeMs,
    });
    currentLease.orphaned = true;
    currentLease.state = "orphaned";

    const failure = this.withMcpErrorFeedback({
      status: "cancelled",
      error_code: timeoutInfo.errorCode,
      message: timeoutInfo.message,
      recoverable: true,
    });
    const finalized = this.finalizeJob(item.job_id, {
      status: "cancelled",
      stage: "cancelled",
      progress_message: failure.error_message,
      error_code: failure.error_code,
      error_message: failure.error_message,
      suggestion: failure.suggestion,
      recoverable: failure.recoverable,
      auto_cancel_reason: timeoutInfo.reason,
      lease: currentLease,
    });
    if (!finalized) {
      return false;
    }
    if (this.onAutoCancel) {
      this.onAutoCancel(timeoutInfo.reason, finalized);
    }
    return true;
  }

  resolveNowMs(nowValue) {
    if (Number.isFinite(Number(nowValue)) && Number(nowValue) > 0) {
      return Math.floor(Number(nowValue));
    }
    const resolved = this.nowMs();
    return Number.isFinite(Number(resolved)) && Number(resolved) > 0
      ? Math.floor(Number(resolved))
      : Date.now();
  }

  resolveTimestampMs(value, fallbackMs) {
    if (Number.isFinite(Number(value)) && Number(value) > 0) {
      return Math.floor(Number(value));
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return Math.floor(parsed);
      }
    }
    return Number.isFinite(Number(fallbackMs)) && Number(fallbackMs) > 0
      ? Math.floor(Number(fallbackMs))
      : this.resolveNowMs();
  }
}

module.exports = {
  JobLeaseJanitor,
  DEFAULT_LEASE_JANITOR_INTERVAL_MS,
  DEFAULT_REBOOT_WAIT_TIMEOUT_MS,
};

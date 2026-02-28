"use strict";

const {
  normalizeMcpJobSnapshotItem,
  isTerminalMcpStatus,
} = require("../../utils/turnUtils");

class JobRecovery {
  constructor(deps) {
    this.snapshotStore = deps && deps.snapshotStore ? deps.snapshotStore : null;
    this.jobStore = deps.jobStore;
    this.jobQueue = deps.jobQueue;
    this.lockManager = deps.lockManager;
    this.jobTtlMs =
      Number.isFinite(Number(deps.jobTtlMs)) && Number(deps.jobTtlMs) > 0
        ? Math.floor(Number(deps.jobTtlMs))
        : 24 * 60 * 60 * 1000;
  }

  restore() {
    if (!this.snapshotStore || typeof this.snapshotStore.loadSnapshot !== "function") {
      return;
    }
    const snapshot = this.snapshotStore.loadSnapshot();
    const payload = snapshot && typeof snapshot === "object" ? snapshot : {};
    const jobs = Array.isArray(payload.jobs)
      ? payload.jobs
          .map((item) => normalizeMcpJobSnapshotItem(item))
          .filter((item) => !!item)
      : [];

    this.jobStore.replaceAll(jobs);
    this.jobQueue.hydrate(Array.isArray(payload.queued_job_ids) ? payload.queued_job_ids : []);
    this.lockManager.forceSet(payload.running_job_id);
    this.reconcileState();
  }

  persist() {
    if (!this.snapshotStore || typeof this.snapshotStore.saveSnapshot !== "function") {
      return false;
    }
    const snapshot = {
      version: 1,
      updated_at: Date.now(),
      running_job_id: this.lockManager.getRunningJobId(),
      queued_job_ids: this.jobQueue.list(),
      jobs: this.jobStore.listJobs(),
    };
    return this.snapshotStore.saveSnapshot(snapshot) === true;
  }

  cleanupExpired(nowMs) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    let changed = false;
    for (const job of this.jobStore.listJobs()) {
      if (!job || typeof job !== "object") {
        continue;
      }
      if (!isTerminalMcpStatus(job.status)) {
        continue;
      }
      const terminalAt =
        Number.isFinite(Number(job.terminal_at)) && Number(job.terminal_at) > 0
          ? Math.floor(Number(job.terminal_at))
          : 0;
      if (!terminalAt) {
        continue;
      }
      if (now - terminalAt <= this.jobTtlMs) {
        continue;
      }
      this.jobQueue.remove(job.job_id);
      this.jobStore.removeJob(job.job_id);
      this.lockManager.release(job.job_id);
      changed = true;
    }
    if (changed) {
      this.persist();
    }
    return changed;
  }

  reconcileState() {
    const jobs = this.jobStore.listJobs();
    const validIds = new Set(jobs.map((job) => job.job_id));

    this.jobQueue.hydrate(
      this.jobQueue
        .list()
        .filter((jobId) => validIds.has(jobId))
        .filter((jobId) => {
          const job = this.jobStore.getJob(jobId);
          return job && job.status === "queued";
        })
    );

    const runningJobId = this.lockManager.getRunningJobId();
    const runningJob = this.jobStore.getJob(runningJobId);
    if (!runningJob || runningJob.status !== "pending") {
      this.lockManager.forceSet("");
      const fallback = jobs
        .filter((job) => job && job.status === "pending")
        .sort((a, b) => Number(a.updated_at || 0) - Number(b.updated_at || 0))[0];
      if (fallback) {
        this.lockManager.forceSet(fallback.job_id);
      }
    }
  }
}

module.exports = {
  JobRecovery,
};

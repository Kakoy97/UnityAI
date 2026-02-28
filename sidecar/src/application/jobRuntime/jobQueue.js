"use strict";

class JobQueue {
  constructor(maxQueue) {
    this.maxQueue =
      Number.isFinite(Number(maxQueue)) && Number(maxQueue) >= 0
        ? Math.floor(Number(maxQueue))
        : 1;
    this.jobIds = [];
  }

  canEnqueue() {
    return this.jobIds.length < this.maxQueue;
  }

  enqueue(jobId) {
    const normalizedJobId = this.normalizeJobId(jobId);
    if (!normalizedJobId) {
      return {
        ok: false,
        reason: "invalid_job_id",
      };
    }
    if (this.jobIds.includes(normalizedJobId)) {
      return {
        ok: true,
        replay: true,
      };
    }
    if (!this.canEnqueue()) {
      return {
        ok: false,
        reason: "queue_full",
      };
    }
    this.jobIds.push(normalizedJobId);
    return {
      ok: true,
      replay: false,
    };
  }

  dequeue() {
    if (this.jobIds.length === 0) {
      return "";
    }
    return this.jobIds.shift() || "";
  }

  remove(jobId) {
    const normalizedJobId = this.normalizeJobId(jobId);
    if (!normalizedJobId) {
      return false;
    }
    const before = this.jobIds.length;
    this.jobIds = this.jobIds.filter((item) => item !== normalizedJobId);
    return this.jobIds.length !== before;
  }

  hydrate(jobIds) {
    const next = Array.isArray(jobIds)
      ? jobIds
          .map((item) => this.normalizeJobId(item))
          .filter((item) => !!item)
      : [];
    this.jobIds = Array.from(new Set(next));
  }

  list() {
    return this.jobIds.slice();
  }

  size() {
    return this.jobIds.length;
  }

  normalizeJobId(value) {
    return typeof value === "string" ? value.trim() : "";
  }
}

module.exports = {
  JobQueue,
};

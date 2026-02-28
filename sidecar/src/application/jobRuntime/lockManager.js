"use strict";

class LockManager {
  constructor() {
    this.runningJobId = "";
  }

  acquire(jobId) {
    const normalizedJobId = this.normalizeJobId(jobId);
    if (!normalizedJobId) {
      return false;
    }
    if (!this.runningJobId) {
      this.runningJobId = normalizedJobId;
      return true;
    }
    return this.runningJobId === normalizedJobId;
  }

  release(jobId) {
    if (!this.runningJobId) {
      return false;
    }
    const normalizedJobId = this.normalizeJobId(jobId);
    if (!normalizedJobId || this.runningJobId === normalizedJobId) {
      this.runningJobId = "";
      return true;
    }
    return false;
  }

  forceSet(jobId) {
    this.runningJobId = this.normalizeJobId(jobId);
  }

  getRunningJobId() {
    return this.runningJobId;
  }

  hasRunningJob() {
    return !!this.runningJobId;
  }

  normalizeJobId(value) {
    return typeof value === "string" ? value.trim() : "";
  }
}

module.exports = {
  LockManager,
};

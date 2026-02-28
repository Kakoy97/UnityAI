"use strict";

const { cloneJson } = require("../../utils/turnUtils");
const { normalizeLease } = require("./jobLease");

class JobStore {
  constructor() {
    /** @type {Map<string, any>} */
    this.jobsById = new Map();
    /** @type {Map<string, string>} */
    this.idempotencyToJobId = new Map();
    /** @type {Map<string, string>} */
    this.requestToJobId = new Map();
  }

  getJob(jobId) {
    const normalizedJobId = this.normalizeString(jobId);
    if (!normalizedJobId) {
      return null;
    }
    return this.jobsById.get(normalizedJobId) || null;
  }

  getJobByIdempotencyKey(idempotencyKey) {
    const normalizedKey = this.normalizeString(idempotencyKey);
    if (!normalizedKey) {
      return null;
    }
    const jobId = this.idempotencyToJobId.get(normalizedKey) || "";
    if (!jobId) {
      return null;
    }
    return this.jobsById.get(jobId) || null;
  }

  getJobByRequestId(requestId) {
    const normalizedRequestId = this.normalizeString(requestId);
    if (!normalizedRequestId) {
      return null;
    }
    const jobId = this.requestToJobId.get(normalizedRequestId) || "";
    if (!jobId) {
      return null;
    }
    return this.jobsById.get(jobId) || null;
  }

  upsertJob(job) {
    const item = job && typeof job === "object" ? job : null;
    if (!item) {
      return null;
    }
    const jobId = this.normalizeString(item.job_id);
    if (!jobId) {
      return null;
    }
    const normalizedThreadId = this.normalizeString(item.thread_id);
    const normalizedCreatedAt = this.normalizeTimestamp(item.created_at);
    const normalizedUpdatedAt = this.normalizeTimestamp(item.updated_at);
    const normalized = {
      ...item,
      job_id: jobId,
      idempotency_key: this.normalizeString(item.idempotency_key),
      thread_id: normalizedThreadId,
      request_id: this.normalizeString(item.request_id),
      turn_id: this.normalizeString(item.turn_id),
      approval_mode:
        item.approval_mode === "require_user" ? "require_user" : "auto",
      status: this.normalizeStatus(item.status),
      stage: this.normalizeString(item.stage),
      progress_message: this.normalizeString(item.progress_message),
      error_code: this.normalizeString(item.error_code),
      error_message: this.normalizeString(item.error_message),
      auto_cancel_reason: this.normalizeString(item.auto_cancel_reason),
      suggestion: this.normalizeString(item.suggestion),
      recoverable: item.recoverable === true,
      execution_report:
        item.execution_report && typeof item.execution_report === "object"
          ? cloneJson(item.execution_report)
          : null,
      created_at: normalizedCreatedAt,
      updated_at: normalizedUpdatedAt,
      terminal_at: this.normalizeTimestamp(item.terminal_at, true),
      user_intent:
        typeof item.user_intent === "string" ? item.user_intent : "",
      based_on_read_token:
        typeof item.based_on_read_token === "string"
          ? item.based_on_read_token.trim()
          : "",
      write_anchor: this.normalizeAnchorObject(item.write_anchor),
      context:
        item.context && typeof item.context === "object"
          ? cloneJson(item.context)
          : null,
      task_allocation:
        item.task_allocation && typeof item.task_allocation === "object"
          ? cloneJson(item.task_allocation)
          : null,
      runtime:
        item.runtime && typeof item.runtime === "object"
          ? cloneJson(item.runtime)
          : null,
      lease: normalizeLease(item.lease, {
        ownerClientId: normalizedThreadId,
        nowMs: normalizedUpdatedAt,
      }),
    };

    const previous = this.jobsById.get(jobId) || null;
    if (
      previous &&
      typeof previous.request_id === "string" &&
      previous.request_id &&
      previous.request_id !== normalized.request_id
    ) {
      this.requestToJobId.delete(previous.request_id);
    }

    this.jobsById.set(jobId, normalized);
    if (normalized.idempotency_key) {
      this.idempotencyToJobId.set(normalized.idempotency_key, jobId);
    }
    if (normalized.request_id) {
      this.requestToJobId.set(normalized.request_id, jobId);
    }
    return normalized;
  }

  updateJob(jobId, patch) {
    const current = this.getJob(jobId);
    if (!current) {
      return null;
    }
    const merged = {
      ...current,
      ...(patch && typeof patch === "object" ? patch : {}),
      job_id: current.job_id,
      idempotency_key: current.idempotency_key,
    };
    return this.upsertJob(merged);
  }

  removeJob(jobId) {
    const current = this.getJob(jobId);
    if (!current) {
      return false;
    }
    this.jobsById.delete(current.job_id);
    if (current.idempotency_key) {
      this.idempotencyToJobId.delete(current.idempotency_key);
    }
    if (current.request_id) {
      this.requestToJobId.delete(current.request_id);
    }
    return true;
  }

  listJobs() {
    return Array.from(this.jobsById.values());
  }

  replaceAll(jobs) {
    this.jobsById.clear();
    this.idempotencyToJobId.clear();
    this.requestToJobId.clear();
    const items = Array.isArray(jobs) ? jobs : [];
    for (const job of items) {
      this.upsertJob(job);
    }
  }

  normalizeStatus(value) {
    const status = this.normalizeString(value).toLowerCase();
    if (
      status === "queued" ||
      status === "pending" ||
      status === "succeeded" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return status;
    }
    return "pending";
  }

  normalizeTimestamp(value, allowZero) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) {
      return Math.floor(n);
    }
    if (allowZero) {
      return 0;
    }
    return Date.now();
  }

  normalizeString(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  normalizeAnchorObject(anchor) {
    if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
      return null;
    }
    const objectId = this.normalizeString(anchor.object_id);
    const path = this.normalizeString(anchor.path);
    if (!objectId || !path) {
      return null;
    }
    return {
      object_id: objectId,
      path,
    };
  }
}

module.exports = {
  JobStore,
};

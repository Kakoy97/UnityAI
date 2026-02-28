"use strict";

const {
  normalizeErrorCode,
  normalizeMcpStreamEventType,
  mapMcpErrorFeedback,
} = require("../../utils/turnUtils");
const { OBSERVABILITY_FREEZE_CONTRACT } = require("../../ports/contracts");

const DEFAULT_STREAM_MAX_EVENTS = 500;
const DEFAULT_STREAM_MAX_SUBSCRIBERS = 32;
const DEFAULT_STREAM_RECOVERY_JOBS_MAX = 20;
const METRICS_CONTRACT_VERSION =
  OBSERVABILITY_FREEZE_CONTRACT &&
  typeof OBSERVABILITY_FREEZE_CONTRACT.metrics_contract_version === "string"
    ? OBSERVABILITY_FREEZE_CONTRACT.metrics_contract_version
    : "mcp.metrics.v1";
const STREAM_EVENT_CONTRACT_VERSION =
  OBSERVABILITY_FREEZE_CONTRACT &&
  typeof OBSERVABILITY_FREEZE_CONTRACT.stream_event_contract_version === "string"
    ? OBSERVABILITY_FREEZE_CONTRACT.stream_event_contract_version
    : "mcp.stream.event.v1";

function fallbackWithMcpErrorFeedback(body) {
  const source = body && typeof body === "object" ? body : {};
  const code = normalizeErrorCode(source.error_code, "E_INTERNAL");
  const message =
    typeof source.error_message === "string" && source.error_message.trim()
      ? source.error_message.trim()
      : typeof source.message === "string" && source.message.trim()
        ? source.message.trim()
        : "Unknown error";
  const feedback = mapMcpErrorFeedback(code, message);
  return {
    ...source,
    status:
      typeof source.status === "string" && source.status.trim()
        ? source.status.trim()
        : "rejected",
    error_code: code,
    error_message: message,
    suggestion: feedback.suggestion,
    recoverable: feedback.recoverable,
    message,
  };
}

function toNonNegativeMetric(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0
    ? Math.floor(Number(value))
    : 0;
}

function normalizeErrorFeedbackByCode(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const normalized = {};
  for (const [code, count] of Object.entries(source)) {
    const key = normalizeErrorCode(code, "");
    if (!key) {
      continue;
    }
    normalized[key] = toNonNegativeMetric(count);
  }
  return normalized;
}

class McpStreamHub {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.maxEvents =
      Number.isFinite(Number(opts.maxEvents)) && Number(opts.maxEvents) > 0
        ? Math.floor(Number(opts.maxEvents))
        : DEFAULT_STREAM_MAX_EVENTS;
    this.maxSubscribers =
      Number.isFinite(Number(opts.maxSubscribers)) &&
      Number(opts.maxSubscribers) > 0
        ? Math.floor(Number(opts.maxSubscribers))
        : DEFAULT_STREAM_MAX_SUBSCRIBERS;
    this.recoveryJobsMax =
      Number.isFinite(Number(opts.recoveryJobsMax)) &&
      Number(opts.recoveryJobsMax) >= 0
        ? Math.floor(Number(opts.recoveryJobsMax))
        : DEFAULT_STREAM_RECOVERY_JOBS_MAX;
    this.withMcpErrorFeedback =
      typeof opts.withMcpErrorFeedback === "function"
        ? opts.withMcpErrorFeedback
        : fallbackWithMcpErrorFeedback;

    /** @type {Map<string, { thread_id: string, onEvent: (event: any) => void }>} */
    this.subscribers = new Map();
    /** @type {Array<any>} */
    this.recentEvents = [];
    this.nextEventSeq = 1;
    this.nextSubscriberSeq = 1;

    this.metrics = {
      stream_connect_calls: 0,
      stream_events_published: 0,
      stream_events_delivered: 0,
      stream_replay_events_sent: 0,
      stream_recovery_jobs_sent: 0,
      stream_subscriber_rejects: 0,
      stream_subscriber_drops: 0,
    };
  }

  registerSubscriber(options) {
    const opts = options && typeof options === "object" ? options : {};
    if (typeof opts.onEvent !== "function") {
      return {
        ok: false,
        statusCode: 400,
        body: this.buildErrorBody(
          "rejected",
          "E_SCHEMA_INVALID",
          "onEvent callback is required"
        ),
      };
    }
    if (this.subscribers.size >= this.maxSubscribers) {
      this.metrics.stream_subscriber_rejects += 1;
      return {
        ok: false,
        statusCode: 429,
        body: this.buildErrorBody(
          "rejected",
          "E_STREAM_SUBSCRIBERS_EXCEEDED",
          `Too many active MCP stream subscribers (${this.subscribers.size}/${this.maxSubscribers})`
        ),
      };
    }

    const threadId =
      typeof opts.thread_id === "string" ? opts.thread_id.trim() : "";
    const cursor =
      Number.isFinite(Number(opts.cursor)) && Number(opts.cursor) >= 0
        ? Math.floor(Number(opts.cursor))
        : 0;
    const replayEvents = this.listEventsSince(cursor, threadId);
    const oldestEventSeq = this.getOldestSeq(threadId);
    const latestEventSeq = this.nextEventSeq - 1;
    const replayTruncated =
      oldestEventSeq > 0 && Number(cursor) + 1 < oldestEventSeq;
    const recoveryJobs =
      replayTruncated &&
      threadId &&
      typeof opts.getRecoveryJobs === "function"
        ? opts.getRecoveryJobs(threadId, this.recoveryJobsMax)
        : [];

    const replayFromSeq =
      replayEvents.length > 0 &&
      Number.isFinite(Number(replayEvents[0].seq)) &&
      Number(replayEvents[0].seq) > 0
        ? Math.floor(Number(replayEvents[0].seq))
        : 0;
    const subscriberId = `mcp_sub_${Date.now()}_${this.nextSubscriberSeq++}`;
    this.subscribers.set(subscriberId, {
      thread_id: threadId,
      onEvent: opts.onEvent,
    });

    this.metrics.stream_connect_calls += 1;
    this.metrics.stream_replay_events_sent += replayEvents.length;
    this.metrics.stream_recovery_jobs_sent += recoveryJobs.length;

    return {
      ok: true,
      subscriber_id: subscriberId,
      requested_cursor: cursor,
      replay_events: replayEvents,
      replay_from_seq: replayFromSeq,
      replay_truncated: replayTruncated,
      recovery_jobs_count: recoveryJobs.length,
      recovery_jobs: recoveryJobs,
      oldest_event_seq: oldestEventSeq,
      latest_event_seq: latestEventSeq,
    };
  }

  unregisterSubscriber(subscriberId) {
    const id = typeof subscriberId === "string" ? subscriberId.trim() : "";
    if (!id) {
      return false;
    }
    return this.subscribers.delete(id);
  }

  listActiveThreadIds() {
    const ids = new Set();
    for (const subscriber of this.subscribers.values()) {
      if (!subscriber || typeof subscriber !== "object") {
        continue;
      }
      const threadId =
        typeof subscriber.thread_id === "string"
          ? subscriber.thread_id.trim()
          : "";
      if (!threadId) {
        continue;
      }
      ids.add(threadId);
    }
    return Array.from(ids);
  }

  hasGlobalSubscriber() {
    for (const subscriber of this.subscribers.values()) {
      if (!subscriber || typeof subscriber !== "object") {
        continue;
      }
      const threadId =
        typeof subscriber.thread_id === "string"
          ? subscriber.thread_id.trim()
          : "";
      if (!threadId) {
        return true;
      }
    }
    return false;
  }

  publishJobEvent(eventName, jobStatusPayload) {
    const payload =
      jobStatusPayload && typeof jobStatusPayload === "object"
        ? jobStatusPayload
        : null;
    if (!payload) {
      return null;
    }

    const seq = this.nextEventSeq++;
    const eventPayload = this.buildEventPayload(seq, eventName, payload);
    this.metrics.stream_events_published += 1;
    this.recentEvents.push(eventPayload);
    if (this.recentEvents.length > this.maxEvents) {
      this.recentEvents = this.recentEvents.slice(
        this.recentEvents.length - this.maxEvents
      );
    }

    for (const [subscriberId, subscriber] of this.subscribers.entries()) {
      if (!subscriber || typeof subscriber !== "object") {
        continue;
      }
      if (
        subscriber.thread_id &&
        subscriber.thread_id !== eventPayload.thread_id
      ) {
        continue;
      }
      try {
        subscriber.onEvent(eventPayload);
        this.metrics.stream_events_delivered += 1;
      } catch {
        this.subscribers.delete(subscriberId);
        this.metrics.stream_subscriber_drops += 1;
      }
    }

    return eventPayload;
  }

  listEventsSince(cursor, threadId) {
    const since =
      Number.isFinite(Number(cursor)) && Number(cursor) >= 0
        ? Math.floor(Number(cursor))
        : 0;
    const normalizedThreadId =
      typeof threadId === "string" ? threadId.trim() : "";
    return this.recentEvents.filter((eventItem) => {
      if (!eventItem || typeof eventItem !== "object") {
        return false;
      }
      if (
        !Number.isFinite(Number(eventItem.seq)) ||
        Number(eventItem.seq) <= since
      ) {
        return false;
      }
      if (normalizedThreadId && eventItem.thread_id !== normalizedThreadId) {
        return false;
      }
      return true;
    });
  }

  getOldestSeq(threadId) {
    const normalizedThreadId =
      typeof threadId === "string" ? threadId.trim() : "";
    let oldest = 0;
    for (const eventItem of this.recentEvents) {
      if (!eventItem || typeof eventItem !== "object") {
        continue;
      }
      if (normalizedThreadId && eventItem.thread_id !== normalizedThreadId) {
        continue;
      }
      const seq =
        Number.isFinite(Number(eventItem.seq)) && Number(eventItem.seq) > 0
          ? Math.floor(Number(eventItem.seq))
          : 0;
      if (!seq) {
        continue;
      }
      if (!oldest || seq < oldest) {
        oldest = seq;
      }
    }
    return oldest;
  }

  getMetricsSnapshot(options) {
    const opts = options && typeof options === "object" ? options : {};
    const statusQueries =
      Number.isFinite(Number(opts.status_query_calls)) &&
      Number(opts.status_query_calls) >= 0
        ? Math.floor(Number(opts.status_query_calls))
        : 0;
    const delivered =
      Number.isFinite(Number(this.metrics.stream_events_delivered)) &&
      Number(this.metrics.stream_events_delivered) >= 0
        ? Math.floor(Number(this.metrics.stream_events_delivered))
        : 0;
    const replayDelivered =
      Number.isFinite(Number(this.metrics.stream_replay_events_sent)) &&
      Number(this.metrics.stream_replay_events_sent) >= 0
        ? Math.floor(Number(this.metrics.stream_replay_events_sent))
        : 0;
    const pushEventsTotal = delivered + replayDelivered;
    const errorFeedbackByCode = normalizeErrorFeedbackByCode(
      opts.error_feedback_by_code
    );
    return {
      status: "ok",
      observability_phase:
        typeof opts.observability_phase === "string" &&
        opts.observability_phase.trim()
          ? opts.observability_phase.trim()
          : "phase6_freeze",
      metrics_contract_version: METRICS_CONTRACT_VERSION,
      timestamp: this.nowIso(),
      status_query_calls: statusQueries,
      stream_connect_calls:
        Number.isFinite(Number(this.metrics.stream_connect_calls)) &&
        Number(this.metrics.stream_connect_calls) >= 0
          ? Math.floor(Number(this.metrics.stream_connect_calls))
          : 0,
      stream_events_published:
        Number.isFinite(Number(this.metrics.stream_events_published)) &&
        Number(this.metrics.stream_events_published) >= 0
          ? Math.floor(Number(this.metrics.stream_events_published))
          : 0,
      stream_events_delivered: delivered,
      stream_replay_events_sent: replayDelivered,
      stream_recovery_jobs_sent:
        Number.isFinite(Number(this.metrics.stream_recovery_jobs_sent)) &&
        Number(this.metrics.stream_recovery_jobs_sent) >= 0
          ? Math.floor(Number(this.metrics.stream_recovery_jobs_sent))
          : 0,
      stream_subscriber_rejects:
        Number.isFinite(Number(this.metrics.stream_subscriber_rejects)) &&
        Number(this.metrics.stream_subscriber_rejects) >= 0
          ? Math.floor(Number(this.metrics.stream_subscriber_rejects))
          : 0,
      stream_subscriber_drops:
        Number.isFinite(Number(this.metrics.stream_subscriber_drops)) &&
        Number(this.metrics.stream_subscriber_drops) >= 0
          ? Math.floor(Number(this.metrics.stream_subscriber_drops))
          : 0,
      push_events_total: pushEventsTotal,
      query_to_push_ratio:
        pushEventsTotal > 0
          ? Number((statusQueries / pushEventsTotal).toFixed(4))
          : null,
      active_stream_subscribers: this.subscribers.size,
      stream_max_subscribers: this.maxSubscribers,
      stream_recovery_jobs_max: this.recoveryJobsMax,
      recent_stream_buffer_size: this.recentEvents.length,
      running_job_id:
        typeof opts.running_job_id === "string" ? opts.running_job_id : "",
      queued_job_count:
        Number.isFinite(Number(opts.queued_job_count)) &&
        Number(opts.queued_job_count) >= 0
          ? Math.floor(Number(opts.queued_job_count))
          : 0,
      total_job_count:
        Number.isFinite(Number(opts.total_job_count)) &&
        Number(opts.total_job_count) >= 0
          ? Math.floor(Number(opts.total_job_count))
          : 0,
      auto_cleanup_enforced: opts.auto_cleanup_enforced !== false,
      lease_heartbeat_timeout_ms:
        Number.isFinite(Number(opts.lease_heartbeat_timeout_ms)) &&
        Number(opts.lease_heartbeat_timeout_ms) > 0
          ? Math.floor(Number(opts.lease_heartbeat_timeout_ms))
          : 0,
      lease_max_runtime_ms:
        Number.isFinite(Number(opts.lease_max_runtime_ms)) &&
        Number(opts.lease_max_runtime_ms) > 0
          ? Math.floor(Number(opts.lease_max_runtime_ms))
          : 0,
      reboot_wait_timeout_ms:
        Number.isFinite(Number(opts.reboot_wait_timeout_ms)) &&
        Number(opts.reboot_wait_timeout_ms) > 0
          ? Math.floor(Number(opts.reboot_wait_timeout_ms))
          : 0,
      lease_janitor_interval_ms:
        Number.isFinite(Number(opts.lease_janitor_interval_ms)) &&
        Number(opts.lease_janitor_interval_ms) > 0
          ? Math.floor(Number(opts.lease_janitor_interval_ms))
          : 0,
      auto_cancel_total:
        Number.isFinite(Number(opts.auto_cancel_total)) &&
        Number(opts.auto_cancel_total) >= 0
          ? Math.floor(Number(opts.auto_cancel_total))
          : 0,
      auto_cancel_heartbeat_timeout_total:
        Number.isFinite(Number(opts.auto_cancel_heartbeat_timeout_total)) &&
        Number(opts.auto_cancel_heartbeat_timeout_total) >= 0
          ? Math.floor(Number(opts.auto_cancel_heartbeat_timeout_total))
          : 0,
      auto_cancel_max_runtime_total:
        Number.isFinite(Number(opts.auto_cancel_max_runtime_total)) &&
        Number(opts.auto_cancel_max_runtime_total) >= 0
          ? Math.floor(Number(opts.auto_cancel_max_runtime_total))
          : 0,
      auto_cancel_reboot_wait_timeout_total:
        Number.isFinite(Number(opts.auto_cancel_reboot_wait_timeout_total)) &&
        Number(opts.auto_cancel_reboot_wait_timeout_total) >= 0
          ? Math.floor(Number(opts.auto_cancel_reboot_wait_timeout_total))
          : 0,
      lock_release_total:
        Number.isFinite(Number(opts.lock_release_total)) &&
        Number(opts.lock_release_total) >= 0
          ? Math.floor(Number(opts.lock_release_total))
          : 0,
      queue_promote_total:
        Number.isFinite(Number(opts.queue_promote_total)) &&
        Number(opts.queue_promote_total) >= 0
          ? Math.floor(Number(opts.queue_promote_total))
          : 0,
      error_feedback_normalized_total: toNonNegativeMetric(
        opts.error_feedback_normalized_total
      ),
      error_stack_sanitized_total: toNonNegativeMetric(
        opts.error_stack_sanitized_total
      ),
      error_path_sanitized_total: toNonNegativeMetric(
        opts.error_path_sanitized_total
      ),
      error_message_truncated_total: toNonNegativeMetric(
        opts.error_message_truncated_total
      ),
      error_fixed_suggestion_enforced_total: toNonNegativeMetric(
        opts.error_fixed_suggestion_enforced_total
      ),
      error_feedback_by_code: errorFeedbackByCode,
    };
  }

  buildEventPayload(seq, eventName, statusPayload) {
    return {
      stream_event_contract_version: STREAM_EVENT_CONTRACT_VERSION,
      seq,
      event: normalizeMcpStreamEventType(eventName, statusPayload.status),
      timestamp: this.nowIso(),
      thread_id:
        typeof statusPayload.thread_id === "string" ? statusPayload.thread_id : "",
      job_id: statusPayload.job_id || "",
      status: statusPayload.status || "pending",
      stage: statusPayload.stage || "",
      message: statusPayload.progress_message || "",
      progress_message: statusPayload.progress_message || "",
      error_code: statusPayload.error_code || "",
      error_message: statusPayload.error_message || "",
      suggestion: statusPayload.suggestion || "",
      recoverable: statusPayload.recoverable === true,
      request_id: statusPayload.request_id || "",
      running_job_id: statusPayload.running_job_id || "",
      approval_mode: statusPayload.approval_mode || "auto",
      execution_report:
        statusPayload.execution_report &&
        typeof statusPayload.execution_report === "object"
          ? statusPayload.execution_report
          : null,
      created_at: statusPayload.created_at || this.nowIso(),
      updated_at: statusPayload.updated_at || this.nowIso(),
    };
  }

  buildErrorBody(status, errorCode, message) {
    return this.withMcpErrorFeedback({
      status: typeof status === "string" && status ? status : "rejected",
      error_code: errorCode,
      message,
    });
  }
}

module.exports = {
  McpStreamHub,
};

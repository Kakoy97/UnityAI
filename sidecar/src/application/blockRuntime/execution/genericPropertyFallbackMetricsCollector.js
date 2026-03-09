"use strict";

const METRICS_SCHEMA_VERSION =
  "block_runtime_generic_property_fallback_metrics.v1";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function createZeroTotals() {
  return {
    events_total: 0,
    attempt_total: 0,
    used_total: 0,
    success_total: 0,
    failure_total: 0,
    blocked_not_allowed_total: 0,
    blocked_precondition_total: 0,
  };
}

function ensureByKey(map, key) {
  const normalizedKey = normalizeString(key) || "unknown";
  if (!Object.prototype.hasOwnProperty.call(map, normalizedKey)) {
    map[normalizedKey] = createZeroTotals();
  }
  return map[normalizedKey];
}

function bumpTotals(totals, eventType) {
  totals.events_total += 1;
  if (eventType === "attempt") {
    totals.attempt_total += 1;
  } else if (eventType === "used") {
    totals.used_total += 1;
  } else if (eventType === "success") {
    totals.success_total += 1;
  } else if (eventType === "failure") {
    totals.failure_total += 1;
  } else if (eventType === "blocked_not_allowed") {
    totals.blocked_not_allowed_total += 1;
  } else if (eventType === "blocked_precondition") {
    totals.blocked_precondition_total += 1;
  }
}

class GenericPropertyFallbackMetricsCollector {
  constructor() {
    this.reset();
  }

  reset() {
    this.updated_at_ms = Date.now();
    this.totals = createZeroTotals();
    this.by_family = {};
    this.by_reason = {};
  }

  recordDecision(input = {}) {
    const payload = input && typeof input === "object" ? input : {};
    const eventType = normalizeString(payload.event_type);
    const familyKey = normalizeString(payload.family_key) || "unknown";
    const reason = normalizeString(payload.reason_code) || "unknown";
    if (!eventType) {
      return;
    }
    bumpTotals(this.totals, eventType);
    bumpTotals(ensureByKey(this.by_family, familyKey), eventType);
    bumpTotals(ensureByKey(this.by_reason, reason), eventType);
    this.updated_at_ms = Date.now();
  }

  getSnapshot() {
    const totals = {};
    for (const [key, value] of Object.entries(this.totals)) {
      totals[key] = normalizeInteger(value);
    }
    const attempts = totals.attempt_total || 0;
    const used = totals.used_total || 0;
    const success = totals.success_total || 0;

    return {
      schema_version: METRICS_SCHEMA_VERSION,
      updated_at_ms: normalizeInteger(this.updated_at_ms),
      totals,
      rates: {
        fallback_use_rate: attempts > 0 ? used / attempts : 0,
        fallback_success_rate: attempts > 0 ? success / attempts : 0,
      },
      by_family: this.by_family,
      by_reason: this.by_reason,
    };
  }
}

let singleton = null;

function getGenericPropertyFallbackMetricsCollectorSingleton() {
  if (!singleton) {
    singleton = new GenericPropertyFallbackMetricsCollector();
  }
  return singleton;
}

function resetGenericPropertyFallbackMetricsCollectorSingleton() {
  singleton = null;
}

module.exports = {
  METRICS_SCHEMA_VERSION,
  GenericPropertyFallbackMetricsCollector,
  getGenericPropertyFallbackMetricsCollectorSingleton,
  resetGenericPropertyFallbackMetricsCollectorSingleton,
};


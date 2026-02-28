"use strict";

const DEFAULT_LEASE_HEARTBEAT_TIMEOUT_MS = 60 * 1000;
const DEFAULT_LEASE_MAX_RUNTIME_MS = 5 * 60 * 1000;

function toPositiveInt(value, fallback, minValue) {
  const min = Number.isFinite(Number(minValue)) && Number(minValue) > 0
    ? Math.floor(Number(minValue))
    : 1;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) {
    return Number.isFinite(Number(fallback)) && Number(fallback) >= min
      ? Math.floor(Number(fallback))
      : min;
  }
  return Math.floor(n);
}

function normalizeOwnerClientId(value, fallback) {
  const owner = typeof value === "string" ? value.trim() : "";
  if (owner) {
    return owner;
  }
  return typeof fallback === "string" ? fallback.trim() : "";
}

function parseTimestampMs(value, fallbackMs) {
  if (Number.isFinite(Number(value)) && Number(value) > 0) {
    return Math.floor(Number(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return Math.floor(
    Number.isFinite(Number(fallbackMs)) && Number(fallbackMs) > 0
      ? Number(fallbackMs)
      : Date.now()
  );
}

function normalizeLeaseState(value, orphaned) {
  const token = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (token === "active" || token === "orphaned" || token === "released") {
    return token;
  }
  return orphaned === true ? "orphaned" : "active";
}

function normalizeLease(lease, options) {
  const opts = options && typeof options === "object" ? options : {};
  const source = lease && typeof lease === "object" ? lease : {};
  const nowMs = parseTimestampMs(opts.nowMs, Date.now());
  const ownerClientId = normalizeOwnerClientId(
    source.owner_client_id,
    opts.ownerClientId
  );
  const heartbeatTimeoutMs = toPositiveInt(
    source.heartbeat_timeout_ms,
    opts.defaultHeartbeatTimeoutMs || DEFAULT_LEASE_HEARTBEAT_TIMEOUT_MS,
    1000
  );
  const maxRuntimeMs = toPositiveInt(
    source.max_runtime_ms,
    opts.defaultMaxRuntimeMs || DEFAULT_LEASE_MAX_RUNTIME_MS,
    1000
  );
  const orphaned = source.orphaned === true;
  const state = normalizeLeaseState(source.state, orphaned);
  return {
    owner_client_id: ownerClientId,
    last_heartbeat_at: parseTimestampMs(source.last_heartbeat_at, nowMs),
    heartbeat_timeout_ms: heartbeatTimeoutMs,
    max_runtime_ms: maxRuntimeMs,
    orphaned,
    state,
  };
}

function touchLease(lease, options) {
  const opts = options && typeof options === "object" ? options : {};
  const normalized = normalizeLease(lease, opts);
  normalized.last_heartbeat_at = parseTimestampMs(opts.nowMs, Date.now());
  normalized.orphaned = false;
  normalized.state = "active";
  if (typeof opts.ownerClientId === "string" && opts.ownerClientId.trim()) {
    normalized.owner_client_id = opts.ownerClientId.trim();
  }
  return normalized;
}

function toIsoTimestamp(valueMs) {
  const ts = parseTimestampMs(valueMs, Date.now());
  return new Date(ts).toISOString();
}

module.exports = {
  DEFAULT_LEASE_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_LEASE_MAX_RUNTIME_MS,
  normalizeLease,
  touchLease,
  toIsoTimestamp,
};

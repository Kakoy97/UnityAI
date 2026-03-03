"use strict";

const DEFAULT_FUSE_FAILURE_THRESHOLD = 3;
const DEFAULT_FUSE_COOLDOWN_MS = 60 * 1000;

function clampPositiveInteger(value, fallback, minValue) {
  const min = Number.isFinite(Number(minValue)) && Number(minValue) > 0
    ? Math.floor(Number(minValue))
    : 1;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  const floored = Math.floor(normalized);
  return floored < min ? min : floored;
}

function toIsoString(timestampMs) {
  if (!Number.isFinite(Number(timestampMs)) || Number(timestampMs) <= 0) {
    return "";
  }
  return new Date(Number(timestampMs)).toISOString();
}

class CaptureCompositeRuntime {
  constructor(options) {
    const opts = options && typeof options === "object" ? options : {};
    this.enabled = opts.enabled === true;
    this.fuseFailureThreshold = clampPositiveInteger(
      opts.fuseFailureThreshold,
      DEFAULT_FUSE_FAILURE_THRESHOLD,
      1
    );
    this.fuseCooldownMs = clampPositiveInteger(
      opts.fuseCooldownMs,
      DEFAULT_FUSE_COOLDOWN_MS,
      1000
    );

    this.inFlight = false;
    this.consecutiveFailures = 0;
    this.fused = false;
    this.fusedUntilMs = 0;
    this.lastFailureAtMs = 0;
    this.lastFailureReason = "";
    this.lastFuseOpenedAtMs = 0;
    this.lastProbeRecoveredAtMs = 0;
    this.lastBusyAtMs = 0;

    this.totalFailures = 0;
    this.totalBlackFailures = 0;
    this.totalErrorFailures = 0;
    this.totalFuseTrips = 0;
    this.totalFallbackRenders = 0;
    this.totalProbeAttempts = 0;
    this.totalProbeRecoveries = 0;
    this.totalBusyRejections = 0;
  }

  tryStartRequest(nowMs) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    if (this.inFlight) {
      this.totalBusyRejections += 1;
      this.lastBusyAtMs = now;
      return { ok: false, reason: "busy", mode: "busy" };
    }

    this.inFlight = true;
    if (this.fused && now < this.fusedUntilMs) {
      this.totalFallbackRenders += 1;
      return { ok: true, mode: "fallback", fusedUntilMs: this.fusedUntilMs };
    }

    if (this.fused && now >= this.fusedUntilMs) {
      this.totalProbeAttempts += 1;
      return { ok: true, mode: "probe" };
    }

    return { ok: true, mode: "normal" };
  }

  endRequest() {
    this.inFlight = false;
  }

  recordCompositeSuccess(params) {
    const input = params && typeof params === "object" ? params : {};
    const now = Number.isFinite(Number(input.nowMs))
      ? Number(input.nowMs)
      : Date.now();
    const mode = typeof input.mode === "string" ? input.mode.trim() : "";

    this.consecutiveFailures = 0;
    if (this.fused && mode === "probe") {
      this.fused = false;
      this.fusedUntilMs = 0;
      this.lastFailureReason = "";
      this.lastProbeRecoveredAtMs = now;
      this.totalProbeRecoveries += 1;
    }
  }

  recordCompositeFailure(params) {
    const input = params && typeof params === "object" ? params : {};
    const now = Number.isFinite(Number(input.nowMs))
      ? Number(input.nowMs)
      : Date.now();
    const mode = typeof input.mode === "string" ? input.mode.trim() : "";
    const kind = typeof input.kind === "string" ? input.kind.trim() : "error";
    const reason =
      typeof input.reason === "string" && input.reason.trim()
        ? input.reason.trim()
        : kind;

    this.totalFailures += 1;
    this.consecutiveFailures += 1;
    this.lastFailureAtMs = now;
    this.lastFailureReason = reason;
    if (kind === "black") {
      this.totalBlackFailures += 1;
    } else {
      this.totalErrorFailures += 1;
    }

    if (this.fused) {
      if (mode === "probe" || now >= this.fusedUntilMs) {
        this.fusedUntilMs = now + this.fuseCooldownMs;
        this.lastFuseOpenedAtMs = now;
        this.totalFuseTrips += 1;
      }
      return;
    }

    if (this.consecutiveFailures >= this.fuseFailureThreshold) {
      this.fused = true;
      this.fusedUntilMs = now + this.fuseCooldownMs;
      this.lastFuseOpenedAtMs = now;
      this.totalFuseTrips += 1;
    }
  }

  getMetricsSnapshot(nowMs) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    return {
      enabled: this.enabled,
      in_flight: this.inFlight,
      fuse_failure_threshold: this.fuseFailureThreshold,
      fuse_cooldown_ms: this.fuseCooldownMs,
      fused: this.fused && now < this.fusedUntilMs,
      fused_until_ms: this.fusedUntilMs,
      fused_until: toIsoString(this.fusedUntilMs),
      consecutive_failures: this.consecutiveFailures,
      total_failures: this.totalFailures,
      total_black_failures: this.totalBlackFailures,
      total_error_failures: this.totalErrorFailures,
      total_fuse_trips: this.totalFuseTrips,
      total_fallback_renders: this.totalFallbackRenders,
      total_probe_attempts: this.totalProbeAttempts,
      total_probe_recoveries: this.totalProbeRecoveries,
      total_busy_rejections: this.totalBusyRejections,
      last_failure_at: toIsoString(this.lastFailureAtMs),
      last_failure_reason: this.lastFailureReason,
      last_fuse_opened_at: toIsoString(this.lastFuseOpenedAtMs),
      last_probe_recovered_at: toIsoString(this.lastProbeRecoveredAtMs),
      last_busy_at: toIsoString(this.lastBusyAtMs),
    };
  }
}

function createCaptureCompositeRuntime(options) {
  return new CaptureCompositeRuntime(options);
}

module.exports = {
  CaptureCompositeRuntime,
  createCaptureCompositeRuntime,
  DEFAULT_FUSE_FAILURE_THRESHOLD,
  DEFAULT_FUSE_COOLDOWN_MS,
};

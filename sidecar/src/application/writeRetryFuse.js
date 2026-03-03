"use strict";

const { createHash } = require("node:crypto");

const DEFAULT_WINDOW_MS = 30000;
const DEFAULT_MAX_ATTEMPTS = 2;

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeInteger(value, fallback, minimum) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  const rounded = Math.floor(n);
  if (rounded < minimum) {
    return fallback;
  }
  return rounded;
}

function normalizeThreadId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "t_default";
}

function sanitizePayloadForHash(payload) {
  const source = isObject(payload) ? payload : {};
  const clone = JSON.parse(JSON.stringify(source));
  delete clone.based_on_read_token;
  delete clone.idempotency_key;
  return clone;
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (!isObject(value)) {
    return JSON.stringify(value);
  }
  const keys = Object.keys(value).sort();
  const pairs = [];
  for (const key of keys) {
    pairs.push(`${JSON.stringify(key)}:${stableSerialize(value[key])}`);
  }
  return `{${pairs.join(",")}}`;
}

function createPayloadHash(payload) {
  const serialized = stableSerialize(sanitizePayloadForHash(payload));
  const digest = createHash("sha256").update(serialized).digest("hex");
  return `sha256:${digest}`;
}

class WriteRetryFuse {
  constructor(options) {
    const opts = options && typeof options === "object" ? options : {};
    this.enabled = opts.enabled !== false;
    this.windowMs = normalizeInteger(opts.windowMs, DEFAULT_WINDOW_MS, 1000);
    this.maxAttempts = normalizeInteger(
      opts.maxAttempts,
      DEFAULT_MAX_ATTEMPTS,
      1
    );
    this.entries = new Map();
  }

  begin(input) {
    if (!this.enabled) {
      return { ok: true, disabled: true };
    }
    const source = input && typeof input === "object" ? input : {};
    const payload = isObject(source.payload) ? source.payload : {};
    const nowMs = Date.now();
    this.cleanup(nowMs);

    const context = {
      toolName:
        typeof source.toolName === "string" && source.toolName.trim()
          ? source.toolName.trim()
          : "",
      threadId: normalizeThreadId(payload.thread_id),
      payloadHash: createPayloadHash(payload),
      nowMs,
    };
    const blocked = this.findBlockedEntry(context.threadId, context.payloadHash, nowMs);
    if (blocked) {
      return {
        ok: false,
        blocked: {
          ...context,
          errorCode: blocked.errorCode,
          attempts: blocked.count,
          firstSeenMs: blocked.firstSeenMs,
          lastSeenMs: blocked.lastSeenMs,
          fuseKey: blocked.key,
          windowMs: this.windowMs,
          maxAttempts: this.maxAttempts,
        },
      };
    }

    return {
      ok: true,
      context,
    };
  }

  recordFailure(context, errorCode) {
    if (!this.enabled) {
      return null;
    }
    const ctx = context && typeof context === "object" ? context : {};
    const normalizedError =
      typeof errorCode === "string" && errorCode.trim()
        ? errorCode.trim().toUpperCase()
        : "";
    if (!normalizedError || !ctx.threadId || !ctx.payloadHash) {
      return null;
    }

    const nowMs = Date.now();
    const key = this.buildKey(ctx.threadId, ctx.payloadHash, normalizedError);
    const existing = this.entries.get(key);
    const active =
      existing &&
      typeof existing === "object" &&
      nowMs - Number(existing.firstSeenMs || 0) <= this.windowMs
        ? existing
        : null;
    const next = active
      ? {
          ...active,
          count: Number(active.count || 0) + 1,
          lastSeenMs: nowMs,
        }
      : {
          key,
          threadId: ctx.threadId,
          payloadHash: ctx.payloadHash,
          errorCode: normalizedError,
          count: 1,
          firstSeenMs: nowMs,
          lastSeenMs: nowMs,
        };
    this.entries.set(key, next);
    this.cleanup(nowMs);
    return next;
  }

  recordSuccess(context) {
    if (!this.enabled) {
      return;
    }
    const ctx = context && typeof context === "object" ? context : {};
    if (!ctx.threadId || !ctx.payloadHash) {
      return;
    }
    for (const [key, entry] of this.entries.entries()) {
      if (
        entry &&
        typeof entry === "object" &&
        entry.threadId === ctx.threadId &&
        entry.payloadHash === ctx.payloadHash
      ) {
        this.entries.delete(key);
      }
    }
  }

  buildKey(threadId, payloadHash, errorCode) {
    return `${threadId}|${payloadHash}|${errorCode}`;
  }

  findBlockedEntry(threadId, payloadHash, nowMs) {
    for (const entry of this.entries.values()) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      if (entry.threadId !== threadId || entry.payloadHash !== payloadHash) {
        continue;
      }
      const ageMs = nowMs - Number(entry.firstSeenMs || 0);
      if (ageMs > this.windowMs) {
        continue;
      }
      if (Number(entry.count || 0) >= this.maxAttempts) {
        return entry;
      }
    }
    return null;
  }

  cleanup(nowMs) {
    const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
    for (const [key, entry] of this.entries.entries()) {
      if (!entry || typeof entry !== "object") {
        this.entries.delete(key);
        continue;
      }
      const firstSeen = Number(entry.firstSeenMs || 0);
      const lastSeen = Number(entry.lastSeenMs || 0);
      if (
        !Number.isFinite(firstSeen) ||
        !Number.isFinite(lastSeen) ||
        now - firstSeen > this.windowMs ||
        now - lastSeen > this.windowMs
      ) {
        this.entries.delete(key);
      }
    }
  }
}

module.exports = {
  WriteRetryFuse,
  DEFAULT_WINDOW_MS,
  DEFAULT_MAX_ATTEMPTS,
};


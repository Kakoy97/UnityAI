"use strict";

const crypto = require("node:crypto");
const {
  SSOT_TOKEN_PREFIX,
  SSOT_TOKEN_MIN_LENGTH,
  SSOT_TOKEN_HARD_MAX_AGE_MS,
  SSOT_TOKEN_CACHE_LIMIT,
  SSOT_UNKNOWN_SCENE_REVISION,
  SSOT_TOKEN_ERROR_CODES,
} = require("./tokenContract");

let ssotTokenRegistrySingleton = null;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSceneRevision(value) {
  const normalized = normalizeString(value);
  return normalized || SSOT_UNKNOWN_SCENE_REVISION;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

class SsotTokenRegistry {
  constructor(options = {}) {
    const opts = options && typeof options === "object" ? options : {};
    this.nowMs =
      typeof opts.nowMs === "function" ? opts.nowMs : () => Date.now();
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date(this.nowMs()).toISOString();
    this.hardMaxAgeMs =
      Number.isFinite(Number(opts.hardMaxAgeMs)) && Number(opts.hardMaxAgeMs) > 0
        ? Math.floor(Number(opts.hardMaxAgeMs))
        : SSOT_TOKEN_HARD_MAX_AGE_MS;
    this.maxEntries =
      Number.isFinite(Number(opts.maxEntries)) && Number(opts.maxEntries) > 0
        ? Math.floor(Number(opts.maxEntries))
        : SSOT_TOKEN_CACHE_LIMIT;
    this.tokensByValue = new Map();
  }

  issueToken(context) {
    const source = context && typeof context === "object" ? context : {};
    const sceneRevision = normalizeSceneRevision(source.scene_revision);
    if (!sceneRevision || sceneRevision === SSOT_UNKNOWN_SCENE_REVISION) {
      return {
        ok: false,
        error_code: SSOT_TOKEN_ERROR_CODES.SCENE_REVISION_DRIFT,
        message: "scene_revision is required to issue SSOT token.",
      };
    }

    this.cleanupExpiredTokens();
    const nowMs = this.nowMs();
    const issuedAt = this.nowIso();
    const randomSuffix = crypto.randomBytes(12).toString("hex");
    const token = `${SSOT_TOKEN_PREFIX}${nowMs.toString(36)}${randomSuffix}`;

    const entry = {
      token,
      issued_at: issuedAt,
      issued_at_ms: nowMs,
      hard_max_age_ms: this.hardMaxAgeMs,
      expires_at_ms: nowMs + this.hardMaxAgeMs,
      scene_revision: sceneRevision,
      scope_kind: normalizeString(source.scope_kind) || "scene",
      object_id: normalizeString(source.object_id),
      path: normalizeString(source.path),
      source_tool_name: normalizeString(source.source_tool_name),
    };
    this.tokensByValue.set(token, entry);
    this.trimToMaxEntries();

    return {
      ok: true,
      token: entry.token,
      issued_at: entry.issued_at,
      hard_max_age_ms: entry.hard_max_age_ms,
      scene_revision: entry.scene_revision,
      scope: {
        kind: entry.scope_kind,
        object_id: entry.object_id,
        path: entry.path,
      },
      source_tool_name: entry.source_tool_name,
    };
  }

  validateToken(tokenValue, currentSnapshot) {
    const token = normalizeString(tokenValue);
    if (
      !token ||
      token.length < SSOT_TOKEN_MIN_LENGTH ||
      !token.startsWith(SSOT_TOKEN_PREFIX)
    ) {
      return {
        ok: false,
        statusCode: 409,
        error_code: SSOT_TOKEN_ERROR_CODES.TOKEN_UNKNOWN,
        message: "based_on_read_token format is invalid or unsupported.",
      };
    }

    const entry = this.tokensByValue.get(token);
    if (!entry || typeof entry !== "object") {
      this.cleanupExpiredTokens();
      return {
        ok: false,
        statusCode: 409,
        error_code: SSOT_TOKEN_ERROR_CODES.TOKEN_UNKNOWN,
        message: "based_on_read_token is unknown.",
      };
    }

    const nowMs = this.nowMs();
    if (!Number.isFinite(Number(entry.expires_at_ms)) || nowMs > entry.expires_at_ms) {
      this.tokensByValue.delete(token);
      return {
        ok: false,
        statusCode: 409,
        error_code: SSOT_TOKEN_ERROR_CODES.TOKEN_EXPIRED,
        message: "based_on_read_token is expired.",
      };
    }

    const current = this.resolveCurrentSceneRevision(currentSnapshot);
    if (!current || current === SSOT_UNKNOWN_SCENE_REVISION) {
      return {
        ok: false,
        statusCode: 409,
        error_code: SSOT_TOKEN_ERROR_CODES.SCENE_REVISION_DRIFT,
        message: "Current scene_revision is unavailable.",
      };
    }

    if (normalizeSceneRevision(entry.scene_revision) !== current) {
      return {
        ok: false,
        statusCode: 409,
        error_code: SSOT_TOKEN_ERROR_CODES.SCENE_REVISION_DRIFT,
        message: "Token scene_revision does not match current scene revision.",
      };
    }

    return {
      ok: true,
      token_entry: cloneJson(entry),
    };
  }

  resolveCurrentSceneRevision(currentSnapshot) {
    const source =
      currentSnapshot && typeof currentSnapshot === "object" ? currentSnapshot : {};
    return normalizeSceneRevision(source.scene_revision || currentSnapshot);
  }

  trimToMaxEntries() {
    while (this.tokensByValue.size > this.maxEntries) {
      const first = this.tokensByValue.keys().next();
      if (!first || !first.value) {
        break;
      }
      this.tokensByValue.delete(first.value);
    }
  }

  cleanupExpiredTokens() {
    const nowMs = this.nowMs();
    for (const [token, entry] of this.tokensByValue.entries()) {
      if (!entry || typeof entry !== "object") {
        this.tokensByValue.delete(token);
        continue;
      }
      if (!Number.isFinite(Number(entry.expires_at_ms)) || nowMs > entry.expires_at_ms) {
        this.tokensByValue.delete(token);
      }
    }
  }

  clearForTests() {
    this.tokensByValue.clear();
  }
}

function getSsotTokenRegistrySingleton(options = {}) {
  const hasCustomOptions =
    options && typeof options === "object" && Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return new SsotTokenRegistry(options);
  }
  if (!ssotTokenRegistrySingleton) {
    ssotTokenRegistrySingleton = new SsotTokenRegistry();
  }
  return ssotTokenRegistrySingleton;
}

function resetSsotTokenRegistrySingletonForTests() {
  ssotTokenRegistrySingleton = null;
}

module.exports = {
  SsotTokenRegistry,
  getSsotTokenRegistrySingleton,
  resetSsotTokenRegistrySingletonForTests,
};

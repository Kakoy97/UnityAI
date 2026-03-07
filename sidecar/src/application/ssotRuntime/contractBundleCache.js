"use strict";

const DEFAULT_MAX_ENTRIES = 256;
const CACHE_NAMESPACE = "write_contract_bundle_v1";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : !!fallback;
}

function normalizePositiveInteger(value, fallbackValue = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return Math.max(0, Math.floor(Number(fallbackValue) || 0));
  }
  return Math.floor(n);
}

function buildContractBundleCacheKey(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const payload = {
    ns: CACHE_NAMESPACE,
    catalog_version: normalizeString(source.catalogVersion) || "unknown",
    tool_name: normalizeString(source.toolName),
    action_type: normalizeString(source.actionType),
    budget_chars: normalizePositiveInteger(source.budgetChars, 0),
    include_error_fix_map: normalizeBoolean(source.includeErrorFixMap, true),
    include_canonical_examples: normalizeBoolean(
      source.includeCanonicalExamples,
      true
    ),
    include_related: normalizeBoolean(source.includeRelated, true),
    include_enhanced: normalizeBoolean(source.includeEnhanced, true),
    include_legacy: normalizeBoolean(source.includeLegacy, true),
    scenario: normalizeString(source.scenario),
    previous_tool: normalizeString(source.previousTool),
  };
  return JSON.stringify(payload);
}

class ContractBundleCache {
  constructor(options = {}) {
    const source = options && typeof options === "object" ? options : {};
    this._maxEntries = normalizePositiveInteger(
      source.maxEntries,
      DEFAULT_MAX_ENTRIES
    );
    this._store = new Map();
    this._metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
    };
  }

  get(key) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) {
      this._metrics.misses += 1;
      return null;
    }
    const existing = this._store.get(normalizedKey);
    if (!existing) {
      this._metrics.misses += 1;
      return null;
    }
    this._store.delete(normalizedKey);
    this._store.set(normalizedKey, existing);
    this._metrics.hits += 1;
    return cloneJson(existing);
  }

  set(key, value) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) {
      return;
    }
    const payload = value && typeof value === "object" ? cloneJson(value) : {};
    if (this._store.has(normalizedKey)) {
      this._store.delete(normalizedKey);
    }
    this._store.set(normalizedKey, payload);
    this._metrics.sets += 1;

    while (this._store.size > this._maxEntries) {
      const first = this._store.keys().next();
      if (first.done) {
        break;
      }
      this._store.delete(first.value);
      this._metrics.evictions += 1;
    }
  }

  clear() {
    this._store.clear();
    this._metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      evictions: 0,
    };
  }

  snapshot() {
    return {
      size: this._store.size,
      max_entries: this._maxEntries,
      hits: this._metrics.hits,
      misses: this._metrics.misses,
      sets: this._metrics.sets,
      evictions: this._metrics.evictions,
    };
  }
}

let singleton = null;

function getContractBundleCacheSingleton(options = {}) {
  const hasCustomOptions =
    options &&
    typeof options === "object" &&
    Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return new ContractBundleCache(options);
  }
  if (!singleton) {
    singleton = new ContractBundleCache();
  }
  return singleton;
}

function resetContractBundleCacheSingletonForTests() {
  singleton = null;
}

function getContractBundleCacheMetricsForTests() {
  return getContractBundleCacheSingleton().snapshot();
}

module.exports = {
  DEFAULT_MAX_ENTRIES,
  ContractBundleCache,
  buildContractBundleCacheKey,
  getContractBundleCacheSingleton,
  resetContractBundleCacheSingletonForTests,
  getContractBundleCacheMetricsForTests,
};

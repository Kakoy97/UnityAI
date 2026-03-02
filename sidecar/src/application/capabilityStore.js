"use strict";

const DEFAULT_CAPABILITY_STALE_AFTER_MS = 120000;
const TOOLS_LIST_MAX_ACTION_HINTS = 12;
const TOOLS_LIST_MAX_DESCRIPTION_CHARS = 900;
const ACTION_SCHEMA_MAX_PROPERTIES = 40;
const ACTION_SCHEMA_MAX_DEPTH = 6;
const SCHEMA_HINT_MAX_CHARS = 1200;
const GET_ACTION_CATALOG_DEFAULT_LIMIT = 10;
const GET_ACTION_CATALOG_MAX_LIMIT = 20;

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeLowerString(value) {
  const normalized = normalizeString(value);
  return normalized ? normalized.toLowerCase() : "";
}

function normalizePositiveInt(value, fallback, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  const rounded = Math.floor(numeric);
  if (Number.isFinite(Number(max)) && rounded > Number(max)) {
    return Math.floor(Number(max));
  }
  return rounded;
}

function normalizeCursor(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.floor(numeric);
}

function normalizeEtag(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/^W\//i, "");
}

function quoteEtag(value) {
  const normalized = normalizeString(value).replace(/"/g, "");
  if (!normalized) {
    return "\"catalog:empty\"";
  }
  return `"${normalized}"`;
}

class CapabilityStore {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.capabilityStaleAfterMs =
      Number.isFinite(Number(opts.capabilityStaleAfterMs)) &&
      Number(opts.capabilityStaleAfterMs) > 0
        ? Math.floor(Number(opts.capabilityStaleAfterMs))
        : DEFAULT_CAPABILITY_STALE_AFTER_MS;

    const nowMs = this.nowMs();
    this.unityConnectionState = "offline";
    this.connectionUpdatedAtMs = nowMs;
    this.lastUnitySignalAtMs = 0;

    this.capabilityVersion = "";
    this.capabilityUpdatedAtMs = 0;
    this.capabilityActionsByType = new Map();
    this.capabilityCatalogByType = new Map();
    this.tokenBudgetMetrics = {
      tools_list_truncated_total: 0,
      schema_hint_truncated_total: 0,
    };
  }

  markUnitySignal() {
    const nowMs = this.nowMs();
    this.lastUnitySignalAtMs = nowMs;
    if (
      this.unityConnectionState === "offline" ||
      this.unityConnectionState === "stale"
    ) {
      this.setConnectionState("connecting", nowMs);
    }
  }

  reportCapabilities(payload) {
    this.markUnitySignal();
    const nowMs = this.nowMs();
    const body = isObject(payload) ? payload : {};
    this.capabilityVersion = normalizeString(body.capability_version);
    this.capabilityUpdatedAtMs = nowMs;

    this.capabilityActionsByType.clear();
    this.capabilityCatalogByType.clear();
    const actions = Array.isArray(body.actions) ? body.actions : [];
    for (const item of actions) {
      const normalized = this.normalizeCapabilityAction(item);
      if (!normalized) {
        continue;
      }
      this.capabilityActionsByType.set(normalized.type, normalized);
      this.capabilityCatalogByType.set(
        normalized.type,
        this.normalizeCatalogMetadata(item)
      );
    }

    this.setConnectionState("ready", nowMs);
    return this.getSnapshot();
  }

  getSnapshot() {
    this.refreshConnectionState();
    const actionSummaries = this.listActionSummaries();
    const hintPack = this.buildActionHints(actionSummaries);
    if (hintPack.truncated) {
      this.tokenBudgetMetrics.tools_list_truncated_total += 1;
    }
    return {
      unity_connection_state: this.unityConnectionState,
      capability_version: this.capabilityVersion,
      capability_updated_at: this.toIso(this.capabilityUpdatedAtMs),
      connection_updated_at: this.toIso(this.connectionUpdatedAtMs),
      last_unity_signal_at: this.toIso(this.lastUnitySignalAtMs),
      action_count: this.capabilityActionsByType.size,
      actions: actionSummaries,
      action_hints: hintPack.hints,
      token_budget: this.buildTokenBudgetSnapshot({
        toolsListTruncated: hintPack.truncated,
        schemaHintTruncated: false,
      }),
    };
  }

  getActionSchema(input) {
    this.refreshConnectionState();
    const query =
      input && typeof input === "object" && !Array.isArray(input)
        ? input
        : {
            action_type: input,
          };
    const key = normalizeString(query.action_type);
    if (!key) {
      return {
        ok: false,
        reason: "invalid_action_type",
      };
    }
    const requestedCatalogVersion = normalizeString(query.catalog_version);
    const capabilityVersion = normalizeString(this.capabilityVersion);
    if (
      requestedCatalogVersion &&
      capabilityVersion &&
      requestedCatalogVersion !== capabilityVersion
    ) {
      return {
        ok: false,
        reason: "capability_mismatch",
        capability_version: capabilityVersion,
      };
    }

    const capability = this.capabilityActionsByType.get(key);
    if (!capability) {
      return {
        ok: false,
        reason: "action_not_found",
      };
    }
    const schemaHint = this.buildSchemaHint(capability);
    if (schemaHint.truncated) {
      this.tokenBudgetMetrics.schema_hint_truncated_total += 1;
    }
    const etag = this.buildSchemaEtag(key);
    if (etag && this.isNotModified(query.if_none_match, etag)) {
      return {
        ok: true,
        not_modified: true,
        etag,
        action_type: key,
        unity_connection_state: this.unityConnectionState,
        capability_version: this.capabilityVersion,
        capability_updated_at: this.toIso(this.capabilityUpdatedAtMs),
        token_budget: this.buildTokenBudgetSnapshot({
          toolsListTruncated: false,
          schemaHintTruncated: false,
        }),
      };
    }
    return {
      ok: true,
      not_modified: false,
      etag,
      action_type: key,
      unity_connection_state: this.unityConnectionState,
      capability_version: this.capabilityVersion,
      capability_updated_at: this.toIso(this.capabilityUpdatedAtMs),
      action: cloneJson(capability),
      schema_hint: schemaHint.hint,
      schema_hint_chars: schemaHint.chars,
      schema_hint_truncated: schemaHint.truncated,
      token_budget: this.buildTokenBudgetSnapshot({
        toolsListTruncated: false,
        schemaHintTruncated: schemaHint.truncated,
      }),
    };
  }

  getActionCatalog(input) {
    this.refreshConnectionState();
    const query =
      input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const requestedCatalogVersion = normalizeString(query.catalog_version);
    const capabilityVersion = normalizeString(this.capabilityVersion);
    if (
      requestedCatalogVersion &&
      capabilityVersion &&
      requestedCatalogVersion !== capabilityVersion
    ) {
      return {
        ok: false,
        reason: "capability_mismatch",
        capability_version: capabilityVersion,
      };
    }

    const domainFilter = normalizeLowerString(query.domain);
    const tierFilter = normalizeLowerString(query.tier);
    const lifecycleFilter = normalizeLowerString(query.lifecycle);
    const cursor = normalizeCursor(query.cursor);
    const limit = normalizePositiveInt(
      query.limit,
      GET_ACTION_CATALOG_DEFAULT_LIMIT,
      GET_ACTION_CATALOG_MAX_LIMIT
    );

    const entries = this.listCatalogEntries().filter((item) => {
      if (domainFilter && normalizeLowerString(item.domain) !== domainFilter) {
        return false;
      }
      if (tierFilter && normalizeLowerString(item.tier) !== tierFilter) {
        return false;
      }
      if (
        lifecycleFilter &&
        normalizeLowerString(item.lifecycle) !== lifecycleFilter
      ) {
        return false;
      }
      return true;
    });
    const boundedCursor = cursor > entries.length ? entries.length : cursor;
    const page = entries.slice(boundedCursor, boundedCursor + limit);
    const nextCursor =
      boundedCursor + page.length < entries.length
        ? String(boundedCursor + page.length)
        : "";
    const etag = this.buildCatalogEtag({
      domain: domainFilter,
      tier: tierFilter,
      lifecycle: lifecycleFilter,
      cursor: boundedCursor,
      limit,
    });

    if (etag && this.isNotModified(query.if_none_match, etag)) {
      return {
        ok: true,
        not_modified: true,
        etag,
        catalog_version: this.capabilityVersion,
        next_cursor: nextCursor,
        total: entries.length,
      };
    }

    return {
      ok: true,
      not_modified: false,
      etag,
      catalog_version: this.capabilityVersion,
      next_cursor: nextCursor,
      total: entries.length,
      items: page.map((item) => cloneJson(item)),
      unity_connection_state: this.unityConnectionState,
      capability_updated_at: this.toIso(this.capabilityUpdatedAtMs),
      token_budget: this.buildTokenBudgetSnapshot({
        toolsListTruncated: false,
        schemaHintTruncated: false,
      }),
    };
  }

  normalizeCapabilityAction(item) {
    if (!isObject(item)) {
      return null;
    }
    const type = normalizeString(item.type);
    if (!type) {
      return null;
    }
    return {
      type,
      description: normalizeString(item.description),
      anchor_policy: normalizeString(item.anchor_policy),
      action_data_schema: isObject(item.action_data_schema)
        ? cloneJson(item.action_data_schema)
        : {},
    };
  }

  normalizeCatalogMetadata(item) {
    const source = item && typeof item === "object" ? item : {};
    const lifecycle = normalizeLowerString(source.lifecycle) || "stable";
    const tier = normalizeLowerString(source.tier) || "core";
    const domain = normalizeLowerString(source.domain) || "general";
    const undoSafety = normalizeLowerString(source.undo_safety) || "atomic_safe";
    const replacementActionType = normalizeString(source.replacement_action_type);
    return {
      lifecycle,
      tier,
      domain,
      undo_safety: undoSafety,
      replacement_action_type: replacementActionType,
    };
  }

  listActionSummaries() {
    const list = [];
    for (const capability of this.capabilityActionsByType.values()) {
      list.push({
        type: capability.type,
        description: capability.description,
        anchor_policy: capability.anchor_policy,
      });
    }
    list.sort((a, b) => String(a.type).localeCompare(String(b.type)));
    return list;
  }

  listCatalogEntries() {
    const items = [];
    for (const capability of this.capabilityActionsByType.values()) {
      const metadata =
        this.capabilityCatalogByType.get(capability.type) ||
        this.normalizeCatalogMetadata(null);
      items.push({
        type: capability.type,
        summary: capability.description,
        required_anchors: this.resolveRequiredAnchors(capability.anchor_policy),
        undo_safety: metadata.undo_safety,
        lifecycle: metadata.lifecycle,
        tier: metadata.tier,
        domain: metadata.domain,
        anchor_policy: capability.anchor_policy,
        ...(metadata.replacement_action_type
          ? { replacement_action_type: metadata.replacement_action_type }
          : {}),
      });
    }
    items.sort((a, b) => String(a.type).localeCompare(String(b.type)));
    return items;
  }

  resolveRequiredAnchors(anchorPolicy) {
    const normalized = normalizeLowerString(anchorPolicy);
    if (normalized === "target_required") {
      return ["target_anchor"];
    }
    if (normalized === "parent_required") {
      return ["parent_anchor"];
    }
    if (normalized === "target_or_parent") {
      return ["target_anchor", "parent_anchor"];
    }
    return [];
  }

  buildActionHints(actionSummaries) {
    const source = Array.isArray(actionSummaries) ? actionSummaries : [];
    const hints = [];
    let usedChars = 0;
    let truncated = false;
    for (const item of source) {
      if (hints.length >= TOOLS_LIST_MAX_ACTION_HINTS) {
        truncated = true;
        break;
      }
      const type = normalizeString(item && item.type);
      if (!type) {
        continue;
      }
      const summary = normalizeString(item && item.description);
      const summaryCost = summary ? summary.length : 0;
      if (summaryCost > 0 && usedChars + summaryCost > TOOLS_LIST_MAX_DESCRIPTION_CHARS) {
        truncated = true;
        break;
      }
      hints.push({
        type,
        summary,
        anchor_policy: normalizeString(item && item.anchor_policy),
      });
      usedChars += summaryCost;
    }

    if (!truncated && source.length > hints.length) {
      truncated = true;
    }

    return {
      hints,
      truncated,
      chars: usedChars,
    };
  }

  buildSchemaHint(capability) {
    const source = capability && typeof capability === "object" ? capability : {};
    const schema = isObject(source.action_data_schema)
      ? source.action_data_schema
      : {};
    const compact = this.compactSchema(schema, ACTION_SCHEMA_MAX_DEPTH);
    let hint = compact;
    let chars = this.measureJsonChars(hint);
    let truncated = chars > SCHEMA_HINT_MAX_CHARS;

    if (chars > SCHEMA_HINT_MAX_CHARS) {
      const withoutDescriptions = this.stripDescriptions(hint);
      chars = this.measureJsonChars(withoutDescriptions);
      hint = withoutDescriptions;
      truncated = true;
    }

    if (chars > SCHEMA_HINT_MAX_CHARS && isObject(hint.properties)) {
      const keys = Object.keys(hint.properties);
      while (keys.length > 0 && chars > SCHEMA_HINT_MAX_CHARS) {
        const key = keys.pop();
        delete hint.properties[key];
        chars = this.measureJsonChars(hint);
      }
      truncated = true;
    }

    if (chars > SCHEMA_HINT_MAX_CHARS) {
      hint = {
        type: normalizeString(schema.type) || "object",
        required: Array.isArray(schema.required)
          ? schema.required
              .filter((item) => typeof item === "string" && item.trim())
              .slice(0, 12)
          : [],
      };
      chars = this.measureJsonChars(hint);
      truncated = true;
    }

    return {
      hint,
      chars,
      truncated,
    };
  }

  compactSchema(value, depth) {
    if (depth <= 0) {
      return {};
    }
    const source = isObject(value) ? value : {};
    const compact = {
      type: normalizeString(source.type),
    };
    if (Array.isArray(source.required)) {
      compact.required = source.required
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim())
        .slice(0, ACTION_SCHEMA_MAX_PROPERTIES);
    }

    const properties = this.normalizeSchemaProperties(source.properties, depth - 1);
    if (Object.keys(properties).length > 0) {
      compact.properties = properties;
    }

    if (Array.isArray(source.enum) && source.enum.length > 0) {
      compact.enum = source.enum.slice(0, 12);
    }
    if (Number.isFinite(Number(source.minimum))) {
      compact.minimum = Number(source.minimum);
    }
    if (Number.isFinite(Number(source.maximum))) {
      compact.maximum = Number(source.maximum);
    }
    if (typeof source.description === "string" && source.description.trim()) {
      compact.description = source.description.trim().slice(0, 160);
    }

    return compact;
  }

  normalizeSchemaProperties(properties, depth) {
    if (depth <= 0) {
      return {};
    }

    const result = {};
    if (Array.isArray(properties)) {
      for (const item of properties) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const name = normalizeString(item.name);
        if (!name) {
          continue;
        }
        if (Object.keys(result).length >= ACTION_SCHEMA_MAX_PROPERTIES) {
          break;
        }
        result[name] = this.compactSchema(item, depth - 1);
      }
      return result;
    }

    if (!isObject(properties)) {
      return result;
    }

    for (const key of Object.keys(properties)) {
      if (Object.keys(result).length >= ACTION_SCHEMA_MAX_PROPERTIES) {
        break;
      }
      const normalizedKey = normalizeString(key);
      if (!normalizedKey) {
        continue;
      }
      result[normalizedKey] = this.compactSchema(properties[key], depth - 1);
    }
    return result;
  }

  stripDescriptions(node) {
    if (Array.isArray(node)) {
      return node.map((item) => this.stripDescriptions(item));
    }
    if (!isObject(node)) {
      return node;
    }
    const output = {};
    for (const key of Object.keys(node)) {
      if (key === "description") {
        continue;
      }
      output[key] = this.stripDescriptions(node[key]);
    }
    return output;
  }

  measureJsonChars(value) {
    try {
      return JSON.stringify(value || {}).length;
    } catch {
      return SCHEMA_HINT_MAX_CHARS + 1;
    }
  }

  buildCatalogEtag(params) {
    const source = params && typeof params === "object" ? params : {};
    const version = normalizeString(this.capabilityVersion) || "capability:empty";
    const domain = normalizeLowerString(source.domain) || "all";
    const tier = normalizeLowerString(source.tier) || "all";
    const lifecycle = normalizeLowerString(source.lifecycle) || "all";
    const cursor = normalizeCursor(source.cursor);
    const limit = normalizePositiveInt(
      source.limit,
      GET_ACTION_CATALOG_DEFAULT_LIMIT,
      GET_ACTION_CATALOG_MAX_LIMIT
    );
    const raw = `catalog:${version}:${domain}:${tier}:${lifecycle}:${cursor}:${limit}`;
    return quoteEtag(raw);
  }

  buildSchemaEtag(actionType) {
    const key = normalizeString(actionType) || "unknown";
    const version = normalizeString(this.capabilityVersion) || "capability:empty";
    return quoteEtag(`schema:${version}:${key}`);
  }

  isNotModified(ifNoneMatch, etag) {
    const expected = normalizeEtag(etag);
    const provided = normalizeEtag(ifNoneMatch);
    return !!expected && !!provided && expected === provided;
  }

  buildTokenBudgetSnapshot(options) {
    const opts = options && typeof options === "object" ? options : {};
    return {
      tools_list_max_action_hints: TOOLS_LIST_MAX_ACTION_HINTS,
      tools_list_max_description_chars: TOOLS_LIST_MAX_DESCRIPTION_CHARS,
      action_schema_max_properties: ACTION_SCHEMA_MAX_PROPERTIES,
      action_schema_max_depth: ACTION_SCHEMA_MAX_DEPTH,
      schema_hint_max_chars: SCHEMA_HINT_MAX_CHARS,
      tools_list_truncated: opts.toolsListTruncated === true,
      schema_hint_truncated: opts.schemaHintTruncated === true,
      tools_list_truncated_total:
        Number(this.tokenBudgetMetrics.tools_list_truncated_total) || 0,
      schema_hint_truncated_total:
        Number(this.tokenBudgetMetrics.schema_hint_truncated_total) || 0,
    };
  }

  refreshConnectionState() {
    if (this.unityConnectionState !== "ready") {
      return;
    }
    if (!this.capabilityUpdatedAtMs) {
      return;
    }
    const elapsed = this.nowMs() - this.capabilityUpdatedAtMs;
    if (elapsed > this.capabilityStaleAfterMs) {
      this.setConnectionState("stale");
    }
  }

  setConnectionState(nextState, nowMsInput) {
    const next = normalizeString(nextState) || "offline";
    if (
      next !== "offline" &&
      next !== "connecting" &&
      next !== "ready" &&
      next !== "stale"
    ) {
      return;
    }
    const nowMs = Number.isFinite(Number(nowMsInput))
      ? Math.floor(Number(nowMsInput))
      : this.nowMs();
    this.unityConnectionState = next;
    this.connectionUpdatedAtMs = nowMs;
  }

  nowMs() {
    const iso = this.nowIso();
    const parsed = Date.parse(String(iso || ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    return Date.now();
  }

  toIso(value) {
    if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
      return "";
    }
    return new Date(Math.floor(Number(value))).toISOString();
  }
}

module.exports = {
  CapabilityStore,
  DEFAULT_CAPABILITY_STALE_AFTER_MS,
  TOOLS_LIST_MAX_ACTION_HINTS,
  TOOLS_LIST_MAX_DESCRIPTION_CHARS,
  ACTION_SCHEMA_MAX_PROPERTIES,
  ACTION_SCHEMA_MAX_DEPTH,
  SCHEMA_HINT_MAX_CHARS,
  GET_ACTION_CATALOG_DEFAULT_LIMIT,
  GET_ACTION_CATALOG_MAX_LIMIT,
};

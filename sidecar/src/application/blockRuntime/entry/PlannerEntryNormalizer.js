"use strict";

const { randomUUID } = require("node:crypto");
const {
  getStaticToolCatalogSingleton,
} = require("../../ssotRuntime/staticToolCatalog");

const PLANNER_ENTRY_NORMALIZER_VERSION = "phase1_step5_planner_entry_normalizer_v1";
const PLANNER_ENTRY_TOOL_NAME = "planner_execute_mcp";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPathSegments(path) {
  const normalized = normalizeString(path);
  if (!normalized) {
    return [];
  }
  return normalized
    .split(".")
    .map((item) => normalizeString(item))
    .filter((item) => item.length > 0);
}

function getPathValue(root, path) {
  const segments = Array.isArray(path) ? path : getPathSegments(path);
  if (!isPlainObject(root) || segments.length <= 0) {
    return undefined;
  }
  let cursor = root;
  for (const segment of segments) {
    if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function setPathValue(root, path, value) {
  const segments = Array.isArray(path) ? path : getPathSegments(path);
  if (!isPlainObject(root) || segments.length <= 0) {
    return false;
  }
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!isPlainObject(cursor[segment])) {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
  return true;
}

function deletePath(root, path) {
  const segments = Array.isArray(path) ? path : getPathSegments(path);
  if (!isPlainObject(root) || segments.length <= 0) {
    return false;
  }
  let cursor = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return false;
    }
    cursor = cursor[segment];
  }
  const tail = segments[segments.length - 1];
  if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, tail)) {
    return false;
  }
  delete cursor[tail];
  return true;
}

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function valuesEquivalent(left, right) {
  if (left === right) {
    return true;
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_error) {
    return false;
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter((item) => item.length > 0);
}

function resolvePlannerUxContract(options = {}) {
  const source = isPlainObject(options) ? options : {};
  if (isPlainObject(source.uxContract)) {
    return cloneJson(source.uxContract);
  }
  if (typeof source.loadUxContract === "function") {
    const loaded = source.loadUxContract();
    if (isPlainObject(loaded)) {
      return cloneJson(loaded);
    }
    return null;
  }
  try {
    const catalog = getStaticToolCatalogSingleton();
    const record =
      catalog &&
      catalog.byName instanceof Map &&
      catalog.byName.get(PLANNER_ENTRY_TOOL_NAME);
    if (record && isPlainObject(record.ux_contract)) {
      return cloneJson(record.ux_contract);
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function buildIdempotencyKey() {
  const suffix = randomUUID().replace(/-/g, "");
  return `idp_auto_${suffix}`;
}

function matchPolicyConditions(payload, policy) {
  const source = isPlainObject(policy) ? policy : {};
  const conditions = isPlainObject(source.conditions) ? source.conditions : {};
  if (Object.prototype.hasOwnProperty.call(conditions, "block_type_in")) {
    const allowed = normalizeStringArray(conditions.block_type_in).map((item) =>
      item.toUpperCase()
    );
    if (allowed.length <= 0) {
      return false;
    }
    const blockType = normalizeString(getPathValue(payload, "block_spec.block_type")).toUpperCase();
    return allowed.includes(blockType);
  }
  return true;
}

function applyAliasRules(payload, commonAliases, normalizationMeta) {
  const aliasMap = isPlainObject(commonAliases) ? commonAliases : {};
  for (const [canonicalPath, aliasListRaw] of Object.entries(aliasMap)) {
    const aliasList = normalizeStringArray(aliasListRaw);
    if (!aliasList.length) {
      continue;
    }
    const canonicalSegments = getPathSegments(canonicalPath);
    let canonicalValue = getPathValue(payload, canonicalSegments);
    for (const aliasPath of aliasList) {
      const aliasSegments = getPathSegments(aliasPath);
      const aliasValue = getPathValue(payload, aliasSegments);
      if (!hasMeaningfulValue(aliasValue)) {
        continue;
      }
      if (!hasMeaningfulValue(canonicalValue)) {
        setPathValue(payload, canonicalSegments, cloneJson(aliasValue));
        canonicalValue = getPathValue(payload, canonicalSegments);
        deletePath(payload, aliasSegments);
        normalizationMeta.alias_hits.push({
          canonical_field: canonicalPath,
          alias_field: aliasPath,
          action: "copied_to_canonical",
        });
        continue;
      }
      if (valuesEquivalent(canonicalValue, aliasValue)) {
        deletePath(payload, aliasSegments);
        normalizationMeta.alias_hits.push({
          canonical_field: canonicalPath,
          alias_field: aliasPath,
          action: "removed_duplicate_alias",
        });
        continue;
      }
      return {
        ok: false,
        error_code: "E_SCHEMA_INVALID",
        error_message: `alias conflicts with canonical field: ${aliasPath} -> ${canonicalPath}`,
        details: {
          canonical_field: canonicalPath,
          alias_field: aliasPath,
          canonical_value: canonicalValue,
          alias_value: aliasValue,
        },
      };
    }
  }
  return { ok: true };
}

function applyAutofillRules(payload, autofillPolicy, normalizationMeta) {
  const policies = isPlainObject(autofillPolicy) ? autofillPolicy : {};
  for (const [policyName, policyRaw] of Object.entries(policies)) {
    const policy = isPlainObject(policyRaw) ? policyRaw : {};
    const fieldPath = normalizeString(policy.field);
    const strategy = normalizeString(policy.strategy);
    if (!fieldPath || !strategy) {
      continue;
    }
    if (!matchPolicyConditions(payload, policy)) {
      continue;
    }
    const currentValue = getPathValue(payload, fieldPath);
    if (hasMeaningfulValue(currentValue)) {
      continue;
    }

    let didSet = false;
    let nextValue = undefined;
    if (strategy === "default_if_missing") {
      if (Object.prototype.hasOwnProperty.call(policy, "value")) {
        nextValue = cloneJson(policy.value);
        didSet = true;
      }
    } else if (strategy === "generate_if_missing") {
      nextValue = buildIdempotencyKey();
      didSet = true;
      normalizationMeta.generated_fields.push(fieldPath);
    } else if (strategy === "copy_if_missing") {
      const sourceField = normalizeString(policy.source_field);
      const sourceValue = getPathValue(payload, sourceField);
      if (hasMeaningfulValue(sourceValue)) {
        nextValue = cloneJson(sourceValue);
        didSet = true;
      }
    } else if (strategy === "copy_from_context_if_missing") {
      const contextPriority = normalizeStringArray(policy.context_priority);
      for (const contextPath of contextPriority) {
        const sourceValue = getPathValue(payload, contextPath);
        if (hasMeaningfulValue(sourceValue)) {
          nextValue = cloneJson(sourceValue);
          didSet = true;
          break;
        }
      }
    }

    if (didSet) {
      setPathValue(payload, fieldPath, nextValue);
      normalizationMeta.auto_filled_fields.push({
        field: fieldPath,
        policy: policyName,
        strategy,
      });
    }
  }
}

function createPlannerEntryNormalizer(options = {}) {
  const uxContract = resolvePlannerUxContract(options);

  function normalizePayload(rawPayload) {
    const payload = isPlainObject(rawPayload) ? cloneJson(rawPayload) : {};
    const normalizationMeta = {
      normalizer_version: PLANNER_ENTRY_NORMALIZER_VERSION,
      rules_source: uxContract ? "ssot_ux_contract" : "none",
      alias_hits: [],
      auto_filled_fields: [],
      generated_fields: [],
    };
    if (!uxContract) {
      return {
        ok: true,
        payload,
        normalization_meta: normalizationMeta,
      };
    }

    const aliasOutcome = applyAliasRules(
      payload,
      uxContract.common_aliases,
      normalizationMeta
    );
    if (!aliasOutcome.ok) {
      return {
        ...aliasOutcome,
        normalization_meta: normalizationMeta,
      };
    }

    applyAutofillRules(payload, uxContract.autofill_policy, normalizationMeta);

    return {
      ok: true,
      payload,
      normalization_meta: normalizationMeta,
    };
  }

  return {
    version: PLANNER_ENTRY_NORMALIZER_VERSION,
    normalizePayload,
  };
}

module.exports = {
  PLANNER_ENTRY_NORMALIZER_VERSION,
  createPlannerEntryNormalizer,
};


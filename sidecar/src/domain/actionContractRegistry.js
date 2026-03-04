"use strict";

const {
  VISUAL_ACTION_ALIAS_TO_CANONICAL,
  canonicalizeVisualActionType,
  normalizeVisualActionType,
} = require("./actionTypeCanonicalizer");

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

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function normalizeAnchorPolicy(value) {
  const normalized = normalizeLowerString(value);
  if (normalized === "target_required") {
    return "target_required";
  }
  if (normalized === "parent_required") {
    return "parent_required";
  }
  if (
    normalized === "target_or_parent" ||
    normalized === "target_or_parent_required"
  ) {
    return "target_or_parent_required";
  }
  if (normalized === "target_and_parent_required") {
    return "target_and_parent_required";
  }
  return "";
}

function resolveAnchorRequirement(anchorPolicy) {
  const normalized = normalizeAnchorPolicy(anchorPolicy);
  if (normalized) {
    return normalized;
  }
  return "target_required";
}

function normalizeSchemaProperties(properties) {
  const output = Object.create(null);
  if (Array.isArray(properties)) {
    for (const item of properties) {
      if (!isObject(item)) {
        continue;
      }
      const key = normalizeString(item.name);
      if (!key) {
        continue;
      }
      output[key] = cloneJson(item) || {};
    }
    return output;
  }

  if (!isObject(properties)) {
    return output;
  }
  for (const key of Object.keys(properties)) {
    const normalizedKey = normalizeString(key);
    if (!normalizedKey) {
      continue;
    }
    output[normalizedKey] = cloneJson(properties[key]) || {};
  }
  return output;
}

function normalizeActionDataSchema(schema) {
  const source = isObject(schema) ? schema : {};
  const requiredRaw = Array.isArray(source.required) ? source.required : [];
  const required = [];
  const requiredSet = new Set();
  for (const item of requiredRaw) {
    if (typeof item !== "string") {
      continue;
    }
    const key = item.trim();
    if (!key || requiredSet.has(key)) {
      continue;
    }
    requiredSet.add(key);
    required.push(key);
  }
  return {
    type: normalizeLowerString(source.type) || "object",
    required,
    properties: normalizeSchemaProperties(source.properties),
  };
}

function buildAliasIndex() {
  const aliasesByCanonical = new Map();
  for (const [alias, canonical] of Object.entries(
    VISUAL_ACTION_ALIAS_TO_CANONICAL
  )) {
    const normalizedAlias = normalizeVisualActionType(alias);
    const normalizedCanonical = normalizeVisualActionType(canonical);
    if (!normalizedAlias || !normalizedCanonical) {
      continue;
    }
    if (!aliasesByCanonical.has(normalizedCanonical)) {
      aliasesByCanonical.set(normalizedCanonical, new Set());
    }
    aliasesByCanonical.get(normalizedCanonical).add(normalizedAlias);
  }
  return aliasesByCanonical;
}

function createActionContractRegistry(options) {
  const opts = options && typeof options === "object" ? options : {};
  const getCapabilityVersion =
    typeof opts.getCapabilityVersion === "function"
      ? opts.getCapabilityVersion
      : () => "";
  const listActionSummaries =
    typeof opts.listActionSummaries === "function"
      ? opts.listActionSummaries
      : () => [];
  const resolveActionSchema =
    typeof opts.resolveActionSchema === "function"
      ? opts.resolveActionSchema
      : () => null;

  const aliasesByCanonical = buildAliasIndex();
  let cacheVersion = "";
  let summaryIndex = new Map();
  let contractCache = new Map();

  function normalizeCapabilityVersion() {
    return normalizeString(getCapabilityVersion());
  }

  function refreshVersionCache() {
    const version = normalizeCapabilityVersion();
    if (version !== cacheVersion) {
      cacheVersion = version;
      summaryIndex = new Map();
      contractCache = new Map();
    }
  }

  function ensureSummaryIndex() {
    refreshVersionCache();
    if (summaryIndex.size > 0) {
      return summaryIndex;
    }
    const summaries = Array.isArray(listActionSummaries())
      ? listActionSummaries()
      : [];
    for (const item of summaries) {
      if (!isObject(item)) {
        continue;
      }
      const rawType = normalizeString(item.type);
      if (!rawType) {
        continue;
      }
      const normalizedType = normalizeVisualActionType(rawType);
      if (!normalizedType) {
        continue;
      }
      summaryIndex.set(normalizedType, {
        type: normalizedType,
        canonical_type:
          canonicalizeVisualActionType(normalizedType) || normalizedType,
        description: normalizeString(item.description),
        anchor_policy: normalizeAnchorPolicy(item.anchor_policy),
      });
    }
    return summaryIndex;
  }

  function readActionSchema(actionType) {
    const target = normalizeString(actionType);
    if (!target) {
      return null;
    }
    const outcome = resolveActionSchema(target);
    if (!isObject(outcome) || outcome.ok !== true || !isObject(outcome.action)) {
      return null;
    }
    return outcome;
  }

  function collectCandidateTypes(canonicalType, requestType) {
    const set = new Set();
    const push = (value) => {
      const normalized = normalizeVisualActionType(value);
      if (normalized) {
        set.add(normalized);
      }
    };
    push(canonicalType);
    push(requestType);
    const index = ensureSummaryIndex();
    for (const type of index.keys()) {
      if ((canonicalizeVisualActionType(type) || type) === canonicalType) {
        set.add(type);
      }
    }
    const aliasSet = aliasesByCanonical.get(canonicalType);
    if (aliasSet instanceof Set) {
      for (const alias of aliasSet.values()) {
        push(alias);
      }
    }
    return [...set];
  }

  function buildContractFromSources(requestType) {
    const normalizedRequestType = normalizeVisualActionType(requestType);
    if (!normalizedRequestType) {
      return null;
    }
    const canonicalType =
      canonicalizeVisualActionType(normalizedRequestType) || normalizedRequestType;
    const index = ensureSummaryIndex();
    const candidateTypes = collectCandidateTypes(
      canonicalType,
      normalizedRequestType
    );

    let actionSchemaOutcome = null;
    for (const candidate of candidateTypes) {
      actionSchemaOutcome = readActionSchema(candidate);
      if (actionSchemaOutcome) {
        break;
      }
    }

    const summary = index.get(normalizedRequestType) || index.get(canonicalType) || null;
    if (!actionSchemaOutcome && !summary) {
      return null;
    }
    const action =
      actionSchemaOutcome && isObject(actionSchemaOutcome.action)
        ? actionSchemaOutcome.action
        : {};
    const actionTypeFromSchema = normalizeVisualActionType(action.type);
    const resolvedCanonicalType =
      canonicalizeVisualActionType(actionTypeFromSchema || canonicalType) ||
      canonicalType;
    const aliasSet = new Set();
    const staticAliases = aliasesByCanonical.get(resolvedCanonicalType);
    if (staticAliases instanceof Set) {
      for (const alias of staticAliases.values()) {
        aliasSet.add(alias);
      }
    }
    for (const candidate of candidateTypes) {
      if ((canonicalizeVisualActionType(candidate) || candidate) === resolvedCanonicalType) {
        aliasSet.add(candidate);
      }
    }
    aliasSet.delete(resolvedCanonicalType);

    const anchorPolicy = normalizeAnchorPolicy(
      action.anchor_policy || (summary && summary.anchor_policy)
    );
    const actionDataSchema = normalizeActionDataSchema(action.action_data_schema);
    return {
      action_type: resolvedCanonicalType,
      aliases: [...aliasSet].sort(),
      anchor_policy: anchorPolicy,
      anchor_requirement: resolveAnchorRequirement(anchorPolicy),
      description: normalizeString(action.description || (summary && summary.description)),
      action_data_schema: actionDataSchema,
      capability_version: cacheVersion,
    };
  }

  function resolveActionContract(actionType) {
    const normalized = normalizeVisualActionType(actionType);
    if (!normalized) {
      return null;
    }
    const canonical = canonicalizeVisualActionType(normalized) || normalized;
    refreshVersionCache();
    if (contractCache.has(canonical)) {
      return cloneJson(contractCache.get(canonical));
    }
    const contract = buildContractFromSources(normalized);
    if (!contract) {
      return null;
    }
    contractCache.set(contract.action_type, contract);
    return cloneJson(contract);
  }

  function listActionContracts() {
    const index = ensureSummaryIndex();
    const contracts = [];
    const seen = new Set();
    for (const type of index.keys()) {
      const contract = resolveActionContract(type);
      if (!contract || !contract.action_type || seen.has(contract.action_type)) {
        continue;
      }
      seen.add(contract.action_type);
      contracts.push(contract);
    }
    contracts.sort((left, right) =>
      String(left.action_type).localeCompare(String(right.action_type))
    );
    return contracts.map((item) => cloneJson(item));
  }

  function resolveActionAnchorPolicy(actionType) {
    const contract = resolveActionContract(actionType);
    return contract && contract.anchor_policy ? contract.anchor_policy : "";
  }

  function resolveRequiredActionDataFields(actionType) {
    const contract = resolveActionContract(actionType);
    if (!contract || !isObject(contract.action_data_schema)) {
      return [];
    }
    return Array.isArray(contract.action_data_schema.required)
      ? [...contract.action_data_schema.required]
      : [];
  }

  return {
    resolveActionContract,
    listActionContracts,
    resolveActionAnchorPolicy,
    resolveRequiredActionDataFields,
  };
}

function createCapabilityActionContractRegistry(capabilityStore) {
  const source = capabilityStore && typeof capabilityStore === "object"
    ? capabilityStore
    : null;
  return createActionContractRegistry({
    getCapabilityVersion() {
      if (!source || typeof source.getSnapshot !== "function") {
        return "";
      }
      const snapshot = source.getSnapshot();
      return snapshot && typeof snapshot === "object"
        ? snapshot.capability_version
        : "";
    },
    listActionSummaries() {
      if (!source || typeof source.getSnapshot !== "function") {
        return [];
      }
      const snapshot = source.getSnapshot();
      return snapshot && Array.isArray(snapshot.actions) ? snapshot.actions : [];
    },
    resolveActionSchema(actionType) {
      if (!source || typeof source.getActionSchema !== "function") {
        return null;
      }
      return source.getActionSchema({
        action_type: actionType,
      });
    },
  });
}

module.exports = {
  createActionContractRegistry,
  createCapabilityActionContractRegistry,
  normalizeAnchorPolicy,
  resolveAnchorRequirement,
  normalizeActionDataSchema,
};

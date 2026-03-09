"use strict";

const FALLBACK_POLICY_GUARD_VERSION = "phase1_step5_plnr008_v1";
const GENERIC_FALLBACK_STRICT_ENV_KEY = "MCP_GENERIC_FALLBACK_STRICT";
const GENERIC_FALLBACK_TOOL_NAME = "set_serialized_property";
const DEFAULT_ALLOWED_CAPABILITY_FAMILIES = Object.freeze(["Write.GenericProperty"]);
const DEFAULT_SOURCE_FAMILY_ALIAS_MAP = Object.freeze({
  "mutate.component_properties": "Write.GenericProperty",
});

const STRICT_SWITCH_POLICY = Object.freeze({
  enabled_values: Object.freeze(["1", "true", "on", "enabled", "yes"]),
  disabled_values: Object.freeze(["0", "false", "off", "disabled", "no"]),
  default_enabled: true,
});

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter((item) => !!item);
}

function normalizeFallbackPolicy(policy) {
  const source = normalizeObject(policy);
  const mode = normalizeString(source.mode) || "disabled";
  const trigger = normalizeString(source.trigger) || "never";
  const tools = normalizeStringArray(source.tools);
  return {
    mode,
    trigger,
    tools,
  };
}

function resolveGenericFallbackStrictEnabled(options = {}) {
  const source = normalizeObject(options);
  if (typeof source.generic_fallback_strict === "boolean") {
    return source.generic_fallback_strict;
  }
  const envValue = normalizeString(
    process.env[GENERIC_FALLBACK_STRICT_ENV_KEY]
  ).toLowerCase();
  if (!envValue) {
    return STRICT_SWITCH_POLICY.default_enabled;
  }
  if (STRICT_SWITCH_POLICY.enabled_values.includes(envValue)) {
    return true;
  }
  if (STRICT_SWITCH_POLICY.disabled_values.includes(envValue)) {
    return false;
  }
  return STRICT_SWITCH_POLICY.default_enabled;
}

function resolveSourceCapabilityFamily(familyKey, aliasMap) {
  const normalizedFamilyKey = normalizeString(familyKey);
  if (!normalizedFamilyKey) {
    return "";
  }
  const aliases = normalizeObject(aliasMap);
  const fromAlias = normalizeString(aliases[normalizedFamilyKey]);
  if (fromAlias) {
    return fromAlias;
  }
  return normalizedFamilyKey;
}

function buildFamilyRejectedError({
  familyKey,
  sourceCapabilityFamily,
  fallbackPolicy,
  allowedCapabilityFamilies,
}) {
  return {
    error_code: "E_PRECONDITION_FAILED",
    block_error_code: "E_BLOCK_FALLBACK_NOT_ALLOWED",
    error_message: `generic fallback strict guard rejected family: ${familyKey || "unknown_family"}`,
    details: {
      family_key: familyKey,
      source_capability_family: sourceCapabilityFamily,
      fallback_policy_mode: fallbackPolicy.mode,
      fallback_candidates: fallbackPolicy.tools,
      allowed_source_capability_families: allowedCapabilityFamilies,
      strict_env_key: GENERIC_FALLBACK_STRICT_ENV_KEY,
    },
  };
}

function evaluateFallbackPolicyGuard(input = {}, options = {}) {
  const source = normalizeObject(input);
  const runtimeOptions = normalizeObject(options);
  const familyKey = normalizeString(source.family_key);
  const fallbackPolicy = normalizeFallbackPolicy(source.fallback_policy);
  const strictEnabled = resolveGenericFallbackStrictEnabled(runtimeOptions);
  const aliasMap = normalizeObject(runtimeOptions.source_family_alias_map);
  const sourceCapabilityFamily = resolveSourceCapabilityFamily(
    familyKey,
    Object.keys(aliasMap).length > 0 ? aliasMap : DEFAULT_SOURCE_FAMILY_ALIAS_MAP
  );
  const allowedCapabilityFamilies = normalizeStringArray(
    Array.isArray(runtimeOptions.allowed_source_capability_families)
      ? runtimeOptions.allowed_source_capability_families
      : DEFAULT_ALLOWED_CAPABILITY_FAMILIES
  );
  const usesGenericFallbackTool = fallbackPolicy.tools.includes(
    GENERIC_FALLBACK_TOOL_NAME
  );

  if (
    strictEnabled !== true ||
    fallbackPolicy.mode !== "controlled" ||
    usesGenericFallbackTool !== true
  ) {
    return {
      ok: true,
      strict_enabled: strictEnabled,
      source_capability_family: sourceCapabilityFamily,
      fallback_policy: fallbackPolicy,
      guard_state: strictEnabled === true ? "not_applicable" : "strict_disabled",
    };
  }

  if (!allowedCapabilityFamilies.includes(sourceCapabilityFamily)) {
    return {
      ok: false,
      strict_enabled: strictEnabled,
      source_capability_family: sourceCapabilityFamily,
      fallback_policy: fallbackPolicy,
      error: buildFamilyRejectedError({
        familyKey,
        sourceCapabilityFamily,
        fallbackPolicy,
        allowedCapabilityFamilies,
      }),
    };
  }

  const guardedTools = [GENERIC_FALLBACK_TOOL_NAME];
  return {
    ok: true,
    strict_enabled: strictEnabled,
    source_capability_family: sourceCapabilityFamily,
    fallback_policy: {
      mode: fallbackPolicy.mode,
      trigger: fallbackPolicy.trigger,
      tools: guardedTools,
    },
    guard_state: "strict_allowed",
  };
}

module.exports = {
  FALLBACK_POLICY_GUARD_VERSION,
  GENERIC_FALLBACK_STRICT_ENV_KEY,
  GENERIC_FALLBACK_TOOL_NAME,
  DEFAULT_ALLOWED_CAPABILITY_FAMILIES,
  DEFAULT_SOURCE_FAMILY_ALIAS_MAP,
  resolveGenericFallbackStrictEnabled,
  evaluateFallbackPolicyGuard,
};

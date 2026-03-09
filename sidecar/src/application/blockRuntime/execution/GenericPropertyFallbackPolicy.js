"use strict";

const GENERIC_PROPERTY_FALLBACK_POLICY_VERSION = "phase1_stepE_v1";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toFrozenStringArray(value) {
  const source = Array.isArray(value) ? value : [];
  const output = [];
  const seen = new Set();
  for (const item of source) {
    const normalized = normalizeString(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return Object.freeze(output);
}

function compileRegexList(value) {
  const source = Array.isArray(value) ? value : [];
  const compiled = [];
  for (const item of source) {
    const pattern = normalizeString(item);
    if (!pattern) {
      continue;
    }
    try {
      compiled.push(new RegExp(pattern));
    } catch (_error) {
      // Fail-closed at pattern level: invalid patterns are ignored.
    }
  }
  return Object.freeze(compiled);
}

function matchAnyRegex(regexList, value) {
  const list = Array.isArray(regexList) ? regexList : [];
  if (list.length === 0) {
    return false;
  }
  for (const regex of list) {
    if (regex && typeof regex.test === "function" && regex.test(value)) {
      return true;
    }
  }
  return false;
}

function buildNotAllowedError(familyKey, fallbackToolName, allowedFamilyKeys) {
  return {
    error_code: "E_PRECONDITION_FAILED",
    block_error_code: "E_BLOCK_FALLBACK_NOT_ALLOWED",
    error_message: `generic fallback is not allowed for family: ${familyKey || "unknown_family"} (${fallbackToolName || "unknown_tool"})`,
    suggested_action: "use_family_primary_tool",
    retry_policy: {
      can_retry: false,
    },
    details: {
      fallback_tool_name: fallbackToolName,
      allowed_source_capability_families: allowedFamilyKeys,
    },
  };
}

function buildPreconditionError(message, suggestedAction, details) {
  return {
    error_code: "E_SCHEMA_INVALID",
    error_message: message,
    suggested_action: normalizeString(suggestedAction) || "get_serialized_property_tree",
    retry_policy: {
      can_retry: true,
    },
    details: normalizeObject(details),
  };
}

function normalizePreconditionContext(blockSpec) {
  const source = normalizeObject(blockSpec);
  const input = normalizeObject(source.input);
  return {
    component_type: normalizeString(input.component_type),
    property_path: normalizeString(input.property_path),
  };
}

function createGenericPropertyFallbackPolicy(contract = {}) {
  const source = normalizeObject(contract);
  const enabled = source.enabled !== false;
  const allowedCapabilityFamilies = toFrozenStringArray(
    Array.isArray(source.allowed_source_capability_families)
      ? source.allowed_source_capability_families
      : ["Write.GenericProperty"]
  );
  const sourceFamilyAliasMap = normalizeObject(
    source.source_family_alias_map &&
      typeof source.source_family_alias_map === "object"
      ? source.source_family_alias_map
      : {
          "mutate.component_properties": "Write.GenericProperty",
        }
  );
  const componentTypeRegex = compileRegexList(
    Array.isArray(source.component_type_whitelist_patterns)
      ? source.component_type_whitelist_patterns
      : ["^UnityEngine\\.[A-Za-z0-9_+.]+\\s*,\\s*[A-Za-z0-9_+.]+$"]
  );
  const propertyPathRegex = compileRegexList(
    Array.isArray(source.property_path_whitelist_patterns)
      ? source.property_path_whitelist_patterns
      : ["^m_[A-Za-z0-9_.\\[\\]-]+$"]
  );

  function evaluate(input = {}) {
    const payload = normalizeObject(input);
    const mappingMeta = normalizeObject(payload.mapping_meta);
    const familyKey = normalizeString(mappingMeta.family_key);
    const sourceCapabilityFamily =
      normalizeString(mappingMeta.source_capability_family) ||
      normalizeString(sourceFamilyAliasMap[familyKey]) ||
      familyKey;
    const fallbackToolName = normalizeString(payload.fallback_tool_name);
    const preconditions = normalizePreconditionContext(payload.block_spec);
    const primaryAttempted = payload.primary_attempted === true;
    const componentTypeMatched = matchAnyRegex(
      componentTypeRegex,
      preconditions.component_type
    );
    const propertyPathMatched = matchAnyRegex(
      propertyPathRegex,
      preconditions.property_path
    );

    if (!enabled) {
      return {
        ok: false,
        reason_code: "fallback_disabled",
        fallback_reason: "generic_fallback_disabled",
        error: buildNotAllowedError(
          familyKey,
          fallbackToolName,
          allowedCapabilityFamilies
        ),
      };
    }

    if (!allowedCapabilityFamilies.includes(sourceCapabilityFamily)) {
      return {
        ok: false,
        reason_code: "family_not_allowed",
        fallback_reason: "family_not_allowed_for_generic_fallback",
        error: buildNotAllowedError(
          familyKey,
          fallbackToolName,
          allowedCapabilityFamilies
        ),
      };
    }

    if (!primaryAttempted) {
      return {
        ok: false,
        reason_code: "missing_specialized_attempted",
        fallback_reason: "missing_primary_attempt_evidence",
        error: buildPreconditionError(
          "generic fallback requires primary specialized tool attempt before fallback",
          "use_family_primary_tool",
          {
            family_key: familyKey,
            source_capability_family: sourceCapabilityFamily,
            fallback_tool_name: fallbackToolName,
          }
        ),
      };
    }

    if (!componentTypeMatched || !propertyPathMatched) {
      return {
        ok: false,
        reason_code: "whitelist_not_matched",
        fallback_reason: "component_or_property_whitelist_miss",
        error: buildPreconditionError(
          "generic fallback requires component_type/property_path whitelist match",
          "preflight_validate_write_payload",
          {
            family_key: familyKey,
            source_capability_family: sourceCapabilityFamily,
            fallback_tool_name: fallbackToolName,
            component_type: preconditions.component_type,
            property_path: preconditions.property_path,
          }
        ),
      };
    }

    return {
      ok: true,
      reason_code: "fallback_allowed",
      fallback_reason: "controlled_generic_property_fallback",
      evidence: {
        family_key: familyKey,
        source_capability_family: sourceCapabilityFamily,
        fallback_tool_name: fallbackToolName,
        primary_attempted: primaryAttempted,
        component_type_whitelist_matched: componentTypeMatched,
        property_path_whitelist_matched: propertyPathMatched,
      },
    };
  }

  return {
    version: GENERIC_PROPERTY_FALLBACK_POLICY_VERSION,
    enabled,
    allowed_source_capability_families: allowedCapabilityFamilies,
    source_family_alias_map: sourceFamilyAliasMap,
    evaluate,
  };
}

module.exports = {
  GENERIC_PROPERTY_FALLBACK_POLICY_VERSION,
  createGenericPropertyFallbackPolicy,
};

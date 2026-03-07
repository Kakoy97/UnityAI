"use strict";

const { getStaticToolCatalogSingleton } = require("./staticToolCatalog");
const {
  buildContractBundleCacheKey,
  getContractBundleCacheSingleton,
} = require("./contractBundleCache");

const DEFAULT_BUDGET_CHARS = 12000;
const MAX_RELATED_TOOLS = 5;
const CONTRACT_VERSION = "2.0";
const BUDGET_ERROR_CODE = "E_CONTRACT_BUDGET_TOO_SMALL";

const MINIMAL_REQUIRED_FIELD_KEYS = Object.freeze([
  "minimal_valid_payload_template",
  "required_fields",
  "common_mistakes",
  "write_envelope_contract",
  "validation_tool",
]);

const OPTIONAL_FIELD_KEYS = Object.freeze([
  "action_type",
  "usage_notes",
  "quick_fixes",
  "recovery_paths",
  "related_contracts",
  "examples_negative",
  "enhanced_fields",
  "legacy_fields",
]);

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  return !!fallback;
}

function normalizePositiveInteger(value, fallbackValue) {
  const fallback = Number.isFinite(Number(fallbackValue))
    ? Math.floor(Number(fallbackValue))
    : DEFAULT_BUDGET_CHARS;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function estimateSize(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function getToolRecord(catalog, toolName) {
  if (!catalog || !(catalog.byName instanceof Map)) {
    return null;
  }
  return catalog.byName.get(toolName) || null;
}

function buildFallbackTemplate(toolRecord) {
  const template = {};
  const required = Array.isArray(toolRecord && toolRecord.required)
    ? toolRecord.required
    : [];
  for (const field of required) {
    template[field] = `__${field}__`;
  }
  return template;
}

function pickMinimalTemplateFromExamples(toolRecord) {
  const examples = Array.isArray(toolRecord && toolRecord.examples)
    ? toolRecord.examples
    : [];
  for (const entry of examples) {
    if (
      entry &&
      typeof entry === "object" &&
      entry.request &&
      typeof entry.request === "object" &&
      !Array.isArray(entry.request)
    ) {
      return cloneJson(entry.request);
    }
  }
  return buildFallbackTemplate(toolRecord);
}

function pickScenarioCombinations(toolRecord, scenario) {
  const combinations = Array.isArray(toolRecord && toolRecord.tool_combinations)
    ? toolRecord.tool_combinations
    : [];
  const normalizedScenario = normalizeString(scenario);
  if (!normalizedScenario) {
    return cloneJson(combinations);
  }
  const filtered = combinations.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    return normalizeString(item.scenario) === normalizedScenario;
  });
  return cloneJson(filtered.length > 0 ? filtered : combinations);
}

function pickExamplesPositive(toolRecord, includeCanonicalExamples, scenario) {
  const positive = Array.isArray(toolRecord && toolRecord.examples_positive)
    ? toolRecord.examples_positive
    : [];
  if (!includeCanonicalExamples) {
    return [];
  }
  const normalizedScenario = normalizeString(scenario);
  if (!normalizedScenario) {
    return cloneJson(positive);
  }
  const filtered = positive.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    return normalizeString(item.scenario) === normalizedScenario;
  });
  return cloneJson(filtered.length > 0 ? filtered : positive);
}

function ensureCommonMistakes(toolRecord) {
  const source = Array.isArray(toolRecord && toolRecord.examples_negative)
    ? cloneJson(toolRecord.examples_negative)
    : [];
  if (source.length > 0) {
    return source;
  }
  return [
    {
      category: "contract_usage",
      wrong: "unknown_or_guess_field",
      fix_action: "get_tool_schema",
      note: "Do not guess payload fields. Use required_fields + get_tool_schema/get_write_contract_bundle.",
    },
  ];
}

function buildRelatedContracts(catalog, toolRecord, includeRelated, budgetChars) {
  if (!includeRelated) {
    return [];
  }
  const related = Array.isArray(toolRecord && toolRecord.related_tools)
    ? toolRecord.related_tools
    : [];
  const output = [];
  const maxTools = Math.min(
    MAX_RELATED_TOOLS,
    Math.max(1, Math.floor(budgetChars / 2500))
  );
  for (const toolName of related) {
    if (output.length >= maxTools) {
      break;
    }
    const relatedRecord = getToolRecord(catalog, toolName);
    if (!relatedRecord) {
      continue;
    }
    output.push({
      tool_name: relatedRecord.name,
      kind: relatedRecord.kind,
      tool_priority: relatedRecord.tool_priority,
      required_fields: Array.isArray(relatedRecord.required)
        ? relatedRecord.required
        : [],
      usage_notes:
        typeof relatedRecord.usage_notes === "string"
          ? relatedRecord.usage_notes
          : "",
    });
  }
  return output;
}

function normalizeFixSteps(fixSteps) {
  const source = Array.isArray(fixSteps) ? fixSteps : [];
  return source.map((step, index) => ({
    step:
      Number.isFinite(Number(step && step.step)) && Number(step.step) >= 1
        ? Math.floor(Number(step.step))
        : index + 1,
    step_id: normalizeString(step && step.step_id) || `fix_step_${index + 1}`,
    tool: normalizeString(step && step.tool),
    required:
      step && typeof step.required === "boolean" ? step.required : true,
    depends_on: Array.isArray(step && step.depends_on)
      ? step.depends_on.map((token) => normalizeString(token)).filter(Boolean)
      : [],
    ...(typeof (step && step.idempotent) === "boolean"
      ? { idempotent: step.idempotent }
      : {}),
    ...(step &&
    step.verification &&
    typeof step.verification === "object" &&
    !Array.isArray(step.verification)
      ? { verification: cloneJson(step.verification) }
      : {}),
    ...(Array.isArray(step && step.context_bindings)
      ? {
          context_bindings: step.context_bindings
            .map((token) => normalizeString(token))
            .filter(Boolean),
        }
      : {}),
  }));
}

function normalizeQuickFixMap(toolRecord, catalog) {
  const source =
    toolRecord &&
    toolRecord.common_error_fixes &&
    typeof toolRecord.common_error_fixes === "object" &&
    !Array.isArray(toolRecord.common_error_fixes)
      ? toolRecord.common_error_fixes
      : {};
  const output = {};
  const byName = catalog && catalog.byName instanceof Map ? catalog.byName : null;
  for (const [errorCode, fix] of Object.entries(source)) {
    if (!fix || typeof fix !== "object" || Array.isArray(fix)) {
      continue;
    }
    const suggestedAction = normalizeString(fix.suggested_action);
    const explicitSuggestedTool = normalizeString(fix.suggested_tool);
    const resolvedSuggestedTool = explicitSuggestedTool || suggestedAction;
    output[errorCode] = {
      ...cloneJson(fix),
      suggested_action: suggestedAction,
      suggested_tool:
        resolvedSuggestedTool && byName && byName.has(resolvedSuggestedTool)
          ? resolvedSuggestedTool
          : suggestedAction,
      fix_steps: normalizeFixSteps(fix.fix_steps),
    };
  }
  const anchorConflictQuickFix = buildAnchorConflictQuickFix(toolRecord, catalog);
  if (
    anchorConflictQuickFix &&
    !Object.prototype.hasOwnProperty.call(output, "E_TARGET_ANCHOR_CONFLICT")
  ) {
    output.E_TARGET_ANCHOR_CONFLICT = anchorConflictQuickFix;
  }
  return output;
}

function isCreateFamilyTool(toolRecord) {
  if (!toolRecord || typeof toolRecord !== "object") {
    return false;
  }
  const toolName = normalizeString(toolRecord.name);
  if (!toolName) {
    return false;
  }
  return toolName === "create_object" || toolName.startsWith("create_");
}

function buildCreatePreCheckPolicy(toolRecord, catalog) {
  if (!isCreateFamilyTool(toolRecord)) {
    return null;
  }
  const globalContracts =
    catalog && typeof catalog.globalContracts === "object"
      ? catalog.globalContracts
      : {};
  const createFamily =
    globalContracts &&
    typeof globalContracts.create_family === "object" &&
    !Array.isArray(globalContracts.create_family)
      ? globalContracts.create_family
      : {};
  const preCheckPolicy =
    createFamily &&
    typeof createFamily.pre_check_policy === "object" &&
    !Array.isArray(createFamily.pre_check_policy)
      ? createFamily.pre_check_policy
      : {};
  const ambiguityContract =
    globalContracts &&
    typeof globalContracts.ambiguity_resolution_policy_contract === "object" &&
    !Array.isArray(globalContracts.ambiguity_resolution_policy_contract)
      ? globalContracts.ambiguity_resolution_policy_contract
      : {};
  const nameCollision =
    ambiguityContract &&
    typeof ambiguityContract.name_collision === "object" &&
    !Array.isArray(ambiguityContract.name_collision)
      ? ambiguityContract.name_collision
      : {};
  const allowedPolicies = Array.isArray(nameCollision.allowed_policies)
    ? nameCollision.allowed_policies
        .map((item) => normalizeString(item))
        .filter(Boolean)
    : [];

  return {
    check_existing: preCheckPolicy.check_existing === true,
    on_conflict:
      normalizeString(preCheckPolicy.on_conflict) ||
      normalizeString(nameCollision.default_policy) ||
      "fail",
    return_candidates: preCheckPolicy.return_candidates === true,
    policy_field: normalizeString(preCheckPolicy.policy_field) || "name_collision_policy",
    allowed_policies:
      allowedPolicies.length > 0 ? allowedPolicies : ["fail", "suffix", "reuse"],
  };
}

function isAnchorWriteTool(toolRecord) {
  if (!toolRecord || typeof toolRecord !== "object") {
    return false;
  }
  if (normalizeString(toolRecord.kind).toLowerCase() !== "write") {
    return false;
  }
  const required = Array.isArray(toolRecord.required) ? toolRecord.required : [];
  return required.includes("target_object_id") && required.includes("target_path");
}

function buildAnchorConflictQuickFix(toolRecord, catalog) {
  if (!isAnchorWriteTool(toolRecord)) {
    return null;
  }
  const globalContracts =
    catalog && typeof catalog.globalContracts === "object"
      ? catalog.globalContracts
      : {};
  const ambiguityContract =
    globalContracts &&
    typeof globalContracts.ambiguity_resolution_policy_contract === "object" &&
    !Array.isArray(globalContracts.ambiguity_resolution_policy_contract)
      ? globalContracts.ambiguity_resolution_policy_contract
      : {};
  const anchorConflict =
    ambiguityContract &&
    typeof ambiguityContract.anchor_conflict === "object" &&
    !Array.isArray(ambiguityContract.anchor_conflict)
      ? ambiguityContract.anchor_conflict
      : {};
  const requiredActions = Array.isArray(anchorConflict.required_actions)
    ? anchorConflict.required_actions
        .map((item) => normalizeString(item))
        .filter(Boolean)
    : [];
  const inspectTool = requiredActions[0] || "get_hierarchy_subtree";
  return {
    suggested_action: inspectTool,
    suggested_tool: inspectTool,
    fix_hint:
      "Anchor conflict detected. Inspect both anchor candidates, choose one object, and retry with matched target_path/target_object_id.",
    context_required: ["during_dispatch"],
    fix_steps: [
      {
        step: 1,
        step_id: "inspect_path_anchor_candidate",
        tool: inspectTool,
        required: true,
        idempotent: true,
        context_bindings: ["path_candidate_path", "path_candidate_object_id"],
      },
      {
        step: 2,
        step_id: "inspect_object_id_anchor_candidate",
        tool: inspectTool,
        required: true,
        idempotent: true,
        depends_on: ["inspect_path_anchor_candidate"],
        context_bindings: [
          "object_id_candidate_path",
          "object_id_candidate_object_id",
        ],
      },
      {
        step: 3,
        step_id: "retry_with_matched_anchor",
        tool: normalizeString(toolRecord.name),
        required: true,
        idempotent: false,
        depends_on: ["inspect_object_id_anchor_candidate"],
      },
    ],
    auto_fixable: false,
  };
}

function buildRecoveryPaths(quickFixMap) {
  const source =
    quickFixMap && typeof quickFixMap === "object" && !Array.isArray(quickFixMap)
      ? quickFixMap
      : {};
  const output = [];
  for (const [errorCode, fix] of Object.entries(source)) {
    if (!fix || typeof fix !== "object") {
      continue;
    }
    output.push({
      error_code: normalizeString(errorCode),
      suggested_action: normalizeString(fix.suggested_action),
      suggested_tool: normalizeString(fix.suggested_tool),
      fix_hint: normalizeString(fix.fix_hint),
      fix_steps: normalizeFixSteps(fix.fix_steps),
    });
  }
  return output;
}

function buildEnhancedFields({
  toolRecord,
  includeErrorFixMap,
  includeCanonicalExamples,
  includeRelated,
  scenario,
  catalog,
  budgetChars,
}) {
  const commonMistakes = ensureCommonMistakes(toolRecord);
  const quickFixes = includeErrorFixMap
    ? normalizeQuickFixMap(toolRecord, catalog)
    : {};
  const canonicalExamples = pickExamplesPositive(
    toolRecord,
    includeCanonicalExamples,
    scenario
  );
  const relatedContracts = buildRelatedContracts(
    catalog,
    toolRecord,
    includeRelated,
    budgetChars
  );

  return {
    usage_notes:
      typeof toolRecord.usage_notes === "string" ? toolRecord.usage_notes : "",
    common_mistakes: commonMistakes,
    quick_fixes: quickFixes,
    recovery_paths: buildRecoveryPaths(quickFixes),
    related_contracts: relatedContracts,
    canonical_examples: canonicalExamples,
    property_path_rules: toolRecord.property_path_rules
      ? cloneJson(toolRecord.property_path_rules)
      : null,
    high_frequency_properties: toolRecord.high_frequency_properties
      ? cloneJson(toolRecord.high_frequency_properties)
      : {},
    tool_combinations: pickScenarioCombinations(toolRecord, scenario),
    related_tools_policy: {
      expand_depth: 1,
      max_tools: MAX_RELATED_TOOLS,
      include_self: false,
    },
    create_pre_check_policy: buildCreatePreCheckPolicy(toolRecord, catalog),
  };
}

function buildLegacyFields(toolRecord, actionType) {
  return {
    tool_name: toolRecord.name,
    action_type: actionType || null,
    schema_source: "ssot_static_artifact",
    write_envelope_contract: {
      mode: "static",
      required_fields: toolRecord.required,
      guidance:
        "Use the required fields exactly as documented. No dynamic action schema expansion is provided in SSOT static mode.",
    },
    minimal_valid_payload_template: pickMinimalTemplateFromExamples(toolRecord),
    schema_ref: {
      tool: "get_tool_schema",
      mode: "ssot_static_artifact",
    },
    message:
      "Dynamic contract synthesis is deprecated. Returning static SSOT contract view from compiled artifacts.",
  };
}

function buildBaseResponse({
  catalog,
  toolRecord,
  legacyFields,
  enhancedFields,
  includeEnhanced,
  includeLegacy,
  actionType,
  budgetChars,
}) {
  return {
    ok: true,
    contract_version: CONTRACT_VERSION,
    tool_name: toolRecord.name,
    action_type: actionType || null,
    schema_source: "ssot_static_artifact",
    validation_tool: "preflight_validate_write_payload",
    required_fields: Array.isArray(toolRecord.required) ? toolRecord.required : [],
    write_envelope_contract: legacyFields.write_envelope_contract,
    minimal_valid_payload_template: legacyFields.minimal_valid_payload_template,
    schema_ref: legacyFields.schema_ref,
    message: legacyFields.message,
    usage_notes: enhancedFields.usage_notes,
    common_mistakes: enhancedFields.common_mistakes,
    quick_fixes: enhancedFields.quick_fixes,
    recovery_paths: enhancedFields.recovery_paths,
    related_contracts: enhancedFields.related_contracts,
    examples_negative: enhancedFields.common_mistakes,
    enhanced_fields: includeEnhanced ? enhancedFields : {},
    legacy_fields: includeLegacy ? legacyFields : {},
    contract_budget_policy: {
      minimal_required_fields: MINIMAL_REQUIRED_FIELD_KEYS,
      optional_fields: OPTIONAL_FIELD_KEYS,
      budget_chars_requested: budgetChars,
      truncation_order: [
        "related_contracts",
        "enhanced_fields.related_contracts",
        "enhanced_fields.canonical_examples",
        "enhanced_fields.tool_combinations",
        "enhanced_fields.high_frequency_properties",
        "recovery_paths",
        "quick_fixes",
        "enhanced_fields.quick_fixes",
        "enhanced_fields.common_mistakes",
        "examples_negative",
        "enhanced_fields.usage_notes",
        "usage_notes",
        "legacy_fields",
        "enhanced_fields",
      ],
    },
    catalog_version: catalog && catalog.version ? catalog.version : null,
  };
}

function buildMinimalExecutablePayload(response, budgetChars) {
  const commonMistakes = Array.isArray(response.common_mistakes)
    ? response.common_mistakes
    : [];
  const minimalCommonMistakes =
    commonMistakes.length > 0 ? [cloneJson(commonMistakes[0])] : [];
  return {
    ok: true,
    contract_version: response.contract_version,
    tool_name: response.tool_name,
    schema_source: response.schema_source,
    validation_tool: response.validation_tool,
    required_fields: response.required_fields,
    write_envelope_contract: response.write_envelope_contract,
    minimal_valid_payload_template: response.minimal_valid_payload_template,
    common_mistakes: minimalCommonMistakes,
    contract_budget_policy: {
      minimal_required_fields: MINIMAL_REQUIRED_FIELD_KEYS,
      optional_fields: OPTIONAL_FIELD_KEYS,
      budget_chars_requested: budgetChars,
    },
  };
}

function createBudgetFailure(minRequiredBudget) {
  return {
    ok: false,
    error_code: BUDGET_ERROR_CODE,
    statusCode: 400,
    message:
      "budget_chars is too small for minimal executable contract payload. Increase budget_chars and retry.",
    min_required_budget: minRequiredBudget,
  };
}

function clearFieldAtPath(target, pathSegments) {
  if (!target || typeof target !== "object") {
    return false;
  }
  if (!Array.isArray(pathSegments) || pathSegments.length <= 0) {
    return false;
  }
  let cursor = target;
  for (let index = 0; index < pathSegments.length - 1; index += 1) {
    const token = pathSegments[index];
    if (
      !cursor ||
      typeof cursor !== "object" ||
      !Object.prototype.hasOwnProperty.call(cursor, token)
    ) {
      return false;
    }
    cursor = cursor[token];
  }
  const leaf = pathSegments[pathSegments.length - 1];
  if (
    !cursor ||
    typeof cursor !== "object" ||
    !Object.prototype.hasOwnProperty.call(cursor, leaf)
  ) {
    return false;
  }
  delete cursor[leaf];
  return true;
}

function buildFullMetadata({
  originalSize,
  truncatedSize,
  truncatedFields,
  minRequiredBudget,
  budgetChars,
}) {
  return {
    original_size: originalSize,
    truncated_size: truncatedSize,
    truncated: truncatedSize < originalSize,
    truncated_fields: Array.from(new Set(truncatedFields)),
    min_required_budget: minRequiredBudget,
    budget_chars_requested: budgetChars,
    warning:
      truncatedSize < originalSize
        ? "partial fields trimmed to satisfy budget_chars."
        : "",
  };
}

function buildMinimalMetadata({ minRequiredBudget, budgetChars }) {
  return {
    truncated: false,
    min_required_budget: minRequiredBudget,
    budget_chars_requested: budgetChars,
  };
}

function ensureCacheMetadata(body, cacheHit) {
  const output = cloneJson(body);
  if (
    !output.metadata ||
    typeof output.metadata !== "object" ||
    Array.isArray(output.metadata)
  ) {
    output.metadata = {};
  }
  output.metadata.cache_hit = cacheHit === true;
  return output;
}

function applyBudgetTrim(baseResponse, budgetChars) {
  const response = cloneJson(baseResponse);
  const originalSize = estimateSize(baseResponse);
  const removalPriority = [
    ["catalog_version"],
    ["message"],
    ["schema_ref"],
    ["related_contracts"],
    ["enhanced_fields", "related_contracts"],
    ["enhanced_fields", "canonical_examples"],
    ["enhanced_fields", "tool_combinations"],
    ["enhanced_fields", "high_frequency_properties"],
    ["contract_budget_policy", "truncation_order"],
    ["contract_budget_policy", "optional_fields"],
    ["recovery_paths"],
    ["quick_fixes"],
    ["enhanced_fields", "quick_fixes"],
    ["enhanced_fields", "common_mistakes"],
    ["examples_negative"],
    ["enhanced_fields", "usage_notes"],
    ["usage_notes"],
    ["legacy_fields"],
    ["enhanced_fields"],
  ];
  const minimumPossible = cloneJson(baseResponse);
  for (const path of removalPriority) {
    clearFieldAtPath(minimumPossible, path);
  }
  const minimalPayload = buildMinimalExecutablePayload(minimumPossible, budgetChars);
  const minimalBudget = estimateSize({
    ...minimalPayload,
    metadata: buildMinimalMetadata({
      minRequiredBudget: 0,
      budgetChars,
    }),
  });
  if (minimalBudget > budgetChars) {
    return createBudgetFailure(minimalBudget);
  }

  const truncatedFields = [];
  const minimalMetadata = buildMinimalMetadata({
    minRequiredBudget: minimalBudget,
    budgetChars,
  });
  for (const fieldPath of removalPriority) {
    const currentSize = estimateSize({
      ...response,
      metadata: minimalMetadata,
    });
    if (currentSize <= budgetChars) {
      break;
    }
    if (clearFieldAtPath(response, fieldPath)) {
      truncatedFields.push(fieldPath.join("."));
    }
  }

  const finalSizeWithMinimalMetadata = estimateSize({
    ...response,
    metadata: minimalMetadata,
  });
  if (finalSizeWithMinimalMetadata > budgetChars) {
    return createBudgetFailure(minimalBudget);
  }

  const finalSizeWithoutMetadata = estimateSize(response);
  response.metadata = buildFullMetadata({
    originalSize,
    truncatedSize: finalSizeWithoutMetadata,
    truncatedFields,
    minRequiredBudget: minimalBudget,
    budgetChars,
  });

  if (estimateSize(response) > budgetChars) {
    response.metadata = minimalMetadata;
  }

  if (estimateSize(response) > budgetChars) {
    return createBudgetFailure(minimalBudget);
  }

  response.metadata.truncated = truncatedFields.length > 0;
  return {
    ok: true,
    response,
  };
}

function buildWriteContractBundleView(requestBody) {
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const toolName = normalizeString(payload.tool_name) || "modify_ui_layout";
  const actionType = normalizeString(payload.action_type);
  const budgetChars = normalizePositiveInteger(
    payload.budget_chars,
    DEFAULT_BUDGET_CHARS
  );

  const includeErrorFixMap = normalizeBoolean(payload.include_error_fix_map, true);
  const includeCanonicalExamples = normalizeBoolean(
    payload.include_canonical_examples,
    true
  );
  const includeRelated = normalizeBoolean(payload.include_related, true);
  const includeEnhanced = normalizeBoolean(payload.include_enhanced, true);
  const includeLegacy = normalizeBoolean(payload.include_legacy, true);

  const context =
    payload.context && typeof payload.context === "object" ? payload.context : {};
  const scenario = normalizeString(context.scenario);
  const previousTool = normalizeString(context.previous_tool);

  let catalog = null;
  try {
    catalog = getStaticToolCatalogSingleton();
  } catch (error) {
    return {
      statusCode: 500,
      body: {
        ok: false,
        error_code: "E_SSOT_SCHEMA_UNAVAILABLE",
        message:
          error && typeof error.message === "string" && error.message.trim()
            ? error.message.trim()
            : "SSOT static tool catalog is unavailable",
      },
    };
  }

  const toolRecord = getToolRecord(catalog, toolName);
  if (!toolRecord) {
    return {
      statusCode: 404,
      body: {
        ok: false,
        error_code: "E_TOOL_SCHEMA_NOT_FOUND",
        message: `Tool schema not found for '${toolName}'`,
        guidance:
          "The requested tool is not part of current SSOT static tool catalog. Use tools/list to inspect available tools.",
      },
    };
  }
  if (String(toolRecord.kind).toLowerCase() !== "write") {
    return {
      statusCode: 400,
      body: {
        ok: false,
        error_code: "E_SSOT_WRITE_TOOL_REQUIRED",
        message:
          "get_write_contract_bundle only supports SSOT write tools in static mode",
      },
    };
  }

  const cache = getContractBundleCacheSingleton();
  const cacheKey = buildContractBundleCacheKey({
    catalogVersion: catalog && catalog.version,
    toolName,
    actionType,
    budgetChars,
    includeErrorFixMap: includeErrorFixMap,
    includeCanonicalExamples: includeCanonicalExamples,
    includeRelated,
    includeEnhanced,
    includeLegacy,
    scenario,
    previousTool,
  });
  const cached = cache.get(cacheKey);
  if (cached && Number(cached.statusCode) === 200 && cached.body) {
    return {
      statusCode: 200,
      body: ensureCacheMetadata(cached.body, true),
    };
  }

  const legacyFields = buildLegacyFields(toolRecord, actionType);
  const enhancedFields = buildEnhancedFields({
    toolRecord,
    includeErrorFixMap,
    includeCanonicalExamples,
    includeRelated,
    scenario,
    catalog,
    budgetChars,
  });
  const baseResponse = buildBaseResponse({
    catalog,
    toolRecord,
    legacyFields,
    enhancedFields,
    includeEnhanced,
    includeLegacy,
    actionType,
    budgetChars,
  });

  const trimmed = applyBudgetTrim(baseResponse, budgetChars);
  if (!trimmed.ok) {
    return {
      statusCode: trimmed.statusCode,
      body: {
        ok: false,
        error_code: trimmed.error_code,
        message: trimmed.message,
        min_required_budget: trimmed.min_required_budget,
      },
    };
  }

  const uncachedBody = ensureCacheMetadata(trimmed.response, false);
  cache.set(cacheKey, {
    statusCode: 200,
    body: uncachedBody,
  });

  return {
    statusCode: 200,
    body: uncachedBody,
  };
}

module.exports = {
  buildWriteContractBundleView,
};

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
const WRITE_PROTOCOL_FIELD_COVERAGE = 0.85;

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
  "workflow_recommendation",
  "quick_fixes",
  "recovery_paths",
  "related_contracts",
  "examples_negative",
  "enhanced_fields",
  "legacy_fields",
]);

const WORKFLOW_RECOMMENDATION_SOURCE = "planner_orchestration_contract";
const WORKFLOW_RECOMMENDATION_TOOL = "planner_execute_mcp";
const MISROUTE_RECOVERY_ERROR_CODES = new Set([
  "E_BLOCK_INTENT_KEY_UNSUPPORTED",
  "E_SCHEMA_INVALID",
  "E_COMPONENT_TYPE_INVALID",
  "E_PLANNER_NO_TOOL_MAPPING",
  "E_PLANNER_UNSUPPORTED_FAMILY",
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

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set();
  const output = [];
  for (const entry of value) {
    const token = normalizeString(entry);
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    output.push(token);
  }
  return output;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function estimateSize(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function getPlannerOrchestrationContract(catalog) {
  const globalContracts =
    catalog && typeof catalog.globalContracts === "object"
      ? catalog.globalContracts
      : {};
  const contract =
    globalContracts &&
    typeof globalContracts.planner_orchestration_contract === "object" &&
    !Array.isArray(globalContracts.planner_orchestration_contract)
      ? globalContracts.planner_orchestration_contract
      : {};
  return contract;
}

function normalizeWorkflowCandidateRules(contract) {
  const source = Array.isArray(contract && contract.workflow_candidate_rules)
    ? contract.workflow_candidate_rules
    : [];
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    const rule = source[index];
    if (!isPlainObject(rule)) {
      continue;
    }
    output.push({
      rule_id: normalizeString(rule.rule_id),
      enabled: rule.enabled !== false,
      priority: Number.isFinite(Number(rule.priority))
        ? Math.floor(Number(rule.priority))
        : 0,
      template_ref: normalizeString(rule.template_ref),
      reason_code_on_hit: normalizeString(rule.reason_code_on_hit),
      source_order: index,
    });
  }
  output.sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return left.source_order - right.source_order;
  });
  return output;
}

function getWorkflowTemplateById(contract, templateId) {
  if (!templateId) {
    return null;
  }
  const templates = isPlainObject(contract && contract.workflow_templates)
    ? contract.workflow_templates
    : {};
  const template = templates[templateId];
  if (!isPlainObject(template) || template.enabled === false) {
    return null;
  }
  return template;
}

function normalizeStringLower(value) {
  const token = normalizeString(value);
  return token ? token.toLowerCase() : "";
}

function normalizeErrorContext(rawErrorContext) {
  const errorContext = isPlainObject(rawErrorContext) ? rawErrorContext : {};
  return {
    error_code: normalizeString(errorContext.error_code).toUpperCase(),
    failed_property_path: normalizeString(errorContext.failed_property_path),
  };
}

function scenarioContainsAnyToken(scenario, tokens) {
  const normalizedScenario = normalizeStringLower(scenario);
  if (!normalizedScenario) {
    return false;
  }
  const values = Array.isArray(tokens) ? tokens : [];
  return values.some((token) => {
    const normalizedToken = normalizeStringLower(token);
    return !!normalizedToken && normalizedScenario.includes(normalizedToken);
  });
}

function resolveWorkflowIntentKey(templateDef) {
  const template = isPlainObject(templateDef) ? templateDef : {};
  const selection = isPlainObject(template.selection) ? template.selection : {};
  const intentKeys = normalizeStringArray(selection.intent_keys);
  return intentKeys[0] || "workflow.script.create_compile_attach";
}

function collectWorkflowTaskPayloadSlots(templateDef) {
  const template = isPlainObject(templateDef) ? templateDef : {};
  const steps = Array.isArray(template.steps) ? template.steps : [];
  const output = new Set();
  for (const step of steps) {
    if (!isPlainObject(step)) {
      continue;
    }
    if (normalizeString(step.step_type) !== "submit_task") {
      continue;
    }
    const slot = normalizeString(step.task_payload_slot);
    if (slot) {
      output.add(slot);
    }
  }
  return output;
}

function shouldIncludeEnsureTargetInput(templateDef) {
  const template = isPlainObject(templateDef) ? templateDef : {};
  const steps = Array.isArray(template.steps) ? template.steps : [];
  for (const rawStep of steps) {
    const step = isPlainObject(rawStep) ? rawStep : {};
    if (normalizeString(step.step_type) === "ensure_target") {
      return true;
    }
  }
  return resolveWorkflowIntentKey(templateDef) === "workflow.script.create_compile_attach";
}

function buildWorkflowMinimalTemplate({ templateId, templateDef }) {
  const taskPayloadSlots = collectWorkflowTaskPayloadSlots(templateDef);
  const input = {
    thread_id: "__thread_id__",
    user_intent: "__user_intent__",
  };
  if (shouldIncludeEnsureTargetInput(templateDef)) {
    input.ensure_target = {
      enabled: false,
      parent_anchor: {
        object_id: "__parent_object_id__",
        path: "__parent_path__",
      },
      new_object_name: "__new_object_name__",
      object_kind: "__object_kind__",
      set_active: true,
      name_collision_policy: "fail",
    };
  }
  if (taskPayloadSlots.has("file_actions")) {
    input.file_actions = [
      {
        action: "create_or_update_script",
        path: "Assets/Scripts/__ScriptName__.cs",
        content:
          "using UnityEngine; public class __ScriptName__ : MonoBehaviour {}",
      },
    ];
  }
  if (taskPayloadSlots.has("visual_layer_actions")) {
    input.visual_layer_actions = [
      {
        action: "add_component",
        target_object_id: "__target_object_id__",
        target_path: "__target_path__",
        component_type: "__ComponentType__",
      },
    ];
  }

  return {
    block_spec: {
      block_id: "__workflow_block_id__",
      block_type: "MUTATE",
      intent_key: resolveWorkflowIntentKey(templateDef),
      input,
      target_anchor: {
        object_id: "__target_object_id__",
        path: "__target_path__",
      },
      based_on_read_token: "__based_on_read_token__",
      write_envelope: {
        idempotency_key: "__idempotency_key__",
        write_anchor_object_id: "__target_object_id__",
        write_anchor_path: "__target_path__",
        execution_mode: "execute",
      },
    },
    execution_context: {
      shape: "single_step",
    },
    suggested_tool: WORKFLOW_RECOMMENDATION_TOOL,
    workflow_template_id: templateId,
  };
}

function buildWorkflowRecommendation({
  catalog,
  toolRecord,
  scenario,
  previousTool,
  errorContext,
}) {
  const contract = getPlannerOrchestrationContract(catalog);
  const rules = normalizeWorkflowCandidateRules(contract);
  if (rules.length <= 0) {
    return null;
  }
  const toolName = normalizeString(toolRecord && toolRecord.name);
  const previousToolName = normalizeString(previousTool);
  const normalizedErrorContext = normalizeErrorContext(errorContext);
  const scenarioHasScriptWorkflowHint = scenarioContainsAnyToken(scenario, [
    "script_create_compile_attach",
    "workflow.script.create_compile_attach",
    "workflow_candidate_script_create_compile_attach",
  ]);
  const scenarioHasScriptActionHint =
    scenarioContainsAnyToken(scenario, ["script"]) &&
    scenarioContainsAnyToken(scenario, ["compile"]) &&
    scenarioContainsAnyToken(scenario, ["attach"]);
  const hasMisrouteRecoveryHint =
    previousToolName === WORKFLOW_RECOMMENDATION_TOOL &&
    MISROUTE_RECOVERY_ERROR_CODES.has(normalizedErrorContext.error_code);

  for (const rule of rules) {
    if (rule.enabled !== true || !rule.template_ref || !rule.rule_id) {
      continue;
    }
    const template = getWorkflowTemplateById(contract, rule.template_ref);
    if (!template) {
      continue;
    }
    const stepTools = new Set(
      (Array.isArray(template.steps) ? template.steps : [])
        .map((step) =>
          isPlainObject(step) ? normalizeString(step.tool_name) : ""
        )
        .filter(Boolean)
    );
    const isToolReferencedByTemplate = toolName ? stepTools.has(toolName) : false;
    const shouldRecommend =
      scenarioHasScriptWorkflowHint ||
      scenarioHasScriptActionHint ||
      hasMisrouteRecoveryHint ||
      (previousToolName === WORKFLOW_RECOMMENDATION_TOOL &&
        isToolReferencedByTemplate);
    if (!shouldRecommend) {
      continue;
    }
    const templateId = rule.template_ref;
    return {
      source: WORKFLOW_RECOMMENDATION_SOURCE,
      source_rule_id: rule.rule_id,
      reason_code:
        rule.reason_code_on_hit || "workflow_candidate_script_create_compile_attach",
      suggested_tool: WORKFLOW_RECOMMENDATION_TOOL,
      workflow_template_id: templateId,
      minimal_valid_template: buildWorkflowMinimalTemplate({
        templateId,
        templateDef: template,
      }),
    };
  }

  return null;
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

function getCommonWriteRequiredFields(catalog) {
  const tools = Array.isArray(catalog && catalog.tools) ? catalog.tools : [];
  const writeTools = tools.filter(
    (tool) =>
      tool &&
      typeof tool === "object" &&
      normalizeString(tool.kind).toLowerCase() === "write"
  );
  if (writeTools.length <= 0) {
    return [];
  }

  const requiredCount = new Map();
  const orderedFields = [];
  for (const tool of writeTools) {
    const required = normalizeStringArray(tool.required);
    for (const field of required) {
      if (!requiredCount.has(field)) {
        requiredCount.set(field, 0);
        orderedFields.push(field);
      }
      requiredCount.set(field, requiredCount.get(field) + 1);
    }
  }

  const minimumCoverage = Math.ceil(writeTools.length * WRITE_PROTOCOL_FIELD_COVERAGE);
  const output = [];
  for (const field of orderedFields) {
    const count = Number(requiredCount.get(field) || 0);
    if (count >= minimumCoverage) {
      output.push(field);
    }
  }
  return output;
}

function buildUxFieldLayers({ catalog, toolRecord, fallbackMinimalTemplate }) {
  const fallbackTemplate = isPlainObject(fallbackMinimalTemplate)
    ? cloneJson(fallbackMinimalTemplate)
    : {};
  const uxContract = isPlainObject(toolRecord && toolRecord.ux_contract)
    ? toolRecord.ux_contract
    : null;
  if (uxContract) {
    return {
      required_business_fields: normalizeStringArray(
        uxContract.required_business_fields
      ),
      system_fields: normalizeStringArray(uxContract.system_fields),
      auto_filled_fields: normalizeStringArray(uxContract.auto_filled_fields),
      minimal_valid_template: isPlainObject(uxContract.minimal_valid_template)
        ? cloneJson(uxContract.minimal_valid_template)
        : fallbackTemplate,
      common_aliases: isPlainObject(uxContract.common_aliases)
        ? cloneJson(uxContract.common_aliases)
        : {},
    };
  }

  const requiredFields = normalizeStringArray(toolRecord && toolRecord.required);
  const commonWriteFieldSet = new Set(getCommonWriteRequiredFields(catalog));
  return {
    required_business_fields: requiredFields.filter(
      (field) => !commonWriteFieldSet.has(field)
    ),
    system_fields: requiredFields.filter((field) => commonWriteFieldSet.has(field)),
    auto_filled_fields: [],
    minimal_valid_template: fallbackTemplate,
    common_aliases: {},
  };
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
  legacyFields,
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
  const uxFieldLayers = buildUxFieldLayers({
    catalog,
    toolRecord,
    fallbackMinimalTemplate:
      legacyFields && legacyFields.minimal_valid_payload_template,
  });

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
    required_business_fields: uxFieldLayers.required_business_fields,
    system_fields: uxFieldLayers.system_fields,
    auto_filled_fields: uxFieldLayers.auto_filled_fields,
    minimal_valid_template: uxFieldLayers.minimal_valid_template,
    common_aliases: uxFieldLayers.common_aliases,
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
  workflowRecommendation,
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
    required_business_fields: enhancedFields.required_business_fields,
    system_fields: enhancedFields.system_fields,
    auto_filled_fields: enhancedFields.auto_filled_fields,
    minimal_valid_template: enhancedFields.minimal_valid_template,
    common_aliases: enhancedFields.common_aliases,
    write_envelope_contract: legacyFields.write_envelope_contract,
    minimal_valid_payload_template: legacyFields.minimal_valid_payload_template,
    schema_ref: legacyFields.schema_ref,
    message: legacyFields.message,
    usage_notes: enhancedFields.usage_notes,
    ...(workflowRecommendation
      ? { workflow_recommendation: workflowRecommendation }
      : {}),
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
    ["workflow_recommendation"],
    ["common_aliases"],
    ["minimal_valid_template"],
    ["auto_filled_fields"],
    ["system_fields"],
    ["required_business_fields"],
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
  const errorContext = normalizeErrorContext(context.error_context);

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
    errorCode: errorContext.error_code,
    failedPropertyPath: errorContext.failed_property_path,
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
    legacyFields,
  });
  const workflowRecommendation = buildWorkflowRecommendation({
    catalog,
    toolRecord,
    scenario,
    previousTool,
    errorContext,
  });
  const baseResponse = buildBaseResponse({
    catalog,
    toolRecord,
    legacyFields,
    enhancedFields,
    workflowRecommendation,
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

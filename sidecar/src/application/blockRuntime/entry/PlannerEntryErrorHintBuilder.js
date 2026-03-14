"use strict";

const {
  getStaticToolCatalogSingleton,
} = require("../../ssotRuntime/staticToolCatalog");

const PLANNER_ENTRY_ERROR_HINT_BUILDER_VERSION =
  "phase1_step7_planner_entry_error_hint_builder_v1";
const PLANNER_ENTRY_TOOL_NAME = "planner_execute_mcp";
const WORKFLOW_RECOMMENDATION_SOURCE = "planner_orchestration_contract";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const output = [];
  const seen = new Set();
  for (const item of value) {
    const token = normalizeString(item);
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    output.push(token);
  }
  return output;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function resolvePlannerUxContract(options = {}) {
  const source = normalizeObject(options);
  if (source.uxContract && typeof source.uxContract === "object") {
    return cloneJson(source.uxContract);
  }
  if (typeof source.loadUxContract === "function") {
    const loaded = source.loadUxContract();
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
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
    if (record && record.ux_contract && typeof record.ux_contract === "object") {
      return cloneJson(record.ux_contract);
    }
  } catch (_error) {
    return null;
  }
  return null;
}

function resolvePlannerOrchestrationContract(options = {}) {
  const source = normalizeObject(options);
  if (source.orchestrationContract && typeof source.orchestrationContract === "object") {
    return cloneJson(source.orchestrationContract);
  }
  if (typeof source.loadOrchestrationContract === "function") {
    const loaded = source.loadOrchestrationContract();
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      return cloneJson(loaded);
    }
    return {};
  }
  try {
    const catalog = getStaticToolCatalogSingleton();
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
    return cloneJson(contract);
  } catch (_error) {
    return {};
  }
}

function resolveWorkflowIntentKey(templateDef) {
  const template = normalizeObject(templateDef);
  const selection = normalizeObject(template.selection);
  const intentKeys = normalizeStringArray(selection.intent_keys);
  return intentKeys[0] || "workflow.script.create_compile_attach";
}

function collectWorkflowTaskPayloadSlots(templateDef) {
  const template = normalizeObject(templateDef);
  const steps = Array.isArray(template.steps) ? template.steps : [];
  const output = new Set();
  for (const step of steps) {
    const currentStep = normalizeObject(step);
    if (normalizeString(currentStep.step_type) !== "submit_task") {
      continue;
    }
    const slot = normalizeString(currentStep.task_payload_slot);
    if (slot) {
      output.add(slot);
    }
  }
  return output;
}

function shouldIncludeEnsureTargetInput(templateDef) {
  const template = normalizeObject(templateDef);
  const steps = Array.isArray(template.steps) ? template.steps : [];
  for (const rawStep of steps) {
    const step = normalizeObject(rawStep);
    if (normalizeString(step.step_type) === "ensure_target") {
      return true;
    }
  }
  return resolveWorkflowIntentKey(templateDef) === "workflow.script.create_compile_attach";
}

function buildWorkflowMinimalTemplate(templateId, templateDef) {
  const slots = collectWorkflowTaskPayloadSlots(templateDef);
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
  if (slots.has("file_actions")) {
    input.file_actions = [
      {
        action: "create_or_update_script",
        path: "Assets/Scripts/__ScriptName__.cs",
        content:
          "using UnityEngine; public class __ScriptName__ : MonoBehaviour {}",
      },
    ];
  }
  if (slots.has("visual_layer_actions")) {
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
    suggested_tool: PLANNER_ENTRY_TOOL_NAME,
    workflow_template_id: templateId,
  };
}

function normalizePlannerFieldPath(rawField) {
  const field = normalizeString(rawField).replace(/\s*\(.+\)\s*$/, "");
  if (!field) {
    return "";
  }
  if (field.startsWith("block_spec.")) {
    return field;
  }
  const shouldPrefix =
    field === "block_spec" ||
    field === "block_id" ||
    field === "block_type" ||
    field === "intent_key" ||
    field === "family_key" ||
    field === "legacy_concrete_key" ||
    field === "input" ||
    field === "based_on_read_token" ||
    field.startsWith("input.") ||
    field.startsWith("target_anchor.") ||
    field.startsWith("write_envelope.");
  if (!shouldPrefix) {
    return field;
  }
  return field === "block_spec" ? "block_spec" : `block_spec.${field}`;
}

function collectMissingFieldsFromMessage(message) {
  const text = normalizeString(message);
  if (!text) {
    return [];
  }
  const output = [];
  const seen = new Set();
  const pushField = (field) => {
    const normalizedField = normalizePlannerFieldPath(field);
    if (!normalizedField || seen.has(normalizedField)) {
      return;
    }
    seen.add(normalizedField);
    output.push(normalizedField);
  };

  const requiredPattern = /required field missing:\s*([a-zA-Z0-9_.]+)/gi;
  let requiredMatch = requiredPattern.exec(text);
  while (requiredMatch) {
    pushField(requiredMatch[1]);
    requiredMatch = requiredPattern.exec(text);
  }

  const envelopePattern = /write envelope fields missing:\s*([^]+)$/i;
  const envelopeMatch = envelopePattern.exec(text);
  if (envelopeMatch && envelopeMatch[1]) {
    const list = envelopeMatch[1]
      .split(",")
      .map((item) => normalizeString(item))
      .filter(Boolean);
    for (const token of list) {
      pushField(token);
    }
  }

  if (text.includes("target_anchor.object_id and target_anchor.path")) {
    pushField("target_anchor.object_id");
    pushField("target_anchor.path");
  }
  if (text.includes("requires one of: intent_key, family_key, legacy_concrete_key")) {
    pushField("intent_key");
    pushField("family_key");
    pushField("legacy_concrete_key");
  }
  if (text.includes("block_spec must be a plain object")) {
    pushField("block_spec");
  }

  return output;
}

function collectMissingFields(errorDetails, errorMessage) {
  const details = normalizeObject(errorDetails);
  const output = [];
  const seen = new Set();
  const pushField = (field) => {
    const normalizedField = normalizePlannerFieldPath(field);
    if (!normalizedField || seen.has(normalizedField)) {
      return;
    }
    seen.add(normalizedField);
    output.push(normalizedField);
  };

  const detailMissingFields = normalizeStringArray(details.missing_fields);
  for (const field of detailMissingFields) {
    pushField(field);
  }
  for (const field of collectMissingFieldsFromMessage(errorMessage)) {
    pushField(field);
  }
  return output;
}

function buildFixHint({ message, missingFields, enumHints, aliasConflict }) {
  if (aliasConflict) {
    return `Alias conflicts with canonical field. Keep '${aliasConflict.canonical_field}' and remove '${aliasConflict.alias_field}'.`;
  }
  if (String(message).includes("intent_key not supported")) {
    const familyKeys = normalizeStringArray(enumHints.supported_family_keys);
    if (familyKeys.length > 0) {
      return `intent_key is not supported for current block_type. Use one of supported_family_keys and retry.`;
    }
    return "intent_key is not supported for current block_type. Retry with a valid family key.";
  }
  if (String(message).includes("block_type not supported")) {
    return "block_spec.block_type is invalid. Retry with allowed block_type enum values.";
  }
  if (
    missingFields.includes("block_spec.target_anchor.object_id") ||
    missingFields.includes("block_spec.target_anchor.path")
  ) {
    return "Write block requires block_spec.target_anchor.object_id and block_spec.target_anchor.path.";
  }
  if (missingFields.includes("block_spec.based_on_read_token")) {
    return "based_on_read_token must be explicit in Phase1 (not auto-filled).";
  }
  return "Use planner_entry_repair.minimal_valid_template and canonical block_spec field names, then retry.";
}

function buildContextualHint({ missingFields, autoFilledFieldSet }) {
  if (!Array.isArray(missingFields) || missingFields.length <= 0) {
    return "";
  }
  const autoFilledMissing = missingFields.filter((field) =>
    autoFilledFieldSet.has(field)
  );
  if (autoFilledMissing.length > 0) {
    return `Some missing fields are auto-fill candidates: ${autoFilledMissing.join(
      ", "
    )}. Auto-fill only applies when preconditions are satisfied.`;
  }
  return "Missing fields are not auto-fillable in Phase1 and must be explicitly provided.";
}

function buildEnumHints(errorDetails, uxContract) {
  const details = normalizeObject(errorDetails);
  const output = {};
  const blockTypeEnum = normalizeStringArray(uxContract.block_type_enum);
  if (blockTypeEnum.length > 0) {
    output.block_type_enum = blockTypeEnum;
  }
  const supportedFamilyKeys = normalizeStringArray(details.supported_family_keys);
  if (supportedFamilyKeys.length > 0) {
    output.supported_family_keys = supportedFamilyKeys;
  }
  const supportedLegacyKeys = normalizeStringArray(
    details.supported_legacy_concrete_keys
  );
  if (supportedLegacyKeys.length > 0) {
    output.supported_legacy_concrete_keys = supportedLegacyKeys;
  }
  return output;
}

function createPlannerEntryErrorHintBuilder(options = {}) {
  const uxContract = resolvePlannerUxContract(options);
  const plannerOrchestrationContract = resolvePlannerOrchestrationContract(options);

  function buildWorkflowRecommendation(input = {}) {
    const source = normalizeObject(input);
    const workflowOrchestration = normalizeObject(
      source.workflow_orchestration || source.planner_orchestration
    );
    const templateId = normalizeString(
      workflowOrchestration.recommended_workflow_template_id
    );
    if (!templateId) {
      return null;
    }
    const templates = normalizeObject(plannerOrchestrationContract.workflow_templates);
    const templateDef = normalizeObject(templates[templateId]);
    if (Object.keys(templateDef).length <= 0 || templateDef.enabled === false) {
      return null;
    }
    const sourceRuleId = normalizeString(
      workflowOrchestration.workflow_misroute_recovery_rule_id
    ) || normalizeString(
      workflowOrchestration.workflow_candidate_rule_id
    );
    const reasonCode =
      normalizeString(workflowOrchestration.workflow_misroute_recovery_reason_code) ||
      normalizeString(workflowOrchestration.workflow_gating_reason_code) ||
      normalizeString(workflowOrchestration.workflow_candidate_reason_code);
    return {
      source: WORKFLOW_RECOMMENDATION_SOURCE,
      ...(sourceRuleId ? { source_rule_id: sourceRuleId } : {}),
      ...(reasonCode ? { reason_code: reasonCode } : {}),
      suggested_tool: PLANNER_ENTRY_TOOL_NAME,
      workflow_template_id: templateId,
      minimal_valid_template: buildWorkflowMinimalTemplate(templateId, templateDef),
    };
  }

  function buildHints(input = {}) {
    const source = normalizeObject(input);
    const errorCode = normalizeString(source.error_code).toUpperCase();
    if (errorCode && errorCode !== "E_SCHEMA_INVALID" && errorCode !== "E_SSOT_SCHEMA_INVALID") {
      return null;
    }
    if (!uxContract) {
      return null;
    }

    const errorMessage = normalizeString(source.error_message);
    const errorDetails = normalizeObject(source.error_details);
    const missingFields = collectMissingFields(errorDetails, errorMessage);
    const autoFilledFields = normalizeStringArray(uxContract.auto_filled_fields);
    const autoFilledFieldSet = new Set(autoFilledFields);
    const enumHints = buildEnumHints(errorDetails, uxContract);
    const aliasConflict =
      normalizeString(errorDetails.canonical_field) &&
      normalizeString(errorDetails.alias_field)
        ? {
            canonical_field: normalizeString(errorDetails.canonical_field),
            alias_field: normalizeString(errorDetails.alias_field),
          }
        : null;
    const missingFieldHints = missingFields.map((field) => ({
      field,
      auto_fillable: autoFilledFieldSet.has(field),
      note: autoFilledFieldSet.has(field)
        ? "auto_fill_candidate_if_preconditions_match"
        : "must_be_explicit",
    }));
    const workflowOrchestration = normalizeObject(source.workflow_orchestration);
    const workflowGatingAction = normalizeString(
      workflowOrchestration.workflow_gating_action
    ).toLowerCase();
    const workflowRecommendation = buildWorkflowRecommendation({
      workflow_orchestration: workflowOrchestration,
    });
    const workflowWarnRecommendationActive =
      workflowGatingAction === "warn" &&
      workflowRecommendation &&
      typeof workflowRecommendation === "object";

    const repairPayload = {
      hint_builder_version: PLANNER_ENTRY_ERROR_HINT_BUILDER_VERSION,
      block_type_enum: normalizeStringArray(uxContract.block_type_enum),
      required_business_fields: normalizeStringArray(
        uxContract.required_business_fields
      ),
      system_fields: normalizeStringArray(uxContract.system_fields),
      auto_filled_fields: autoFilledFields,
      minimal_valid_template:
        uxContract.minimal_valid_template &&
        typeof uxContract.minimal_valid_template === "object" &&
        !Array.isArray(uxContract.minimal_valid_template)
          ? cloneJson(uxContract.minimal_valid_template)
          : {},
      common_aliases:
        uxContract.common_aliases &&
        typeof uxContract.common_aliases === "object" &&
        !Array.isArray(uxContract.common_aliases)
          ? cloneJson(uxContract.common_aliases)
          : {},
      enum_hints: enumHints,
      missing_field_hints: missingFieldHints,
      ...(workflowWarnRecommendationActive
        ? { workflow_recommendation: workflowRecommendation }
        : {}),
      ...(aliasConflict ? { alias_conflict: aliasConflict } : {}),
    };

    const defaultFixHint = buildFixHint({
      message: errorMessage,
      missingFields,
      enumHints,
      aliasConflict,
    });
    const defaultContextualHint = buildContextualHint({
      missingFields,
      autoFilledFieldSet,
    });
    const workflowFixHint =
      "Workflow candidate matched. Use planner_entry_repair.workflow_recommendation.minimal_valid_template and retry planner_execute_mcp.";

    return {
      suggested_action: workflowWarnRecommendationActive
        ? PLANNER_ENTRY_TOOL_NAME
        : "get_tool_schema",
      suggested_tool: workflowWarnRecommendationActive
        ? PLANNER_ENTRY_TOOL_NAME
        : "get_tool_schema",
      fix_hint: workflowWarnRecommendationActive ? workflowFixHint : defaultFixHint,
      contextual_hint: workflowWarnRecommendationActive
        ? "warn path matched workflow candidate; prefer workflow template over low-level intent retries."
        : defaultContextualHint,
      missing_fields: missingFields,
      fix_steps: workflowWarnRecommendationActive
        ? [
            {
              step: 1,
              step_id: "retry_with_recommended_workflow_template",
              tool: PLANNER_ENTRY_TOOL_NAME,
              required: true,
              idempotent: false,
              verification: {
                workflow_template_id: workflowRecommendation.workflow_template_id,
              },
            },
          ]
        : [
            {
              step: 1,
              step_id: "inspect_planner_entry_schema",
              tool: "get_tool_schema",
              required: true,
              idempotent: true,
              verification: {
                tool_name: PLANNER_ENTRY_TOOL_NAME,
              },
            },
            {
              step: 2,
              step_id: "retry_with_planner_minimal_template",
              tool: PLANNER_ENTRY_TOOL_NAME,
              required: true,
              idempotent: false,
            },
          ],
      ...(workflowWarnRecommendationActive
        ? { workflow_recommendation: workflowRecommendation }
        : {}),
      repair_payload: repairPayload,
    };
  }

  return {
    version: PLANNER_ENTRY_ERROR_HINT_BUILDER_VERSION,
    buildHints,
    buildWorkflowRecommendation,
  };
}

module.exports = {
  PLANNER_ENTRY_ERROR_HINT_BUILDER_VERSION,
  createPlannerEntryErrorHintBuilder,
};

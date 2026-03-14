"use strict";

const { normalizeErrorCode } = require("../../utils/turnUtils");
const {
  getMcpErrorFeedbackTemplate,
} = require("./errorFeedbackTemplateRegistry");
const {
  getStaticToolCatalogSingleton,
} = require("../ssotRuntime/staticToolCatalog");
const { normalizeFailureContext } = require("./failureContextNormalizer");
const {
  isWorkflowMisrouteRecoveryFailurePathErrorCode,
  listStructuredGuidanceErrorCodes,
  planRecoveryAction,
} = require("./recoveryPlanner");
const {
  createPlannerEntryErrorHintBuilder,
} = require("../blockRuntime/entry/PlannerEntryErrorHintBuilder");

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
  for (const raw of value) {
    const token = normalizeString(raw);
    if (!token || seen.has(token)) {
      continue;
    }
    seen.add(token);
    output.push(token);
  }
  return output;
}

function normalizeRetryPolicy(policy) {
  const source = normalizeObject(policy);
  if (Object.keys(source).length <= 0) {
    return null;
  }
  return source;
}

function tryLoadCatalog() {
  try {
    return getStaticToolCatalogSingleton();
  } catch {
    return null;
  }
}

function deriveStructuredGuidanceCodes() {
  const catalog = tryLoadCatalog();
  const codes = listStructuredGuidanceErrorCodes(
    catalog || { tools: [], byName: new Map() }
  );
  return Object.freeze(codes);
}

const STRUCTURED_GUIDANCE_ERROR_CODES = deriveStructuredGuidanceCodes();
const WORKFLOW_GUIDANCE_FALLBACK_BY_CODE = Object.freeze({
  E_WORKFLOW_ENSURE_TARGET_FAILED: Object.freeze({
    suggested_action: "get_hierarchy_subtree",
    suggested_tool: "get_hierarchy_subtree",
    fix_hint:
      "ensure_target step failed. Re-check ensure_target.parent_anchor/new_object_name/object_kind and retry planner_execute_mcp.",
  }),
  E_WORKFLOW_ENSURE_TARGET_AMBIGUOUS_REUSE: Object.freeze({
    suggested_action: "get_hierarchy_subtree",
    suggested_tool: "get_hierarchy_subtree",
    fix_hint:
      "ensure_target reuse requires a unique existing match. Refresh parent hierarchy and retry with a deterministic target.",
  }),
  E_WORKFLOW_RESOLVED_TARGET_CONFLICT: Object.freeze({
    suggested_action: "get_write_contract_bundle",
    suggested_tool: "get_write_contract_bundle",
    fix_hint:
      "Resolved target conflicts with explicit attach target. Align attach target with workflow_orchestration.resolved_target, then retry planner_execute_mcp.",
  }),
  E_WORKFLOW_RESOLVED_TARGET_MISSING: Object.freeze({
    suggested_action: "get_write_contract_bundle",
    suggested_tool: "get_write_contract_bundle",
    fix_hint:
      "Resolved target is missing before attach. Ensure ensure_target is enabled and returns target_object_id/target_path, then retry planner_execute_mcp.",
  }),
  E_WORKFLOW_SCRIPT_COMPILE_FAILED: Object.freeze({
    suggested_action: "get_unity_task_status",
    suggested_tool: "get_unity_task_status",
    fix_hint:
      "Script compile failed in workflow. Inspect terminal error details, fix script compilation issues, then retry planner_execute_mcp.",
  }),
  E_WORKFLOW_SCRIPT_CLASS_MISMATCH: Object.freeze({
    suggested_action: "get_write_contract_bundle",
    suggested_tool: "get_write_contract_bundle",
    fix_hint:
      "Script class/type mismatch. Verify file name, class name and component_type contract, then retry planner_execute_mcp.",
  }),
  E_WORKFLOW_COMPONENT_NOT_ATTACHABLE: Object.freeze({
    suggested_action: "get_gameobject_components",
    suggested_tool: "get_gameobject_components",
    fix_hint:
      "Target object cannot attach this component. Inspect target components/type constraints, then retry planner_execute_mcp.",
  }),
  E_WORKFLOW_COMPILE_WAIT_TIMEOUT: Object.freeze({
    suggested_action: "get_unity_task_status",
    suggested_tool: "get_unity_task_status",
    fix_hint:
      "Compile wait timed out. Check task status, cancel running task if needed, then retry planner_execute_mcp.",
  }),
  E_WORKFLOW_TASK_CANCELLED: Object.freeze({
    suggested_action: "get_unity_task_status",
    suggested_tool: "get_unity_task_status",
    fix_hint:
      "Workflow task was cancelled. Inspect terminal reason and resubmit planner_execute_mcp with corrected payload.",
  }),
});
const WORKFLOW_RECOMMENDATION_TOOL = "planner_execute_mcp";
const WORKFLOW_SCENE_SIGNAL_TOKENS = new Set([
  "script_file_action",
  "component_attach",
  "compile_wait_intent",
  "target_anchor_available",
  "thread_id_available",
  "target_anchor_missing",
  "thread_id_missing",
  "required_capability_missing",
  "workflow_template_disabled",
]);
const plannerEntryErrorHintBuilder = createPlannerEntryErrorHintBuilder();

function mergeMissingFields(...items) {
  const output = [];
  const seen = new Set();
  for (const item of items) {
    const list = Array.isArray(item) ? item : [];
    for (const raw of list) {
      const normalized = normalizeString(raw);
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      output.push(normalized);
    }
  }
  return output;
}

function normalizeWorkflowOrchestration(sourceData, sourceContext) {
  const data = normalizeObject(sourceData);
  const context = normalizeObject(sourceContext);
  const dataPlannerOrchestration = normalizeObject(data.planner_orchestration);
  const contextPlannerOrchestration = normalizeObject(
    context.planner_orchestration
  );
  return {
    ...contextPlannerOrchestration,
    ...dataPlannerOrchestration,
  };
}

function getPlannerOrchestrationContract(globalContracts) {
  const contracts = normalizeObject(globalContracts);
  return normalizeObject(contracts.planner_orchestration_contract);
}

function normalizeWorkflowMisrouteRecoveryRules(orchestrationContract) {
  const contract = normalizeObject(orchestrationContract);
  const source = Array.isArray(contract.workflow_misroute_recovery_rules)
    ? contract.workflow_misroute_recovery_rules
    : [];
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    const rule = normalizeObject(source[index]);
    output.push({
      rule_id: normalizeString(rule.rule_id),
      enabled: rule.enabled === true,
      priority: Number.isFinite(Number(rule.priority))
        ? Math.floor(Number(rule.priority))
        : 0,
      template_ref: normalizeString(rule.template_ref),
      when: normalizeObject(rule.when),
      reason_code: normalizeString(rule.reason_code),
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

function findWorkflowCandidateRule(orchestrationContract, ruleId) {
  const contract = normalizeObject(orchestrationContract);
  const candidateRules = Array.isArray(contract.workflow_candidate_rules)
    ? contract.workflow_candidate_rules
    : [];
  const wantedRuleId = normalizeString(ruleId);
  if (!wantedRuleId) {
    return null;
  }
  for (const entry of candidateRules) {
    const rule = normalizeObject(entry);
    if (normalizeString(rule.rule_id) === wantedRuleId) {
      return rule;
    }
  }
  return null;
}

function findWorkflowIntentGatingRule(orchestrationContract, ruleId) {
  const contract = normalizeObject(orchestrationContract);
  const gatingRules = Array.isArray(contract.workflow_intent_gating_rules)
    ? contract.workflow_intent_gating_rules
    : [];
  const wantedRuleId = normalizeString(ruleId);
  if (!wantedRuleId) {
    return null;
  }
  for (const entry of gatingRules) {
    const rule = normalizeObject(entry);
    if (normalizeString(rule.rule_id) === wantedRuleId) {
      return rule;
    }
  }
  return null;
}

function deriveWorkflowCandidateHit(plannerOrchestration) {
  const orchestration = normalizeObject(plannerOrchestration);
  if (typeof orchestration.workflow_candidate_hit === "boolean") {
    return orchestration.workflow_candidate_hit;
  }
  const confidence = normalizeString(
    orchestration.workflow_candidate_confidence
  ).toLowerCase();
  if (confidence && confidence !== "none") {
    return true;
  }
  return false;
}

function buildSceneSignalsHitSet({
  plannerOrchestration,
  orchestrationContract,
  candidateHit,
}) {
  const orchestration = normalizeObject(plannerOrchestration);
  const contract = normalizeObject(orchestrationContract);
  const output = new Set();

  for (const signal of normalizeStringArray(orchestration.scene_signals_hit)) {
    if (WORKFLOW_SCENE_SIGNAL_TOKENS.has(signal)) {
      output.add(signal);
    }
  }
  const sceneSignalFacts = normalizeObject(orchestration.scene_signal_facts);
  for (const [signalName, rawValue] of Object.entries(sceneSignalFacts)) {
    const signal = normalizeString(signalName);
    if (rawValue === true && WORKFLOW_SCENE_SIGNAL_TOKENS.has(signal)) {
      output.add(signal);
    }
  }
  for (const [fieldName, rawValue] of Object.entries(orchestration)) {
    if (rawValue !== true) {
      continue;
    }
    const field = normalizeString(fieldName);
    if (WORKFLOW_SCENE_SIGNAL_TOKENS.has(field)) {
      output.add(field);
      continue;
    }
    if (field.startsWith("scene_signal_")) {
      const signal = normalizeString(field.slice("scene_signal_".length));
      if (WORKFLOW_SCENE_SIGNAL_TOKENS.has(signal)) {
        output.add(signal);
      }
    }
  }

  if (candidateHit) {
    const candidateRule = findWorkflowCandidateRule(
      contract,
      normalizeString(orchestration.workflow_candidate_rule_id)
    );
    if (candidateRule) {
      const matchWhen = normalizeObject(candidateRule.match_when);
      for (const signal of normalizeStringArray(matchWhen.all_signals)) {
        if (WORKFLOW_SCENE_SIGNAL_TOKENS.has(signal)) {
          output.add(signal);
        }
      }
      const candidateConfidence = normalizeString(
        orchestration.workflow_candidate_confidence
      ).toLowerCase();
      if (candidateConfidence === "high") {
        for (const signal of normalizeStringArray(matchWhen.any_signals)) {
          if (WORKFLOW_SCENE_SIGNAL_TOKENS.has(signal)) {
            output.add(signal);
          }
        }
      }
    }
  }

  const workflowGatingAction = normalizeString(
    orchestration.workflow_gating_action
  ).toLowerCase();
  const gatingRule = findWorkflowIntentGatingRule(
    contract,
    normalizeString(orchestration.workflow_gating_rule_id)
  );
  if (gatingRule) {
    const gatingRuleAction = normalizeString(gatingRule.action).toLowerCase();
    if (!gatingRuleAction || !workflowGatingAction || gatingRuleAction === workflowGatingAction) {
      const when = normalizeObject(gatingRule.when);
      for (const signal of normalizeStringArray(when.required_scene_signals_all)) {
        if (WORKFLOW_SCENE_SIGNAL_TOKENS.has(signal)) {
          output.add(signal);
        }
      }
    }
  }

  return output;
}

function isWorkflowMisrouteRuleMatched({
  rule,
  errorCode,
  plannerOrchestration,
  sceneSignalsHitSet,
  candidateHit,
}) {
  const currentRule = normalizeObject(rule);
  const when = normalizeObject(currentRule.when);
  const orchestration = normalizeObject(plannerOrchestration);
  const normalizedErrorCode = normalizeErrorCode(errorCode, "E_INTERNAL");

  if (
    Object.prototype.hasOwnProperty.call(when, "candidate_hit") &&
    Boolean(when.candidate_hit) !== candidateHit
  ) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(when, "candidate_rule_ids")) {
    const candidateRuleIds = normalizeStringArray(when.candidate_rule_ids);
    const candidateRuleId = normalizeString(orchestration.workflow_candidate_rule_id);
    if (candidateRuleIds.length <= 0 || !candidateRuleId || !candidateRuleIds.includes(candidateRuleId)) {
      return false;
    }
  }
  if (Object.prototype.hasOwnProperty.call(when, "required_scene_signals_all")) {
    const requiredSignals = normalizeStringArray(when.required_scene_signals_all);
    if (
      requiredSignals.length <= 0 ||
      !requiredSignals.every((signal) => sceneSignalsHitSet.has(signal))
    ) {
      return false;
    }
  }
  if (Object.prototype.hasOwnProperty.call(when, "failure_path_error_codes_any")) {
    const failureCodes = normalizeStringArray(when.failure_path_error_codes_any).map(
      (item) => normalizeErrorCode(item, "")
    );
    if (
      failureCodes.length <= 0 ||
      !failureCodes.includes(normalizedErrorCode)
    ) {
      return false;
    }
  }

  return true;
}

function resolveWorkflowMisrouteRecoveryRuleMatch({
  errorCode,
  plannerOrchestration,
  orchestrationContract,
}) {
  const rules = normalizeWorkflowMisrouteRecoveryRules(orchestrationContract);
  if (rules.length <= 0) {
    return null;
  }
  const orchestration = normalizeObject(plannerOrchestration);
  const candidateHit = deriveWorkflowCandidateHit(orchestration);
  const sceneSignalsHitSet = buildSceneSignalsHitSet({
    plannerOrchestration: orchestration,
    orchestrationContract,
    candidateHit,
  });
  for (const rule of rules) {
    if (
      rule.enabled !== true ||
      !rule.rule_id ||
      !rule.template_ref ||
      !isWorkflowMisrouteRuleMatched({
        rule,
        errorCode,
        plannerOrchestration: orchestration,
        sceneSignalsHitSet,
        candidateHit,
      })
    ) {
      continue;
    }
    return {
      rule_id: rule.rule_id,
      reason_code: rule.reason_code || "workflow_misroute_recovery_rule_matched",
      template_ref: rule.template_ref,
    };
  }
  return null;
}

function buildWorkflowRecommendationFixSteps(workflowRecommendation) {
  const recommendation = normalizeObject(workflowRecommendation);
  const workflowTemplateId = normalizeString(recommendation.workflow_template_id);
  if (!workflowTemplateId) {
    return [];
  }
  return [
    {
      step: 1,
      step_id: "retry_with_recommended_workflow_template",
      tool: WORKFLOW_RECOMMENDATION_TOOL,
      required: true,
      idempotent: false,
      verification: {
        workflow_template_id: workflowTemplateId,
      },
    },
  ];
}

function resolveWorkflowRecommendation({
  toolName,
  errorCode,
  globalContracts,
  sourceData,
  sourceContext,
}) {
  if (normalizeString(toolName) !== WORKFLOW_RECOMMENDATION_TOOL) {
    return null;
  }
  const plannerOrchestration = normalizeWorkflowOrchestration(
    sourceData,
    sourceContext
  );
  const orchestrationContract = getPlannerOrchestrationContract(globalContracts);
  let misrouteRuleMatch = resolveWorkflowMisrouteRecoveryRuleMatch({
    errorCode,
    plannerOrchestration,
    orchestrationContract,
  });
  if (!misrouteRuleMatch) {
    const workflowGatingAction = normalizeString(
      plannerOrchestration.workflow_gating_action
    ).toLowerCase();
    const shouldFallbackRecommend =
      isWorkflowMisrouteRecoveryFailurePathErrorCode(errorCode) &&
      (workflowGatingAction === "warn" ||
        (workflowGatingAction === "reject" &&
          normalizeErrorCode(errorCode, "E_INTERNAL") ===
            "E_WORKFLOW_GATING_REJECTED"));
    if (!shouldFallbackRecommend) {
      return null;
    }
    misrouteRuleMatch = {
      rule_id: "",
      reason_code:
        normalizeString(plannerOrchestration.workflow_gating_reason_code) ||
        normalizeString(plannerOrchestration.workflow_candidate_reason_code) ||
        "workflow_misroute_recovery_fallback",
      template_ref: normalizeString(
        plannerOrchestration.recommended_workflow_template_id
      ),
    };
    if (!misrouteRuleMatch.template_ref) {
      return null;
    }
  }
  if (
    !plannerEntryErrorHintBuilder ||
    typeof plannerEntryErrorHintBuilder.buildWorkflowRecommendation !== "function"
  ) {
    return null;
  }
  const recommendationContext = {
    ...plannerOrchestration,
    recommended_workflow_template_id:
      normalizeString(misrouteRuleMatch.template_ref) ||
      normalizeString(plannerOrchestration.recommended_workflow_template_id),
    workflow_misroute_recovery_rule_id: normalizeString(
      misrouteRuleMatch.rule_id
    ),
    workflow_misroute_recovery_reason_code: normalizeString(
      misrouteRuleMatch.reason_code
    ),
  };
  const recommendation = plannerEntryErrorHintBuilder.buildWorkflowRecommendation({
    workflow_orchestration: recommendationContext,
  });
  return recommendation && typeof recommendation === "object"
    ? recommendation
    : null;
}

function resolveErrorGuidance(options = {}) {
  const source = normalizeObject(options);
  const errorCode = normalizeErrorCode(source.error_code, "E_INTERNAL");
  const message = normalizeString(source.error_message);
  const toolName = normalizeString(source.tool_name);
  const sourceData = normalizeObject(source.data);
  const sourceContext = normalizeObject(source.context);
  const fallbackStrategy = normalizeString(source.fallback_strategy);
  const template = getMcpErrorFeedbackTemplate(errorCode, message);
  const retryPolicy = normalizeRetryPolicy(
    source.retry_policy || template.retry_policy
  );

  const catalog = tryLoadCatalog();
  const globalContracts = normalizeObject(catalog && catalog.globalContracts);
  const toolRecord =
    catalog && catalog.byName instanceof Map
      ? catalog.byName.get(toolName) || null
      : null;
  const normalizedContext = normalizeFailureContext({
    errorCode,
    context: source.context,
    data: source.data,
    globalContracts,
    nowMs: source.now_ms,
  });

  const plan = planRecoveryAction({
    errorCode,
    toolName,
    toolRecord,
    catalog,
    globalContracts,
    failureContext: normalizedContext.context,
    fallbackStrategy,
    contextStale: normalizedContext.context_stale,
    requiresContextRefresh: normalizedContext.requires_context_refresh,
  });

  const allMissingFields = mergeMissingFields(
    normalizedContext.missing_fields,
    plan.context_requirement_missing
  );
  const contextMissing = allMissingFields.length > 0;
  const warningParts = [];
  if (contextMissing) {
    warningParts.push("error context is incomplete for structured recovery guidance");
  }
  if (normalizedContext.context_stale) {
    warningParts.push("error context snapshot is stale");
  }
  if (plan.plan_error_code) {
    warningParts.push(plan.plan_error_message || plan.plan_error_code);
  }
  const warning = warningParts.join("; ");
  const workflowFallback =
    toolName === "planner_execute_mcp"
      ? WORKFLOW_GUIDANCE_FALLBACK_BY_CODE[errorCode] || null
      : null;
  const workflowRecommendation = resolveWorkflowRecommendation({
    toolName,
    errorCode,
    globalContracts,
    sourceData,
    sourceContext,
  });
  const activeWorkflowRecommendation =
    workflowRecommendation &&
    contextMissing !== true &&
    normalizedContext.context_stale !== true
      ? workflowRecommendation
      : null;
  const fallbackSuggestedAction = normalizeString(
    workflowFallback && workflowFallback.suggested_action
  );
  const fallbackSuggestedTool = normalizeString(
    workflowFallback && workflowFallback.suggested_tool
  );
  const fallbackFixHint = normalizeString(
    workflowFallback && workflowFallback.fix_hint
  );
  const shouldPreferWorkflowRecommendation = !!activeWorkflowRecommendation;
  const recommendedWorkflowFixSteps = buildWorkflowRecommendationFixSteps(
    activeWorkflowRecommendation
  );
  const workflowRecommendationFixHint =
    "Workflow candidate is available. Use workflow_recommendation.minimal_valid_template and retry planner_execute_mcp directly.";
  const normalizedSuggestedAction = shouldPreferWorkflowRecommendation
    ? WORKFLOW_RECOMMENDATION_TOOL
    : normalizeString(plan.suggested_action) || fallbackSuggestedAction;
  const normalizedSuggestedTool = shouldPreferWorkflowRecommendation
    ? WORKFLOW_RECOMMENDATION_TOOL
    : normalizeString(plan.suggested_tool) || fallbackSuggestedTool;
  const normalizedFixHint = shouldPreferWorkflowRecommendation
    ? workflowRecommendationFixHint
    : fallbackFixHint || normalizeString(plan.fix_hint);
  const normalizedFixSteps = shouldPreferWorkflowRecommendation
    ? recommendedWorkflowFixSteps
    : Array.isArray(plan.fix_steps)
      ? plan.fix_steps
      : [];

  return {
    recoverable: template.recoverable === true,
    suggestion:
      typeof template.suggestion === "string" ? template.suggestion : "",
    retry_policy: retryPolicy,
    suggested_action: normalizedSuggestedAction,
    suggested_tool: normalizedSuggestedTool,
    fix_hint: normalizedFixHint,
    contextual_hint: plan.contextual_hint,
    fix_steps: normalizedFixSteps,
    execution_order: plan.execution_order,
    failure_handling: plan.failure_handling,
    fallback_strategy: plan.fallback_strategy,
    requires_context_refresh: plan.requires_context_refresh === true,
    context_missing: contextMissing,
    missing_fields: allMissingFields,
    warning,
    recovery_plan_error_code: plan.plan_error_code || "",
    recovery_plan_error_message: plan.plan_error_message || "",
    routed_error_code: plan.routed_error_code || "",
    routed_source: plan.routed_source || "",
    ...(activeWorkflowRecommendation
      ? { workflow_recommendation: activeWorkflowRecommendation }
      : {}),
  };
}

module.exports = {
  STRUCTURED_GUIDANCE_ERROR_CODES,
  resolveErrorGuidance,
};

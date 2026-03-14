"use strict";

const WORKFLOW_ROUTING_ADVISOR_VERSION =
  "phase2b_step5_workflow_routing_advisor_v3";
const REJECT_GATE_ENABLED_ENV_KEY = "PLANNER_WORKFLOW_GATING_REJECT_ENABLED";
const REJECT_GATE_RULE_IDS_ENV_KEY = "PLANNER_WORKFLOW_GATING_REJECT_RULE_IDS";

const CANDIDATE_CONFIDENCE = Object.freeze({
  NONE: "none",
  MEDIUM: "medium",
  HIGH: "high",
});

const GATING_ACTION = Object.freeze({
  ALLOW: "allow",
  WARN: "warn",
  REJECT: "reject",
});

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Math.floor(Number(fallback) || 0);
  }
  return Math.floor(n);
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

function normalizeLowerStringArray(value) {
  return normalizeStringArray(value).map((item) => item.toLowerCase());
}

function normalizeCandidateConfidence(value) {
  const token = normalizeString(value).toLowerCase();
  if (
    token === CANDIDATE_CONFIDENCE.NONE ||
    token === CANDIDATE_CONFIDENCE.MEDIUM ||
    token === CANDIDATE_CONFIDENCE.HIGH
  ) {
    return token;
  }
  return CANDIDATE_CONFIDENCE.NONE;
}

function normalizeGatingAction(value) {
  const action = normalizeString(value).toLowerCase();
  if (
    action === GATING_ACTION.ALLOW ||
    action === GATING_ACTION.WARN ||
    action === GATING_ACTION.REJECT
  ) {
    return action;
  }
  return "";
}

function normalizeBooleanFlag(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  const token = normalizeString(value).toLowerCase();
  if (
    token === "1" ||
    token === "true" ||
    token === "yes" ||
    token === "on" ||
    token === "enabled"
  ) {
    return true;
  }
  if (
    token === "0" ||
    token === "false" ||
    token === "no" ||
    token === "off" ||
    token === "disabled"
  ) {
    return false;
  }
  return fallback === true;
}

function normalizeRuleIdAllowlist(value) {
  if (Array.isArray(value)) {
    return normalizeStringArray(value);
  }
  const token = normalizeString(value);
  if (!token) {
    return [];
  }
  return normalizeStringArray(
    token
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
}

function resolveRejectRuntimeGate(options = {}) {
  const source = isPlainObject(options) ? options : {};
  const rejectEnabled = Object.prototype.hasOwnProperty.call(source, "reject_enabled")
    ? normalizeBooleanFlag(source.reject_enabled, false)
    : normalizeBooleanFlag(process.env[REJECT_GATE_ENABLED_ENV_KEY], false);
  const rejectRuleIdsRaw = Object.prototype.hasOwnProperty.call(
    source,
    "reject_rule_ids"
  )
    ? source.reject_rule_ids
    : process.env[REJECT_GATE_RULE_IDS_ENV_KEY];
  const rejectRuleIds = normalizeRuleIdAllowlist(rejectRuleIdsRaw);
  return {
    reject_enabled: rejectEnabled,
    reject_rule_id_allowlist: new Set(rejectRuleIds),
  };
}

function isRejectRuleRuntimeEnabled(ruleId, rejectRuntimeGate) {
  const gate = isPlainObject(rejectRuntimeGate) ? rejectRuntimeGate : {};
  if (gate.reject_enabled !== true) {
    return false;
  }
  const allowlist =
    gate.reject_rule_id_allowlist instanceof Set
      ? gate.reject_rule_id_allowlist
      : null;
  if (!allowlist || allowlist.size <= 0) {
    return true;
  }
  return allowlist.has(normalizeString(ruleId));
}

function normalizeWorkflowCandidateRules(rawRules) {
  const source = Array.isArray(rawRules) ? rawRules : [];
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    const rule = source[index];
    if (!isPlainObject(rule)) {
      continue;
    }
    output.push({
      rule_id: normalizeString(rule.rule_id),
      enabled: rule.enabled !== false,
      priority: normalizeInteger(rule.priority, 0),
      template_ref: normalizeString(rule.template_ref),
      match_when: isPlainObject(rule.match_when) ? rule.match_when : {},
      deny_when: isPlainObject(rule.deny_when) ? rule.deny_when : {},
      reason_code_on_hit: normalizeString(rule.reason_code_on_hit),
      reason_code_on_deny: normalizeString(rule.reason_code_on_deny),
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

function normalizeWorkflowIntentGatingRules(rawRules, rejectRuntimeGate) {
  const source = Array.isArray(rawRules) ? rawRules : [];
  const output = [];
  for (let index = 0; index < source.length; index += 1) {
    const rule = source[index];
    if (!isPlainObject(rule)) {
      continue;
    }
    const ruleId = normalizeString(rule.rule_id);
    const action = normalizeGatingAction(rule.action);
    let enabled = rule.enabled === true;
    if (enabled && action === GATING_ACTION.REJECT) {
      enabled = isRejectRuleRuntimeEnabled(ruleId, rejectRuntimeGate);
    }
    output.push({
      rule_id: ruleId,
      enabled,
      priority: normalizeInteger(rule.priority, 0),
      action,
      when: isPlainObject(rule.when) ? rule.when : {},
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

function getWorkflowTemplate(orchestrationContract, templateRef) {
  const contract = isPlainObject(orchestrationContract) ? orchestrationContract : {};
  const templates = isPlainObject(contract.workflow_templates)
    ? contract.workflow_templates
    : {};
  if (!templateRef) {
    return null;
  }
  const template = templates[templateRef];
  return isPlainObject(template) ? template : null;
}

function normalizeActionType(rawAction) {
  const action = isPlainObject(rawAction) ? rawAction : {};
  const explicitType = normalizeString(action.type);
  if (explicitType) {
    return explicitType;
  }
  return normalizeString(action.action);
}

function hasFileActionSignal(blockSpec) {
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const input = isPlainObject(block.input) ? block.input : {};
  const fileActions = Array.isArray(input.file_actions) ? input.file_actions : [];
  if (fileActions.length <= 0) {
    return false;
  }
  return fileActions.some((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      return true;
    }
    const actionType = normalizeActionType(entry).toLowerCase();
    if (!actionType) {
      return false;
    }
    return (
      actionType.includes("script") ||
      actionType.includes("file") ||
      actionType === "write_file"
    );
  });
}

function hasComponentAttachSignal(blockSpec) {
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const input = isPlainObject(block.input) ? block.input : {};
  const visualLayerActions = Array.isArray(input.visual_layer_actions)
    ? input.visual_layer_actions
    : [];
  if (visualLayerActions.length <= 0) {
    return false;
  }
  return visualLayerActions.some((entry) => {
    if (typeof entry === "string") {
      return entry.toLowerCase().includes("add_component");
    }
    const actionType = normalizeActionType(entry).toLowerCase();
    return actionType === "add_component" || actionType.includes("component");
  });
}

function hasCompileWaitIntentSignal(blockSpec) {
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const intentKey = normalizeString(block.intent_key).toLowerCase();
  if (!intentKey) {
    return false;
  }
  return (
    intentKey.includes("workflow.script.create_compile_attach") ||
    intentKey.includes("compile") ||
    intentKey.includes("wait")
  );
}

function resolveTargetAnchor(blockSpec, executionContext) {
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const context = isPlainObject(executionContext) ? executionContext : {};
  if (isPlainObject(block.target_anchor)) {
    return block.target_anchor;
  }
  if (isPlainObject(context.target_anchor)) {
    return context.target_anchor;
  }
  return {};
}

function hasTargetAnchorSignal(blockSpec, executionContext) {
  const anchor = resolveTargetAnchor(blockSpec, executionContext);
  return !!(normalizeString(anchor.object_id) && normalizeString(anchor.path));
}

function resolveThreadId(blockSpec, executionContext) {
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const context = isPlainObject(executionContext) ? executionContext : {};
  const input = isPlainObject(block.input) ? block.input : {};
  return (
    normalizeString(input.thread_id) ||
    normalizeString(block.thread_id) ||
    normalizeString(context.thread_id)
  );
}

function extractCapabilityTypesFromObject(source, outputSet) {
  if (!isPlainObject(source) || !(outputSet instanceof Set)) {
    return;
  }
  for (const fieldName of [
    "available_capabilities",
    "capability_types",
    "required_capabilities",
  ]) {
    for (const token of normalizeStringArray(source[fieldName])) {
      outputSet.add(token);
    }
  }
  const actions = Array.isArray(source.actions) ? source.actions : [];
  for (const action of actions) {
    if (typeof action === "string") {
      const token = normalizeString(action);
      if (token) {
        outputSet.add(token);
      }
      continue;
    }
    if (!isPlainObject(action)) {
      continue;
    }
    const typeToken = normalizeString(action.type);
    if (typeToken) {
      outputSet.add(typeToken);
    }
  }
}

function resolveAvailableCapabilitySet(executionContext) {
  const context = isPlainObject(executionContext) ? executionContext : {};
  const output = new Set();
  for (const token of normalizeStringArray(context.available_capabilities)) {
    output.add(token);
  }
  for (const token of normalizeStringArray(context.capability_types)) {
    output.add(token);
  }
  const capabilities = context.capabilities;
  if (Array.isArray(capabilities)) {
    for (const token of normalizeStringArray(capabilities)) {
      output.add(token);
    }
  } else if (isPlainObject(capabilities)) {
    extractCapabilityTypesFromObject(capabilities, output);
  }
  extractCapabilityTypesFromObject(context, output);
  return output;
}

function hasRequiredCapabilityMissingSignal(template, executionContext) {
  const templateDef = isPlainObject(template) ? template : {};
  const selection = isPlainObject(templateDef.selection) ? templateDef.selection : {};
  const requiredCapabilities = normalizeStringArray(selection.required_capabilities);
  if (requiredCapabilities.length <= 0) {
    return false;
  }
  const availableCapabilitySet = resolveAvailableCapabilitySet(executionContext);
  if (availableCapabilitySet.size <= 0) {
    return false;
  }
  for (const capabilityType of requiredCapabilities) {
    if (!availableCapabilitySet.has(capabilityType)) {
      return true;
    }
  }
  return false;
}

function buildSignalFacts({ blockSpec, executionContext, template }) {
  const targetAnchorAvailable = hasTargetAnchorSignal(blockSpec, executionContext);
  const threadId = resolveThreadId(blockSpec, executionContext);
  return {
    script_file_action: hasFileActionSignal(blockSpec),
    component_attach: hasComponentAttachSignal(blockSpec),
    compile_wait_intent: hasCompileWaitIntentSignal(blockSpec),
    target_anchor_available: targetAnchorAvailable,
    thread_id_available: !!threadId,
    target_anchor_missing: !targetAnchorAvailable,
    thread_id_missing: !threadId,
    required_capability_missing: hasRequiredCapabilityMissingSignal(
      template,
      executionContext
    ),
    workflow_template_disabled:
      !isPlainObject(template) || template.enabled === false,
  };
}

function areAllSignalsMatched(signalKeys, facts) {
  const normalizedSignals = normalizeStringArray(signalKeys);
  if (normalizedSignals.length <= 0) {
    return false;
  }
  return normalizedSignals.every((signalName) => facts[signalName] === true);
}

function hasAnySignalMatched(signalKeys, facts) {
  const normalizedSignals = normalizeStringArray(signalKeys);
  if (normalizedSignals.length <= 0) {
    return false;
  }
  return normalizedSignals.some((signalName) => facts[signalName] === true);
}

function buildDefaultDecision() {
  return {
    candidate_hit: false,
    confidence: CANDIDATE_CONFIDENCE.NONE,
    matched_rule_id: "",
    recommended_workflow_template_id: "",
    reason_code: "workflow_candidate_not_matched",
  };
}

function normalizeWorkflowCandidateDecision(value) {
  const decision = isPlainObject(value) ? value : {};
  return {
    candidate_hit: decision.candidate_hit === true,
    confidence: normalizeCandidateConfidence(decision.confidence),
    matched_rule_id: normalizeString(decision.matched_rule_id),
    recommended_workflow_template_id: normalizeString(
      decision.recommended_workflow_template_id
    ),
    reason_code: normalizeString(decision.reason_code),
  };
}

function hasAsyncOpsSubmitTaskMixedSlotsPattern(blockSpec) {
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const input = isPlainObject(block.input) ? block.input : {};
  const intentKey = normalizeString(block.intent_key).toLowerCase();
  if (!intentKey.startsWith("write.async_ops.submit_task")) {
    return false;
  }
  const hasFileActions = Array.isArray(input.file_actions) && input.file_actions.length > 0;
  const hasVisualActions =
    Array.isArray(input.visual_layer_actions) &&
    input.visual_layer_actions.length > 0;
  return hasFileActions && hasVisualActions;
}

function hasMissingWriteEnvelopeOrAnchorPattern(blockSpec) {
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const blockType = normalizeString(block.block_type).toUpperCase();
  if (blockType !== "CREATE" && blockType !== "MUTATE") {
    return false;
  }
  const writeEnvelope = isPlainObject(block.write_envelope) ? block.write_envelope : {};
  const hasWriteEnvelope =
    !!normalizeString(writeEnvelope.execution_mode) &&
    !!normalizeString(writeEnvelope.idempotency_key) &&
    !!normalizeString(writeEnvelope.write_anchor_object_id) &&
    !!normalizeString(writeEnvelope.write_anchor_path);
  const hasReadToken = !!normalizeString(block.based_on_read_token);
  const hasTargetAnchor = hasTargetAnchorSignal(block, {});
  return !(hasWriteEnvelope && hasReadToken && hasTargetAnchor);
}

function buildMisroutePatternFacts({ blockSpec }) {
  return {
    async_ops_submit_task_mixed_slots: hasAsyncOpsSubmitTaskMixedSlotsPattern(blockSpec),
    unsupported_intent_key: false,
    disabled_family_key: false,
    missing_write_envelope_or_anchor: hasMissingWriteEnvelopeOrAnchorPattern(
      blockSpec
    ),
    generic_property_fallback_drift: false,
  };
}

function buildDefaultGatingDecision(candidateDecision) {
  const candidate = normalizeWorkflowCandidateDecision(candidateDecision);
  return {
    action: candidate.candidate_hit ? GATING_ACTION.WARN : GATING_ACTION.ALLOW,
    matched_rule_id: "",
    reason_code: candidate.candidate_hit
      ? "workflow_gating_warn_candidate_default"
      : "workflow_gating_allow_default",
    recommended_workflow_template_id: candidate.recommended_workflow_template_id,
  };
}

function evaluateWorkflowCandidate({
  blockSpec,
  executionContext,
  orchestrationContract,
}) {
  const rules = normalizeWorkflowCandidateRules(
    orchestrationContract.workflow_candidate_rules
  );
  if (rules.length <= 0) {
    return buildDefaultDecision();
  }
  for (const rule of rules) {
    if (rule.enabled !== true || !rule.rule_id || !rule.template_ref) {
      continue;
    }
    const evaluation = evaluateWorkflowCandidateRule({
      rule,
      blockSpec,
      executionContext,
      orchestrationContract,
    });
    if (evaluation.matched === true && isPlainObject(evaluation.decision)) {
      return evaluation.decision;
    }
  }
  return buildDefaultDecision();
}

function isIntentGatingRuleMatched({
  rule,
  blockSpec,
  executionContext,
  orchestrationContract,
  candidateDecision,
}) {
  const currentRule = isPlainObject(rule) ? rule : {};
  const when = isPlainObject(currentRule.when) ? currentRule.when : {};
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const context = isPlainObject(executionContext) ? executionContext : {};
  const candidate = normalizeWorkflowCandidateDecision(candidateDecision);
  const intentKey = normalizeString(block.intent_key).toLowerCase();

  if (
    Object.prototype.hasOwnProperty.call(when, "candidate_hit") &&
    Boolean(when.candidate_hit) !== candidate.candidate_hit
  ) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(when, "candidate_rule_ids")) {
    const candidateRuleIds = normalizeStringArray(when.candidate_rule_ids);
    if (
      candidateRuleIds.length <= 0 ||
      !candidateRuleIds.includes(candidate.matched_rule_id)
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(when, "candidate_confidence_in")) {
    const confidenceIn = normalizeLowerStringArray(when.candidate_confidence_in);
    if (confidenceIn.length <= 0 || !confidenceIn.includes(candidate.confidence)) {
      return false;
    }
  }

  const recommendedTemplate = getWorkflowTemplate(
    orchestrationContract,
    candidate.recommended_workflow_template_id
  );
  const signalFacts = buildSignalFacts({
    blockSpec: block,
    executionContext: context,
    template: recommendedTemplate,
  });
  if (Object.prototype.hasOwnProperty.call(when, "required_scene_signals_all")) {
    if (!areAllSignalsMatched(when.required_scene_signals_all, signalFacts)) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(when, "intent_key_prefixes")) {
    const intentKeyPrefixes = normalizeLowerStringArray(when.intent_key_prefixes);
    if (
      intentKeyPrefixes.length <= 0 ||
      !intentKeyPrefixes.some((prefix) => intentKey.startsWith(prefix))
    ) {
      return false;
    }
  }

  if (Object.prototype.hasOwnProperty.call(when, "misroute_patterns_any")) {
    const misroutePatterns = normalizeStringArray(when.misroute_patterns_any);
    const misrouteFacts = buildMisroutePatternFacts({ blockSpec: block });
    if (
      misroutePatterns.length <= 0 ||
      !misroutePatterns.some((pattern) => misrouteFacts[pattern] === true)
    ) {
      return false;
    }
  }

  return true;
}

function evaluateWorkflowIntentGating({
  blockSpec,
  executionContext,
  orchestrationContract,
  candidateDecision,
  rejectRuntimeGate,
}) {
  const candidate = normalizeWorkflowCandidateDecision(candidateDecision);
  const rules = normalizeWorkflowIntentGatingRules(
    orchestrationContract.workflow_intent_gating_rules,
    rejectRuntimeGate
  );
  for (const rule of rules) {
    if (rule.enabled !== true || !rule.rule_id || !rule.action) {
      continue;
    }
    if (
      !isIntentGatingRuleMatched({
        rule,
        blockSpec,
        executionContext,
        orchestrationContract,
        candidateDecision: candidate,
      })
    ) {
      continue;
    }
    return {
      action: rule.action,
      matched_rule_id: rule.rule_id,
      reason_code:
        rule.reason_code ||
        (rule.action === GATING_ACTION.REJECT
          ? "workflow_gating_reject_rule_matched"
          : rule.action === GATING_ACTION.WARN
          ? "workflow_gating_warn_rule_matched"
          : "workflow_gating_allow_rule_matched"),
      recommended_workflow_template_id: candidate.recommended_workflow_template_id,
    };
  }
  return buildDefaultGatingDecision(candidate);
}

function evaluateWorkflowCandidateRule({
  rule,
  blockSpec,
  executionContext,
  orchestrationContract,
}) {
  const currentRule = isPlainObject(rule) ? rule : {};
  const templateRef = normalizeString(currentRule.template_ref);
  const template = getWorkflowTemplate(orchestrationContract, templateRef);
  const matchWhen = isPlainObject(currentRule.match_when) ? currentRule.match_when : {};
  const denyWhen = isPlainObject(currentRule.deny_when) ? currentRule.deny_when : {};
  const facts = buildSignalFacts({
    blockSpec,
    executionContext,
    template,
  });
  const allSignals = normalizeStringArray(matchWhen.all_signals);
  const anySignals = normalizeStringArray(matchWhen.any_signals);
  if (!areAllSignalsMatched(allSignals, facts)) {
    return {
      matched: false,
      decision: null,
    };
  }
  if (hasAnySignalMatched(denyWhen.any_signals, facts)) {
    return {
      matched: true,
      decision: {
        candidate_hit: false,
        confidence: CANDIDATE_CONFIDENCE.NONE,
        matched_rule_id: normalizeString(currentRule.rule_id),
        recommended_workflow_template_id: templateRef,
        reason_code:
          normalizeString(currentRule.reason_code_on_deny) ||
          "workflow_candidate_rule_denied",
      },
    };
  }
  const optionalAnySignalMatched =
    anySignals.length <= 0 || hasAnySignalMatched(anySignals, facts);
  return {
    matched: true,
    decision: {
      candidate_hit: true,
      confidence: optionalAnySignalMatched
        ? CANDIDATE_CONFIDENCE.HIGH
        : CANDIDATE_CONFIDENCE.MEDIUM,
      matched_rule_id: normalizeString(currentRule.rule_id),
      recommended_workflow_template_id: templateRef,
      reason_code:
        normalizeString(currentRule.reason_code_on_hit) ||
        "workflow_candidate_confirmed",
    },
  };
}

function createWorkflowRoutingAdvisor(options = {}) {
  const rejectRuntimeGate = resolveRejectRuntimeGate(options);
  return {
    version: WORKFLOW_ROUTING_ADVISOR_VERSION,
    detectCandidate(input = {}) {
      const source = isPlainObject(input) ? input : {};
      const blockSpec = isPlainObject(source.block_spec) ? source.block_spec : {};
      const executionContext = isPlainObject(source.execution_context)
        ? source.execution_context
        : {};
      const orchestrationContract = isPlainObject(source.orchestration_contract)
        ? source.orchestration_contract
        : {};
      return evaluateWorkflowCandidate({
        blockSpec,
        executionContext,
        orchestrationContract,
      });
    },
    evaluateIntentGating(input = {}) {
      const source = isPlainObject(input) ? input : {};
      const blockSpec = isPlainObject(source.block_spec) ? source.block_spec : {};
      const executionContext = isPlainObject(source.execution_context)
        ? source.execution_context
        : {};
      const orchestrationContract = isPlainObject(source.orchestration_contract)
        ? source.orchestration_contract
        : {};
      const candidateDecision = isPlainObject(source.candidate_decision)
        ? source.candidate_decision
        : evaluateWorkflowCandidate({
            blockSpec,
            executionContext,
            orchestrationContract,
          });
      return evaluateWorkflowIntentGating({
        blockSpec,
        executionContext,
        orchestrationContract,
        candidateDecision,
        rejectRuntimeGate,
      });
    },
  };
}

module.exports = {
  WORKFLOW_ROUTING_ADVISOR_VERSION,
  CANDIDATE_CONFIDENCE,
  GATING_ACTION,
  createWorkflowRoutingAdvisor,
};

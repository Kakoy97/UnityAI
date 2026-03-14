"use strict";

const { normalizeErrorCode } = require("../../utils/turnUtils");
const { normalizeSsotErrorCodeForMcp } = require("./ssotErrorCodeCanon");

const DEFAULT_EXECUTION_ORDER = "sequential";
const DEFAULT_FAILURE_HANDLING = "stop_on_first_failure";
const DEFAULT_FALLBACK_STRATEGY = "return_manual_instructions";
const DEFAULT_DEPENDENCY_MAX_DEPTH = 10;
const WORKFLOW_MISROUTE_RECOVERY_FAILURE_PATH_ERROR_CODES = new Set([
  "E_SCHEMA_INVALID",
  "E_BLOCK_INTENT_KEY_UNSUPPORTED",
  "E_COMPONENT_TYPE_INVALID",
  "E_BLOCK_NOT_IMPLEMENTED",
  "E_PLANNER_NO_TOOL_MAPPING",
  "E_PLANNER_UNSUPPORTED_FAMILY",
  "E_WORKFLOW_GATING_REJECTED",
]);
const DEFAULT_CODE_RECOVERY_BASELINE = Object.freeze({
  E_SCENE_REVISION_DRIFT: Object.freeze({
    suggested_action: "get_scene_snapshot_for_write",
    suggested_tool: "get_scene_snapshot_for_write",
    fix_hint: "Scene revision drift detected. Refresh read token, then retry write once.",
    context_required: ["scene_revision_changed"],
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "refresh_read_token",
        tool: "get_scene_snapshot_for_write",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_PROPERTY_TYPE_MISMATCH: Object.freeze({
    suggested_action: "get_serialized_property_tree",
    suggested_tool: "get_serialized_property_tree",
    fix_hint:
      "Property value type mismatched. Query serialized property tree and retry with the expected value kind.",
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "inspect_property_tree",
        tool: "get_serialized_property_tree",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_NAME_COLLISION_POLICY_INVALID: Object.freeze({
    suggested_action: "get_write_contract_bundle",
    suggested_tool: "get_write_contract_bundle",
    fix_hint:
      "Name collision policy is invalid. Refresh write contract bundle and use an allowed conflict policy.",
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "refresh_contract_bundle",
        tool: "get_write_contract_bundle",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_TRANSACTION_REF_PATH_INVALID: Object.freeze({
    suggested_action: "get_write_contract_bundle",
    suggested_tool: "get_write_contract_bundle",
    fix_hint:
      "Transaction alias path must use alias.field format. Refresh contract bundle and correct ref expressions.",
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "refresh_transaction_contract",
        tool: "get_write_contract_bundle",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_COMPONENT_TYPE_INVALID: Object.freeze({
    suggested_action: "get_write_contract_bundle",
    suggested_tool: "get_write_contract_bundle",
    fix_hint:
      "Component type is invalid. Refresh write contract bundle and use assembly-qualified component_type.",
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "refresh_component_contract",
        tool: "get_write_contract_bundle",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_COMPONENT_NOT_FOUND: Object.freeze({
    suggested_action: "get_gameobject_components",
    suggested_tool: "get_gameobject_components",
    fix_hint:
      "Component was not found on target object. Query components and retry with a valid component_type.",
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "inspect_target_components",
        tool: "get_gameobject_components",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_PROPERTY_NOT_FOUND: Object.freeze({
    suggested_action: "get_serialized_property_tree",
    suggested_tool: "get_serialized_property_tree",
    fix_hint:
      "Property path is invalid. Query serialized property tree and retry with exact property_path.",
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "inspect_property_tree",
        tool: "get_serialized_property_tree",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_TARGET_NOT_FOUND: Object.freeze({
    suggested_action: "get_hierarchy_subtree",
    suggested_tool: "get_hierarchy_subtree",
    fix_hint:
      "Target object was not found. Refresh hierarchy anchors and retry with a valid target_path/target_object_id pair.",
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "refresh_target_anchor",
        tool: "get_hierarchy_subtree",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_NAME_COLLISION_DETECTED: Object.freeze({
    suggested_action: "get_write_contract_bundle",
    suggested_tool: "get_write_contract_bundle",
    fix_hint:
      "Name collision detected. Choose a valid name_collision_policy (suffix/reuse/fail) and retry.",
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "refresh_create_policy",
        tool: "get_write_contract_bundle",
        required: true,
        idempotent: true,
      }),
    ]),
  }),
  E_TARGET_ANCHOR_CONFLICT: Object.freeze({
    suggested_action: "get_hierarchy_subtree",
    suggested_tool: "get_hierarchy_subtree",
    fix_hint:
      "Anchor conflict detected. Inspect both anchor candidates, choose one object, and retry with target_path/target_object_id bound to the same object.",
    context_required: ["during_dispatch"],
    fix_steps: Object.freeze([
      Object.freeze({
        step: 1,
        step_id: "inspect_path_anchor_candidate",
        tool: "get_hierarchy_subtree",
        required: true,
        idempotent: true,
        context_bindings: Object.freeze([
          "path_candidate_path",
          "path_candidate_object_id",
        ]),
      }),
      Object.freeze({
        step: 2,
        step_id: "inspect_object_id_anchor_candidate",
        tool: "get_hierarchy_subtree",
        required: true,
        idempotent: true,
        depends_on: Object.freeze(["inspect_path_anchor_candidate"]),
        context_bindings: Object.freeze([
          "object_id_candidate_path",
          "object_id_candidate_object_id",
        ]),
      }),
      Object.freeze({
        step: 3,
        step_id: "retry_with_matched_anchor",
        tool: "__retry_current_tool__",
        required: true,
        idempotent: false,
        depends_on: Object.freeze(["inspect_object_id_anchor_candidate"]),
      }),
    ]),
  }),
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : !!fallback;
}

function normalizeNumericStep(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) {
    return fallback;
  }
  return Math.floor(n);
}

function normalizePlannerErrorCode(value, fallback = "E_INTERNAL") {
  const normalized = normalizeErrorCode(value, fallback);
  return normalizeSsotErrorCodeForMcp(normalized);
}

function isWorkflowMisrouteRecoveryFailurePathErrorCode(errorCode) {
  const normalized = normalizePlannerErrorCode(errorCode, "");
  return (
    !!normalized &&
    WORKFLOW_MISROUTE_RECOVERY_FAILURE_PATH_ERROR_CODES.has(normalized)
  );
}

function mergeFixContract(baseFix, overrideFix) {
  const base = normalizeObject(baseFix);
  const override = normalizeObject(overrideFix);
  return {
    ...base,
    ...override,
    context_required:
      Array.isArray(override.context_required) &&
      override.context_required.length > 0
        ? override.context_required
        : Array.isArray(base.context_required)
          ? base.context_required
          : [],
    fix_steps:
      Array.isArray(override.fix_steps) && override.fix_steps.length > 0
        ? override.fix_steps
        : Array.isArray(base.fix_steps)
          ? base.fix_steps
          : [],
  };
}

function resolveTransactionStepNestedFix(errorCode, fix, failureContext) {
  const normalizedErrorCode = normalizePlannerErrorCode(
    errorCode,
    "E_INTERNAL"
  );
  if (normalizedErrorCode !== "E_TRANSACTION_STEP_FAILED") {
    return {
      fix: normalizeObject(fix),
      routed_error_code: "",
      routed_source: "",
    };
  }

  const context = normalizeObject(failureContext);
  const nestedErrorCode = normalizePlannerErrorCode(
    normalizeString(context.nested_error_code) ||
      normalizeString(context.failed_error_code),
    ""
  );
  if (!nestedErrorCode) {
    return {
      fix: normalizeObject(fix),
      routed_error_code: "",
      routed_source: "",
    };
  }

  const baseFix = normalizeObject(fix);
  const nestedRouteMap = normalizeObject(baseFix.nested_error_routes);
  let nestedRouteFix = normalizeObject(nestedRouteMap[nestedErrorCode]);
  if (Object.keys(nestedRouteFix).length <= 0) {
    for (const [routeCode, routeFix] of Object.entries(nestedRouteMap)) {
      if (normalizePlannerErrorCode(routeCode, "") === nestedErrorCode) {
        nestedRouteFix = normalizeObject(routeFix);
        break;
      }
    }
  }
  if (Object.keys(nestedRouteFix).length > 0) {
    return {
      fix: mergeFixContract(baseFix, nestedRouteFix),
      routed_error_code: nestedErrorCode,
      routed_source: "tool_nested_error_route",
    };
  }

  const baselineRouteFix = normalizeObject(
    DEFAULT_CODE_RECOVERY_BASELINE[nestedErrorCode]
  );
  if (Object.keys(baselineRouteFix).length > 0) {
    return {
      fix: mergeFixContract(baseFix, baselineRouteFix),
      routed_error_code: nestedErrorCode,
      routed_source: "baseline_nested_error_route",
    };
  }

  return {
    fix: baseFix,
    routed_error_code: nestedErrorCode,
    routed_source: "",
  };
}

function isReadTool(catalog, toolName) {
  if (!catalog || !(catalog.byName instanceof Map)) {
    return false;
  }
  const tool = catalog.byName.get(toolName);
  if (!tool || typeof tool !== "object") {
    return false;
  }
  return normalizeString(tool.kind).toLowerCase() === "read";
}

function buildRawFixSteps(fix, toolName) {
  const sourceFix = normalizeObject(fix);
  const sourceSteps = normalizeArray(sourceFix.fix_steps);
  const normalized = [];
  for (let index = 0; index < sourceSteps.length; index += 1) {
    const sourceStep = normalizeObject(sourceSteps[index]);
    const stepOrder = normalizeNumericStep(sourceStep.step, index + 1);
    const rawStepTool = normalizeString(sourceStep.tool);
    const stepTool =
      rawStepTool === "__retry_current_tool__"
        ? normalizeString(toolName)
        : rawStepTool;
    const stepId =
      normalizeString(sourceStep.step_id) || `fix_step_${String(stepOrder)}`;
    const dependsOnRaw = normalizeArray(sourceStep.depends_on)
      .map((item) => {
        if (Number.isFinite(Number(item)) && Number(item) >= 1) {
          return `@index:${Math.floor(Number(item))}`;
        }
        return normalizeString(item);
      })
      .filter(Boolean);
    normalized.push({
      step: stepOrder,
      step_id: stepId,
      tool: stepTool,
      required: normalizeBoolean(sourceStep.required, true),
      depends_on: dependsOnRaw,
      idempotent:
        typeof sourceStep.idempotent === "boolean"
          ? sourceStep.idempotent
          : null,
      verification: sourceStep.verification,
      context_bindings: normalizeArray(sourceStep.context_bindings),
    });
  }
  if (normalized.length <= 0 && toolName) {
    return [];
  }
  normalized.sort((a, b) => a.step - b.step);
  return normalized;
}

function attachDefaultStepSemantics(rawSteps, catalog) {
  const stepIdByOrder = new Map();
  for (let index = 0; index < rawSteps.length; index += 1) {
    const current = normalizeObject(rawSteps[index]);
    const stepOrder = normalizeNumericStep(current.step, index + 1);
    const stepId = normalizeString(current.step_id) || `fix_step_${index + 1}`;
    stepIdByOrder.set(stepOrder, stepId);
  }

  const resolveDependsOn = (tokens) =>
    normalizeArray(tokens)
      .map((item) => normalizeString(item))
      .filter(Boolean)
      .map((token) => {
        if (token.startsWith("@index:")) {
          const rawIndex = Number(token.slice("@index:".length));
          if (Number.isFinite(rawIndex) && rawIndex >= 1) {
            const mappedStepId = stepIdByOrder.get(Math.floor(rawIndex));
            return normalizeString(mappedStepId);
          }
          return "";
        }
        return token;
      })
      .filter(Boolean);

  const steps = rawSteps.map((step, index) => {
    const current = normalizeObject(step);
    const prev = index > 0 ? rawSteps[index - 1] : null;
    const explicitDepends = resolveDependsOn(current.depends_on);
    const prevStepId = prev ? normalizeString(prev.step_id) : "";
    const dependsOn = explicitDepends.length > 0 ? explicitDepends : prevStepId ? [prevStepId] : [];
    const verification = normalizeObject(current.verification);
    const hasVerification = Object.keys(verification).length > 0;
    return {
      step: normalizeNumericStep(current.step, index + 1),
      step_id: normalizeString(current.step_id) || `fix_step_${index + 1}`,
      tool: normalizeString(current.tool),
      required: normalizeBoolean(current.required, true),
      depends_on: dependsOn,
      idempotent:
        typeof current.idempotent === "boolean"
          ? current.idempotent
          : isReadTool(catalog, normalizeString(current.tool)),
      verification: hasVerification
        ? {
            auto_verify: normalizeBoolean(verification.auto_verify, false),
            verification_tool: normalizeString(verification.verification_tool),
            verification_criteria: normalizeString(
              verification.verification_criteria
            ),
          }
        : null,
      context_bindings: normalizeArray(current.context_bindings),
    };
  });
  return steps;
}

function detectCycle(steps, maxDepth) {
  const byStepId = new Map();
  for (const step of steps) {
    byStepId.set(step.step_id, step);
  }
  const visiting = new Set();
  const visited = new Set();
  const stack = [];

  function dfs(stepId, depth) {
    if (depth > maxDepth) {
      return {
        ok: false,
        error_code: "E_RECOVERY_PLAN_CYCLE",
        error_message: `fix_steps dependency depth exceeds limit (${maxDepth}).`,
      };
    }
    if (visiting.has(stepId)) {
      const cycleStart = stack.indexOf(stepId);
      const cyclePath =
        cycleStart >= 0
          ? stack.slice(cycleStart).concat([stepId]).join(" -> ")
          : `${stepId} -> ${stepId}`;
      return {
        ok: false,
        error_code: "E_RECOVERY_PLAN_CYCLE",
        error_message: `fix_steps dependency cycle detected: ${cyclePath}`,
      };
    }
    if (visited.has(stepId)) {
      return { ok: true };
    }
    const step = byStepId.get(stepId);
    if (!step) {
      return {
        ok: false,
        error_code: "E_RECOVERY_PLAN_CYCLE",
        error_message: `fix_steps depends_on references unknown step_id '${stepId}'.`,
      };
    }
    visiting.add(stepId);
    stack.push(stepId);
    for (const dep of normalizeArray(step.depends_on)) {
      const depId = normalizeString(dep);
      if (!depId) {
        continue;
      }
      const verdict = dfs(depId, depth + 1);
      if (!verdict.ok) {
        return verdict;
      }
    }
    stack.pop();
    visiting.delete(stepId);
    visited.add(stepId);
    return { ok: true };
  }

  for (const step of steps) {
    const stepId = normalizeString(step.step_id);
    if (!stepId) {
      return {
        ok: false,
        error_code: "E_RECOVERY_PLAN_CYCLE",
        error_message: "fix_steps step_id is required for dependency validation.",
      };
    }
    const verdict = dfs(stepId, 0);
    if (!verdict.ok) {
      return verdict;
    }
  }
  return { ok: true };
}

function pickFallbackStrategy(globalContracts, requestedFallback) {
  const recoveryContract = normalizeObject(
    normalizeObject(globalContracts).recovery_action_contract
  );
  const fallbackContract = normalizeObject(recoveryContract.fallback_strategy);
  const allowed = normalizeArray(fallbackContract.allowed)
    .map((item) => normalizeString(item))
    .filter(Boolean);
  const defaultValue =
    normalizeString(fallbackContract.default) || DEFAULT_FALLBACK_STRATEGY;
  const candidate = normalizeString(requestedFallback) || defaultValue;
  if (allowed.length <= 0) {
    return candidate || DEFAULT_FALLBACK_STRATEGY;
  }
  if (allowed.includes(candidate)) {
    return candidate;
  }
  if (allowed.includes(defaultValue)) {
    return defaultValue;
  }
  return allowed[0];
}

function isContextRequirementSatisfied(context, token) {
  const requirement = normalizeString(token);
  const source = normalizeObject(context);
  if (!requirement) {
    return true;
  }
  if (
    requirement === "before_write" ||
    requirement === "after_write" ||
    requirement === "during_transaction" ||
    requirement === "during_dispatch"
  ) {
    return normalizeString(source.stage) === requirement;
  }
  if (requirement === "scene_revision_changed") {
    return source.scene_revision_changed === true;
  }
  if (requirement === "previous_operation") {
    return !!normalizeString(source.previous_operation);
  }
  return !!normalizeString(source[requirement]);
}

function collectRequirementMissing(context, requiredTokens) {
  const missing = [];
  for (const token of normalizeArray(requiredTokens)) {
    const normalizedToken = normalizeString(token);
    if (!normalizedToken) {
      continue;
    }
    if (!isContextRequirementSatisfied(context, normalizedToken)) {
      missing.push(normalizedToken);
    }
  }
  return missing;
}

function buildFallbackHint(errorCode) {
  const code = normalizePlannerErrorCode(errorCode, "E_INTERNAL");
  if (code === "E_TARGET_ANCHOR_CONFLICT") {
    return "Anchor conflict detected. Refresh hierarchy anchors and retry with matched target_path/target_object_id.";
  }
  if (code === "E_SCENE_REVISION_DRIFT") {
    return "Scene revision changed. Refresh read token before retry.";
  }
  if (code === "E_TRANSACTION_STEP_FAILED") {
    return "Transaction step failed. Inspect nested_error_code and apply mapped recovery steps before retrying.";
  }
  return "Resolve payload/schema mismatch before retry. Use tool schema and contract bundle when needed.";
}

function listStructuredGuidanceErrorCodes(catalog) {
  const output = new Set();
  for (const code of Object.keys(DEFAULT_CODE_RECOVERY_BASELINE)) {
    const normalizedBaselineCode = normalizePlannerErrorCode(code, "");
    if (normalizedBaselineCode) {
      output.add(normalizedBaselineCode);
    }
  }
  const tools = Array.isArray(catalog && catalog.tools) ? catalog.tools : [];
  for (const tool of tools) {
    const quickFixMap = normalizeObject(tool && tool.common_error_fixes);
    for (const code of Object.keys(quickFixMap)) {
      const normalized = normalizePlannerErrorCode(code, "");
      if (normalized) {
        output.add(normalized);
      }
    }
  }
  return Array.from(output.values()).sort();
}

function planRecoveryAction(options = {}) {
  const input = normalizeObject(options);
  const errorCode = normalizePlannerErrorCode(input.errorCode, "E_INTERNAL");
  const toolName = normalizeString(input.toolName);
  const catalog = input.catalog;
  const toolRecord =
    input.toolRecord ||
    (catalog && catalog.byName instanceof Map ? catalog.byName.get(toolName) : null);
  const globalContracts = normalizeObject(input.globalContracts);
  const failureContext = normalizeObject(input.failureContext);
  const fallbackStrategy = pickFallbackStrategy(
    globalContracts,
    input.fallbackStrategy
  );
  const quickFixMap = normalizeObject(toolRecord && toolRecord.common_error_fixes);
  const toolFix = normalizeObject(quickFixMap[errorCode]);
  const globalFix = normalizeObject(DEFAULT_CODE_RECOVERY_BASELINE[errorCode]);
  const baseFix = mergeFixContract(globalFix, toolFix);
  const routeResolution = resolveTransactionStepNestedFix(
    errorCode,
    baseFix,
    failureContext
  );
  const fix = routeResolution.fix;

  const suggestedAction =
    normalizeString(fix.suggested_action) ||
    (errorCode === "E_TARGET_ANCHOR_CONFLICT"
      ? normalizeString(
          normalizeArray(
            normalizeObject(
              normalizeObject(globalContracts.ambiguity_resolution_policy_contract)
                .anchor_conflict
            ).required_actions
          )[0]
        )
      : "");
  const suggestedTool =
    normalizeString(fix.suggested_tool) || suggestedAction || "";
  const missingContextRequirements = collectRequirementMissing(
    failureContext,
    normalizeArray(fix.context_required)
  );
  const rawFixSteps = buildRawFixSteps(fix, toolName);
  const normalizedFixSteps = attachDefaultStepSemantics(rawFixSteps, catalog);

  const dependencyValidation = normalizeObject(
    normalizeObject(globalContracts.recovery_action_contract).dependency_validation
  );
  const checkCycles =
    dependencyValidation.check_cycles !== false &&
    normalizeString(dependencyValidation.on_cycle_detected || "fail_fast") ===
      "fail_fast";
  const maxDepth =
    Number.isFinite(Number(dependencyValidation.max_depth)) &&
    Number(dependencyValidation.max_depth) > 0
      ? Math.floor(Number(dependencyValidation.max_depth))
      : DEFAULT_DEPENDENCY_MAX_DEPTH;
  const cycleVerdict = checkCycles
    ? detectCycle(normalizedFixSteps, maxDepth)
    : { ok: true };

  const contextStale = input.contextStale === true;
  const requiresContextRefresh =
    input.requiresContextRefresh === true || contextStale === true;

  const contextualHintByStage = {
    before_write:
      "Read latest snapshot before write to avoid stale anchors/token.",
    after_write:
      "Write advanced scene revision. Refresh token before next write.",
    during_transaction:
      "Transaction failed mid-flight. Validate refs and replay with fresh context.",
  };
  const stage = normalizeString(failureContext.stage);
  const contextualHint = contextualHintByStage[stage] || "";

  if (!cycleVerdict.ok) {
    return {
      suggested_action: suggestedAction,
      suggested_tool: suggestedTool,
      fix_hint:
        normalizeString(fix.fix_hint) ||
        "Recovery plan invalid due to dependency cycle.",
      contextual_hint: contextualHint,
      fix_steps: [],
      execution_order: DEFAULT_EXECUTION_ORDER,
      failure_handling: DEFAULT_FAILURE_HANDLING,
      fallback_strategy: fallbackStrategy,
      requires_context_refresh: requiresContextRefresh,
      context_requirement_missing: missingContextRequirements,
      plan_error_code: cycleVerdict.error_code,
      plan_error_message: cycleVerdict.error_message,
      routed_error_code: routeResolution.routed_error_code,
      routed_source: routeResolution.routed_source,
    };
  }

  return {
    suggested_action: suggestedAction,
    suggested_tool: suggestedTool,
    fix_hint: normalizeString(fix.fix_hint) || buildFallbackHint(errorCode),
    contextual_hint: contextualHint,
    fix_steps: normalizedFixSteps,
    execution_order:
      normalizeString(fix.execution_order) || DEFAULT_EXECUTION_ORDER,
    failure_handling:
      normalizeString(fix.failure_handling) || DEFAULT_FAILURE_HANDLING,
    fallback_strategy: fallbackStrategy,
    requires_context_refresh: requiresContextRefresh,
    context_requirement_missing: missingContextRequirements,
    plan_error_code: "",
    plan_error_message: "",
    routed_error_code: routeResolution.routed_error_code,
    routed_source: routeResolution.routed_source,
  };
}

module.exports = {
  DEFAULT_EXECUTION_ORDER,
  DEFAULT_FAILURE_HANDLING,
  DEFAULT_FALLBACK_STRATEGY,
  isWorkflowMisrouteRecoveryFailurePathErrorCode,
  listStructuredGuidanceErrorCodes,
  planRecoveryAction,
};

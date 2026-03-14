"use strict";

const { BLOCK_TYPE } = require("../blockRuntime/contracts");

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeString(item)).filter((item) => !!item);
}

function normalizeNonNegativeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Math.max(0, Math.floor(Number(fallback) || 0));
  }
  return Math.floor(n);
}

function normalizeCollisionPolicy(value) {
  const token = normalizeString(value).toLowerCase();
  if (token === "fail" || token === "reuse" || token === "suffix") {
    return token;
  }
  return "";
}

function buildEnsureTargetWriteEnvelope({ blockSpec, stepId, parentAnchor }) {
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const anchor = isPlainObject(parentAnchor) ? parentAnchor : {};
  const baseEnvelope = isPlainObject(block.write_envelope)
    ? { ...block.write_envelope }
    : {};
  const baseKey = normalizeString(baseEnvelope.idempotency_key);
  const normalizedStepId = normalizeString(stepId);
  if (baseKey && normalizedStepId) {
    baseEnvelope.idempotency_key = `${baseKey}__${normalizedStepId}`;
  }
  const parentObjectId = normalizeString(anchor.object_id);
  const parentPath = normalizeString(anchor.path);
  if (parentObjectId) {
    baseEnvelope.write_anchor_object_id = parentObjectId;
  }
  if (parentPath) {
    baseEnvelope.write_anchor_path = parentPath;
  }
  return baseEnvelope;
}

function buildFailureOutcome({
  stepId,
  stepType,
  stepToolName,
  errorCode,
  errorMessage,
  outputData = {},
  status = "failed",
  extras = {},
}) {
  return {
    ok: false,
    errorCode: normalizeString(errorCode) || "E_WORKFLOW_ENSURE_TARGET_FAILED",
    errorMessage: normalizeString(errorMessage) || "ensure_target step failed",
    outputData: isPlainObject(outputData) ? outputData : {},
    stepResult: {
      step_id: normalizeString(stepId) || "workflow_step",
      step_type: normalizeString(stepType) || "ensure_target",
      tool_name: normalizeString(stepToolName) || "create_object",
      status: normalizeString(status) || "failed",
      ...extras,
    },
    resolvedTarget: null,
  };
}

function buildSuccessOutcome({
  stepId,
  stepType,
  stepToolName,
  stepStatus = "succeeded",
  outputData = {},
  resolvedTarget = null,
  extras = {},
}) {
  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    outputData: isPlainObject(outputData) ? outputData : {},
    stepResult: {
      step_id: normalizeString(stepId) || "workflow_step",
      step_type: normalizeString(stepType) || "ensure_target",
      tool_name: normalizeString(stepToolName) || "create_object",
      status: normalizeString(stepStatus) || "succeeded",
      ...extras,
    },
    resolvedTarget: isPlainObject(resolvedTarget) ? resolvedTarget : null,
  };
}

async function executeEnsureTargetStep({
  step,
  stepId,
  blockSpec,
  executionContext,
  adapter,
  sourceUserIntent = "",
}) {
  const workflowStep = isPlainObject(step) ? step : {};
  const block = isPlainObject(blockSpec) ? blockSpec : {};
  const context = isPlainObject(executionContext) ? executionContext : {};
  const stepType = normalizeString(workflowStep.step_type) || "ensure_target";
  const stepToolName = normalizeString(workflowStep.tool_name);
  if (stepToolName !== "create_object" && stepToolName !== "create.object") {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_WORKFLOW_TEMPLATE_INVALID",
      errorMessage: `workflow ensure_target step requires create_object/create.object tool: ${stepId}`,
    });
  }
  if (!adapter || typeof adapter.executeBlock !== "function") {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_WORKFLOW_EXECUTION_FAILED",
      errorMessage: "workflow ensure_target step requires execution adapter",
    });
  }

  const contract = isPlainObject(workflowStep.ensure_target_contract)
    ? workflowStep.ensure_target_contract
    : null;
  if (!contract) {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_WORKFLOW_TEMPLATE_INVALID",
      errorMessage: `workflow ensure_target step requires ensure_target_contract: ${stepId}`,
    });
  }

  const blockInput = isPlainObject(block.input) ? block.input : {};
  const ensureTargetInput = isPlainObject(blockInput.ensure_target)
    ? blockInput.ensure_target
    : {};
  const enabled = ensureTargetInput.enabled === true;
  if (!enabled) {
    return buildSuccessOutcome({
      stepId,
      stepType,
      stepToolName,
      stepStatus: "skipped",
      extras: {
        skipped_reason: "ensure_target_disabled",
      },
    });
  }

  const parentAnchor = isPlainObject(ensureTargetInput.parent_anchor)
    ? ensureTargetInput.parent_anchor
    : {};
  const parentObjectId = normalizeString(parentAnchor.object_id);
  const parentPath = normalizeString(parentAnchor.path);
  if (!parentObjectId || !parentPath) {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_SCHEMA_INVALID",
      errorMessage:
        "workflow ensure_target step requires input.ensure_target.parent_anchor.object_id and path",
    });
  }

  const newObjectName = normalizeString(ensureTargetInput.new_object_name);
  if (!newObjectName) {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_SCHEMA_INVALID",
      errorMessage:
        "workflow ensure_target step requires input.ensure_target.new_object_name",
    });
  }
  const objectKind = normalizeString(ensureTargetInput.object_kind);
  if (!objectKind) {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_SCHEMA_INVALID",
      errorMessage:
        "workflow ensure_target step requires input.ensure_target.object_kind",
    });
  }
  const setActive =
    typeof ensureTargetInput.set_active === "boolean" ? ensureTargetInput.set_active : true;

  const allowedPolicies = normalizeStringArray(contract.allowed_collision_policies).map((entry) =>
    entry.toLowerCase()
  );
  const defaultPolicy =
    normalizeCollisionPolicy(contract.default_collision_policy) || "fail";
  const requestedPolicyRaw =
    normalizeString(ensureTargetInput.name_collision_policy).toLowerCase() || defaultPolicy;
  const requestedPolicy = normalizeCollisionPolicy(requestedPolicyRaw);
  if (!requestedPolicy || !allowedPolicies.includes(requestedPolicy)) {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_SCHEMA_INVALID",
      errorMessage:
        "workflow ensure_target step input.ensure_target.name_collision_policy is not allowed by template contract",
      extras: {
        allowed_collision_policies: allowedPolicies,
      },
    });
  }

  const ensureTargetBlockSpec = {
    block_id: `${normalizeString(block.block_id) || "workflow"}__${stepId}`,
    block_type: BLOCK_TYPE.CREATE,
    intent_key: "create.object",
    input: {
      new_object_name: newObjectName,
      object_kind: objectKind,
      set_active: setActive,
      name_collision_policy: requestedPolicy,
      ...(normalizeString(sourceUserIntent)
        ? { user_intent: normalizeString(sourceUserIntent) }
        : {}),
    },
    target_anchor: {
      object_id: parentObjectId,
      path: parentPath,
    },
    based_on_read_token: normalizeString(block.based_on_read_token),
    write_envelope: buildEnsureTargetWriteEnvelope({
      blockSpec: block,
      stepId,
      parentAnchor: {
        object_id: parentObjectId,
        path: parentPath,
      },
    }),
  };

  const ensureTargetBlockResult = await adapter.executeBlock(
    ensureTargetBlockSpec,
    context
  );
  const stepOutput = isPlainObject(ensureTargetBlockResult && ensureTargetBlockResult.output_data)
    ? ensureTargetBlockResult.output_data
    : {};

  if (!ensureTargetBlockResult || ensureTargetBlockResult.status !== "succeeded") {
    const stepError = isPlainObject(ensureTargetBlockResult && ensureTargetBlockResult.error)
      ? ensureTargetBlockResult.error
      : {};
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode:
        normalizeString(stepError.error_code) || "E_WORKFLOW_ENSURE_TARGET_FAILED",
      errorMessage:
        normalizeString(stepError.error_message) ||
        "workflow ensure_target create.object step failed",
      outputData: stepOutput,
    });
  }

  const resolvedTargetId = normalizeString(stepOutput.target_object_id);
  const resolvedTargetPath = normalizeString(stepOutput.target_path);
  if (!resolvedTargetId || !resolvedTargetPath) {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_WORKFLOW_ENSURE_TARGET_RESULT_INVALID",
      errorMessage:
        "workflow ensure_target step succeeded but missing target_object_id/target_path",
      outputData: stepOutput,
    });
  }

  const collisionPolicyUsed =
    normalizeCollisionPolicy(stepOutput.applied_policy) || requestedPolicy;
  const existingCandidatesCount = normalizeNonNegativeInteger(
    stepOutput.existing_candidates_count,
    0
  );
  const existingCandidatePath = normalizeString(stepOutput.existing_candidate_path);
  const requireUniqueReuseMatch = contract.require_unique_reuse_match === true;
  const forbidFuzzyReuse = contract.forbid_fuzzy_reuse === true;
  if (
    collisionPolicyUsed === "reuse" &&
    existingCandidatesCount > 1 &&
    (requireUniqueReuseMatch || forbidFuzzyReuse)
  ) {
    return buildFailureOutcome({
      stepId,
      stepType,
      stepToolName,
      errorCode: "E_WORKFLOW_ENSURE_TARGET_AMBIGUOUS_REUSE",
      errorMessage:
        "workflow ensure_target reuse requires unique match; multiple existing candidates detected",
      outputData: stepOutput,
      extras: {
        existing_candidates_count: existingCandidatesCount,
        existing_candidate_path: existingCandidatePath,
      },
    });
  }

  const createdOrReused =
    collisionPolicyUsed === "reuse" && existingCandidatesCount === 1
      ? "reused"
      : "created";
  const resolvedTarget = {
    resolved_target_id: resolvedTargetId,
    resolved_target_path: resolvedTargetPath,
    created_or_reused: createdOrReused,
    collision_policy_used: collisionPolicyUsed,
    existing_candidates_count: existingCandidatesCount,
    existing_candidate_path: existingCandidatePath,
    ensure_target_step_id: normalizeString(stepId) || "ensure_target_object",
  };

  return buildSuccessOutcome({
    stepId,
    stepType,
    stepToolName,
    outputData: stepOutput,
    resolvedTarget,
    extras: {
      target_object_id: resolvedTargetId,
      target_path: resolvedTargetPath,
      created_or_reused: createdOrReused,
      collision_policy_used: collisionPolicyUsed,
      existing_candidates_count: existingCandidatesCount,
      existing_candidate_path: existingCandidatePath,
    },
  });
}

module.exports = {
  executeEnsureTargetStep,
};


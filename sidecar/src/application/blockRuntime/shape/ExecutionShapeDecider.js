"use strict";

const {
  BLOCK_TYPE,
  validateBlockPlan,
} = require("../contracts");
const {
  resolveMappingByIntent,
} = require("../execution/BlockToToolPlanMapper");
const {
  MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT,
} = require("../../../ports/contracts");

const EXECUTION_SHAPE_DECIDER_VERSION = "phase2a_step4_t1_v1";

const SHAPE = Object.freeze({
  SINGLE_STEP: "single_step",
  TRANSACTION: "transaction",
});

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.floor(n);
}

function normalizeBlocksFromPlan(blockPlan) {
  return Array.isArray(blockPlan && blockPlan.blocks) ? blockPlan.blocks : [];
}

function normalizeDependsOn(value) {
  return Array.isArray(value) ? value : [];
}

function toToolNameSet(value) {
  const source = Array.isArray(value) ? value : [];
  const output = new Set();
  for (const entry of source) {
    const normalized = normalizeString(entry);
    if (!normalized) {
      continue;
    }
    output.add(normalized);
  }
  return output;
}

function normalizeTransactionEnabledToolSet(rawNames) {
  const source = Array.isArray(rawNames)
    ? rawNames
    : Array.isArray(
          MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT &&
            MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT
              .transaction_enabled_write_tool_names
        )
      ? MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT.transaction_enabled_write_tool_names
      : [];
  return toToolNameSet(source);
}

function normalizeTransactionCandidateRules(value) {
  const source = Array.isArray(value) ? value : [];
  const normalized = [];
  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    if (!isPlainObject(entry)) {
      continue;
    }
    normalized.push({
      rule_id: normalizeString(entry.rule_id),
      enabled: entry.enabled !== false,
      priority: normalizeInteger(entry.priority, 0),
      allow_when: isPlainObject(entry.allow_when) ? entry.allow_when : {},
      deny_when: isPlainObject(entry.deny_when) ? entry.deny_when : {},
      reason_code_on_allow: normalizeString(entry.reason_code_on_allow),
      reason_code_on_deny: normalizeString(entry.reason_code_on_deny),
      source_order: index,
    });
  }
  normalized.sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return left.source_order - right.source_order;
  });
  return normalized;
}

function isWriteBlockType(blockType) {
  return blockType === BLOCK_TYPE.CREATE || blockType === BLOCK_TYPE.MUTATE;
}

function normalizeAnchorKey(anchor) {
  const source = isPlainObject(anchor) ? anchor : {};
  const objectId = normalizeString(source.object_id);
  const path = normalizeString(source.path);
  if (!objectId || !path) {
    return "";
  }
  return `${objectId}::${path}`;
}

function resolveToolNameForBlock(blockSpec) {
  const outcome = resolveMappingByIntent(blockSpec);
  if (!outcome || outcome.ok !== true) {
    return "";
  }
  return normalizeString(outcome.tool_name);
}

function containsAsyncWaitCompileStep(blocks) {
  const source = Array.isArray(blocks) ? blocks : [];
  for (const block of source) {
    const toolName = resolveToolNameForBlock(block);
    if (toolName.startsWith("submit_unity_task")) {
      return true;
    }
    if (toolName.startsWith("get_unity_task_status")) {
      return true;
    }
    if (toolName.startsWith("cancel_unity_task")) {
      return true;
    }
    const intentKey = normalizeString(block && block.intent_key).toLowerCase();
    if (intentKey.includes(".async_") || intentKey.includes(".wait_")) {
      return true;
    }
    if (intentKey.includes(".compile_") || intentKey.includes(".script_ops.")) {
      return true;
    }
  }
  return false;
}

function hasCrossObjectDependencyInferred(blocks) {
  const source = Array.isArray(blocks) ? blocks : [];
  if (source.length <= 1) {
    return false;
  }
  const blockById = new Map();
  for (const block of source) {
    const blockId = normalizeString(block && block.block_id);
    if (blockId) {
      blockById.set(blockId, block);
    }
  }
  for (const block of source) {
    const blockAnchor = normalizeAnchorKey(block && block.target_anchor);
    const dependsOn = normalizeDependsOn(block && block.depends_on);
    if (dependsOn.length <= 0) {
      continue;
    }
    for (const dependencyIdRaw of dependsOn) {
      const dependencyId = normalizeString(dependencyIdRaw);
      if (!dependencyId) {
        return true;
      }
      const dependencyBlock = blockById.get(dependencyId);
      if (!dependencyBlock) {
        return true;
      }
      const dependencyAnchor = normalizeAnchorKey(dependencyBlock.target_anchor);
      if (!blockAnchor || !dependencyAnchor) {
        return true;
      }
      if (blockAnchor !== dependencyAnchor) {
        return true;
      }
    }
  }
  return false;
}

function areDependenciesExplicit(writeBlocks, allBlockIds) {
  const source = Array.isArray(writeBlocks) ? writeBlocks : [];
  if (source.length <= 1) {
    return false;
  }
  for (let index = 1; index < source.length; index += 1) {
    const dependsOn = normalizeDependsOn(source[index] && source[index].depends_on);
    if (dependsOn.length <= 0) {
      return false;
    }
    let hasValidDependency = false;
    for (const dependencyIdRaw of dependsOn) {
      const dependencyId = normalizeString(dependencyIdRaw);
      if (!dependencyId) {
        continue;
      }
      if (allBlockIds.has(dependencyId)) {
        hasValidDependency = true;
      }
    }
    if (!hasValidDependency) {
      return false;
    }
  }
  return true;
}

function buildRuleFacts(blocks, executionContext, transactionEnabledToolSet) {
  const source = Array.isArray(blocks) ? blocks : [];
  const writeBlocks = source.filter((block) =>
    isWriteBlockType(normalizeString(block && block.block_type))
  );
  const blockIds = new Set(
    source
      .map((block) => normalizeString(block && block.block_id))
      .filter((blockId) => !!blockId)
  );
  const writeAnchors = writeBlocks
    .map((block) => normalizeAnchorKey(block && block.target_anchor))
    .filter((anchorKey) => !!anchorKey);
  const writeAnchorsKnown = writeAnchors.length === writeBlocks.length;
  const sameTargetAnchor =
    writeBlocks.length > 0 &&
    writeAnchorsKnown &&
    new Set(writeAnchors).size === 1;
  const toolNames = source.map((block) => resolveToolNameForBlock(block));
  const allStepsTransactionEnabled =
    source.length > 0 &&
    toolNames.length === source.length &&
    toolNames.every(
      (toolName) =>
        !!toolName &&
        transactionEnabledToolSet instanceof Set &&
        transactionEnabledToolSet.has(toolName)
    );
  const planInitialReadToken = normalizeString(
    executionContext && executionContext.plan_initial_read_token
  );
  const previousReadTokenCandidate = normalizeString(
    executionContext && executionContext.previous_read_token_candidate
  );
  const transactionReadTokenCandidate = normalizeString(
    executionContext && executionContext.transaction_read_token_candidate
  );
  const hasBlockReadToken = writeBlocks.some(
    (block) => normalizeString(block && block.based_on_read_token).length > 0
  );
  const tokenSourceUnknown =
    !planInitialReadToken &&
    !previousReadTokenCandidate &&
    !transactionReadTokenCandidate &&
    !hasBlockReadToken;

  return {
    write_block_count: writeBlocks.length,
    same_target_anchor: sameTargetAnchor,
    all_steps_transaction_enabled: allStepsTransactionEnabled,
    dependencies_explicit: areDependenciesExplicit(writeBlocks, blockIds),
    disallow_async_wait_compile: !containsAsyncWaitCompileStep(source),
    token_source_unknown: tokenSourceUnknown,
    cross_object_dependency_inferred: hasCrossObjectDependencyInferred(source),
    target_anchor_ambiguous:
      writeBlocks.length > 0
        ? writeBlocks.some(
            (block) => normalizeAnchorKey(block && block.target_anchor).length <= 0
          )
        : true,
    contains_async_wait_compile_step: containsAsyncWaitCompileStep(source),
  };
}

function isAllowWhenMatched(allowWhen, facts) {
  const conditions = isPlainObject(allowWhen) ? allowWhen : {};
  for (const [key, value] of Object.entries(conditions)) {
    if (key === "write_block_count") {
      const range = isPlainObject(value) ? value : {};
      const min = Number.isFinite(Number(range.min)) ? Number(range.min) : 0;
      const max = Number.isFinite(Number(range.max)) ? Number(range.max) : Infinity;
      if (
        !Number.isFinite(facts.write_block_count) ||
        facts.write_block_count < min ||
        facts.write_block_count > max
      ) {
        return false;
      }
      continue;
    }
    if (typeof value !== "boolean") {
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(facts, key)) {
      return false;
    }
    if (facts[key] !== value) {
      return false;
    }
  }
  return true;
}

function isDenyWhenMatched(denyWhen, facts) {
  const conditions = isPlainObject(denyWhen) ? denyWhen : {};
  for (const [key, value] of Object.entries(conditions)) {
    if (typeof value !== "boolean") {
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(facts, key)) {
      continue;
    }
    if (facts[key] === value) {
      return true;
    }
  }
  return false;
}

function evaluateTransactionCandidateByRules({
  rules,
  blocks,
  executionContext,
  transactionEnabledToolSet,
}) {
  const normalizedRules = Array.isArray(rules) ? rules : [];
  if (normalizedRules.length <= 0) {
    return {
      rule_mode: false,
      candidate: false,
      reason_code: "",
    };
  }
  const facts = buildRuleFacts(blocks, executionContext, transactionEnabledToolSet);
  for (const rule of normalizedRules) {
    if (!rule || rule.enabled === false) {
      continue;
    }
    if (isDenyWhenMatched(rule.deny_when, facts)) {
      return {
        rule_mode: true,
        candidate: false,
        reason_code:
          normalizeString(rule.reason_code_on_deny) ||
          "transaction_candidate_rule_denied",
      };
    }
    if (isAllowWhenMatched(rule.allow_when, facts)) {
      return {
        rule_mode: true,
        candidate: true,
        reason_code:
          normalizeString(rule.reason_code_on_allow) ||
          "transaction_candidate_confirmed",
      };
    }
  }
  return {
    rule_mode: true,
    candidate: false,
    reason_code: "transaction_candidate_rules_not_matched",
  };
}

function buildShapeDecision({
  shape,
  shapeReason,
  shapeDegraded = false,
  degradedReason = "",
  originalShape = "",
}) {
  const output = {
    shape: shape === SHAPE.TRANSACTION ? SHAPE.TRANSACTION : SHAPE.SINGLE_STEP,
    shape_reason: normalizeString(shapeReason) || "insufficient_atomicity_requirements",
    shape_degraded: shapeDegraded === true,
  };
  if (output.shape_degraded) {
    const normalizedOriginalShape = normalizeString(originalShape);
    const normalizedDegradedReason = normalizeString(degradedReason);
    if (normalizedOriginalShape) {
      output.original_shape = normalizedOriginalShape;
    }
    if (normalizedDegradedReason) {
      output.degraded_reason = normalizedDegradedReason;
    }
  }
  return output;
}

function extractDecisionInputs(input) {
  const source = isPlainObject(input) ? input : {};
  const blockSpec = isPlainObject(source.block_spec) ? source.block_spec : null;
  const executionContext = isPlainObject(source.execution_context)
    ? source.execution_context
    : {};
  const runtimeFlags = isPlainObject(source.runtime_flags)
    ? source.runtime_flags
    : {};
  return {
    block_spec: blockSpec,
    execution_context: executionContext,
    runtime_flags: runtimeFlags,
  };
}

function isTransactionCandidate(blocks) {
  const writeBlocks = blocks.filter((block) =>
    isWriteBlockType(normalizeString(block && block.block_type))
  );
  if (writeBlocks.length < 2) {
    return false;
  }

  const atomicGroupIds = writeBlocks
    .map((block) => normalizeString(block && block.atomic_group_id))
    .filter(Boolean);
  const hasSharedAtomicGroup =
    atomicGroupIds.length === writeBlocks.length &&
    new Set(atomicGroupIds).size === 1;
  const allWriteAtomicRequired = writeBlocks.every(
    (block) => block && block.atomicity_required === true
  );

  const hasDependencySignal = blocks.some((block) => {
    const dependsOn = normalizeDependsOn(block && block.depends_on);
    if (dependsOn.length > 0) {
      return true;
    }
    return normalizeString(block && block.atomic_group_id).length > 0;
  });

  return (
    (hasSharedAtomicGroup || allWriteAtomicRequired) && hasDependencySignal
  );
}

function createExecutionShapeDecider(options = {}) {
  const input = isPlainObject(options) ? options : {};
  const validateBlockPlanFn =
    typeof input.validateBlockPlan === "function"
      ? input.validateBlockPlan
      : validateBlockPlan;
  const transactionCandidateRules = normalizeTransactionCandidateRules(
    input.transactionCandidateRules
  );
  const transactionEnabledToolSet = normalizeTransactionEnabledToolSet(
    input.transactionEnabledToolNames
  );

  return {
    decideExecutionShape(rawInput = {}) {
      const normalized = extractDecisionInputs(rawInput);
      const blockSpec = normalized.block_spec;
      const executionContext = normalized.execution_context;
      const runtimeFlags = normalized.runtime_flags;

      if (runtimeFlags.force_single_step === true) {
        return buildShapeDecision({
          shape: SHAPE.SINGLE_STEP,
          shapeReason: "forced_by_block_runtime_flag",
        });
      }

      const blockType = normalizeString(blockSpec && blockSpec.block_type);
      if (blockType === BLOCK_TYPE.READ_STATE || blockType === BLOCK_TYPE.VERIFY) {
        return buildShapeDecision({
          shape: SHAPE.SINGLE_STEP,
          shapeReason: "read_or_verify_single_step",
        });
      }

      const blockPlan = isPlainObject(executionContext.block_plan)
        ? executionContext.block_plan
        : null;
      if (blockPlan) {
        const validation = validateBlockPlanFn(blockPlan);
        if (!validation || validation.ok !== true) {
          return buildShapeDecision({
            shape: SHAPE.SINGLE_STEP,
            shapeReason: "validation_failed",
            shapeDegraded: true,
            originalShape: SHAPE.TRANSACTION,
            degradedReason: "block_plan_validation_failed",
          });
        }
      }

      const blocks = blockPlan ? normalizeBlocksFromPlan(blockPlan) : blockSpec ? [blockSpec] : [];
      if (blocks.length <= 1) {
        return buildShapeDecision({
          shape: SHAPE.SINGLE_STEP,
          shapeReason: "single_block_or_missing_plan",
        });
      }

      const ruleDecision = evaluateTransactionCandidateByRules({
        rules: transactionCandidateRules,
        blocks,
        executionContext,
        transactionEnabledToolSet,
      });
      const candidate = ruleDecision.rule_mode
        ? ruleDecision.candidate
        : isTransactionCandidate(blocks);
      const candidateReason = ruleDecision.rule_mode
        ? normalizeString(ruleDecision.reason_code)
        : candidate
          ? "transaction_candidate_confirmed"
          : "insufficient_atomicity_requirements";
      const transactionCapable = normalizeBoolean(
        executionContext.transaction_capable,
        false
      );
      if (candidate) {
        if (transactionCapable) {
          return buildShapeDecision({
            shape: SHAPE.TRANSACTION,
            shapeReason: candidateReason || "transaction_candidate_confirmed",
          });
        }
        return buildShapeDecision({
          shape: SHAPE.SINGLE_STEP,
          shapeReason: "transaction_capability_unavailable",
          shapeDegraded: true,
          originalShape: SHAPE.TRANSACTION,
          degradedReason: "transaction_capability_unavailable",
        });
      }

      return buildShapeDecision({
        shape: SHAPE.SINGLE_STEP,
        shapeReason: candidateReason || "insufficient_atomicity_requirements",
      });
    },
  };
}

module.exports = {
  EXECUTION_SHAPE_DECIDER_VERSION,
  SHAPE,
  createExecutionShapeDecider,
};

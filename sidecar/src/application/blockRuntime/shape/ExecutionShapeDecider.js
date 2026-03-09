"use strict";

const {
  BLOCK_TYPE,
  validateBlockPlan,
} = require("../contracts");

const EXECUTION_SHAPE_DECIDER_VERSION = "phase1_step4_t1_v1";

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

function normalizeBlocksFromPlan(blockPlan) {
  return Array.isArray(blockPlan && blockPlan.blocks) ? blockPlan.blocks : [];
}

function normalizeDependsOn(value) {
  return Array.isArray(value) ? value : [];
}

function isWriteBlockType(blockType) {
  return blockType === BLOCK_TYPE.CREATE || blockType === BLOCK_TYPE.MUTATE;
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

      const candidate = isTransactionCandidate(blocks);
      const transactionCapable = normalizeBoolean(
        executionContext.transaction_capable,
        false
      );
      if (candidate) {
        if (transactionCapable) {
          return buildShapeDecision({
            shape: SHAPE.TRANSACTION,
            shapeReason: "transaction_candidate_confirmed",
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
        shapeReason: "insufficient_atomicity_requirements",
      });
    },
  };
}

module.exports = {
  EXECUTION_SHAPE_DECIDER_VERSION,
  SHAPE,
  createExecutionShapeDecider,
};


"use strict";

const { WRITE_BLOCK_TYPES } = require("./blockTypes");

function normalizeBlocks(plan) {
  return Array.isArray(plan && plan.blocks) ? plan.blocks : [];
}

function normalizeBlockId(value) {
  return typeof value === "string" ? value : "";
}

function normalizeBlockType(value) {
  return typeof value === "string" ? value : "";
}

function normalizeDependsOn(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeAtomicGroupId(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function buildBlockPlanIndex(plan) {
  const blocks = normalizeBlocks(plan);
  const blockIds = new Set();
  const dependsById = new Map();
  const groupMembers = new Map();
  const errors = [];

  for (const block of blocks) {
    const blockId = normalizeBlockId(block && block.block_id);
    const blockType = normalizeBlockType(block && block.block_type);
    const dependsOn = normalizeDependsOn(block && block.depends_on);
    const atomicGroupId = normalizeAtomicGroupId(block && block.atomic_group_id);

    if (blockIds.has(blockId)) {
      errors.push({
        code: "E_BLOCK_PLAN_DUPLICATE_BLOCK_ID",
        message: `Duplicate block_id "${blockId}" in BlockPlan`,
      });
    } else {
      blockIds.add(blockId);
      dependsById.set(blockId, dependsOn);
    }

    if (atomicGroupId) {
      const members = groupMembers.get(atomicGroupId) || [];
      members.push({
        block_id: blockId,
        block_type: blockType,
      });
      groupMembers.set(atomicGroupId, members);
    }
  }

  return {
    blocks,
    blockIds,
    dependsById,
    groupMembers,
    errors,
  };
}

function validateDependencyGraph(index) {
  const output = [];
  const blocks = Array.isArray(index && index.blocks) ? index.blocks : [];
  const blockIds = index && index.blockIds instanceof Set ? index.blockIds : new Set();
  const dependsById =
    index && index.dependsById instanceof Map ? index.dependsById : new Map();

  for (const block of blocks) {
    const blockId = normalizeBlockId(block && block.block_id);
    const dependsOn = normalizeDependsOn(block && block.depends_on);
    for (const depId of dependsOn) {
      if (depId === blockId) {
        output.push({
          code: "E_BLOCK_PLAN_SELF_DEPENDENCY",
          message: `Block "${blockId}" must not depend on itself`,
          block_id: blockId,
        });
      }
      if (!blockIds.has(depId)) {
        output.push({
          code: "E_BLOCK_PLAN_DEPENDENCY_NOT_FOUND",
          message: `Block "${blockId}" depends on missing block_id "${depId}"`,
          block_id: blockId,
          dependency_block_id: depId,
        });
      }
    }
  }

  const visitState = new Map();
  const visit = (id, stack) => {
    const state = visitState.get(id);
    if (state === "visiting") {
      const cycle = [...stack, id].join(" -> ");
      output.push({
        code: "E_BLOCK_PLAN_DEPENDENCY_CYCLE",
        message: `Dependency cycle detected: ${cycle}`,
      });
      return;
    }
    if (state === "done") {
      return;
    }

    visitState.set(id, "visiting");
    const next = dependsById.get(id) || [];
    for (const dep of next) {
      if (dependsById.has(dep)) {
        visit(dep, [...stack, id]);
      }
    }
    visitState.set(id, "done");
  };

  for (const id of dependsById.keys()) {
    visit(id, []);
  }

  return output;
}

function validateAtomicGroups(index, options = {}) {
  const output = [];
  const writeBlockTypes =
    options.writeBlockTypes instanceof Set ? options.writeBlockTypes : WRITE_BLOCK_TYPES;
  const groupMembers =
    index && index.groupMembers instanceof Map ? index.groupMembers : new Map();

  for (const [groupId, members] of groupMembers.entries()) {
    if (!Array.isArray(members) || members.length < 2) {
      output.push({
        code: "E_BLOCK_PLAN_ATOMIC_GROUP_TOO_SMALL",
        message: `atomic_group_id "${groupId}" must include at least 2 write blocks`,
        atomic_group_id: groupId,
      });
      continue;
    }
    for (const member of members) {
      const blockType = normalizeBlockType(member && member.block_type);
      if (!writeBlockTypes.has(blockType)) {
        output.push({
          code: "E_BLOCK_PLAN_ATOMIC_GROUP_INVALID_BLOCK_TYPE",
          message: `atomic_group_id "${groupId}" contains non-write block "${normalizeBlockId(
            member && member.block_id
          )}"`,
          atomic_group_id: groupId,
          block_id: normalizeBlockId(member && member.block_id),
          block_type: blockType,
        });
      }
    }
  }

  return output;
}

function validateBlockPlanSemantics(plan, options = {}) {
  const index = buildBlockPlanIndex(plan);
  const errors = [...index.errors];
  errors.push(...validateDependencyGraph(index));
  errors.push(...validateAtomicGroups(index, options));
  return errors;
}

module.exports = {
  buildBlockPlanIndex,
  validateDependencyGraph,
  validateAtomicGroups,
  validateBlockPlanSemantics,
};


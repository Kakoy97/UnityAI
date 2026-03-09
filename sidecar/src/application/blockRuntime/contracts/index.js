"use strict";

const { BLOCK_TYPE, BLOCK_TYPE_VALUES, WRITE_BLOCK_TYPES, isBlockType } = require("./blockTypes");
const { BLOCK_SPEC_SCHEMA, validateBlockSpec } = require("./blockSpecSchema");
const {
  BLOCK_PLAN_SCHEMA,
  validateBlockPlan,
  validateBlockPlanSemantics: validateBlockPlanSemanticsBySchema,
} = require("./blockPlanSchema");
const {
  buildBlockPlanIndex,
  validateDependencyGraph,
  validateAtomicGroups,
  validateBlockPlanSemantics,
} = require("./blockPlanValidators");
const { BLOCK_ERROR_SCHEMA, validateBlockError } = require("./blockErrorSchema");
const { BLOCK_RESULT_SCHEMA, validateBlockResult } = require("./blockResultSchema");
const { BLOCK_ERROR_ALIAS_TO_CANONICAL } = require("./blockErrorAliasMap");

module.exports = {
  BLOCK_TYPE,
  BLOCK_TYPE_VALUES,
  WRITE_BLOCK_TYPES,
  isBlockType,
  BLOCK_SPEC_SCHEMA,
  validateBlockSpec,
  BLOCK_PLAN_SCHEMA,
  validateBlockPlan,
  validateBlockPlanSemanticsBySchema,
  buildBlockPlanIndex,
  validateDependencyGraph,
  validateAtomicGroups,
  validateBlockPlanSemantics,
  BLOCK_ERROR_SCHEMA,
  validateBlockError,
  BLOCK_RESULT_SCHEMA,
  validateBlockResult,
  BLOCK_ERROR_ALIAS_TO_CANONICAL,
};

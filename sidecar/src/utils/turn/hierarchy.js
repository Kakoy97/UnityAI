"use strict";

const legacy = require("./legacyTurnUtils");

module.exports = {
  pathLeafName: legacy.pathLeafName,
  isPathSameOrDescendant: legacy.isPathSameOrDescendant,
  parseUnityResourceUri: legacy.parseUnityResourceUri,
  clampInteger: legacy.clampInteger,
  buildHierarchySubtreeSnapshot: legacy.buildHierarchySubtreeSnapshot,
  buildHierarchyNodeWithinBudget: legacy.buildHierarchyNodeWithinBudget,
  buildFallbackHierarchyNode: legacy.buildFallbackHierarchyNode,
  pruneHierarchyByCharBudget: legacy.pruneHierarchyByCharBudget,
  pruneOneHierarchyBranch: legacy.pruneOneHierarchyBranch,
  collapseHierarchyToRootOnly: legacy.collapseHierarchyToRootOnly,
  countHierarchyNodes: legacy.countHierarchyNodes,
  buildHierarchyTruncatedReason: legacy.buildHierarchyTruncatedReason,
};


"use strict";

const legacy = require("./legacyValidators");

module.exports = {
  validateMcpListAssetsInFolder: legacy.validateMcpListAssetsInFolder,
  validateMcpGetSceneRoots: legacy.validateMcpGetSceneRoots,
  validateMcpFindObjectsByComponent: legacy.validateMcpFindObjectsByComponent,
  validateMcpQueryPrefabInfo: legacy.validateMcpQueryPrefabInfo,
};


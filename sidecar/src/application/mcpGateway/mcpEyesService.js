"use strict";

const { validationError, withMcpErrorFeedback } = require("./mcpErrorFeedback");
const { McpEyesReadService } = require("./mcpEyesReadService");
const { McpEyesWriteService } = require("./mcpEyesWriteService");

class McpEyesService {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.readService = new McpEyesReadService({
      nowIso: opts.nowIso,
      enableMcpEyes: opts.enableMcpEyes,
      unitySnapshotService: opts.unitySnapshotService,
      mcpGateway: opts.mcpGateway,
      withMcpErrorFeedback,
      validationError,
      submitUnityQueryAndWait: opts.submitUnityQueryAndWait,
    });
    this.writeService = new McpEyesWriteService({
      unitySnapshotService: opts.unitySnapshotService,
      preconditionService: opts.preconditionService,
      mcpGateway: opts.mcpGateway,
      withMcpErrorFeedback,
      validationError,
    });
  }

  applyScriptActions(body) {
    return this.writeService.applyScriptActions(body);
  }

  applyVisualActions(body) {
    return this.writeService.applyVisualActions(body);
  }

  getCurrentSelection() {
    return this.readService.getCurrentSelection();
  }

  getGameObjectComponents(body) {
    return this.readService.getGameObjectComponents(body);
  }

  getHierarchySubtree(body) {
    return this.readService.getHierarchySubtree(body);
  }

  getPrefabInfo(body) {
    return this.readService.getPrefabInfo(body);
  }

  getCompileState() {
    return this.readService.getCompileState();
  }

  getConsoleErrors(body) {
    return this.readService.getConsoleErrors(body);
  }

  listAssetsInFolder(body) {
    return this.readService.listAssetsInFolder(body);
  }

  getSceneRoots(body) {
    return this.readService.getSceneRoots(body);
  }

  findObjectsByComponent(body) {
    return this.readService.findObjectsByComponent(body);
  }

  queryPrefabInfo(body) {
    return this.readService.queryPrefabInfo(body);
  }

  listResources() {
    return this.readService.listResources();
  }

  readResource(uri) {
    return this.readService.readResource(uri);
  }
}

module.exports = {
  McpEyesService,
};

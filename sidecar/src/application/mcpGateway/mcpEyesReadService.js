"use strict";

const {
  resolveSnapshotTarget,
  buildHierarchySubtreeSnapshot,
  buildConsoleErrorEntries,
  parseUnityResourceUri,
  clampInteger,
} = require("../../utils/turnUtils");
const {
  validateMcpListAssetsInFolder,
  validateMcpGetSceneRoots,
  validateMcpFindObjectsByComponent,
  validateMcpQueryPrefabInfo,
} = require("../../domain/validators");

class McpEyesReadService {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.enableMcpEyes = opts.enableMcpEyes === true;
    this.unitySnapshotService = opts.unitySnapshotService;
    this.mcpGateway = opts.mcpGateway;
    this.withMcpErrorFeedback = opts.withMcpErrorFeedback;
    this.validationError = opts.validationError;
    this.submitUnityQueryAndWait =
      typeof opts.submitUnityQueryAndWait === "function"
        ? opts.submitUnityQueryAndWait
        : null;
  }

  async listAssetsInFolder(body) {
    return this.executeUnityReadQuery(
      "list_assets_in_folder",
      body,
      validateMcpListAssetsInFolder
    );
  }

  async getSceneRoots(body) {
    return this.executeUnityReadQuery(
      "get_scene_roots",
      body,
      validateMcpGetSceneRoots
    );
  }

  async findObjectsByComponent(body) {
    return this.executeUnityReadQuery(
      "find_objects_by_component",
      body,
      validateMcpFindObjectsByComponent
    );
  }

  async queryPrefabInfo(body) {
    return this.executeUnityReadQuery(
      "query_prefab_info",
      body,
      validateMcpQueryPrefabInfo
    );
  }

  getCurrentSelection() {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }
    const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
    if (!snapshot || !snapshot.selection) {
      return {
        statusCode: 409,
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: "E_SELECTION_UNAVAILABLE",
          message:
            "No Unity selection snapshot is available yet. Ensure Unity editor reports selection snapshot first.",
        }),
      };
    }
    const token = this.unitySnapshotService.issueReadTokenForSelection(snapshot, {
      target_object_path: snapshot.selection.target_object_path || "",
      target_object_id: snapshot.selection.object_id || "",
    });
    return {
      statusCode: 200,
      body: {
        ok: true,
        captured_at: snapshot.captured_at || this.nowIso(),
        scene_revision: snapshot.scene_revision || "",
        target_object_id: snapshot.selection.object_id || "",
        target_object_path: snapshot.selection.target_object_path || "",
        selection: snapshot.selection,
        context: snapshot.context || {},
        read_token: token,
      },
    };
  }

  getGameObjectComponents(body) {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }
    const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
    const resolved = resolveSnapshotTarget(snapshot, body || {}, {
      allowSelectionFallback: true,
      requireInTree: false,
      requireInComponentIndex: false,
    });
    if (!resolved.ok) {
      return this.targetResolveFailure(resolved);
    }
    const components = this.unitySnapshotService.readSelectionComponentsForPath(
      resolved.targetPath,
      snapshot
    );
    const token = this.unitySnapshotService.issueReadTokenForSelection(snapshot, {
      target_object_path: resolved.targetPath,
      target_object_id: resolved.targetObjectId || "",
    });
    return {
      statusCode: 200,
      body: {
        ok: true,
        scene_revision: snapshot && snapshot.scene_revision ? snapshot.scene_revision : "",
        target_object_id: resolved.targetObjectId || "",
        target_object_path: resolved.targetPath || "",
        components,
        read_token: token,
      },
    };
  }

  getHierarchySubtree(body) {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }
    const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
    const resolved = resolveSnapshotTarget(snapshot, body || {}, {
      allowSelectionFallback: true,
      requireInTree: true,
      requireInComponentIndex: false,
    });
    if (!resolved.ok) {
      return this.targetResolveFailure(resolved);
    }
    if (!resolved.node) {
      return {
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: "E_TARGET_NOT_FOUND",
          message: `target_path not found in latest selection tree: ${resolved.targetPath}`,
        }),
      };
    }

    const depth = clampInteger(body && body.depth, 1, 0, 3);
    const nodeBudget = clampInteger(body && body.node_budget, 200, 1, 2000);
    const charBudget = clampInteger(body && body.char_budget, 12000, 256, 100000);
    const subtree = buildHierarchySubtreeSnapshot(resolved.node, {
      depth,
      nodeBudget,
      charBudget,
    });
    const token = this.unitySnapshotService.issueReadTokenForSelection(snapshot, {
      target_object_path: resolved.targetPath,
      target_object_id: resolved.targetObjectId || "",
    });

    return {
      statusCode: 200,
      body: {
        ok: true,
        scene_revision: snapshot && snapshot.scene_revision ? snapshot.scene_revision : "",
        target_object_id: resolved.targetObjectId || "",
        target_object_path: resolved.targetPath || "",
        depth,
        node_budget: nodeBudget,
        char_budget: charBudget,
        returned_node_count: subtree.returnedNodeCount,
        truncated: subtree.truncated === true,
        truncated_reason: subtree.truncatedReason || "",
        root: subtree.root,
        read_token: token,
      },
    };
  }

  getPrefabInfo(body) {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }
    const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
    const resolved = resolveSnapshotTarget(snapshot, body || {}, {
      allowSelectionFallback: true,
      requireInTree: false,
      requireInComponentIndex: false,
    });
    if (!resolved.ok) {
      return this.targetResolveFailure(resolved);
    }
    const prefabPath = this.resolvePrefabPath(snapshot, resolved);
    const token = this.unitySnapshotService.issueReadTokenForSelection(snapshot, {
      target_object_path: resolved.targetPath,
      target_object_id: resolved.targetObjectId || "",
    });
    return {
      statusCode: 200,
      body: {
        ok: true,
        scene_revision: snapshot && snapshot.scene_revision ? snapshot.scene_revision : "",
        target_object_id: resolved.targetObjectId || "",
        target_object_path: resolved.targetPath || "",
        prefab_path: prefabPath,
        has_prefab_binding: !!prefabPath,
        read_token: token,
      },
    };
  }

  getCompileState() {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }
    const compileSnapshot = this.unitySnapshotService.getLatestCompileSnapshot();
    const runningJob = this.mcpGateway.getRunningJob();
    return {
      statusCode: 200,
      body: {
        ok: true,
        captured_at:
          compileSnapshot && compileSnapshot.captured_at
            ? compileSnapshot.captured_at
            : "",
        compile_success:
          compileSnapshot && typeof compileSnapshot.compile_success === "boolean"
            ? compileSnapshot.compile_success
            : null,
        error_count:
          compileSnapshot &&
          Number.isFinite(Number(compileSnapshot.error_count)) &&
          Number(compileSnapshot.error_count) >= 0
            ? Math.floor(Number(compileSnapshot.error_count))
            : 0,
        errors:
          compileSnapshot && Array.isArray(compileSnapshot.errors)
            ? compileSnapshot.errors
            : [],
        running_job_id: runningJob ? runningJob.job_id : "",
        running_job_stage: runningJob ? runningJob.stage || "" : "",
      },
    };
  }

  getConsoleErrors(body) {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }
    const limit = clampInteger(body && body.limit, 20, 1, 100);
    const entries = buildConsoleErrorEntries(
      this.unitySnapshotService.getLatestCompileSnapshot(),
      this.unitySnapshotService.getLatestActionErrorSnapshot(),
      this.unitySnapshotService.getLatestConsoleSnapshot()
    );
    return {
      statusCode: 200,
      body: {
        ok: true,
        limit,
        total: entries.length,
        errors: entries.slice(0, limit),
      },
    };
  }

  listResources() {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }
    return {
      statusCode: 200,
      body: {
        resources: [
          {
            uri: "unity://selection/current",
            name: "Current Selection",
            description: "Latest Unity selection snapshot with read token",
            mimeType: "application/json",
          },
          {
            uri: "unity://compile/state",
            name: "Compile State",
            description: "Latest Unity compile state snapshot",
            mimeType: "application/json",
          },
          {
            uri: "unity://console/errors",
            name: "Console Errors",
            description: "Merged compile/action/console errors",
            mimeType: "application/json",
          },
        ],
      },
    };
  }

  readResource(uri) {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }
    const parsed = parseUnityResourceUri(uri);
    if (!parsed) {
      return {
        statusCode: 400,
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: "E_SCHEMA_INVALID",
          message: "Invalid resource uri",
        }),
      };
    }

    let payload = null;
    if (parsed.key === "selection/current") {
      payload = this.getCurrentSelection().body;
    } else if (parsed.key === "compile/state") {
      payload = this.getCompileState().body;
    } else if (parsed.key === "console/errors") {
      const rawLimit = parsed.searchParams ? parsed.searchParams.get("limit") : "";
      payload = this.getConsoleErrors({
        limit: rawLimit !== null ? Number(rawLimit) : undefined,
      }).body;
    } else {
      return {
        statusCode: 404,
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: "E_RESOURCE_NOT_FOUND",
          message: "Resource not found",
        }),
      };
    }
    return {
      statusCode: 200,
      body: {
        contents: [
          {
            uri: uri,
            mimeType: "application/json",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      },
    };
  }

  targetResolveFailure(resolved) {
    return {
      statusCode: resolved.statusCode || 409,
      body: this.withMcpErrorFeedback({
        status: "failed",
        error_code: resolved.errorCode || "E_TARGET_NOT_FOUND",
        message: resolved.message || "Failed to resolve target",
      }),
    };
  }

  resolvePrefabPath(snapshot, resolved) {
    if (!snapshot || typeof snapshot !== "object") {
      return "";
    }
    if (
      resolved &&
      resolved.node &&
      typeof resolved.node.prefab_path === "string" &&
      resolved.node.prefab_path.trim()
    ) {
      return resolved.node.prefab_path.trim();
    }
    if (
      resolved &&
      resolved.componentIndexEntry &&
      typeof resolved.componentIndexEntry.prefab_path === "string" &&
      resolved.componentIndexEntry.prefab_path.trim()
    ) {
      return resolved.componentIndexEntry.prefab_path.trim();
    }
    if (
      snapshot.selection &&
      typeof snapshot.selection.prefab_path === "string" &&
      snapshot.selection.prefab_path.trim()
    ) {
      return snapshot.selection.prefab_path.trim();
    }
    return "";
  }

  disabledOutcome() {
    return {
      statusCode: 404,
      body: this.withMcpErrorFeedback({
        status: "rejected",
        error_code: "E_MCP_EYES_DISABLED",
        message: "MCP eyes tools are disabled",
      }),
    };
  }

  async executeUnityReadQuery(queryType, body, validator) {
    if (!this.enableMcpEyes) {
      return this.disabledOutcome();
    }

    const payload = body && typeof body === "object" ? body : {};
    const validate = typeof validator === "function" ? validator : null;
    if (validate) {
      const validation = validate(payload);
      if (!validation.ok) {
        if (typeof this.validationError === "function") {
          return this.validationError(validation);
        }
        return {
          statusCode: validation.statusCode || 400,
          body: this.withMcpErrorFeedback({
            status: "rejected",
            error_code: validation.errorCode || "E_SCHEMA_INVALID",
            message: validation.message || "Request schema invalid",
          }),
        };
      }
    }

    if (!this.submitUnityQueryAndWait) {
      return {
        statusCode: 500,
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: "E_INTERNAL",
          message: "Unity query runtime is not configured",
        }),
      };
    }

    let unityResponse = null;
    try {
      unityResponse = await this.submitUnityQueryAndWait(queryType, payload);
    } catch (error) {
      return this.mapReadQueryFailure(error);
    }

    if (!unityResponse || typeof unityResponse !== "object") {
      return {
        statusCode: 502,
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: "E_QUERY_FAILED",
          message: "Unity query response is invalid",
        }),
      };
    }

    if (unityResponse.ok !== true) {
      const errorCode = normalizeNonEmptyString(unityResponse.error_code);
      const errorMessage =
        normalizeNonEmptyString(unityResponse.error_message) ||
        normalizeNonEmptyString(unityResponse.message) ||
        "Unity query returned failure";
      return {
        statusCode: mapReadQueryErrorToStatusCode(errorCode),
        body: this.withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode || "E_QUERY_FAILED",
          message: errorMessage,
        }),
      };
    }

    const data =
      unityResponse.data && typeof unityResponse.data === "object"
        ? unityResponse.data
        : {};
    const capturedAt =
      normalizeNonEmptyString(unityResponse.captured_at) || this.nowIso();
    const readToken = this.unitySnapshotService.issueReadTokenForQueryResult(
      queryType,
      unityResponse,
      payload
    );

    return {
      statusCode: 200,
      body: {
        ok: true,
        data,
        read_token: readToken,
        captured_at: capturedAt,
      },
    };
  }

  mapReadQueryFailure(error) {
    const source = error && typeof error === "object" ? error : {};
    const errorCode =
      normalizeNonEmptyString(source.error_code) ||
      normalizeNonEmptyString(source.errorCode) ||
      "E_QUERY_FAILED";
    const errorMessage =
      normalizeNonEmptyString(source.message) ||
      normalizeNonEmptyString(source.error_message) ||
      "Unity query failed";
    const suggestion = normalizeNonEmptyString(source.suggestion);
    const recoverable =
      typeof source.recoverable === "boolean" ? source.recoverable : undefined;

    return {
      statusCode: mapReadQueryErrorToStatusCode(errorCode),
      body: this.withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode,
        message: errorMessage,
        ...(suggestion ? { suggestion } : {}),
        ...(recoverable === undefined ? {} : { recoverable }),
      }),
    };
  }
}

function normalizeNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function mapReadQueryErrorToStatusCode(errorCode) {
  const code = normalizeNonEmptyString(errorCode);
  if (code === "E_SCHEMA_INVALID") {
    return 400;
  }
  if (
    code === "E_QUERY_NOT_FOUND" ||
    code === "E_SCENE_NOT_LOADED" ||
    code === "E_TARGET_NOT_FOUND" ||
    code === "E_PREFAB_NOT_FOUND"
  ) {
    return 404;
  }
  if (code === "E_QUERY_TIMEOUT") {
    return 504;
  }
  if (code === "E_PREFAB_QUERY_API_UNAVAILABLE") {
    return 501;
  }
  return 409;
}

module.exports = {
  McpEyesReadService,
};

"use strict";

const MCP_READ_TOKEN_HARD_MAX_AGE_MS = 3 * 60 * 1000;
const MCP_READ_TOKEN_CACHE_LIMIT = 512;
const MCP_UNKNOWN_SCENE_REVISION = "scene_rev_unknown";
const { OCC_STALE_SNAPSHOT_SUGGESTION } = require("./turnPolicies");

function normalizeRequestId(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}
const {
  buildSelectionSnapshot,
  normalizeSnapshotComponents,
} = require("./turnPayloadBuilders");
const {
  findComponentIndexEntryByPath,
  findSelectionNodeByPath,
  normalizeComponentAlias,
  createReadTokenValue,
  normalizeObjectId,
  normalizeCompileErrors,
  normalizeErrorCode,
} = require("../utils/turnUtils");

/**
 * UnitySnapshotService handles Unity editor snapshots and read token management.
 * This service manages selection, console, compile, and action error snapshots,
 * as well as read token validation and issuance.
 */
class UnitySnapshotService {
  /**
   * @param {{
   *   nowIso: () => string,
   *   readTokenHardMaxAgeMs?: number,
   * }} deps
   */
  constructor(deps) {
    this.nowIso = deps.nowIso;
    this.readTokenHardMaxAgeMs =
      Number.isFinite(Number(deps.readTokenHardMaxAgeMs)) &&
      Number(deps.readTokenHardMaxAgeMs) > 0
        ? Math.floor(Number(deps.readTokenHardMaxAgeMs))
        : MCP_READ_TOKEN_HARD_MAX_AGE_MS;
    this.latestSceneRevision = MCP_UNKNOWN_SCENE_REVISION;

    /** @type {{ source: string, captured_at: string, scene_revision: string, thread_id: string, request_id: string, turn_id: string, context: any, selection: any, component_index?: Array<{path: string, name: string, depth: number, prefab_path?: string, components: Array<{short_name: string, assembly_qualified_name: string}>}> } | null} */
    this.latestSelectionSnapshot = null;
    /** @type {{ source: string, captured_at: string, request_id: string, thread_id: string, turn_id: string, reason: string, errors: Array<any> } | null} */
    this.latestConsoleSnapshot = null;
    /** @type {{ request_id: string, thread_id: string, turn_id: string, timestamp: string, captured_at: string, compile_success: boolean | null, duration_ms: number, error_count: number, errors: Array<{code: string, file: string, line: number, column: number, message: string}> } | null} */
    this.latestCompileSnapshot = null;
    /** @type {{ request_id: string, thread_id: string, turn_id: string, timestamp: string, captured_at: string, action_type: string, target_object_id: string, target_object_path: string, error_code: string, error_message: string } | null} */
    this.latestActionErrorSnapshot = null;
    /** @type {Map<string, { token: string, scene_revision: string, object_id: string, path: string, scope_kind: string, revision_vector: { scene_revision: string, asset_revision: string, compile_epoch: number }, issued_at: string, issued_at_ms: number, hard_max_age_ms: number }>} */
    this.readTokensByValue = new Map();
  }

  // Getter methods for external access to snapshots
  getLatestSelectionSnapshot() {
    return this.latestSelectionSnapshot;
  }

  clearLatestSelectionSnapshot() {
    this.latestSelectionSnapshot = null;
    this.readTokensByValue.clear();
  }

  getLatestConsoleSnapshot() {
    return this.latestConsoleSnapshot;
  }

  getLatestCompileSnapshot() {
    return this.latestCompileSnapshot;
  }

  getLatestActionErrorSnapshot() {
    return this.latestActionErrorSnapshot;
  }

  // Snapshot management methods
  recordLatestSelectionContext(context, metadata) {
    if (!context || typeof context !== "object") {
      return;
    }
    const meta = metadata && typeof metadata === "object" ? metadata : {};
    const snapshot = buildSelectionSnapshot(context, {
      source:
        typeof meta.source === "string" && meta.source.trim()
          ? meta.source.trim()
          : "turn.send",
      requestId:
        typeof meta.requestId === "string" ? normalizeRequestId(meta.requestId) : "",
      threadId: typeof meta.threadId === "string" ? meta.threadId : "",
      turnId: typeof meta.turnId === "string" ? meta.turnId : "",
      capturedAt: this.nowIso(),
    });
    if (!snapshot) {
      return;
    }
    this.latestSelectionSnapshot = snapshot;
    this.latestSceneRevision = this.normalizeSceneRevision(snapshot.scene_revision);
  }

  captureLatestCompileSnapshot(body) {
    const payload = body && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};
    const errors = normalizeCompileErrors(payload.errors);
    this.latestCompileSnapshot = {
      request_id: normalizeRequestId(body && body.request_id),
      thread_id:
        body && typeof body.thread_id === "string" ? body.thread_id : "",
      turn_id: body && typeof body.turn_id === "string" ? body.turn_id : "",
      timestamp:
        body && typeof body.timestamp === "string" && body.timestamp.trim()
          ? body.timestamp
          : this.nowIso(),
      captured_at: this.nowIso(),
      compile_success: payload.success === true,
      duration_ms:
        Number.isFinite(Number(payload.duration_ms)) &&
        Number(payload.duration_ms) >= 0
          ? Math.floor(Number(payload.duration_ms))
          : 0,
      error_count: errors.length,
      errors,
    };
  }

  captureLatestActionErrorSnapshot(body) {
    const payload = body && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};
    if (payload.success === true) {
      this.latestActionErrorSnapshot = null;
      return;
    }

    const targetObjectPath =
      typeof payload.target_object_path === "string" &&
      payload.target_object_path.trim()
        ? payload.target_object_path.trim()
        : typeof payload.target === "string" && payload.target.trim()
          ? payload.target.trim()
          : "";
    const targetObjectId = normalizeObjectId(
      payload.target_object_id,
      payload.object_id
    );
    const errorCode = normalizeErrorCode(
      payload.error_code,
      "E_ACTION_EXECUTION_FAILED"
    );
    const errorMessage =
      typeof payload.error_message === "string" && payload.error_message.trim()
        ? payload.error_message.trim()
        : "Unity visual action failed";
    this.latestActionErrorSnapshot = {
      request_id: normalizeRequestId(body && body.request_id),
      thread_id:
        body && typeof body.thread_id === "string" ? body.thread_id : "",
      turn_id: body && typeof body.turn_id === "string" ? body.turn_id : "",
      timestamp:
        body && typeof body.timestamp === "string" && body.timestamp.trim()
          ? body.timestamp
          : this.nowIso(),
      captured_at: this.nowIso(),
      action_type:
        typeof payload.action_type === "string" ? payload.action_type : "",
      target_object_id: targetObjectId,
      target_object_path: targetObjectPath,
      error_code: errorCode,
      error_message: errorMessage,
    };
  }

  setLatestConsoleSnapshot(snapshot) {
    this.latestConsoleSnapshot = snapshot;
  }

  // Read token management methods
  validateReadTokenForWrite(tokenValue) {
    const token = typeof tokenValue === "string" ? tokenValue.trim() : "";
    if (!token || token.length < 24) {
      return this.createStaleSnapshotFailure("based_on_read_token is missing or invalid");
    }

    this.cleanupExpiredReadTokens();
    const tokenEntry = this.readTokensByValue.get(token);
    if (!tokenEntry || typeof tokenEntry !== "object") {
      return this.createStaleSnapshotFailure("based_on_read_token is unknown or expired");
    }

    const issuedAtMs = this.resolveReadTokenIssuedAtMs(tokenEntry);
    const hardMaxAgeMs = this.resolveReadTokenHardMaxAgeMs(tokenEntry);
    if (!issuedAtMs || !hardMaxAgeMs) {
      this.readTokensByValue.delete(token);
      return this.createStaleSnapshotFailure("based_on_read_token metadata is invalid");
    }

    const expiresAtMs = issuedAtMs + hardMaxAgeMs;
    if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs) {
      this.readTokensByValue.delete(token);
      return this.createStaleSnapshotFailure("based_on_read_token exceeded hard_max_age_ms");
    }

    const currentRevision = this.getCurrentSceneRevision();
    const tokenRevision = this.normalizeSceneRevision(
      tokenEntry.scene_revision ||
        (tokenEntry.revision_vector &&
        typeof tokenEntry.revision_vector === "object"
          ? tokenEntry.revision_vector.scene_revision
          : "")
    );

    if (currentRevision === MCP_UNKNOWN_SCENE_REVISION) {
      return this.createStaleSnapshotFailure("Current scene_revision is unavailable");
    }

    if (
      tokenRevision === MCP_UNKNOWN_SCENE_REVISION ||
      tokenRevision !== currentRevision
    ) {
      return this.createStaleSnapshotFailure(
        "based_on_read_token scene_revision does not match current snapshot"
      );
    }

    return {
      ok: true,
      token_entry: tokenEntry,
    };
  }

  issueReadTokenForSelection(snapshot, targetRef) {
    this.cleanupExpiredReadTokens();
    const sceneRevision = this.normalizeSceneRevision(
      snapshot && typeof snapshot.scene_revision === "string"
        ? snapshot.scene_revision
        : ""
    );
    this.latestSceneRevision = sceneRevision;
    const targetPath = this.resolveSelectionTargetPath(snapshot, targetRef);
    const targetObjectId = this.resolveSelectionTargetObjectId(snapshot, targetRef);
    return this.registerReadTokenEntry({
      scene_revision: sceneRevision,
      asset_revision: "",
      compile_epoch: 0,
      scope_kind: "scene",
      object_id: targetObjectId || "",
      path: targetPath || "",
    });
  }

  issueReadTokenForQueryResult(queryType, queryResult, requestPayload) {
    this.cleanupExpiredReadTokens();

    const result = queryResult && typeof queryResult === "object" ? queryResult : {};
    const payload =
      requestPayload && typeof requestPayload === "object" ? requestPayload : {};
    const revisionVector = this.resolveQueryRevisionVector(result);
    this.latestSceneRevision = this.normalizeSceneRevision(
      revisionVector && revisionVector.scene_revision
    );
    const scope = this.resolveQueryScope(queryType, result, payload);

    return this.registerReadTokenEntry({
      scene_revision: revisionVector.scene_revision,
      asset_revision: revisionVector.asset_revision,
      compile_epoch: revisionVector.compile_epoch,
      scope_kind: scope.kind,
      object_id: scope.object_id,
      path: scope.path,
    });
  }

  registerReadTokenEntry(tokenSeed) {
    const seed = tokenSeed && typeof tokenSeed === "object" ? tokenSeed : {};
    const nowMs = Date.now();
    const issuedAt = this.nowIso();
    const token = createReadTokenValue(nowMs);
    const entry = {
      token,
      scene_revision: this.normalizeSceneRevision(seed.scene_revision),
      object_id:
        typeof seed.object_id === "string" && seed.object_id.trim()
          ? seed.object_id.trim()
          : "",
      path: this.normalizePath(seed.path),
      scope_kind: this.normalizeScopeKind(seed.scope_kind),
      revision_vector: {
        scene_revision: this.normalizeSceneRevision(seed.scene_revision),
        asset_revision:
          typeof seed.asset_revision === "string" ? seed.asset_revision.trim() : "",
        compile_epoch: this.normalizeCompileEpoch(seed.compile_epoch),
      },
      issued_at: issuedAt,
      issued_at_ms: nowMs,
      hard_max_age_ms: this.readTokenHardMaxAgeMs,
    };

    this.readTokensByValue.set(token, entry);
    while (this.readTokensByValue.size > MCP_READ_TOKEN_CACHE_LIMIT) {
      const oldest = this.readTokensByValue.keys().next();
      if (oldest && oldest.value) {
        this.readTokensByValue.delete(oldest.value);
      } else {
        break;
      }
    }

    return {
      token: entry.token,
      issued_at: entry.issued_at,
      hard_max_age_ms: entry.hard_max_age_ms,
      revision_vector: {
        scene_revision: entry.revision_vector.scene_revision,
        asset_revision: entry.revision_vector.asset_revision,
        compile_epoch: entry.revision_vector.compile_epoch,
      },
      scope: {
        kind: entry.scope_kind,
        object_id: entry.object_id,
        path: entry.path,
      },
    };
  }

  resolveSelectionTargetPath(snapshot, targetRef) {
    if (typeof targetRef === "string" && targetRef.trim()) {
      return targetRef.trim();
    }
    if (
      targetRef &&
      typeof targetRef === "object" &&
      typeof targetRef.target_object_path === "string" &&
      targetRef.target_object_path.trim()
    ) {
      return targetRef.target_object_path.trim();
    }
    if (
      targetRef &&
      typeof targetRef === "object" &&
      typeof targetRef.target_path === "string" &&
      targetRef.target_path.trim()
    ) {
      return targetRef.target_path.trim();
    }
    if (
      snapshot &&
      snapshot.selection &&
      typeof snapshot.selection.target_object_path === "string"
    ) {
      return snapshot.selection.target_object_path.trim();
    }
    return "";
  }

  resolveSelectionTargetObjectId(snapshot, targetRef) {
    if (
      targetRef &&
      typeof targetRef === "object" &&
      typeof targetRef.target_object_id === "string" &&
      targetRef.target_object_id.trim()
    ) {
      return targetRef.target_object_id.trim();
    }
    if (
      targetRef &&
      typeof targetRef === "object" &&
      typeof targetRef.object_id === "string" &&
      targetRef.object_id.trim()
    ) {
      return targetRef.object_id.trim();
    }
    if (
      snapshot &&
      snapshot.selection &&
      typeof snapshot.selection.object_id === "string" &&
      snapshot.selection.object_id.trim()
    ) {
      return snapshot.selection.object_id.trim();
    }
    return "";
  }

  resolveQueryRevisionVector(queryResult) {
    const result = queryResult && typeof queryResult === "object" ? queryResult : {};
    const resultReadToken =
      result.read_token && typeof result.read_token === "object"
        ? result.read_token
        : {};
    const resultRevisionVector =
      resultReadToken.revision_vector &&
      typeof resultReadToken.revision_vector === "object"
        ? resultReadToken.revision_vector
        : {};
    const resultData = result.data && typeof result.data === "object" ? result.data : {};
    const latestSelection = this.latestSelectionSnapshot || {};
    const sceneRevision = this.normalizeSceneRevision(
      resultRevisionVector.scene_revision ||
        resultData.scene_revision ||
        latestSelection.scene_revision ||
        ""
    );
    const assetRevision =
      typeof resultRevisionVector.asset_revision === "string"
        ? resultRevisionVector.asset_revision.trim()
        : "";
    const compileEpoch = this.normalizeCompileEpoch(resultRevisionVector.compile_epoch);

    return {
      scene_revision: sceneRevision,
      asset_revision: assetRevision,
      compile_epoch: compileEpoch,
    };
  }

  resolveQueryScope(queryType, queryResult, requestPayload) {
    const result = queryResult && typeof queryResult === "object" ? queryResult : {};
    const payload =
      requestPayload && typeof requestPayload === "object" ? requestPayload : {};
    const resultReadToken =
      result.read_token && typeof result.read_token === "object"
        ? result.read_token
        : {};
    const resultScope =
      resultReadToken.scope && typeof resultReadToken.scope === "object"
        ? resultReadToken.scope
        : {};
    const data = result.data && typeof result.data === "object" ? result.data : {};

    const normalizedType =
      typeof queryType === "string" ? queryType.trim() : "";
    let defaultKind = "scene";
    if (normalizedType === "list_assets_in_folder") {
      defaultKind = "asset";
    } else if (normalizedType === "query_prefab_info") {
      defaultKind = "prefab";
    }

    let path =
      this.normalizePath(resultScope.path) ||
      this.normalizePath(data.prefab_path) ||
      this.normalizePath(data.folder_path) ||
      this.normalizePath(data.scene_path) ||
      this.normalizePath(data.under_path) ||
      this.normalizePath(payload.prefab_path) ||
      this.normalizePath(payload.folder_path) ||
      this.normalizePath(payload.scene_path) ||
      this.normalizePath(payload.under_path);
    let objectId =
      typeof resultScope.object_id === "string" ? resultScope.object_id.trim() : "";

    if (!objectId && normalizedType === "get_scene_roots") {
      const roots = Array.isArray(data.roots) ? data.roots : [];
      const first = roots.length > 0 && roots[0] && typeof roots[0] === "object" ? roots[0] : null;
      if (first && typeof first.object_id === "string" && first.object_id.trim()) {
        objectId = first.object_id.trim();
      }
    }

    if (!objectId && normalizedType === "find_objects_by_component") {
      const matches = Array.isArray(data.matches) ? data.matches : [];
      const first = matches.length > 0 && matches[0] && typeof matches[0] === "object" ? matches[0] : null;
      if (first && typeof first.object_id === "string" && first.object_id.trim()) {
        objectId = first.object_id.trim();
      }
    }

    if (!objectId && normalizedType === "query_prefab_info") {
      if (data.root && typeof data.root === "object") {
        if (typeof data.root.object_id === "string" && data.root.object_id.trim()) {
          objectId = data.root.object_id.trim();
        }
      }
    }

    return {
      kind: this.normalizeScopeKind(resultScope.kind || defaultKind),
      object_id: objectId,
      path,
    };
  }

  normalizeSceneRevision(value) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    return MCP_UNKNOWN_SCENE_REVISION;
  }

  normalizeScopeKind(value) {
    const kind = typeof value === "string" ? value.trim() : "";
    if (kind === "asset" || kind === "prefab" || kind === "scene") {
      return kind;
    }
    return "scene";
  }

  normalizeCompileEpoch(value) {
    if (
      Number.isFinite(Number(value)) &&
      Number(value) >= 0 &&
      Math.floor(Number(value)) === Number(value)
    ) {
      return Math.floor(Number(value));
    }
    return 0;
  }

  normalizePath(value) {
    if (typeof value !== "string" || !value.trim()) {
      return "";
    }
    return value.trim();
  }

  getCurrentSceneRevision() {
    const fromSelection =
      this.latestSelectionSnapshot &&
      typeof this.latestSelectionSnapshot.scene_revision === "string"
        ? this.normalizeSceneRevision(this.latestSelectionSnapshot.scene_revision)
        : MCP_UNKNOWN_SCENE_REVISION;
    if (fromSelection !== MCP_UNKNOWN_SCENE_REVISION) {
      this.latestSceneRevision = fromSelection;
      return fromSelection;
    }
    return this.normalizeSceneRevision(this.latestSceneRevision);
  }

  resolveReadTokenIssuedAtMs(entry) {
    const tokenEntry = entry && typeof entry === "object" ? entry : null;
    if (!tokenEntry) {
      return 0;
    }
    const fromIso = Date.parse(tokenEntry.issued_at);
    if (Number.isFinite(fromIso) && fromIso > 0) {
      return fromIso;
    }
    const fromMs = Number(tokenEntry.issued_at_ms);
    if (Number.isFinite(fromMs) && fromMs > 0) {
      return Math.floor(fromMs);
    }
    return 0;
  }

  resolveReadTokenHardMaxAgeMs(entry) {
    const tokenEntry = entry && typeof entry === "object" ? entry : null;
    if (!tokenEntry) {
      return 0;
    }
    const value = Number(tokenEntry.hard_max_age_ms);
    if (!Number.isFinite(value) || value <= 0) {
      return 0;
    }
    return Math.floor(value);
  }

  createStaleSnapshotFailure(message) {
    return {
      ok: false,
      statusCode: 409,
      error_code: "E_STALE_SNAPSHOT",
      message:
        typeof message === "string" && message.trim()
          ? message.trim()
          : "based_on_read_token is stale",
      suggestion: OCC_STALE_SNAPSHOT_SUGGESTION,
    };
  }

  cleanupExpiredReadTokens() {
    const now = Date.now();
    for (const [token, entry] of this.readTokensByValue.entries()) {
      if (!entry || typeof entry !== "object") {
        this.readTokensByValue.delete(token);
        continue;
      }
      const issuedAtMs = this.resolveReadTokenIssuedAtMs(entry);
      const hardMaxAgeMs = this.resolveReadTokenHardMaxAgeMs(entry);
      if (!issuedAtMs || now - issuedAtMs > hardMaxAgeMs) {
        this.readTokensByValue.delete(token);
      }
    }
  }

  // Snapshot query methods
  selectionPathExists(targetPath, snapshot) {
    const path = typeof targetPath === "string" ? targetPath.trim() : "";
    if (!path) {
      return false;
    }
    const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
    if (!snap || !snap.selection) {
      return false;
    }
    const selectedPath =
      typeof snap.selection.target_object_path === "string"
        ? snap.selection.target_object_path.trim()
        : "";
    if (selectedPath && selectedPath === path) {
      return true;
    }

    const root =
      snap.context &&
      snap.context.selection_tree &&
      snap.context.selection_tree.root &&
      typeof snap.context.selection_tree.root === "object"
        ? snap.context.selection_tree.root
        : null;
    if (findSelectionNodeByPath(root, path)) {
      return true;
    }
    return !!findComponentIndexEntryByPath(snap.component_index, path);
  }

  readSelectionComponentsForPath(targetPath, snapshot) {
    const path = typeof targetPath === "string" ? targetPath.trim() : "";
    if (!path) {
      return [];
    }
    const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
    if (!snap || !snap.selection) {
      return [];
    }
    const selectedPath =
      typeof snap.selection.target_object_path === "string"
        ? snap.selection.target_object_path.trim()
        : "";
    if (selectedPath && selectedPath === path) {
      return normalizeSnapshotComponents(snap.selection.components);
    }

    const root =
      snap.context &&
      snap.context.selection_tree &&
      snap.context.selection_tree.root &&
      typeof snap.context.selection_tree.root === "object"
        ? snap.context.selection_tree.root
        : null;
    const node = findSelectionNodeByPath(root, path);
    if (node && Array.isArray(node.components)) {
      return normalizeSnapshotComponents(node.components);
    }
    const indexEntry = findComponentIndexEntryByPath(snap.component_index, path);
    if (indexEntry && Array.isArray(indexEntry.components)) {
      return normalizeSnapshotComponents(indexEntry.components);
    }
    return [];
  }

  matchComponentInList(components, expectedRaw) {
    const expected =
      typeof expectedRaw === "string" && expectedRaw.trim()
        ? expectedRaw.trim().toLowerCase()
        : "";
    if (!expected) {
      return false;
    }
    const expectedShort = normalizeComponentAlias(expected);
    const list = Array.isArray(components) ? components : [];
    for (const item of list) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const shortName =
        typeof item.short_name === "string" ? item.short_name.toLowerCase() : "";
      const shortAlias = normalizeComponentAlias(shortName);
      const assembly =
        typeof item.assembly_qualified_name === "string"
          ? item.assembly_qualified_name.toLowerCase()
          : "";
      if (
        shortName === expected ||
        shortAlias === expected ||
        shortName === expectedShort ||
        shortAlias === expectedShort ||
        assembly === expected ||
        normalizeComponentAlias(assembly) === expectedShort
      ) {
        return true;
      }
    }
    return false;
  }
}

module.exports = {
  UnitySnapshotService,
  OCC_STALE_SNAPSHOT_SUGGESTION,
};


"use strict";

const { normalizeSnapshotComponents } = require("../application/turnPayloadBuilders");
const {
  getMcpErrorFeedbackTemplate,
  OCC_STALE_SNAPSHOT_SUGGESTION,
} = require("../application/turnPolicies");
const { normalizeLease } = require("../application/jobRuntime/jobLease");

// Helper functions - defined in dependency order

function normalizeObjectId(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeRequestId(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function pathLeafName(pathValue) {
  const text = typeof pathValue === "string" ? pathValue.trim() : "";
  if (!text) {
    return "";
  }
  const parts = text.split("/").filter((part) => !!part);
  if (parts.length === 0) {
    return text;
  }
  return parts[parts.length - 1];
}

function isPathSameOrDescendant(pathValue, rootPath) {
  const path =
    typeof pathValue === "string" && pathValue.trim() ? pathValue.trim() : "";
  const root =
    typeof rootPath === "string" && rootPath.trim() ? rootPath.trim() : "";
  if (!path || !root) {
    return false;
  }
  if (path === root) {
    return true;
  }
  return path.startsWith(`${root}/`);
}

function normalizeSelectionComponentIndex(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }
  const result = [];
  for (const item of entries) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const path =
      typeof item.path === "string" && item.path.trim() ? item.path.trim() : "";
    if (!path) {
      continue;
    }
    result.push({
      object_id: normalizeObjectId(item.object_id),
      path,
      name:
        typeof item.name === "string" && item.name.trim()
          ? item.name.trim()
          : pathLeafName(path),
      depth:
        Number.isFinite(Number(item.depth)) && Number(item.depth) >= 0
          ? Math.floor(Number(item.depth))
          : 0,
      prefab_path:
        typeof item.prefab_path === "string" && item.prefab_path.trim()
          ? item.prefab_path.trim()
          : "",
      components: normalizeSnapshotComponents(item.components),
    });
  }
  return result;
}

function findComponentIndexEntryByPath(entries, targetPath) {
  const normalizedTarget =
    typeof targetPath === "string" && targetPath.trim() ? targetPath.trim() : "";
  if (!normalizedTarget || !Array.isArray(entries)) {
    return null;
  }
  for (const item of entries) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const path =
      typeof item.path === "string" && item.path.trim() ? item.path.trim() : "";
    if (path && path === normalizedTarget) {
      return item;
    }
  }
  return null;
}

function findComponentIndexEntryByObjectId(entries, objectId) {
  const normalizedTarget = normalizeObjectId(objectId);
  if (!normalizedTarget || !Array.isArray(entries)) {
    return null;
  }
  for (const item of entries) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const currentObjectId = normalizeObjectId(item.object_id);
    if (currentObjectId && currentObjectId === normalizedTarget) {
      return item;
    }
  }
  return null;
}

function findSelectionNodeByPath(root, targetPath) {
  if (!root || typeof root !== "object") {
    return null;
  }
  const normalizedTarget = typeof targetPath === "string" ? targetPath.trim() : "";
  if (!normalizedTarget) {
    return null;
  }
  const rootPath =
    typeof root.path === "string" && root.path.trim() ? root.path.trim() : "";
  if (rootPath && rootPath === normalizedTarget) {
    return root;
  }
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) {
    const hit = findSelectionNodeByPath(child, normalizedTarget);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function findSelectionNodeByObjectId(root, objectId) {
  if (!root || typeof root !== "object") {
    return null;
  }
  const normalizedTarget = normalizeObjectId(objectId);
  if (!normalizedTarget) {
    return null;
  }
  const rootObjectId = normalizeObjectId(root.object_id);
  if (rootObjectId && rootObjectId === normalizedTarget) {
    return root;
  }
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) {
    const hit = findSelectionNodeByObjectId(child, normalizedTarget);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function normalizeCompileErrors(errors) {
  if (!Array.isArray(errors)) {
    return [];
  }
  const result = [];
  for (const item of errors) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const code =
      typeof item.code === "string" && item.code.trim() ? item.code.trim() : "";
    const file =
      typeof item.file === "string" && item.file.trim() ? item.file.trim() : "";
    const line =
      Number.isFinite(Number(item.line)) && Number(item.line) > 0
        ? Math.floor(Number(item.line))
        : 0;
    const column =
      Number.isFinite(Number(item.column)) && Number(item.column) > 0
        ? Math.floor(Number(item.column))
        : 0;
    const message =
      typeof item.message === "string" && item.message.trim()
        ? item.message.trim()
        : "";
    if (!code && !file && !message) {
      continue;
    }
    result.push({
      code: code || "UNKNOWN",
      file,
      line,
      column,
      message,
    });
  }
  return result;
}

function normalizeConsoleSnapshotErrors(errors) {
  if (!Array.isArray(errors)) {
    return [];
  }
  const result = [];
  for (const item of errors) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const timestamp =
      typeof item.timestamp === "string" && item.timestamp.trim()
        ? item.timestamp.trim()
        : "";
    const logType =
      typeof item.log_type === "string" && item.log_type.trim()
        ? item.log_type.trim()
        : "Error";
    const condition =
      typeof item.condition === "string" && item.condition.trim()
        ? item.condition.trim()
        : "";
    const stackTrace =
      typeof item.stack_trace === "string" && item.stack_trace.trim()
        ? item.stack_trace
        : "";
    const file =
      typeof item.file === "string" && item.file.trim() ? item.file.trim() : "";
    const line =
      Number.isFinite(Number(item.line)) && Number(item.line) > 0
        ? Math.floor(Number(item.line))
        : 0;
    const errorCode =
      typeof item.error_code === "string" && item.error_code.trim()
        ? item.error_code.trim()
        : "";
    if (!condition && !stackTrace && !file && !errorCode) {
      continue;
    }
    result.push({
      timestamp,
      log_type: logType,
      condition,
      stack_trace: stackTrace,
      file,
      line,
      error_code: errorCode,
    });
  }
  return result;
}

function parseTimestampMs(value) {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function buildConsoleErrorEntries(
  compileSnapshot,
  actionErrorSnapshot,
  consoleSnapshot
) {
  const entries = [];

  if (compileSnapshot && typeof compileSnapshot === "object") {
    const compileErrors = normalizeCompileErrors(compileSnapshot.errors);
    const compileTimestamp =
      typeof compileSnapshot.captured_at === "string" &&
      compileSnapshot.captured_at.trim()
        ? compileSnapshot.captured_at
        : typeof compileSnapshot.timestamp === "string"
          ? compileSnapshot.timestamp
          : "";
    for (const error of compileErrors) {
      entries.push({
        source: "compile",
        timestamp: compileTimestamp,
        request_id:
          typeof compileSnapshot.request_id === "string"
            ? compileSnapshot.request_id
            : "",
        thread_id:
          typeof compileSnapshot.thread_id === "string"
            ? compileSnapshot.thread_id
            : "",
        turn_id:
          typeof compileSnapshot.turn_id === "string"
            ? compileSnapshot.turn_id
            : "",
        error_code:
          typeof error.code === "string" && error.code.trim()
            ? error.code.trim()
            : "UNKNOWN",
        error_message:
          typeof error.message === "string" ? error.message : "",
        file: typeof error.file === "string" ? error.file : "",
        line:
          Number.isFinite(Number(error.line)) && Number(error.line) > 0
            ? Math.floor(Number(error.line))
            : 0,
        column:
          Number.isFinite(Number(error.column)) && Number(error.column) > 0
            ? Math.floor(Number(error.column))
            : 0,
      });
    }
  }

  if (actionErrorSnapshot && typeof actionErrorSnapshot === "object") {
    const actionTimestamp =
      typeof actionErrorSnapshot.captured_at === "string" &&
      actionErrorSnapshot.captured_at.trim()
        ? actionErrorSnapshot.captured_at
        : typeof actionErrorSnapshot.timestamp === "string"
          ? actionErrorSnapshot.timestamp
          : "";
    entries.push({
      source: "action",
      timestamp: actionTimestamp,
      request_id:
        typeof actionErrorSnapshot.request_id === "string"
          ? actionErrorSnapshot.request_id
          : "",
      thread_id:
        typeof actionErrorSnapshot.thread_id === "string"
          ? actionErrorSnapshot.thread_id
          : "",
      turn_id:
        typeof actionErrorSnapshot.turn_id === "string"
          ? actionErrorSnapshot.turn_id
          : "",
      error_code:
        typeof actionErrorSnapshot.error_code === "string"
          ? actionErrorSnapshot.error_code
          : "E_ACTION_EXECUTION_FAILED",
      error_message:
        typeof actionErrorSnapshot.error_message === "string"
          ? actionErrorSnapshot.error_message
          : "",
      action_type:
        typeof actionErrorSnapshot.action_type === "string"
          ? actionErrorSnapshot.action_type
          : "",
      target_object_id:
        typeof actionErrorSnapshot.target_object_id === "string"
          ? actionErrorSnapshot.target_object_id
          : "",
      target_object_path:
        typeof actionErrorSnapshot.target_object_path === "string"
          ? actionErrorSnapshot.target_object_path
          : "",
      file: "",
      line: 0,
      column: 0,
    });
  }

  if (consoleSnapshot && typeof consoleSnapshot === "object") {
    const consoleErrors = normalizeConsoleSnapshotErrors(consoleSnapshot.errors);
    const consoleCapturedAt =
      typeof consoleSnapshot.captured_at === "string" &&
      consoleSnapshot.captured_at.trim()
        ? consoleSnapshot.captured_at
        : "";
    for (const item of consoleErrors) {
      const timestamp =
        typeof item.timestamp === "string" && item.timestamp.trim()
          ? item.timestamp
          : consoleCapturedAt;
      entries.push({
        source: "unity_console",
        timestamp,
        request_id:
          typeof consoleSnapshot.request_id === "string"
            ? consoleSnapshot.request_id
            : "",
        thread_id:
          typeof consoleSnapshot.thread_id === "string"
            ? consoleSnapshot.thread_id
            : "",
        turn_id:
          typeof consoleSnapshot.turn_id === "string"
            ? consoleSnapshot.turn_id
            : "",
        error_code:
          typeof item.error_code === "string" && item.error_code.trim()
            ? item.error_code
            : "UNITY_CONSOLE_ERROR",
        error_message:
          typeof item.condition === "string" ? item.condition : "",
        file: typeof item.file === "string" ? item.file : "",
        line:
          Number.isFinite(Number(item.line)) && Number(item.line) > 0
            ? Math.floor(Number(item.line))
            : 0,
        column: 0,
        log_type:
          typeof item.log_type === "string" && item.log_type.trim()
            ? item.log_type
            : "Error",
        stack_trace:
          typeof item.stack_trace === "string" ? item.stack_trace : "",
      });
    }
  }

  entries.sort((a, b) => {
    return parseTimestampMs(b.timestamp) - parseTimestampMs(a.timestamp);
  });
  return entries;
}

function createSplitWriteIdempotencyKey() {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `split_write_${ts}_${rand}`;
}

function normalizeComponentAlias(value) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!text) {
    return "";
  }
  const beforeComma = text.split(",")[0].trim();
  if (!beforeComma) {
    return "";
  }
  const parts = beforeComma.split(".").filter((part) => !!part);
  if (parts.length === 0) {
    return beforeComma;
  }
  return parts[parts.length - 1];
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function createReadTokenValue(nowMs) {
  const ts = Number.isFinite(Number(nowMs)) && Number(nowMs) > 0
    ? Math.floor(Number(nowMs))
    : Date.now();
  const stamp = ts.toString(36);
  // Keep token length >= 24 to satisfy write-side schema validation.
  const rand = Math.random().toString(36).slice(2, 18).padEnd(16, "0");
  return `rt_${stamp}_${rand}`;
}

function resolveSnapshotTarget(snapshot, args, options) {
  const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!snap || !snap.selection) {
    return {
      ok: false,
      statusCode: 409,
      errorCode: "E_SELECTION_UNAVAILABLE",
      message:
        "No Unity selection snapshot is available yet. Ensure Unity editor reports selection snapshot first.",
    };
  }

  const opts = options && typeof options === "object" ? options : {};
  const allowSelectionFallback = opts.allowSelectionFallback !== false;
  const requireInTree = opts.requireInTree === true;
  const requireInComponentIndex = opts.requireInComponentIndex === true;
  const source = args && typeof args === "object" ? args : {};
  const requestedAnchor =
    source.target_anchor && typeof source.target_anchor === "object"
      ? source.target_anchor
      : null;
  const requestedTargetPath = normalizeNonEmptyString(
    requestedAnchor && typeof requestedAnchor.path === "string"
      ? requestedAnchor.path
      : ""
  );
  const requestedObjectId = normalizeObjectId(
    requestedAnchor && typeof requestedAnchor.object_id === "string"
      ? requestedAnchor.object_id
      : ""
  );
  if (requestedAnchor) {
    if (!requestedTargetPath || !requestedObjectId) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: "E_SCHEMA_INVALID",
        message: "target_anchor requires both object_id and path",
      };
    }
  }
  const selectedTargetPath = normalizeNonEmptyString(
    snap.selection && typeof snap.selection === "object"
      ? snap.selection.target_object_path
      : ""
  );
  const selectedTargetObjectId = normalizeObjectId(
    snap.selection && typeof snap.selection === "object"
      ? snap.selection.object_id
      : ""
  );
  const root =
    snap.context &&
    snap.context.selection_tree &&
    snap.context.selection_tree.root &&
    typeof snap.context.selection_tree.root === "object"
      ? snap.context.selection_tree.root
      : null;
  const componentIndex = Array.isArray(snap.component_index)
    ? snap.component_index
    : [];

  if (!selectedTargetPath && !requestedTargetPath && !requestedObjectId) {
    return {
      ok: false,
      statusCode: 409,
      errorCode: "E_SELECTION_UNAVAILABLE",
      message: "Current selection snapshot does not include target_object_path",
    };
  }

  const resolveByPath = (targetPath) => {
    const normalizedPath = normalizeNonEmptyString(targetPath);
    if (!normalizedPath) {
      return null;
    }
    const node = findSelectionNodeByPath(root, normalizedPath);
    const componentIndexEntry = findComponentIndexEntryByPath(
      componentIndex,
      normalizedPath
    );
    if (!node && !componentIndexEntry && normalizedPath !== selectedTargetPath) {
      return null;
    }
    return {
      targetPath: normalizedPath,
      targetObjectId: normalizeObjectId(
        node && typeof node === "object" ? node.object_id : "",
        componentIndexEntry && typeof componentIndexEntry === "object"
          ? componentIndexEntry.object_id
          : "",
        normalizedPath === selectedTargetPath ? selectedTargetObjectId : ""
      ),
      node,
      componentIndexEntry,
    };
  };

  const resolveByObjectId = (targetObjectId) => {
    const normalizedObjectId = normalizeObjectId(targetObjectId);
    if (!normalizedObjectId) {
      return null;
    }
    if (selectedTargetObjectId && normalizedObjectId === selectedTargetObjectId) {
      return resolveByPath(selectedTargetPath) || {
        targetPath: selectedTargetPath,
        targetObjectId: selectedTargetObjectId,
        node: null,
        componentIndexEntry: null,
      };
    }
    const node = findSelectionNodeByObjectId(root, normalizedObjectId);
    if (node) {
      const nodePath = normalizeNonEmptyString(node.path);
      return {
        targetPath: nodePath,
        targetObjectId: normalizedObjectId,
        node,
        componentIndexEntry: findComponentIndexEntryByPath(componentIndex, nodePath),
      };
    }
    const componentIndexEntry = findComponentIndexEntryByObjectId(
      componentIndex,
      normalizedObjectId
    );
    if (componentIndexEntry) {
      const path = normalizeNonEmptyString(componentIndexEntry.path);
      return {
        targetPath: path,
        targetObjectId: normalizedObjectId,
        node: findSelectionNodeByPath(root, path),
        componentIndexEntry,
      };
    }
    return null;
  };

  const resolvedByPath = requestedTargetPath ? resolveByPath(requestedTargetPath) : null;
  if (requestedTargetPath && !resolvedByPath) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "E_TARGET_NOT_FOUND",
      message:
        "target_path not found in latest selection tree/component index: " +
        requestedTargetPath,
    };
  }

  const resolvedByObjectId = requestedObjectId
    ? resolveByObjectId(requestedObjectId)
    : null;
  if (requestedObjectId && !resolvedByObjectId) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "E_TARGET_NOT_FOUND",
      message:
        "target_object_id not found in latest selection tree/component index: " +
        requestedObjectId,
    };
  }

  let resolved = null;
  if (resolvedByPath && resolvedByObjectId) {
    const pathConflict = resolvedByPath.targetPath !== resolvedByObjectId.targetPath;
    const pathObjectId =
      normalizeObjectId(resolvedByPath.targetObjectId) || requestedObjectId;
    const objectIdConflict =
      pathObjectId &&
      requestedObjectId &&
      normalizeObjectId(pathObjectId) !== normalizeObjectId(requestedObjectId);
    if (pathConflict || objectIdConflict) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: "E_TARGET_ANCHOR_CONFLICT",
        message:
          "target_object_id and target_path resolve to different objects in latest snapshot",
      };
    }
    resolved = {
      targetPath: resolvedByPath.targetPath,
      targetObjectId: normalizeObjectId(
        requestedObjectId,
        resolvedByPath.targetObjectId,
        resolvedByObjectId.targetObjectId
      ),
      node: resolvedByPath.node || resolvedByObjectId.node,
      componentIndexEntry:
        resolvedByPath.componentIndexEntry || resolvedByObjectId.componentIndexEntry,
    };
  } else if (resolvedByPath) {
    resolved = resolvedByPath;
  } else if (resolvedByObjectId) {
    resolved = resolvedByObjectId;
  } else if (allowSelectionFallback && selectedTargetPath) {
    resolved =
      resolveByPath(selectedTargetPath) || {
        targetPath: selectedTargetPath,
        targetObjectId: selectedTargetObjectId,
        node: null,
        componentIndexEntry: null,
      };
  }

  if (!resolved || !resolved.targetPath) {
    return {
      ok: false,
      statusCode: 400,
      errorCode: "E_SCHEMA_INVALID",
      message: "target_anchor is required when no current selection is available",
    };
  }

  if (requireInTree && !resolved.node) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "E_TARGET_NOT_FOUND",
      message: `target_path not found in latest selection tree: ${resolved.targetPath}`,
    };
  }
  if (requireInComponentIndex && !resolved.componentIndexEntry) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "E_TARGET_NOT_FOUND",
      message:
        "target_path not found in latest selection component index: " +
        resolved.targetPath,
    };
  }

  if (
    !requireInTree &&
    !requireInComponentIndex &&
    !resolved.node &&
    !resolved.componentIndexEntry &&
    resolved.targetPath !== selectedTargetPath
  ) {
    return {
      ok: false,
      statusCode: 404,
      errorCode: "E_TARGET_NOT_FOUND",
      message:
        "target_path not found in latest selection tree/component index: " +
        resolved.targetPath,
    };
  }

  return {
    ok: true,
    targetPath: resolved.targetPath,
    targetObjectId: normalizeObjectId(
      resolved.targetObjectId,
      resolved.targetPath === selectedTargetPath ? selectedTargetObjectId : ""
    ),
    node: resolved.node || null,
    componentIndexEntry: resolved.componentIndexEntry || null,
    selectedTargetPath,
    selectedTargetObjectId,
  };
}

function mapTargetResolveReasonToPreconditionReason(errorCode) {
  if (
    errorCode === "E_TARGET_CONFLICT" ||
    errorCode === "E_TARGET_ANCHOR_CONFLICT"
  ) {
    return "anchor_conflict";
  }
  if (errorCode === "E_TARGET_NOT_FOUND") {
    return "target_not_found";
  }
  if (errorCode === "E_SELECTION_UNAVAILABLE") {
    return "selection_unavailable";
  }
  return "target_missing";
}

function parseUnityResourceUri(uri) {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "unity:") {
      return null;
    }
    const host = typeof parsed.host === "string" ? parsed.host.trim() : "";
    const path = typeof parsed.pathname === "string" ? parsed.pathname : "";
    const normalizedPath = path.replace(/^\/+/, "").trim();
    const key = [host, normalizedPath].filter((part) => !!part).join("/");
    return {
      key,
      searchParams: parsed.searchParams,
    };
  } catch {
    return null;
  }
}

function clampInteger(value, fallback, min, max) {
  const n = Number(value);
  const raw = Number.isFinite(n) ? Math.floor(n) : fallback;
  let bounded = Number.isFinite(raw) ? raw : fallback;
  if (Number.isFinite(min) && bounded < min) {
    bounded = min;
  }
  if (Number.isFinite(max) && bounded > max) {
    bounded = max;
  }
  return bounded;
}

function buildHierarchySubtreeSnapshot(sourceRoot, options) {
  const opts = options && typeof options === "object" ? options : {};
  const depth = clampInteger(opts.depth, 1, 0, 3);
  const nodeBudget = clampInteger(opts.nodeBudget, 200, 1, 2000);
  const charBudget = clampInteger(opts.charBudget, 12000, 256, 100000);
  const stats = {
    returnedNodeCount: 0,
    truncatedReasons: new Set(),
  };
  const builtRoot = buildHierarchyNodeWithinBudget(
    sourceRoot,
    0,
    {
      depth,
      nodeBudget,
    },
    stats
  );
  const root = builtRoot || buildFallbackHierarchyNode(sourceRoot);

  if (JSON.stringify({ root }).length > charBudget) {
    stats.truncatedReasons.add("char_budget");
    pruneHierarchyByCharBudget(root, charBudget);
  }
  if (JSON.stringify({ root }).length > charBudget) {
    collapseHierarchyToRootOnly(root);
    stats.truncatedReasons.add("char_budget");
  }

  const truncatedReason = buildHierarchyTruncatedReason(stats.truncatedReasons);
  return {
    root,
    returnedNodeCount: countHierarchyNodes(root),
    truncated: truncatedReason !== "",
    truncatedReason,
  };
}

function buildHierarchyNodeWithinBudget(sourceNode, relativeDepth, limits, stats) {
  if (!sourceNode || typeof sourceNode !== "object") {
    return null;
  }
  if (stats.returnedNodeCount >= limits.nodeBudget) {
    stats.truncatedReasons.add("node_budget");
    return null;
  }

  const children = Array.isArray(sourceNode.children) ? sourceNode.children : [];
  const componentCount = Array.isArray(sourceNode.components)
    ? sourceNode.components.length
    : 0;
  const node = {
    name:
      typeof sourceNode.name === "string" && sourceNode.name.trim()
        ? sourceNode.name.trim()
        : pathLeafName(sourceNode.path || ""),
    object_id: normalizeObjectId(sourceNode.object_id),
    path:
      typeof sourceNode.path === "string" && sourceNode.path.trim()
        ? sourceNode.path.trim()
        : "",
    depth:
      Number.isFinite(Number(sourceNode.depth)) && Number(sourceNode.depth) >= 0
        ? Math.floor(Number(sourceNode.depth))
        : relativeDepth,
    component_count: componentCount,
    children: [],
    children_truncated_count: 0,
  };
  if (typeof sourceNode.active === "boolean") {
    node.active = sourceNode.active;
  }
  stats.returnedNodeCount += 1;

  if (relativeDepth >= limits.depth) {
    if (children.length > 0) {
      node.children_truncated_count = children.length;
      stats.truncatedReasons.add("depth_limit");
    }
    return node;
  }

  for (let i = 0; i < children.length; i += 1) {
    if (stats.returnedNodeCount >= limits.nodeBudget) {
      node.children_truncated_count += children.length - i;
      stats.truncatedReasons.add("node_budget");
      break;
    }
    const childNode = buildHierarchyNodeWithinBudget(
      children[i],
      relativeDepth + 1,
      limits,
      stats
    );
    if (childNode) {
      node.children.push(childNode);
    } else {
      node.children_truncated_count += children.length - i;
      break;
    }
  }
  return node;
}

function buildFallbackHierarchyNode(sourceNode) {
  const componentCount = Array.isArray(sourceNode && sourceNode.components)
    ? sourceNode.components.length
    : 0;
  return {
    name:
      sourceNode && typeof sourceNode.name === "string" && sourceNode.name.trim()
        ? sourceNode.name.trim()
        : "",
    object_id:
      sourceNode && typeof sourceNode.object_id === "string"
        ? normalizeObjectId(sourceNode.object_id)
        : "",
    path:
      sourceNode && typeof sourceNode.path === "string" && sourceNode.path.trim()
        ? sourceNode.path.trim()
        : "",
    depth:
      sourceNode &&
      Number.isFinite(Number(sourceNode.depth)) &&
      Number(sourceNode.depth) >= 0
        ? Math.floor(Number(sourceNode.depth))
        : 0,
    component_count: componentCount,
    children: [],
    children_truncated_count: 0,
  };
}

function pruneHierarchyByCharBudget(root, charBudget) {
  let guard = 0;
  while (JSON.stringify({ root }).length > charBudget && guard < 2048) {
    guard += 1;
    if (!pruneOneHierarchyBranch(root)) {
      break;
    }
  }
}

function pruneOneHierarchyBranch(node) {
  if (!node || typeof node !== "object") {
    return false;
  }
  const children = Array.isArray(node.children) ? node.children : [];
  for (let i = children.length - 1; i >= 0; i -= 1) {
    if (pruneOneHierarchyBranch(children[i])) {
      return true;
    }
  }
  if (children.length > 0) {
    node.children = [];
    node.children_truncated_count =
      (Number.isFinite(Number(node.children_truncated_count))
        ? Math.floor(Number(node.children_truncated_count))
        : 0) + children.length;
    return true;
  }
  return false;
}

function collapseHierarchyToRootOnly(root) {
  if (!root || typeof root !== "object") {
    return;
  }
  const children = Array.isArray(root.children) ? root.children : [];
  if (children.length > 0) {
    root.children_truncated_count =
      (Number.isFinite(Number(root.children_truncated_count))
        ? Math.floor(Number(root.children_truncated_count))
        : 0) + children.length;
  }
  root.children = [];
}

function countHierarchyNodes(root) {
  if (!root || typeof root !== "object") {
    return 0;
  }
  const children = Array.isArray(root.children) ? root.children : [];
  let count = 1;
  for (const child of children) {
    count += countHierarchyNodes(child);
  }
  return count;
}

function buildHierarchyTruncatedReason(reasons) {
  const set = reasons instanceof Set ? reasons : new Set();
  const ordered = [];
  if (set.has("depth_limit")) {
    ordered.push("depth_limit");
  }
  if (set.has("node_budget")) {
    ordered.push("node_budget");
  }
  if (set.has("char_budget")) {
    ordered.push("char_budget");
  }
  return ordered.join("+");
}

function normalizeErrorCode(value, fallback) {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const code = value.trim();
  return code || fallback;
}

const MCP_ERROR_MESSAGE_MAX_LENGTH = 240;
const WINDOWS_ABSOLUTE_PATH_RE =
  /\b(?:[A-Za-z]:\\|\\\\)[^\s|;:]+(?:\\[^\s|;:]+)*/g;
const BROKEN_WINDOWS_PATH_RE = /(?:^|[\s|;])(:\\[^\s|;:]+(?:\\[^\s|;:]+)*)/g;
const UNIX_ABSOLUTE_PATH_RE =
  /\b\/(?:Users|home|var|tmp|private|opt|Volumes|mnt|etc|srv|proc|sys)\/[^\s|;:]*/g;
const STACK_TRACE_SEGMENT_RE = /(?:^|\s)(?:at|in)\s+[A-Za-z0-9_.$<>`]+\s*(?:\([^)]+\))?/gi;

function sanitizeMcpErrorMessage(value, options) {
  const opts = options && typeof options === "object" ? options : {};
  const fallback =
    typeof opts.fallback === "string" && opts.fallback.trim()
      ? opts.fallback.trim()
      : "Unknown error";
  const maxLength =
    Number.isFinite(Number(opts.maxLength)) && Number(opts.maxLength) >= 32
      ? Math.floor(Number(opts.maxLength))
      : MCP_ERROR_MESSAGE_MAX_LENGTH;
  const text = typeof value === "string" ? value : "";
  const diagnostics = {
    had_multiline: false,
    stack_sanitized: false,
    path_sanitized: false,
    truncated: false,
  };

  let cleaned = text.replace(/\u0000/g, "");
  if (/[\r\n]/.test(cleaned)) {
    diagnostics.had_multiline = true;
    cleaned = cleaned
      .split(/\r?\n/)
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => !!item)
      .join(" | ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return {
      message: fallback,
      diagnostics,
    };
  }

  const beforeStack = cleaned;
  cleaned = cleaned
    .replace(/\bStackTrace:\s*.*$/i, "")
    .replace(STACK_TRACE_SEGMENT_RE, " ")
    .replace(/\s+\|\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned !== beforeStack || diagnostics.had_multiline) {
    diagnostics.stack_sanitized = true;
  }

  const beforePath = cleaned;
  cleaned = cleaned
    .replace(WINDOWS_ABSOLUTE_PATH_RE, "<path>")
    .replace(BROKEN_WINDOWS_PATH_RE, " <path>")
    .replace(UNIX_ABSOLUTE_PATH_RE, "<path>")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned !== beforePath) {
    diagnostics.path_sanitized = true;
  }

  if (!cleaned) {
    cleaned = fallback;
  }
  if (cleaned.length > maxLength) {
    cleaned = `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
    diagnostics.truncated = true;
  }
  return {
    message: cleaned,
    diagnostics,
  };
}

function normalizeErrorSuggestionByCode(errorCode, suggestion) {
  const code = normalizeErrorCode(errorCode, "E_INTERNAL");
  const text =
    typeof suggestion === "string" && suggestion.trim() ? suggestion.trim() : "";
  if (code === "E_STALE_SNAPSHOT") {
    return OCC_STALE_SNAPSHOT_SUGGESTION;
  }
  return text;
}

function normalizeApprovalMode(value, fallback) {
  if (value === "auto" || value === "require_user") {
    return value;
  }
  return fallback === "auto" ? "auto" : "require_user";
}

function normalizeUnityQueryErrorCode(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function toOptionalBoolean(value) {
  if (typeof value !== "boolean") {
    return null;
  }
  return value;
}

function createUnityQueryId() {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `uq_${stamp}_${rand}`;
}

function normalizeMcpJobStatus(value) {
  const status = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    status === "queued" ||
    status === "pending" ||
    status === "succeeded" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "pending";
}

function normalizeMcpJobSnapshotItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const jobId = typeof item.job_id === "string" ? item.job_id.trim() : "";
  if (!jobId) {
    return null;
  }
  const status = normalizeMcpJobStatus(item.status);
  const now = Date.now();
  const createdAt =
    Number.isFinite(Number(item.created_at)) && Number(item.created_at) > 0
      ? Math.floor(Number(item.created_at))
      : now;
  const updatedAt =
    Number.isFinite(Number(item.updated_at)) && Number(item.updated_at) > 0
      ? Math.floor(Number(item.updated_at))
      : createdAt;
  const terminalAt =
    Number.isFinite(Number(item.terminal_at)) && Number(item.terminal_at) > 0
      ? Math.floor(Number(item.terminal_at))
      : 0;
  return {
    job_id: jobId,
    idempotency_key:
      typeof item.idempotency_key === "string" ? item.idempotency_key.trim() : "",
    approval_mode: normalizeApprovalMode(item.approval_mode, "auto"),
    user_intent: typeof item.user_intent === "string" ? item.user_intent : "",
    thread_id: typeof item.thread_id === "string" ? item.thread_id : "",
    request_id: typeof item.request_id === "string" ? item.request_id : "",
    turn_id: typeof item.turn_id === "string" ? item.turn_id : "",
    context:
      item.context && typeof item.context === "object"
        ? item.context
        : null,
    write_anchor:
      item.write_anchor && typeof item.write_anchor === "object"
        ? {
            object_id: normalizeObjectId(item.write_anchor.object_id),
            path: normalizeNonEmptyString(item.write_anchor.path),
          }
        : null,
    runtime:
      item.runtime && typeof item.runtime === "object" ? item.runtime : null,
    status,
    stage:
      typeof item.stage === "string" && item.stage
        ? item.stage
        : status === "queued"
          ? "queued"
          : status === "failed"
            ? "failed"
            : "",
    progress_message:
      typeof item.progress_message === "string" ? item.progress_message : "",
    error_code: typeof item.error_code === "string" ? item.error_code : "",
    error_message: typeof item.error_message === "string" ? item.error_message : "",
    auto_cancel_reason:
      typeof item.auto_cancel_reason === "string" ? item.auto_cancel_reason : "",
    suggestion: typeof item.suggestion === "string" ? item.suggestion : "",
    recoverable: item.recoverable === true,
    execution_report:
      item.execution_report && typeof item.execution_report === "object"
        ? item.execution_report
        : null,
    created_at: createdAt,
    updated_at: updatedAt,
    terminal_at: terminalAt,
    lease: normalizeLease(item.lease, {
      ownerClientId:
        typeof item.thread_id === "string" ? item.thread_id.trim() : "",
      nowMs: updatedAt,
    }),
  };
}

function sameJson(a, b) {
  if (a === b) {
    return true;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isTerminalMcpStatus(status) {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function normalizeMcpStreamEventType(value, statusHint) {
  const eventName = typeof value === "string" ? value.trim() : "";
  if (eventName === "job.progress" || eventName === "job.completed") {
    return eventName;
  }
  return isTerminalMcpStatus(statusHint) ? "job.completed" : "job.progress";
}

function mapMcpErrorFeedback(errorCode, errorMessage) {
  const code = normalizeErrorCode(errorCode, "E_INTERNAL");
  const message = typeof errorMessage === "string" ? errorMessage : "";
  return getMcpErrorFeedbackTemplate(code, message);
}

function mapTurnStateToMcpStatus(turnState) {
  const state = typeof turnState === "string" ? turnState : "";
  if (state === "completed") {
    return "succeeded";
  }
  if (state === "error") {
    return "failed";
  }
  if (state === "cancelled") {
    return "cancelled";
  }
  return "pending";
}

function createMcpJobId(nowMs) {
  const ts = Number.isFinite(nowMs) && nowMs > 0 ? Number(nowMs) : Date.now();
  const stamp = new Date(ts).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `job_${stamp}_${rand}`;
}

function createMcpRequestId(nowMs) {
  const ts = Number.isFinite(nowMs) && nowMs > 0 ? Number(nowMs) : Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `mcp_req_${ts}_${rand}`;
}

function createMcpTurnId(nowMs) {
  const ts = Number.isFinite(nowMs) && nowMs > 0 ? Number(nowMs) : Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `mcp_turn_${ts}_${rand}`;
}

module.exports = {
  normalizeRequestId,
  normalizeSelectionComponentIndex,
  findComponentIndexEntryByPath,
  findComponentIndexEntryByObjectId,
  findSelectionNodeByPath,
  findSelectionNodeByObjectId,
  pathLeafName,
  isPathSameOrDescendant,
  normalizeCompileErrors,
  normalizeConsoleSnapshotErrors,
  buildConsoleErrorEntries,
  parseTimestampMs,
  createSplitWriteIdempotencyKey,
  normalizeComponentAlias,
  cloneJson,
  createReadTokenValue,
  resolveSnapshotTarget,
  mapTargetResolveReasonToPreconditionReason,
  normalizeNonEmptyString,
  normalizeObjectId,
  parseUnityResourceUri,
  clampInteger,
  buildHierarchySubtreeSnapshot,
  buildHierarchyNodeWithinBudget,
  buildFallbackHierarchyNode,
  pruneHierarchyByCharBudget,
  pruneOneHierarchyBranch,
  collapseHierarchyToRootOnly,
  countHierarchyNodes,
  buildHierarchyTruncatedReason,
  normalizeErrorCode,
  sanitizeMcpErrorMessage,
  normalizeErrorSuggestionByCode,
  normalizeApprovalMode,
  normalizeUnityQueryErrorCode,
  toOptionalBoolean,
  createUnityQueryId,
  normalizeMcpJobSnapshotItem,
  normalizeMcpJobStatus,
  sameJson,
  normalizeMcpStreamEventType,
  mapMcpErrorFeedback,
  mapTurnStateToMcpStatus,
  isTerminalMcpStatus,
  createMcpJobId,
  createMcpRequestId,
  createMcpTurnId,
};


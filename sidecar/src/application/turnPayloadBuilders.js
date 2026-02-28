"use strict";

// Utility functions
function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
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

function normalizeObjectId(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function normalizeErrorCode(value, fallback) {
  if (!value || typeof value !== "string") {
    return fallback;
  }
  const code = value.trim();
  return code || fallback;
}

// Payload builder functions
function buildCompileRequestEnvelope(body, reason) {
  return {
    event: "unity.compile.request",
    request_id: body.request_id,
    thread_id: body.thread_id,
    turn_id: body.turn_id,
    reason: reason || "file_actions_applied",
    refresh_assets: true,
  };
}

function buildCompileFailureSummary(errors) {
  if (!Array.isArray(errors) || errors.length === 0) {
    return "Compile failed";
  }
  const first = errors[0];
  if (!first || typeof first !== "object") {
    return "Compile failed";
  }
  const code = first.code ? String(first.code) : "UNKNOWN";
  const message = first.message ? String(first.message) : "Compile failed";
  return `Compile failed: ${code} ${message}`;
}

function buildActionFailureSummary(payload) {
  const errorCode = normalizeErrorCode(
    payload && payload.error_code,
    "E_ACTION_EXECUTION_FAILED"
  );
  const errorMessage =
    payload && typeof payload.error_message === "string" && payload.error_message
      ? payload.error_message
      : "Visual action failed";
  return `Action failed: ${errorCode} ${errorMessage}`;
}

function normalizeSnapshotComponents(components) {
  if (!Array.isArray(components)) {
    return [];
  }
  const normalized = [];
  for (const item of components) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const shortName =
      typeof item.short_name === "string" && item.short_name.trim()
        ? item.short_name.trim()
        : "";
    if (!shortName) {
      continue;
    }
    const assemblyQualifiedName =
      typeof item.assembly_qualified_name === "string" &&
      item.assembly_qualified_name.trim()
        ? item.assembly_qualified_name.trim()
        : shortName;
    normalized.push({
      short_name: shortName,
      assembly_qualified_name: assemblyQualifiedName,
    });
  }
  return normalized;
}

function buildSelectionSnapshot(context, metadata) {
  if (!context || typeof context !== "object") {
    return null;
  }
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const selection =
    context.selection && typeof context.selection === "object"
      ? context.selection
      : {};
  const selectionTree =
    context.selection_tree && typeof context.selection_tree === "object"
      ? context.selection_tree
      : {};
  const root =
    selectionTree.root && typeof selectionTree.root === "object"
      ? selectionTree.root
      : null;
  const targetObjectPath =
    typeof selection.target_object_path === "string" && selection.target_object_path.trim()
      ? selection.target_object_path.trim()
      : "";
  if (!targetObjectPath) {
    return null;
  }
  const targetObjectId = normalizeObjectId(
    typeof selection.object_id === "string" ? selection.object_id : ""
  );
  const rootComponents = normalizeSnapshotComponents(root ? root.components : []);
  const sceneRevision =
    typeof context.scene_revision === "string" && context.scene_revision.trim()
      ? context.scene_revision.trim()
      : typeof selectionTree.scene_revision === "string" &&
          selectionTree.scene_revision.trim()
        ? selectionTree.scene_revision.trim()
        : `snapshot_${Date.now().toString(36)}`;
  return {
    source:
      typeof meta.source === "string" && meta.source.trim()
        ? meta.source.trim()
        : "turn.send",
    captured_at:
      typeof meta.capturedAt === "string" && meta.capturedAt.trim()
        ? meta.capturedAt
        : new Date().toISOString(),
    scene_revision: sceneRevision,
    thread_id: typeof meta.threadId === "string" ? meta.threadId : "",
    request_id: typeof meta.requestId === "string" ? meta.requestId : "",
    turn_id: typeof meta.turnId === "string" ? meta.turnId : "",
    context: cloneJson(context),
    selection: {
      mode: typeof selection.mode === "string" ? selection.mode : "selection",
      object_id: targetObjectId,
      target_object_path: targetObjectPath,
      name:
        root && typeof root.name === "string" && root.name.trim()
          ? root.name.trim()
          : pathLeafName(targetObjectPath),
      active:
        typeof selection.active === "boolean"
          ? selection.active
          : typeof root.active === "boolean"
            ? root.active
            : null,
      prefab_path:
        typeof selection.prefab_path === "string" ? selection.prefab_path : "",
      components: rootComponents,
    },
  };
}

module.exports = {
  buildCompileRequestEnvelope,
  buildCompileFailureSummary,
  buildActionFailureSummary,
  buildSelectionSnapshot,
  normalizeSnapshotComponents,
};

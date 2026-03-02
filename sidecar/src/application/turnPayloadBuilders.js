"use strict";

/**
 * R10-ARCH-01 Responsibility boundary:
 * - This module only builds/normalizes transport payload objects.
 * - This module must not run schema validation decisions.
 * - This module must not map user-facing error feedback templates.
 */

// Utility functions
function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function tryParseJsonObject(rawJson) {
  if (typeof rawJson !== "string" || !rawJson.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawJson);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stringifyActionData(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" && text.length > 0 ? text : "{}";
  } catch {
    return "{}";
  }
}

function buildLegacyVisualActionData(action) {
  const source = isObject(action) ? action : {};
  const result = {};
  const skipKeys = new Set([
    "type",
    "target",
    "target_anchor",
    "target_anchor_ref",
    "parent_anchor",
    "parent_anchor_ref",
    "action_data",
    "action_data_json",
    "target_object_path",
    "target_path",
    "target_object_id",
    "object_id",
    "parent_path",
    "parent_object_path",
    "parent_object_id",
  ]);
  for (const key of Object.keys(source)) {
    if (skipKeys.has(key)) {
      continue;
    }
    const value = source[key];
    if (value === undefined) {
      continue;
    }
    result[key] = value && typeof value === "object" ? cloneJson(value) : value;
  }
  return result;
}

function resolveVisualActionData(action) {
  const source = isObject(action) ? action : {};
  if (isObject(source.action_data)) {
    return cloneJson(source.action_data);
  }
  const parsed = tryParseJsonObject(source.action_data_json);
  if (parsed) {
    return parsed;
  }
  return buildLegacyVisualActionData(source);
}

function normalizeCompositeStepForUnity(step) {
  const source = isObject(step) ? step : {};
  const normalized = {};
  if (typeof source.step_id === "string") {
    normalized.step_id = source.step_id;
  }
  if (typeof source.type === "string") {
    normalized.type = source.type;
  }
  if (isObject(source.target_anchor)) {
    normalized.target_anchor = cloneJson(source.target_anchor);
  }
  if (typeof source.target_anchor_ref === "string" && source.target_anchor_ref.trim()) {
    normalized.target_anchor_ref = source.target_anchor_ref.trim();
  }
  if (isObject(source.parent_anchor)) {
    normalized.parent_anchor = cloneJson(source.parent_anchor);
  }
  if (typeof source.parent_anchor_ref === "string" && source.parent_anchor_ref.trim()) {
    normalized.parent_anchor_ref = source.parent_anchor_ref.trim();
  }
  if (Array.isArray(source.bind_outputs)) {
    normalized.bind_outputs = cloneJson(source.bind_outputs);
  }
  const stepActionData = isObject(source.action_data)
    ? cloneJson(source.action_data)
    : tryParseJsonObject(source.action_data_json) || {};
  normalized.action_data_json = stringifyActionData(stepActionData);
  return normalized;
}

function normalizeCompositeActionDataForUnity(actionData) {
  const source = isObject(actionData) ? actionData : {};
  const normalized = cloneJson(source);
  const sourceSteps = Array.isArray(source.steps) ? source.steps : [];
  normalized.steps = sourceSteps.map((step) => normalizeCompositeStepForUnity(step));
  return normalized;
}

function buildVisualActionDataBridge(action) {
  const source = isObject(action) ? action : {};
  const actionType = typeof source.type === "string" ? source.type.trim() : "";
  const actionData = resolveVisualActionData(source);
  const normalizedActionData =
    actionType === "composite_visual_action"
      ? normalizeCompositeActionDataForUnity(actionData)
      : actionData;
  return {
    action_data: normalizedActionData,
    action_data_json: stringifyActionData(normalizedActionData),
  };
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
  const source = payload && typeof payload === "object" ? payload : {};
  const errorCode = normalizeErrorCode(
    source.error_code,
    "E_ACTION_RESULT_MISSING_ERROR_CODE"
  );
  const errorMessage =
    typeof source.error_message === "string" && source.error_message.trim()
      ? source.error_message.trim()
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
  buildVisualActionDataBridge,
  normalizeCompositeActionDataForUnity,
  normalizeCompositeStepForUnity,
  buildSelectionSnapshot,
  normalizeSnapshotComponents,
};

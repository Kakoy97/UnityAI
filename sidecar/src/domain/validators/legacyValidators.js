"use strict";

/**
 * R10-ARCH-01 Responsibility boundary:
 * - This module only validates request/response schema and invariants.
 * - This module must not stringify payloads or mutate transport contracts.
 * - This module must not render MCP error feedback text templates.
 */
/**
 * R11-ARCH-01 Responsibility boundary:
 * - This module owns shared schema validation and invariant checks only.
 * - This module must not register MCP tools, wire HTTP routes, or execute side-effects.
 * - Command policy text/templates belong to policy/feedback modules, not validators.
 * - Command-specific read validators may be duplicated in command modules during migration.
 */

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidReadTokenString(value) {
  return isNonEmptyString(value) && value.trim().length >= 24;
}

const FIXED_ERROR_SUGGESTION_BY_CODE = Object.freeze({
  E_STALE_SNAPSHOT: "请先调用读工具获取最新 token。",
});

function enforceFixedErrorSuggestion(errorCode, suggestion) {
  const code = isNonEmptyString(errorCode)
    ? String(errorCode).trim().toUpperCase()
    : "";
  const expected = FIXED_ERROR_SUGGESTION_BY_CODE[code];
  const normalizedSuggestion = isNonEmptyString(suggestion)
    ? String(suggestion).trim()
    : "";
  if (!expected) {
    return {
      suggestion: normalizedSuggestion,
      enforced: false,
    };
  }
  if (normalizedSuggestion !== expected) {
    return {
      suggestion: expected,
      enforced: true,
    };
  }
  return {
    suggestion: expected,
    enforced: false,
  };
}

function isNullOrUndefined(value) {
  return value === null || value === undefined;
}

function isMutationVisualActionType(type) {
  return (
    type === "add_component" ||
    type === "remove_component" ||
    type === "replace_component"
  );
}

const VISUAL_ACTION_LEGACY_ANCHOR_FIELDS = Object.freeze([
  "target_object_path",
  "target_path",
  "target_object_id",
  "object_id",
  "parent_path",
  "parent_object_path",
  "parent_object_id",
]);

function resolveVisualActionField(action, fieldName) {
  if (!isObject(action) || !isNonEmptyString(fieldName)) {
    return undefined;
  }
  if (action[fieldName] !== undefined) {
    return action[fieldName];
  }
  if (isObject(action.action_data) && action.action_data[fieldName] !== undefined) {
    return action.action_data[fieldName];
  }
  return undefined;
}

function validateBasedOnReadTokenField(body, fieldPath) {
  const path =
    typeof fieldPath === "string" && fieldPath.trim()
      ? fieldPath.trim()
      : "based_on_read_token";
  if (!Object.prototype.hasOwnProperty.call(body || {}, "based_on_read_token")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${path} is required`,
      statusCode: 400,
    };
  }

  if (!isValidReadTokenString(body.based_on_read_token)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${path} must be a string with length >= 24`,
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateTopLevelWriteAnchorField(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, "write_anchor")) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: "write_anchor is required",
      statusCode: 400,
    };
  }

  return validateAnchorObject(body.write_anchor, "write_anchor", "E_ACTION_SCHEMA_INVALID");
}

function validateVisualActionHardcut(action, itemPath) {
  if (!isObject(action)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${itemPath} must be an object`,
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(action.type)) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: `${itemPath}.type is required`,
      statusCode: 400,
    };
  }

  const actionType = String(action.type).trim();
  const hasTargetAnchor = !isNullOrUndefined(action.target_anchor);
  const hasParentAnchor = !isNullOrUndefined(action.parent_anchor);

  if (hasTargetAnchor) {
    const targetAnchorValidation = validateAnchorObject(
      action.target_anchor,
      `${itemPath}.target_anchor`,
      "E_ACTION_SCHEMA_INVALID"
    );
    if (!targetAnchorValidation.ok) {
      return targetAnchorValidation;
    }
  }

  if (hasParentAnchor) {
    const parentAnchorValidation = validateAnchorObject(
      action.parent_anchor,
      `${itemPath}.parent_anchor`,
      "E_ACTION_SCHEMA_INVALID"
    );
    if (!parentAnchorValidation.ok) {
      return parentAnchorValidation;
    }
  }

  if (isMutationVisualActionType(actionType) && !hasTargetAnchor) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: `${itemPath}.target_anchor is required`,
      statusCode: 400,
    };
  }

  if (actionType === "create_gameobject" && !hasParentAnchor) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: `${itemPath}.parent_anchor is required`,
      statusCode: 400,
    };
  }

  if (!hasTargetAnchor && !hasParentAnchor) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: `${itemPath}.target_anchor or ${itemPath}.parent_anchor is required`,
      statusCode: 400,
    };
  }

  for (const legacyField of VISUAL_ACTION_LEGACY_ANCHOR_FIELDS) {
    if (!isNullOrUndefined(action[legacyField])) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message: `${itemPath}.${legacyField} is not allowed; use target_anchor/parent_anchor`,
        statusCode: 400,
      };
    }
  }

  if (
    !isNullOrUndefined(action.action_data) &&
    !isObject(action.action_data)
  ) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: `${itemPath}.action_data must be an object when provided`,
      statusCode: 400,
    };
  }

  if (!isNullOrUndefined(action.action_data_json)) {
    return {
      ok: false,
      errorCode: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
      message: `${itemPath}.action_data_json is not allowed in external payload`,
      statusCode: 400,
    };
  }

  return {
    ok: true,
    actionType,
  };
}

function validateAnchorObject(anchor, fieldPath, errorCode) {
  const code =
    typeof errorCode === "string" && errorCode.trim()
      ? errorCode.trim()
      : "E_SCHEMA_INVALID";
  if (!isObject(anchor)) {
    return {
      ok: false,
      errorCode: code,
      message: `${fieldPath} is required`,
      statusCode: 400,
    };
  }
  if (!isNonEmptyString(anchor.object_id)) {
    return {
      ok: false,
      errorCode: code,
      message: `${fieldPath}.object_id is required`,
      statusCode: 400,
    };
  }
  if (!isNonEmptyString(anchor.path)) {
    return {
      ok: false,
      errorCode: code,
      message: `${fieldPath}.path is required`,
      statusCode: 400,
    };
  }
  const allowed = new Set(["object_id", "path"]);
  const keysValidation = validateAllowedKeys(anchor, allowed, fieldPath);
  if (!keysValidation.ok) {
    return {
      ...keysValidation,
      errorCode: code,
    };
  }
  return { ok: true };
}

function hasAnyNonEmptyString(...values) {
  for (const value of values) {
    if (isNonEmptyString(value)) {
      return true;
    }
  }
  return false;
}

function validateAllowedKeys(body, allowedKeys, objectName) {
  const keys = Object.keys(body || {});
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${objectName} has unexpected field: ${key}`,
        statusCode: 400,
      };
    }
  }
  return { ok: true };
}

function isValidIsoTimestamp(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function isNonNegativeInteger(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 && Math.floor(numberValue) === numberValue;
}

function validateComponentDescriptorArray(value, fieldPath, options) {
  const opts = options && typeof options === "object" ? options : {};
  const allowStringItems = opts.allowStringItems === true;

  if (!Array.isArray(value)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must be an array`,
      statusCode: 400,
    };
  }

  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item === "string") {
      if (!allowStringItems) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${fieldPath}[${i}] must be an object`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(item)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${fieldPath}[${i}] must be a non-empty string when string shorthand is used`,
          statusCode: 400,
        };
      }
      continue;
    }
    if (!isObject(item)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}[${i}] must be an object`,
        statusCode: 400,
      };
    }
    if (!isNonEmptyString(item.short_name)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}[${i}].short_name is required`,
        statusCode: 400,
      };
    }
    if (!isNonEmptyString(item.assembly_qualified_name)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}[${i}].assembly_qualified_name is required`,
        statusCode: 400,
      };
    }
  }

  return { ok: true };
}

function validateSelectionTreeNode(node, fieldPath, options) {
  const opts = options && typeof options === "object" ? options : {};
  const allowStringComponents = opts.allowStringComponents === true;
  const requireChildrenTruncatedCount =
    opts.requireChildrenTruncatedCount !== false;

  if (!isObject(node)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must be an object`,
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(node.name)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.name is required`,
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(node.path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.path is required`,
      statusCode: 400,
    };
  }

  if (!isNonNegativeInteger(node.depth)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.depth must be a non-negative integer`,
      statusCode: 400,
    };
  }

  if (
    node.object_id !== undefined &&
    node.object_id !== null &&
    typeof node.object_id !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.object_id must be a string when provided`,
      statusCode: 400,
    };
  }

  if (node.active !== undefined && typeof node.active !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.active must be a boolean when provided`,
      statusCode: 400,
    };
  }

  if (
    node.prefab_path !== undefined &&
    node.prefab_path !== null &&
    typeof node.prefab_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.prefab_path must be a string when provided`,
      statusCode: 400,
    };
  }

  const componentsValidation = validateComponentDescriptorArray(
    node.components,
    `${fieldPath}.components`,
    { allowStringItems: allowStringComponents }
  );
  if (!componentsValidation.ok) {
    return componentsValidation;
  }

  if (!Array.isArray(node.children)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.children must be an array`,
      statusCode: 400,
    };
  }

  if (requireChildrenTruncatedCount && node.children_truncated_count === undefined) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.children_truncated_count is required`,
      statusCode: 400,
    };
  }

  if (
    node.children_truncated_count !== undefined &&
    node.children_truncated_count !== null &&
    !isNonNegativeInteger(node.children_truncated_count)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.children_truncated_count must be a non-negative integer`,
      statusCode: 400,
    };
  }

  for (let i = 0; i < node.children.length; i += 1) {
    const childValidation = validateSelectionTreeNode(
      node.children[i],
      `${fieldPath}.children[${i}]`,
      {
        allowStringComponents,
        requireChildrenTruncatedCount,
      }
    );
    if (!childValidation.ok) {
      return childValidation;
    }
  }

  return { ok: true };
}

function validateTurnContextPayload(context, fieldPath, options) {
  const opts = options && typeof options === "object" ? options : {};
  const requireSceneRevision = opts.requireSceneRevision === true;
  const allowStringComponents = opts.allowStringComponents === true;
  const requireChildrenTruncatedCount =
    opts.requireChildrenTruncatedCount === true;

  if (!isObject(context)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} is required`,
      statusCode: 400,
    };
  }

  if (requireSceneRevision) {
    if (!isNonEmptyString(context.scene_revision)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}.scene_revision is required`,
        statusCode: 400,
      };
    }
  } else if (
    context.scene_revision !== undefined &&
    context.scene_revision !== null &&
    !isNonEmptyString(context.scene_revision)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.scene_revision must be a non-empty string when provided`,
      statusCode: 400,
    };
  }

  if (!isObject(context.selection)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection is required`,
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(context.selection.target_object_path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection.target_object_path is required`,
      statusCode: 400,
    };
  }

  if (
    context.selection.mode !== undefined &&
    context.selection.mode !== null &&
    typeof context.selection.mode !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection.mode must be a string when provided`,
      statusCode: 400,
    };
  }

  if (
    context.selection.object_id !== undefined &&
    context.selection.object_id !== null &&
    typeof context.selection.object_id !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection.object_id must be a string when provided`,
      statusCode: 400,
    };
  }

  if (
    context.selection.prefab_path !== undefined &&
    context.selection.prefab_path !== null &&
    typeof context.selection.prefab_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection.prefab_path must be a string when provided`,
      statusCode: 400,
    };
  }

  if (
    context.selection.active !== undefined &&
    typeof context.selection.active !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection.active must be a boolean when provided`,
      statusCode: 400,
    };
  }

  const selectionTree = context.selection_tree;
  if (!isObject(selectionTree)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection_tree is required`,
      statusCode: 400,
    };
  }

  if (selectionTree.max_depth !== 2) {
    return {
      ok: false,
      errorCode: "E_CONTEXT_DEPTH_VIOLATION",
      message: `${fieldPath}.selection_tree.max_depth must be 2`,
      statusCode: 400,
    };
  }

  if (!isObject(selectionTree.root)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection_tree.root is required`,
      statusCode: 400,
    };
  }

  const rootValidation = validateSelectionTreeNode(
    selectionTree.root,
    `${fieldPath}.selection_tree.root`,
    {
      allowStringComponents,
      requireChildrenTruncatedCount,
    }
  );
  if (!rootValidation.ok) {
    return rootValidation;
  }

  if (
    selectionTree.truncated_node_count !== undefined &&
    selectionTree.truncated_node_count !== null &&
    !isNonNegativeInteger(selectionTree.truncated_node_count)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection_tree.truncated_node_count must be a non-negative integer when provided`,
      statusCode: 400,
    };
  }

  if (
    selectionTree.truncated_reason !== undefined &&
    selectionTree.truncated_reason !== null &&
    typeof selectionTree.truncated_reason !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection_tree.truncated_reason must be a string when provided`,
      statusCode: 400,
    };
  }

  if (context.selection.target_object_path !== selectionTree.root.path) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.selection.target_object_path must match ${fieldPath}.selection_tree.root.path`,
      statusCode: 400,
    };
  }

  return { ok: true };
}

const ALLOWED_FILE_ACTION_TYPES = new Set([
  "create_file",
  "update_file",
  "rename_file",
  "delete_file",
]);
const ALLOWED_VISUAL_ACTION_TYPES = new Set([
  "add_component",
  "remove_component",
  "replace_component",
  "create_gameobject",
]);
const ALLOWED_WRITE_PRECONDITION_TYPES = new Set([
  "object_exists",
  "component_exists",
  "compile_idle",
]);
const ALLOWED_PRIMITIVE_TYPES = new Set([
  "Cube",
  "Sphere",
  "Capsule",
  "Cylinder",
  "Plane",
  "Quad",
]);
const ALLOWED_UI_TYPES = new Set([
  "Canvas",
  "Panel",
  "Button",
  "Image",
  "Text",
  "TMP_Text",
]);
const ALLOWED_CREATE_GAMEOBJECT_TYPES = new Set([
  ...ALLOWED_PRIMITIVE_TYPES,
  ...ALLOWED_UI_TYPES,
]);
const COMPOSITE_VISUAL_ACTION_TYPE = "composite_visual_action";
const COMPOSITE_MAX_STEPS = 8;
const COMPOSITE_MAX_ALIASES = 16;
const COMPOSITE_MAX_STEP_MS = 2000;
const COMPOSITE_MAX_TOTAL_MS = 12000;
const COMPOSITE_STEP_ID_PATTERN = /^[a-z][a-z0-9_]{2,47}$/;
const COMPOSITE_ALIAS_PATTERN = /^[a-z][a-z0-9_]{2,31}$/;
const COMPOSITE_ALLOWED_BIND_OUTPUT_SOURCES = new Set([
  "created_object",
  "target_object",
  "parent_object",
]);

function normalizeAnchorPolicyForValidation(value) {
  const normalized = isNonEmptyString(value)
    ? String(value).trim().toLowerCase()
    : "";
  if (!normalized) {
    return "";
  }
  if (normalized === "target_required") {
    return "target_required";
  }
  if (normalized === "parent_required") {
    return "parent_required";
  }
  if (
    normalized === "target_or_parent" ||
    normalized === "target_or_parent_required"
  ) {
    return "target_or_parent_required";
  }
  return "";
}

function resolveActionAnchorPolicy(actionType, options) {
  const normalizedActionType = isNonEmptyString(actionType)
    ? String(actionType).trim()
    : "";
  if (!normalizedActionType) {
    return "";
  }

  const opts = options && typeof options === "object" ? options : {};
  if (typeof opts.resolveActionAnchorPolicy === "function") {
    return normalizeAnchorPolicyForValidation(
      opts.resolveActionAnchorPolicy(normalizedActionType)
    );
  }

  const policyMap = opts.actionAnchorPolicyByType;
  if (policyMap instanceof Map) {
    return normalizeAnchorPolicyForValidation(policyMap.get(normalizedActionType));
  }

  if (
    isObject(policyMap) &&
    Object.prototype.hasOwnProperty.call(policyMap, normalizedActionType)
  ) {
    return normalizeAnchorPolicyForValidation(policyMap[normalizedActionType]);
  }

  return "";
}

function validateActionAnchorPolicyForKnownType(
  action,
  itemPath,
  actionType,
  options
) {
  const anchorPolicy = resolveActionAnchorPolicy(actionType, options);
  if (!anchorPolicy) {
    return { ok: true };
  }

  const hasTargetAnchor = !isNullOrUndefined(action.target_anchor);
  const hasParentAnchor = !isNullOrUndefined(action.parent_anchor);

  if (anchorPolicy === "target_required" && !hasTargetAnchor) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: `${itemPath}.target_anchor is required by anchor_policy(target_required)`,
      statusCode: 400,
    };
  }

  if (anchorPolicy === "parent_required" && !hasParentAnchor) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: `${itemPath}.parent_anchor is required by anchor_policy(parent_required)`,
      statusCode: 400,
    };
  }

  if (
    anchorPolicy === "target_or_parent_required" &&
    !hasTargetAnchor &&
    !hasParentAnchor
  ) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message:
        `${itemPath}.target_anchor or ${itemPath}.parent_anchor is required by anchor_policy(target_or_parent_required)`,
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateEnvelope(body, expectedEvent) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.event)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "event is required",
      statusCode: 400,
    };
  }

  if (body.event !== expectedEvent) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `event must be '${expectedEvent}'`,
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.request_id)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "request_id is required",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.thread_id)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "thread_id is required",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.turn_id)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "turn_id is required",
      statusCode: 400,
    };
  }

  if (!isValidIsoTimestamp(body.timestamp)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "timestamp must be a valid ISO string",
      statusCode: 400,
    };
  }

  if (!isObject(body.payload)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload is required",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateFileActionsApply(body) {
  const envelope = validateEnvelope(body, "file_actions.apply");
  if (!envelope.ok) {
    return envelope;
  }

  const actions = body.payload.file_actions;
  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.file_actions must be a non-empty array",
      statusCode: 400,
    };
  }

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    if (!isObject(action)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.file_actions[${i}] must be an object`,
        statusCode: 400,
      };
    }

    if (!ALLOWED_FILE_ACTION_TYPES.has(action.type)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `payload.file_actions[${i}].type must be create_file/update_file/rename_file/delete_file`,
        statusCode: 400,
      };
    }

    if (action.type === "create_file" || action.type === "update_file") {
      const keys = Object.keys(action);
      for (const key of keys) {
        if (
          key !== "type" &&
          key !== "path" &&
          key !== "content" &&
          key !== "overwrite_if_exists"
        ) {
          return {
            ok: false,
            errorCode: "E_SCHEMA_INVALID",
            message: `payload.file_actions[${i}] has unexpected field: ${key}`,
            statusCode: 400,
          };
        }
      }
      if (!isNonEmptyString(action.path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.file_actions[${i}].path is required`,
          statusCode: 400,
        };
      }

      if (typeof action.content !== "string") {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.file_actions[${i}].content must be a string`,
          statusCode: 400,
        };
      }

      if (typeof action.overwrite_if_exists !== "boolean") {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.file_actions[${i}].overwrite_if_exists must be a boolean`,
          statusCode: 400,
        };
      }
      continue;
    }

    if (action.type === "rename_file") {
      const keys = Object.keys(action);
      for (const key of keys) {
        if (
          key !== "type" &&
          key !== "old_path" &&
          key !== "new_path" &&
          key !== "overwrite_if_exists"
        ) {
          return {
            ok: false,
            errorCode: "E_SCHEMA_INVALID",
            message: `payload.file_actions[${i}] has unexpected field: ${key}`,
            statusCode: 400,
          };
        }
      }
      if (!isNonEmptyString(action.old_path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.file_actions[${i}].old_path is required`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(action.new_path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.file_actions[${i}].new_path is required`,
          statusCode: 400,
        };
      }
      if (
        action.overwrite_if_exists !== undefined &&
        typeof action.overwrite_if_exists !== "boolean"
      ) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.file_actions[${i}].overwrite_if_exists must be a boolean when provided`,
          statusCode: 400,
        };
      }
      continue;
    }

    const keys = Object.keys(action);
    for (const key of keys) {
      if (key !== "type" && key !== "path") {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.file_actions[${i}] has unexpected field: ${key}`,
          statusCode: 400,
        };
      }
    }
    if (!isNonEmptyString(action.path)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.file_actions[${i}].path is required`,
        statusCode: 400,
      };
    }
  }

  const visualActions = body.payload.visual_layer_actions;
  if (visualActions !== undefined) {
    const visualValidation = validateVisualLayerActionsArray(visualActions);
    if (!visualValidation.ok) {
      return visualValidation;
    }
  }

  return { ok: true };
}

function validateUnityCompileResult(body) {
  const envelope = validateEnvelope(body, "unity.compile.result");
  if (!envelope.ok) {
    return envelope;
  }

  if (typeof body.payload.success !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.success must be a boolean",
      statusCode: 400,
    };
  }

  if (
    body.payload.duration_ms !== undefined &&
    (!Number.isFinite(Number(body.payload.duration_ms)) ||
      Number(body.payload.duration_ms) < 0)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.duration_ms must be a non-negative number",
      statusCode: 400,
    };
  }

  if (body.payload.errors !== undefined && !Array.isArray(body.payload.errors)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.errors must be an array when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateUnityActionResult(body) {
  const envelope = validateEnvelope(body, "unity.action.result");
  if (!envelope.ok) {
    return envelope;
  }

  if (!isNonEmptyString(body.payload.action_type)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.action_type is required",
      statusCode: 400,
    };
  }

  const actionType = String(body.payload.action_type).trim();
  const isLegacyActionType = ALLOWED_VISUAL_ACTION_TYPES.has(actionType);
  body.payload.action_type = actionType;

  if (
    body.payload.target !== undefined &&
    typeof body.payload.target !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.target must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    isLegacyActionType &&
    (actionType === "add_component" || actionType === "replace_component") &&
    !isNonEmptyString(body.payload.component_assembly_qualified_name)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.component_assembly_qualified_name is required",
      statusCode: 400,
    };
  }

  if (typeof body.payload.success !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.success must be a boolean",
      statusCode: 400,
    };
  }

  if (typeof body.payload.error_message !== "string") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.error_message must be a string",
      statusCode: 400,
    };
  }

  if (
    body.payload.error_code !== undefined &&
    typeof body.payload.error_code !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.error_code must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.payload.result_data !== undefined &&
    !isObject(body.payload.result_data)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.result_data must be an object when provided",
      statusCode: 400,
    };
  }

  if (isLegacyActionType && actionType === "remove_component") {
    const hasComponentName = isNonEmptyString(body.payload.component_name);
    const hasComponentAssembly = isNonEmptyString(
      body.payload.component_assembly_qualified_name
    );
    if (!hasComponentName && !hasComponentAssembly) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          "payload.component_name or payload.component_assembly_qualified_name is required",
        statusCode: 400,
      };
    }
  }

  if (
    body.payload.component_name !== undefined &&
    typeof body.payload.component_name !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.component_name must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    isLegacyActionType &&
    actionType === "replace_component" &&
    !isNonEmptyString(body.payload.source_component_assembly_qualified_name)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.source_component_assembly_qualified_name is required",
      statusCode: 400,
    };
  }

  if (
    body.payload.source_component_assembly_qualified_name !== undefined &&
    typeof body.payload.source_component_assembly_qualified_name !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        "payload.source_component_assembly_qualified_name must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.payload.target_object_path !== undefined &&
    typeof body.payload.target_object_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.target_object_path must be a string when provided",
      statusCode: 400,
    };
  }
  if (
    body.payload.target_object_id !== undefined &&
    typeof body.payload.target_object_id !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.target_object_id must be a string when provided",
      statusCode: 400,
    };
  }
  if (
    body.payload.object_id !== undefined &&
    typeof body.payload.object_id !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.object_id must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.payload.created_object_path !== undefined &&
    typeof body.payload.created_object_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.created_object_path must be a string when provided",
      statusCode: 400,
    };
  }
  if (
    body.payload.created_object_id !== undefined &&
    typeof body.payload.created_object_id !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.created_object_id must be a string when provided",
      statusCode: 400,
    };
  }

  if (body.payload.name !== undefined && typeof body.payload.name !== "string") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.name must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    isLegacyActionType &&
    actionType === "create_gameobject" &&
    !isNonEmptyString(body.payload.name)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.name is required for create_gameobject",
      statusCode: 400,
    };
  }

  if (
    body.payload.parent_object_path !== undefined &&
    typeof body.payload.parent_object_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.parent_object_path must be a string when provided",
      statusCode: 400,
    };
  }
  if (
    body.payload.parent_object_id !== undefined &&
    typeof body.payload.parent_object_id !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.parent_object_id must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.payload.parent_path !== undefined &&
    typeof body.payload.parent_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.parent_path must be a string when provided",
      statusCode: 400,
    };
  }

  const hasTargetRef =
    isNonEmptyString(body.payload.target) ||
    isNonEmptyString(body.payload.target_object_path) ||
    isNonEmptyString(body.payload.target_object_id) ||
    isNonEmptyString(body.payload.object_id);
  const hasParentRef =
    isNonEmptyString(body.payload.parent_path) ||
    isNonEmptyString(body.payload.parent_object_path) ||
    isNonEmptyString(body.payload.parent_object_id);
  if (isLegacyActionType) {
    if (actionType === "create_gameobject") {
      if (!hasParentRef) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message:
            "payload.parent_path/parent_object_path or payload.parent_object_id is required for create_gameobject",
          statusCode: 400,
        };
      }
      if (
        !isNonEmptyString(
          body.payload.parent_path ||
            body.payload.parent_object_path ||
            body.payload.parent_object_id ||
            body.payload.target_object_id ||
            body.payload.object_id
        )
      ) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message:
            "payload.parent_path/parent_object_path or parent_object_id/target_object_id is required for create_gameobject",
          statusCode: 400,
        };
      }
    } else if (!hasTargetRef) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          "payload.target/target_object_path or payload.target_object_id/object_id is required",
        statusCode: 400,
      };
    }
  }

  if (
    isLegacyActionType &&
    body.payload.object_type !== undefined &&
    (typeof body.payload.object_type !== "string" ||
      (body.payload.object_type.trim().length > 0 &&
        !ALLOWED_CREATE_GAMEOBJECT_TYPES.has(body.payload.object_type)))
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        `payload.object_type must be one of ${Array.from(ALLOWED_CREATE_GAMEOBJECT_TYPES).join("/")}`,
      statusCode: 400,
    };
  }

  if (
    isLegacyActionType &&
    actionType === "create_gameobject" &&
    !isNonEmptyString(
      body.payload.object_type ||
        body.payload.primitive_type ||
        body.payload.ui_type
    )
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.object_type is required for create_gameobject",
      statusCode: 400,
    };
  }

  if (
    isLegacyActionType &&
    body.payload.primitive_type !== undefined &&
    (typeof body.payload.primitive_type !== "string" ||
      (body.payload.primitive_type.trim().length > 0 &&
        !ALLOWED_PRIMITIVE_TYPES.has(body.payload.primitive_type)))
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        `payload.primitive_type must be one of ${Array.from(ALLOWED_PRIMITIVE_TYPES).join("/")}`,
      statusCode: 400,
    };
  }

  if (
    isLegacyActionType &&
    body.payload.ui_type !== undefined &&
    (typeof body.payload.ui_type !== "string" ||
      (body.payload.ui_type.trim().length > 0 &&
        !ALLOWED_UI_TYPES.has(body.payload.ui_type)))
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `payload.ui_type must be one of ${Array.from(ALLOWED_UI_TYPES).join("/")}`,
      statusCode: 400,
    };
  }

  if (
    isLegacyActionType &&
    isNonEmptyString(body.payload.primitive_type) &&
    isNonEmptyString(body.payload.ui_type)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload cannot set both primitive_type and ui_type",
      statusCode: 400,
    };
  }

  if (
    body.payload.duration_ms !== undefined &&
    (!Number.isFinite(Number(body.payload.duration_ms)) ||
      Number(body.payload.duration_ms) < 0)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.duration_ms must be a non-negative number",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateUnityRuntimePing(body) {
  const envelope = validateEnvelope(body, "unity.runtime.ping");
  if (!envelope.ok) {
    return envelope;
  }

  if (!isNonEmptyString(body.payload.status)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.status is required",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateUnityCapabilitiesReport(body) {
  const envelope = validateEnvelope(body, "unity.capabilities.report");
  if (!envelope.ok) {
    return envelope;
  }
  const payload = body.payload;
  if (!isNonEmptyString(payload.capability_version)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.capability_version is required",
      statusCode: 400,
    };
  }
  if (!Array.isArray(payload.actions)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.actions must be an array",
      statusCode: 400,
    };
  }
  for (let i = 0; i < payload.actions.length; i += 1) {
    const item = payload.actions[i];
    const itemPath = `payload.actions[${i}]`;
    if (!isObject(item)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath} must be an object`,
        statusCode: 400,
      };
    }
    if (!isNonEmptyString(item.type)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.type is required`,
        statusCode: 400,
      };
    }
    const keysValidation = validateAllowedKeys(
      item,
      new Set([
        "type",
        "description",
        "anchor_policy",
        "action_data_schema",
        "domain",
        "tier",
        "lifecycle",
        "undo_safety",
        "replacement_action_type",
      ]),
      itemPath
    );
    if (!keysValidation.ok) {
      return keysValidation;
    }
    if (
      item.description !== undefined &&
      typeof item.description !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.description must be a string when provided`,
        statusCode: 400,
      };
    }
    if (
      item.anchor_policy !== undefined &&
      typeof item.anchor_policy !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.anchor_policy must be a string when provided`,
        statusCode: 400,
      };
    }
    if (
      item.action_data_schema !== undefined &&
      !isObject(item.action_data_schema)
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.action_data_schema must be an object when provided`,
        statusCode: 400,
      };
    }
    if (item.domain !== undefined && typeof item.domain !== "string") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.domain must be a string when provided`,
        statusCode: 400,
      };
    }
    if (item.tier !== undefined && typeof item.tier !== "string") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.tier must be a string when provided`,
        statusCode: 400,
      };
    }
    if (item.lifecycle !== undefined && typeof item.lifecycle !== "string") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.lifecycle must be a string when provided`,
        statusCode: 400,
      };
    }
    if (item.undo_safety !== undefined && typeof item.undo_safety !== "string") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.undo_safety must be a string when provided`,
        statusCode: 400,
      };
    }
    if (
      item.replacement_action_type !== undefined &&
      typeof item.replacement_action_type !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath}.replacement_action_type must be a string when provided`,
        statusCode: 400,
      };
    }
  }
  return { ok: true };
}

function validateUnitySelectionSnapshot(body) {
  const envelope = validateEnvelope(body, "unity.selection.snapshot");
  if (!envelope.ok) {
    return envelope;
  }

  const payload = body.payload || {};
  if (
    payload.reason !== undefined &&
    payload.reason !== null &&
    !isNonEmptyString(payload.reason)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.reason must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  const selectionEmpty = payload.selection_empty === true;
  if (
    payload.selection_empty !== undefined &&
    typeof payload.selection_empty !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.selection_empty must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (payload.component_index !== undefined && payload.component_index !== null) {
    if (!Array.isArray(payload.component_index)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "payload.component_index must be an array when provided",
        statusCode: 400,
      };
    }
    for (let i = 0; i < payload.component_index.length; i += 1) {
      const item = payload.component_index[i];
      if (!isObject(item)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.component_index[${i}] must be an object`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(item.path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.component_index[${i}].path is required`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(item.name)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.component_index[${i}].name is required`,
          statusCode: 400,
        };
      }

      if (!isNonNegativeInteger(item.depth)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.component_index[${i}].depth must be a non-negative integer`,
          statusCode: 400,
        };
      }

      if (
        item.object_id !== undefined &&
        item.object_id !== null &&
        typeof item.object_id !== "string"
      ) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.component_index[${i}].object_id must be a string when provided`,
          statusCode: 400,
        };
      }

      if (
        item.prefab_path !== undefined &&
        item.prefab_path !== null &&
        typeof item.prefab_path !== "string"
      ) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.component_index[${i}].prefab_path must be a string when provided`,
          statusCode: 400,
        };
      }

      const descriptorValidation = validateComponentDescriptorArray(
        item.components,
        `payload.component_index[${i}].components`
      );
      if (!descriptorValidation.ok) {
        return descriptorValidation;
      }

      const itemKeys = Object.keys(item);
      for (const key of itemKeys) {
        if (
          key !== "object_id" &&
          key !== "path" &&
          key !== "name" &&
          key !== "depth" &&
          key !== "prefab_path" &&
          key !== "components"
        ) {
          return {
            ok: false,
            errorCode: "E_SCHEMA_INVALID",
            message: `payload.component_index[${i}] has unexpected field: ${key}`,
            statusCode: 400,
          };
        }
      }
    }
  }

  if (selectionEmpty) {
    return { ok: true };
  }

  if (!isObject(payload.context)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context is required when payload.selection_empty is false",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(payload.context.scene_revision)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.scene_revision is required",
      statusCode: 400,
    };
  }

  if (!isObject(payload.context.selection)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection is required",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(payload.context.selection.target_object_path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection.target_object_path is required",
      statusCode: 400,
    };
  }

  if (
    payload.context.selection.mode !== undefined &&
    payload.context.selection.mode !== null &&
    typeof payload.context.selection.mode !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection.mode must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    payload.context.selection.object_id !== undefined &&
    payload.context.selection.object_id !== null &&
    typeof payload.context.selection.object_id !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection.object_id must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    payload.context.selection.prefab_path !== undefined &&
    payload.context.selection.prefab_path !== null &&
    typeof payload.context.selection.prefab_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection.prefab_path must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    payload.context.selection.active !== undefined &&
    typeof payload.context.selection.active !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection.active must be a boolean when provided",
      statusCode: 400,
    };
  }

  const selectionTree = payload.context.selection_tree;
  if (!isObject(selectionTree)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection_tree is required",
      statusCode: 400,
    };
  }

  if (selectionTree.max_depth !== 2) {
    return {
      ok: false,
      errorCode: "E_CONTEXT_DEPTH_VIOLATION",
      message: "payload.context.selection_tree.max_depth must be 2",
      statusCode: 400,
    };
  }

  if (!isObject(selectionTree.root)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection_tree.root is required",
      statusCode: 400,
    };
  }

  const rootValidation = validateSelectionTreeNode(
    selectionTree.root,
    "payload.context.selection_tree.root"
  );
  if (!rootValidation.ok) {
    return rootValidation;
  }

  if (
    selectionTree.truncated_node_count !== undefined &&
    !isNonNegativeInteger(selectionTree.truncated_node_count)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        "payload.context.selection_tree.truncated_node_count must be a non-negative integer when provided",
      statusCode: 400,
    };
  }

  if (
    selectionTree.truncated_reason !== undefined &&
    selectionTree.truncated_reason !== null &&
    typeof selectionTree.truncated_reason !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context.selection_tree.truncated_reason must be a string when provided",
      statusCode: 400,
    };
  }

  if (payload.context.selection.target_object_path !== selectionTree.root.path) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        "payload.context.selection.target_object_path must match payload.context.selection_tree.root.path",
      statusCode: 400,
    };
  }

  const contextKeys = Object.keys(payload.context);
  for (const key of contextKeys) {
    if (key !== "scene_revision" && key !== "selection" && key !== "selection_tree") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.context has unexpected field: ${key}`,
        statusCode: 400,
      };
    }
  }

  const selectionKeys = Object.keys(payload.context.selection);
  for (const key of selectionKeys) {
    if (
      key !== "mode" &&
      key !== "object_id" &&
      key !== "target_object_path" &&
      key !== "active" &&
      key !== "prefab_path"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.context.selection has unexpected field: ${key}`,
        statusCode: 400,
      };
    }
  }

  const selectionTreeKeys = Object.keys(selectionTree);
  for (const key of selectionTreeKeys) {
    if (
      key !== "max_depth" &&
      key !== "root" &&
      key !== "truncated_node_count" &&
      key !== "truncated_reason"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.context.selection_tree has unexpected field: ${key}`,
        statusCode: 400,
      };
    }
  }

  return { ok: true };
}

function validateUnityConsoleSnapshot(body) {
  const envelope = validateEnvelope(body, "unity.console.snapshot");
  if (!envelope.ok) {
    return envelope;
  }

  const payload = body.payload || {};
  if (
    payload.reason !== undefined &&
    payload.reason !== null &&
    !isNonEmptyString(payload.reason)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.reason must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  if (!Array.isArray(payload.errors)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.errors must be an array",
      statusCode: 400,
    };
  }

  for (let i = 0; i < payload.errors.length; i += 1) {
    const item = payload.errors[i];
    if (!isObject(item)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.errors[${i}] must be an object`,
        statusCode: 400,
      };
    }

    if (item.timestamp !== undefined && item.timestamp !== null) {
      if (!isNonEmptyString(item.timestamp) || !isValidIsoTimestamp(item.timestamp)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.errors[${i}].timestamp must be a valid ISO string when provided`,
          statusCode: 400,
        };
      }
    }

    if (
      item.log_type !== undefined &&
      item.log_type !== null &&
      typeof item.log_type !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.errors[${i}].log_type must be a string when provided`,
        statusCode: 400,
      };
    }

    if (
      item.condition !== undefined &&
      item.condition !== null &&
      typeof item.condition !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.errors[${i}].condition must be a string when provided`,
        statusCode: 400,
      };
    }

    if (
      item.stack_trace !== undefined &&
      item.stack_trace !== null &&
      typeof item.stack_trace !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.errors[${i}].stack_trace must be a string when provided`,
        statusCode: 400,
      };
    }

    if (
      item.file !== undefined &&
      item.file !== null &&
      typeof item.file !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.errors[${i}].file must be a string when provided`,
        statusCode: 400,
      };
    }

    if (
      item.line !== undefined &&
      item.line !== null &&
      (!Number.isFinite(Number(item.line)) || Number(item.line) < 0)
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.errors[${i}].line must be a non-negative number when provided`,
        statusCode: 400,
      };
    }

    if (
      item.error_code !== undefined &&
      item.error_code !== null &&
      typeof item.error_code !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.errors[${i}].error_code must be a string when provided`,
        statusCode: 400,
      };
    }
  }

  return { ok: true };
}

function validateFileActionsArray(actions, fieldPath) {
  const list = Array.isArray(actions) ? actions : [];
  const basePath =
    typeof fieldPath === "string" && fieldPath.trim()
      ? fieldPath.trim()
      : "actions";
  for (let i = 0; i < list.length; i += 1) {
    const action = list[i];
    if (!isObject(action)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${basePath}[${i}] must be an object`,
        statusCode: 400,
      };
    }
    if (!ALLOWED_FILE_ACTION_TYPES.has(action.type)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `${basePath}[${i}].type must be create_file/update_file/rename_file/delete_file`,
        statusCode: 400,
      };
    }

    if (action.type === "create_file" || action.type === "update_file") {
      const keys = Object.keys(action);
      for (const key of keys) {
        if (
          key !== "type" &&
          key !== "path" &&
          key !== "content" &&
          key !== "overwrite_if_exists"
        ) {
          return {
            ok: false,
            errorCode: "E_SCHEMA_INVALID",
            message: `${basePath}[${i}] has unexpected field: ${key}`,
            statusCode: 400,
          };
        }
      }
      if (!isNonEmptyString(action.path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${basePath}[${i}].path is required`,
          statusCode: 400,
        };
      }
      if (typeof action.content !== "string") {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${basePath}[${i}].content must be a string`,
          statusCode: 400,
        };
      }
      if (typeof action.overwrite_if_exists !== "boolean") {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${basePath}[${i}].overwrite_if_exists must be a boolean`,
          statusCode: 400,
        };
      }
      continue;
    }

    if (action.type === "rename_file") {
      const keys = Object.keys(action);
      for (const key of keys) {
        if (
          key !== "type" &&
          key !== "old_path" &&
          key !== "new_path" &&
          key !== "overwrite_if_exists"
        ) {
          return {
            ok: false,
            errorCode: "E_SCHEMA_INVALID",
            message: `${basePath}[${i}] has unexpected field: ${key}`,
            statusCode: 400,
          };
        }
      }
      if (!isNonEmptyString(action.old_path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${basePath}[${i}].old_path is required`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(action.new_path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${basePath}[${i}].new_path is required`,
          statusCode: 400,
        };
      }
      if (
        action.overwrite_if_exists !== undefined &&
        typeof action.overwrite_if_exists !== "boolean"
      ) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${basePath}[${i}].overwrite_if_exists must be a boolean when provided`,
          statusCode: 400,
        };
      }
      continue;
    }

    const keys = Object.keys(action);
    for (const key of keys) {
      if (key !== "type" && key !== "path") {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${basePath}[${i}] has unexpected field: ${key}`,
          statusCode: 400,
        };
      }
    }
    if (!isNonEmptyString(action.path)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${basePath}[${i}].path is required`,
        statusCode: 400,
      };
    }
  }

  return { ok: true };
}

function validateMcpSubmitUnityTask(body, options) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set([
    "thread_id",
    "idempotency_key",
    "approval_mode",
    "user_intent",
    "based_on_read_token",
    "context",
    "write_anchor",
    "file_actions",
    "visual_layer_actions",
  ]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.thread_id)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "thread_id is required",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.idempotency_key)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "idempotency_key is required",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.user_intent)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "user_intent is required",
      statusCode: 400,
    };
  }

  if (
    body.approval_mode !== undefined &&
    body.approval_mode !== "auto" &&
    body.approval_mode !== "require_user"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "approval_mode must be auto/require_user when provided",
      statusCode: 400,
    };
  }

  const tokenValidation = validateBasedOnReadTokenField(body, "based_on_read_token");
  if (!tokenValidation.ok) {
    return tokenValidation;
  }

  const writeAnchorValidation = validateTopLevelWriteAnchorField(body);
  if (!writeAnchorValidation.ok) {
    return writeAnchorValidation;
  }

  if (body.context !== undefined) {
    const contextValidation = validateTurnContextPayload(body.context, "context", {
      requireSceneRevision: false,
      allowStringComponents: true,
      requireChildrenTruncatedCount: false,
    });
    if (!contextValidation.ok) {
      return contextValidation;
    }
  }

  const hasFileActions =
    Array.isArray(body.file_actions) && body.file_actions.length > 0;
  const hasVisualActions =
    Array.isArray(body.visual_layer_actions) &&
    body.visual_layer_actions.length > 0;

  if (!hasFileActions && !hasVisualActions) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        "At least one of file_actions or visual_layer_actions must be a non-empty array",
      statusCode: 400,
    };
  }

  if (body.file_actions !== undefined) {
    if (!Array.isArray(body.file_actions)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "file_actions must be an array when provided",
        statusCode: 400,
      };
    }
    const fileActionsValidation = validateFileActionsArray(
      body.file_actions,
      "file_actions"
    );
    if (!fileActionsValidation.ok) {
      return fileActionsValidation;
    }
  }

  if (body.visual_layer_actions !== undefined) {
    if (!Array.isArray(body.visual_layer_actions)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "visual_layer_actions must be an array when provided",
        statusCode: 400,
      };
    }
    const visualValidation = validateVisualLayerActionsArray(
      body.visual_layer_actions,
      "visual_layer_actions",
      options
    );
    if (!visualValidation.ok) {
      return visualValidation;
    }
  }

  return { ok: true };
}

function validateMcpApplyScriptActions(body) {
  const base = validateMcpSplitWriteBase(body, "actions");
  if (!base.ok) {
    return base;
  }

  return validateFileActionsArray(body.actions, "actions");
}

function validateMcpApplyVisualActions(body, options) {
  const base = validateMcpSplitWriteBase(body, "actions");
  if (!base.ok) {
    return base;
  }

  const visualValidation = validateVisualLayerActionsArray(
    body.actions,
    "actions",
    options
  );
  if (!visualValidation.ok) {
    return visualValidation;
  }

  return { ok: true };
}

function validateMcpSetUiProperties(body) {
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    !isNullOrUndefined(body.action_data_json)
  ) {
    return {
      ok: false,
      errorCode: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
      message: "action_data_json is not allowed in external payload",
      statusCode: 400,
    };
  }

  const base = validateMcpSplitWriteBase(body, "operations", {
    extraAllowedKeys: ["atomic"],
  });
  if (!base.ok) {
    return base;
  }

  if (body.atomic !== undefined && typeof body.atomic !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "atomic must be a boolean when provided",
      statusCode: 400,
    };
  }

  return validateSetUiPropertyOperations(body.operations);
}

function validateMcpSplitWriteBase(body, actionsKey, options) {
  const opts = options && typeof options === "object" ? options : {};
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const key = typeof actionsKey === "string" && actionsKey ? actionsKey : "actions";
  const allowed = new Set([
    "based_on_read_token",
    "write_anchor",
    key,
    "preconditions",
    "dry_run",
    "thread_id",
    "idempotency_key",
    "user_intent",
    "approval_mode",
    "context",
  ]);
  const extraAllowedKeys = Array.isArray(opts.extraAllowedKeys)
    ? opts.extraAllowedKeys
    : [];
  for (const keyName of extraAllowedKeys) {
    if (isNonEmptyString(keyName)) {
      allowed.add(String(keyName).trim());
    }
  }
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  const tokenValidation = validateBasedOnReadTokenField(body, "based_on_read_token");
  if (!tokenValidation.ok) {
    return tokenValidation;
  }

  if (
    body.thread_id !== undefined &&
    body.thread_id !== null &&
    !isNonEmptyString(body.thread_id)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "thread_id must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  if (
    body.idempotency_key !== undefined &&
    body.idempotency_key !== null &&
    !isNonEmptyString(body.idempotency_key)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "idempotency_key must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  if (
    body.user_intent !== undefined &&
    body.user_intent !== null &&
    !isNonEmptyString(body.user_intent)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "user_intent must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  if (
    body.approval_mode !== undefined &&
    body.approval_mode !== "auto" &&
    body.approval_mode !== "require_user"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "approval_mode must be auto/require_user when provided",
      statusCode: 400,
    };
  }

  if (body.dry_run !== undefined && typeof body.dry_run !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "dry_run must be a boolean when provided",
      statusCode: 400,
    };
  }

  const writeAnchorValidation = validateTopLevelWriteAnchorField(body);
  if (!writeAnchorValidation.ok) {
    return writeAnchorValidation;
  }

  if (body.context !== undefined) {
    const contextValidation = validateTurnContextPayload(body.context, "context", {
      requireSceneRevision: false,
      allowStringComponents: true,
      requireChildrenTruncatedCount: false,
    });
    if (!contextValidation.ok) {
      return contextValidation;
    }
  }

  const preconditionValidation = validateWritePreconditions(body.preconditions);
  if (!preconditionValidation.ok) {
    return preconditionValidation;
  }

  const actions = body[key];
  if (!Array.isArray(actions) || actions.length === 0) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${key} must be a non-empty array`,
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateSetUiPropertyOperations(operations) {
  if (!Array.isArray(operations) || operations.length === 0) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "operations must be a non-empty array",
      statusCode: 400,
    };
  }

  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index];
    const opPath = `operations[${index}]`;
    if (!isObject(operation)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${opPath} must be an object`,
        statusCode: 400,
      };
    }

    const operationKeysValidation = validateAllowedKeys(
      operation,
      new Set([
        "target_anchor",
        "rect_transform",
        "image",
        "text",
        "layout_element",
        "action_data_json",
      ]),
      opPath
    );
    if (!operationKeysValidation.ok) {
      return operationKeysValidation;
    }

    const anchorValidation = validateAnchorObject(
      operation.target_anchor,
      `${opPath}.target_anchor`,
      "E_ACTION_SCHEMA_INVALID"
    );
    if (!anchorValidation.ok) {
      return anchorValidation;
    }

    if (!isNullOrUndefined(operation.action_data_json)) {
      return {
        ok: false,
        errorCode: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
        message: `${opPath}.action_data_json is not allowed in external payload`,
        statusCode: 400,
      };
    }

    let mappedFieldCount = 0;

    if (!isNullOrUndefined(operation.rect_transform)) {
      const rectValidation = validateSetUiRectTransformPayload(
        operation.rect_transform,
        `${opPath}.rect_transform`
      );
      if (!rectValidation.ok) {
        return rectValidation;
      }
      mappedFieldCount += rectValidation.mappedFieldCount;
    }

    if (!isNullOrUndefined(operation.image)) {
      const imageValidation = validateSetUiImagePayload(
        operation.image,
        `${opPath}.image`
      );
      if (!imageValidation.ok) {
        return imageValidation;
      }
      mappedFieldCount += imageValidation.mappedFieldCount;
    }

    if (!isNullOrUndefined(operation.text)) {
      const textValidation = validateSetUiTextPayload(
        operation.text,
        `${opPath}.text`
      );
      if (!textValidation.ok) {
        return textValidation;
      }
      mappedFieldCount += textValidation.mappedFieldCount;
    }

    if (!isNullOrUndefined(operation.layout_element)) {
      const layoutValidation = validateSetUiLayoutElementPayload(
        operation.layout_element,
        `${opPath}.layout_element`
      );
      if (!layoutValidation.ok) {
        return layoutValidation;
      }
      mappedFieldCount += layoutValidation.mappedFieldCount;
    }

    if (mappedFieldCount <= 0) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${opPath} must provide at least one writable property`,
        statusCode: 400,
      };
    }
  }

  return { ok: true };
}

function validateSetUiRectTransformPayload(value, fieldPath) {
  const shapeValidation = validateSetUiObjectShape(
    value,
    fieldPath,
    new Set(["anchored_position", "size_delta", "pivot", "anchors"])
  );
  if (!shapeValidation.ok) {
    return shapeValidation;
  }

  const source = value && typeof value === "object" ? value : {};
  let mappedFieldCount = 0;

  if (!isNullOrUndefined(source.anchored_position)) {
    const anchoredValidation = validateSetUiVector2Object(
      source.anchored_position,
      `${fieldPath}.anchored_position`
    );
    if (!anchoredValidation.ok) {
      return anchoredValidation;
    }
    mappedFieldCount += 1;
  }

  if (!isNullOrUndefined(source.size_delta)) {
    const sizeDeltaValidation = validateSetUiVector2Object(
      source.size_delta,
      `${fieldPath}.size_delta`
    );
    if (!sizeDeltaValidation.ok) {
      return sizeDeltaValidation;
    }
    mappedFieldCount += 1;
  }

  if (!isNullOrUndefined(source.pivot)) {
    const pivotValidation = validateSetUiVector2Object(
      source.pivot,
      `${fieldPath}.pivot`
    );
    if (!pivotValidation.ok) {
      return pivotValidation;
    }
    mappedFieldCount += 1;
  }

  if (!isNullOrUndefined(source.anchors)) {
    const anchorsValidation = validateSetUiAnchorsObject(
      source.anchors,
      `${fieldPath}.anchors`
    );
    if (!anchorsValidation.ok) {
      return anchorsValidation;
    }
    mappedFieldCount += 1;
  }

  if (mappedFieldCount <= 0) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must provide at least one writable field`,
      statusCode: 400,
    };
  }

  return {
    ok: true,
    mappedFieldCount,
  };
}

function validateSetUiImagePayload(value, fieldPath) {
  const shapeValidation = validateSetUiObjectShape(
    value,
    fieldPath,
    new Set(["color", "raycast_target"])
  );
  if (!shapeValidation.ok) {
    return shapeValidation;
  }

  const source = value && typeof value === "object" ? value : {};
  let mappedFieldCount = 0;

  if (!isNullOrUndefined(source.color)) {
    const colorValidation = validateSetUiColorObject(
      source.color,
      `${fieldPath}.color`
    );
    if (!colorValidation.ok) {
      return colorValidation;
    }
    mappedFieldCount += 1;
  }

  if (!isNullOrUndefined(source.raycast_target)) {
    if (typeof source.raycast_target !== "boolean") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}.raycast_target must be a boolean when provided`,
        statusCode: 400,
      };
    }
    mappedFieldCount += 1;
  }

  if (mappedFieldCount <= 0) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must provide at least one writable field`,
      statusCode: 400,
    };
  }

  return {
    ok: true,
    mappedFieldCount,
  };
}

function validateSetUiTextPayload(value, fieldPath) {
  const shapeValidation = validateSetUiObjectShape(
    value,
    fieldPath,
    new Set(["content", "color", "font_size"])
  );
  if (!shapeValidation.ok) {
    return shapeValidation;
  }

  const source = value && typeof value === "object" ? value : {};
  let mappedFieldCount = 0;

  if (!isNullOrUndefined(source.content)) {
    if (typeof source.content !== "string") {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}.content must be a string when provided`,
        statusCode: 400,
      };
    }
    mappedFieldCount += 1;
  }

  if (!isNullOrUndefined(source.color)) {
    const colorValidation = validateSetUiColorObject(
      source.color,
      `${fieldPath}.color`
    );
    if (!colorValidation.ok) {
      return colorValidation;
    }
    mappedFieldCount += 1;
  }

  if (!isNullOrUndefined(source.font_size)) {
    const fontSize = Number(source.font_size);
    if (!Number.isFinite(fontSize) || fontSize <= 0) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}.font_size must be a finite number > 0 when provided`,
        statusCode: 400,
      };
    }
    mappedFieldCount += 1;
  }

  if (mappedFieldCount <= 0) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must provide at least one writable field`,
      statusCode: 400,
    };
  }

  return {
    ok: true,
    mappedFieldCount,
  };
}

function validateSetUiLayoutElementPayload(value, fieldPath) {
  const shapeValidation = validateSetUiObjectShape(
    value,
    fieldPath,
    new Set([
      "min_width",
      "min_height",
      "preferred_width",
      "preferred_height",
      "flexible_width",
      "flexible_height",
      "ignore_layout",
    ])
  );
  if (!shapeValidation.ok) {
    return shapeValidation;
  }

  const source = value && typeof value === "object" ? value : {};
  const requiredKeys = [
    "min_width",
    "min_height",
    "preferred_width",
    "preferred_height",
    "flexible_width",
    "flexible_height",
    "ignore_layout",
  ];
  for (const requiredKey of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, requiredKey)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}.${requiredKey} is required`,
        statusCode: 400,
      };
    }
  }

  const numericKeys = [
    "min_width",
    "min_height",
    "preferred_width",
    "preferred_height",
    "flexible_width",
    "flexible_height",
  ];
  for (const numericKey of numericKeys) {
    const numericValidation = validateSetUiFiniteNumber(
      source[numericKey],
      `${fieldPath}.${numericKey}`
    );
    if (!numericValidation.ok) {
      return numericValidation;
    }
  }

  if (typeof source.ignore_layout !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.ignore_layout must be a boolean`,
      statusCode: 400,
    };
  }

  return {
    ok: true,
    mappedFieldCount: 1,
  };
}

function validateSetUiObjectShape(value, fieldPath, allowedKeys) {
  if (!isObject(value)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must be an object when provided`,
      statusCode: 400,
    };
  }
  const keysValidation = validateAllowedKeys(value, allowedKeys, fieldPath);
  if (!keysValidation.ok) {
    return keysValidation;
  }
  return { ok: true };
}

function validateSetUiVector2Object(value, fieldPath) {
  const shapeValidation = validateSetUiObjectShape(
    value,
    fieldPath,
    new Set(["x", "y"])
  );
  if (!shapeValidation.ok) {
    return shapeValidation;
  }

  if (!Object.prototype.hasOwnProperty.call(value, "x")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.x is required`,
      statusCode: 400,
    };
  }
  if (!Object.prototype.hasOwnProperty.call(value, "y")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath}.y is required`,
      statusCode: 400,
    };
  }
  const xValidation = validateSetUiFiniteNumber(value.x, `${fieldPath}.x`);
  if (!xValidation.ok) {
    return xValidation;
  }
  const yValidation = validateSetUiFiniteNumber(value.y, `${fieldPath}.y`);
  if (!yValidation.ok) {
    return yValidation;
  }
  return { ok: true };
}

function validateSetUiAnchorsObject(value, fieldPath) {
  const shapeValidation = validateSetUiObjectShape(
    value,
    fieldPath,
    new Set(["min_x", "min_y", "max_x", "max_y"])
  );
  if (!shapeValidation.ok) {
    return shapeValidation;
  }

  const requiredKeys = ["min_x", "min_y", "max_x", "max_y"];
  for (const requiredKey of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}.${requiredKey} is required`,
        statusCode: 400,
      };
    }
    const numericValidation = validateSetUiFiniteNumber(
      value[requiredKey],
      `${fieldPath}.${requiredKey}`
    );
    if (!numericValidation.ok) {
      return numericValidation;
    }
  }

  return { ok: true };
}

function validateSetUiColorObject(value, fieldPath) {
  const shapeValidation = validateSetUiObjectShape(
    value,
    fieldPath,
    new Set(["r", "g", "b", "a"])
  );
  if (!shapeValidation.ok) {
    return shapeValidation;
  }

  const requiredKeys = ["r", "g", "b", "a"];
  for (const requiredKey of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, requiredKey)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath}.${requiredKey} is required`,
        statusCode: 400,
      };
    }
    const numericValidation = validateSetUiFiniteNumber(
      value[requiredKey],
      `${fieldPath}.${requiredKey}`
    );
    if (!numericValidation.ok) {
      return numericValidation;
    }
  }

  return { ok: true };
}

function validateSetUiFiniteNumber(value, fieldPath) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must be a finite number`,
      statusCode: 400,
    };
  }
  return { ok: true };
}

function validateWritePreconditions(preconditions) {
  if (preconditions === undefined || preconditions === null) {
    return { ok: true };
  }
  if (!Array.isArray(preconditions)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "preconditions must be an array when provided",
      statusCode: 400,
    };
  }
  for (let i = 0; i < preconditions.length; i += 1) {
    const item = preconditions[i];
    if (!isObject(item)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `preconditions[${i}] must be an object`,
        statusCode: 400,
      };
    }
    if (!isNonEmptyString(item.type)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `preconditions[${i}].type is required`,
        statusCode: 400,
      };
    }
    const type = String(item.type).trim();
    if (!ALLOWED_WRITE_PRECONDITION_TYPES.has(type)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `preconditions[${i}].type must be object_exists/component_exists/compile_idle`,
        statusCode: 400,
      };
    }

    const itemPath = `preconditions[${i}]`;
    if (type === "compile_idle") {
      const keysValidation = validateAllowedKeys(item, new Set(["type"]), itemPath);
      if (!keysValidation.ok) {
        return keysValidation;
      }
      continue;
    }

    const allowed =
      type === "component_exists"
        ? new Set(["type", "target_anchor", "component"])
        : new Set(["type", "target_anchor"]);
    const keysValidation = validateAllowedKeys(item, allowed, itemPath);
    if (!keysValidation.ok) {
      return keysValidation;
    }

    const targetAnchorValidation = validateAnchorObject(
      item.target_anchor,
      `${itemPath}.target_anchor`,
      "E_SCHEMA_INVALID"
    );
    if (!targetAnchorValidation.ok) {
      return targetAnchorValidation;
    }

    if (type === "component_exists") {
      if (!isNonEmptyString(item.component)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `${itemPath}.component is required for component_exists`,
          statusCode: 400,
        };
      }
    }
  }
  return { ok: true };
}

function normalizeCompositeAliasValue(value) {
  return isNonEmptyString(value) ? String(value).trim() : "";
}

function validateCompositeAliasValue(value, fieldPath) {
  const alias = normalizeCompositeAliasValue(value);
  if (!alias || !COMPOSITE_ALIAS_PATTERN.test(alias)) {
    return {
      ok: false,
      errorCode: "E_COMPOSITE_ALIAS_INVALID",
      message: `${fieldPath} must match ${COMPOSITE_ALIAS_PATTERN}`,
      statusCode: 400,
    };
  }
  return {
    ok: true,
    alias,
  };
}

function containsInlineAliasInterpolation(value) {
  if (typeof value === "string") {
    return /\$ref:[a-z][a-z0-9_]{2,31}/.test(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsInlineAliasInterpolation(item)) {
        return true;
      }
    }
    return false;
  }
  if (isObject(value)) {
    for (const key of Object.keys(value)) {
      if (containsInlineAliasInterpolation(value[key])) {
        return true;
      }
    }
  }
  return false;
}

function validateCompositeActionData(actionData, itemPath) {
  if (!isObject(actionData)) {
    return {
      ok: false,
      errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
      message: `${itemPath}.action_data must be an object for composite_visual_action`,
      statusCode: 400,
    };
  }

  const allowedCompositeKeys = new Set([
    "schema_version",
    "transaction_id",
    "atomic_mode",
    "max_step_ms",
    "steps",
  ]);
  const compositeKeysValidation = validateAllowedKeys(
    actionData,
    allowedCompositeKeys,
    `${itemPath}.action_data`
  );
  if (!compositeKeysValidation.ok) {
    return {
      ...compositeKeysValidation,
      errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
    };
  }

  if (
    actionData.schema_version !== undefined &&
    actionData.schema_version !== null &&
    !isNonEmptyString(actionData.schema_version)
  ) {
    return {
      ok: false,
      errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
      message: `${itemPath}.action_data.schema_version must be a non-empty string when provided`,
      statusCode: 400,
    };
  }

  if (
    actionData.transaction_id !== undefined &&
    actionData.transaction_id !== null &&
    !isNonEmptyString(actionData.transaction_id)
  ) {
    return {
      ok: false,
      errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
      message: `${itemPath}.action_data.transaction_id must be a non-empty string when provided`,
      statusCode: 400,
    };
  }

  if (
    actionData.atomic_mode !== undefined &&
    actionData.atomic_mode !== "all_or_nothing"
  ) {
    return {
      ok: false,
      errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
      message: `${itemPath}.action_data.atomic_mode must be all_or_nothing when provided`,
      statusCode: 400,
    };
  }

  let maxStepMs = 1500;
  if (actionData.max_step_ms !== undefined) {
    const budget = Number(actionData.max_step_ms);
    if (!Number.isFinite(budget) || budget <= 0 || Math.floor(budget) !== budget) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${itemPath}.action_data.max_step_ms must be an integer > 0 when provided`,
        statusCode: 400,
      };
    }
    if (budget > COMPOSITE_MAX_STEP_MS) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_BUDGET_EXCEEDED",
        message: `${itemPath}.action_data.max_step_ms exceeds ${COMPOSITE_MAX_STEP_MS}`,
        statusCode: 400,
      };
    }
    maxStepMs = budget;
  }

  if (!Array.isArray(actionData.steps) || actionData.steps.length === 0) {
    return {
      ok: false,
      errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
      message: `${itemPath}.action_data.steps must be a non-empty array`,
      statusCode: 400,
    };
  }

  if (actionData.steps.length > COMPOSITE_MAX_STEPS) {
    return {
      ok: false,
      errorCode: "E_COMPOSITE_BUDGET_EXCEEDED",
      message: `${itemPath}.action_data.steps exceeds ${COMPOSITE_MAX_STEPS}`,
      statusCode: 400,
    };
  }

  if (actionData.steps.length * maxStepMs > COMPOSITE_MAX_TOTAL_MS) {
    return {
      ok: false,
      errorCode: "E_COMPOSITE_BUDGET_EXCEEDED",
      message: `${itemPath}.action_data total budget exceeds ${COMPOSITE_MAX_TOTAL_MS}ms`,
      statusCode: 400,
    };
  }

  const seenStepIds = new Set();
  const seenAliases = new Set();
  const availableAliases = new Set();
  for (let stepIndex = 0; stepIndex < actionData.steps.length; stepIndex += 1) {
    const step = actionData.steps[stepIndex];
    const stepPath = `${itemPath}.action_data.steps[${stepIndex}]`;
    if (!isObject(step)) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath} must be an object`,
        statusCode: 400,
      };
    }

    const stepAllowedKeys = new Set([
      "step_id",
      "type",
      "target_anchor",
      "target_anchor_ref",
      "parent_anchor",
      "parent_anchor_ref",
      "action_data",
      "bind_outputs",
      "action_data_json",
    ]);
    const stepKeysValidation = validateAllowedKeys(step, stepAllowedKeys, stepPath);
    if (!stepKeysValidation.ok) {
      return {
        ...stepKeysValidation,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
      };
    }

    if (!isNonEmptyString(step.step_id)) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath}.step_id is required`,
        statusCode: 400,
      };
    }
    const stepId = String(step.step_id).trim();
    if (!COMPOSITE_STEP_ID_PATTERN.test(stepId)) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath}.step_id must match ${COMPOSITE_STEP_ID_PATTERN}`,
        statusCode: 400,
      };
    }
    if (seenStepIds.has(stepId)) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath}.step_id must be unique`,
        statusCode: 400,
      };
    }
    seenStepIds.add(stepId);

    if (!isNonEmptyString(step.type)) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath}.type is required`,
        statusCode: 400,
      };
    }
    const stepType = String(step.type).trim();
    if (stepType === COMPOSITE_VISUAL_ACTION_TYPE) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath}.type cannot be composite_visual_action`,
        statusCode: 400,
      };
    }

    if (!isNullOrUndefined(step.action_data_json)) {
      return {
        ok: false,
        errorCode: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
        message: `${stepPath}.action_data_json is not allowed in external payload`,
        statusCode: 400,
      };
    }
    if (!isNullOrUndefined(step.action_data) && !isObject(step.action_data)) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath}.action_data must be an object when provided`,
        statusCode: 400,
      };
    }
    const stepActionData = isObject(step.action_data) ? step.action_data : {};
    if (containsInlineAliasInterpolation(stepActionData)) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_ALIAS_INLINE_REF_UNSUPPORTED",
        message:
          `${stepPath}.action_data inline alias interpolation is not supported in v1`,
        statusCode: 400,
      };
    }

    const hasTargetAnchor = !isNullOrUndefined(step.target_anchor);
    const hasTargetAnchorRef = !isNullOrUndefined(step.target_anchor_ref);
    const hasParentAnchor = !isNullOrUndefined(step.parent_anchor);
    const hasParentAnchorRef = !isNullOrUndefined(step.parent_anchor_ref);
    if (hasTargetAnchor && hasTargetAnchorRef) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_ALIAS_INVALID",
        message: `${stepPath}.target_anchor and target_anchor_ref are mutually exclusive`,
        statusCode: 400,
      };
    }
    if (hasParentAnchor && hasParentAnchorRef) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_ALIAS_INVALID",
        message: `${stepPath}.parent_anchor and parent_anchor_ref are mutually exclusive`,
        statusCode: 400,
      };
    }
    if (hasTargetAnchor) {
      const targetValidation = validateAnchorObject(
        step.target_anchor,
        `${stepPath}.target_anchor`,
        "E_COMPOSITE_PAYLOAD_INVALID"
      );
      if (!targetValidation.ok) {
        return targetValidation;
      }
    }
    if (hasParentAnchor) {
      const parentValidation = validateAnchorObject(
        step.parent_anchor,
        `${stepPath}.parent_anchor`,
        "E_COMPOSITE_PAYLOAD_INVALID"
      );
      if (!parentValidation.ok) {
        return parentValidation;
      }
    }
    if (hasTargetAnchorRef) {
      const targetRefValidation = validateCompositeAliasValue(
        step.target_anchor_ref,
        `${stepPath}.target_anchor_ref`
      );
      if (!targetRefValidation.ok) {
        return targetRefValidation;
      }
      if (!availableAliases.has(targetRefValidation.alias)) {
        return {
          ok: false,
          errorCode: "E_COMPOSITE_ALIAS_FORWARD_REF",
          message:
            `${stepPath}.target_anchor_ref references alias not bound by previous steps`,
          statusCode: 400,
        };
      }
    }
    if (hasParentAnchorRef) {
      const parentRefValidation = validateCompositeAliasValue(
        step.parent_anchor_ref,
        `${stepPath}.parent_anchor_ref`
      );
      if (!parentRefValidation.ok) {
        return parentRefValidation;
      }
      if (!availableAliases.has(parentRefValidation.alias)) {
        return {
          ok: false,
          errorCode: "E_COMPOSITE_ALIAS_FORWARD_REF",
          message:
            `${stepPath}.parent_anchor_ref references alias not bound by previous steps`,
          statusCode: 400,
        };
      }
    }

    const hasStepTarget = hasTargetAnchor || hasTargetAnchorRef;
    const hasStepParent = hasParentAnchor || hasParentAnchorRef;
    if (!hasStepTarget && !hasStepParent) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message:
          `${stepPath}.target_anchor/target_anchor_ref or parent_anchor/parent_anchor_ref is required`,
        statusCode: 400,
      };
    }
    if (isMutationVisualActionType(stepType) && !hasStepTarget) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath}.target_anchor or target_anchor_ref is required`,
        statusCode: 400,
      };
    }
    if (stepType === "create_gameobject" && !hasStepParent) {
      return {
        ok: false,
        errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
        message: `${stepPath}.parent_anchor or parent_anchor_ref is required`,
        statusCode: 400,
      };
    }

    if (!isNullOrUndefined(step.bind_outputs)) {
      if (!Array.isArray(step.bind_outputs)) {
        return {
          ok: false,
          errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
          message: `${stepPath}.bind_outputs must be an array when provided`,
          statusCode: 400,
        };
      }
      const stepBoundAliases = new Set();
      for (let bindIndex = 0; bindIndex < step.bind_outputs.length; bindIndex += 1) {
        const bindOutput = step.bind_outputs[bindIndex];
        const bindPath = `${stepPath}.bind_outputs[${bindIndex}]`;
        if (!isObject(bindOutput)) {
          return {
            ok: false,
            errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
            message: `${bindPath} must be an object`,
            statusCode: 400,
          };
        }
        const bindAllowedKeys = new Set(["source", "alias"]);
        const bindKeyValidation = validateAllowedKeys(
          bindOutput,
          bindAllowedKeys,
          bindPath
        );
        if (!bindKeyValidation.ok) {
          return {
            ...bindKeyValidation,
            errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
          };
        }
        if (!isNonEmptyString(bindOutput.source)) {
          return {
            ok: false,
            errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
            message: `${bindPath}.source is required`,
            statusCode: 400,
          };
        }
        const source = String(bindOutput.source).trim();
        if (!COMPOSITE_ALLOWED_BIND_OUTPUT_SOURCES.has(source)) {
          return {
            ok: false,
            errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
            message:
              `${bindPath}.source must be created_object/target_object/parent_object`,
            statusCode: 400,
          };
        }
        const aliasValidation = validateCompositeAliasValue(
          bindOutput.alias,
          `${bindPath}.alias`
        );
        if (!aliasValidation.ok) {
          return aliasValidation;
        }
        if (
          seenAliases.has(aliasValidation.alias) ||
          stepBoundAliases.has(aliasValidation.alias)
        ) {
          return {
            ok: false,
            errorCode: "E_COMPOSITE_ALIAS_DUPLICATED",
            message: `${bindPath}.alias duplicates an existing alias`,
            statusCode: 400,
          };
        }
        stepBoundAliases.add(aliasValidation.alias);
      }

      if (seenAliases.size + stepBoundAliases.size > COMPOSITE_MAX_ALIASES) {
        return {
          ok: false,
          errorCode: "E_COMPOSITE_ALIAS_INVALID",
          message: `${itemPath}.action_data alias count exceeds ${COMPOSITE_MAX_ALIASES}`,
          statusCode: 400,
        };
      }
      for (const alias of stepBoundAliases) {
        seenAliases.add(alias);
        availableAliases.add(alias);
      }
    }
  }

  return { ok: true };
}

function validateMcpGetUnityTaskStatus(jobId) {
  const value = typeof jobId === "string" ? jobId.trim() : "";
  if (!value) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "job_id query parameter is required",
      statusCode: 400,
    };
  }
  return { ok: true };
}

function validateMcpCancelUnityTask(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.job_id)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "job_id is required",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateMcpHeartbeat(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set(["thread_id", "job_id"]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  const threadId = isNonEmptyString(body.thread_id) ? body.thread_id.trim() : "";
  const jobId = isNonEmptyString(body.job_id) ? body.job_id.trim() : "";
  if (!threadId && !jobId) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "thread_id or job_id is required",
      statusCode: 400,
    };
  }

  if (body.thread_id !== undefined && body.thread_id !== null && !threadId) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "thread_id must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  if (body.job_id !== undefined && body.job_id !== null && !jobId) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "job_id must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateMcpListAssetsInFolder(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set(["folder_path", "recursive", "include_meta", "limit"]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.folder_path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "folder_path is required",
      statusCode: 400,
    };
  }

  if (body.recursive !== undefined && typeof body.recursive !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "recursive must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (body.include_meta !== undefined && typeof body.include_meta !== "boolean") {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_meta must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (
    body.limit !== undefined &&
    (!Number.isFinite(Number(body.limit)) ||
      Math.floor(Number(body.limit)) !== Number(body.limit) ||
      Number(body.limit) < 1)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "limit must be an integer >= 1 when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateMcpGetSceneRoots(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set(["scene_path", "include_inactive"]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (
    body.scene_path !== undefined &&
    body.scene_path !== null &&
    typeof body.scene_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "scene_path must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.include_inactive !== undefined &&
    typeof body.include_inactive !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_inactive must be a boolean when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateMcpFindObjectsByComponent(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set([
    "component_query",
    "scene_path",
    "under_path",
    "include_inactive",
    "limit",
  ]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.component_query)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "component_query is required",
      statusCode: 400,
    };
  }

  if (
    body.scene_path !== undefined &&
    body.scene_path !== null &&
    typeof body.scene_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "scene_path must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.under_path !== undefined &&
    body.under_path !== null &&
    typeof body.under_path !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "under_path must be a string when provided",
      statusCode: 400,
    };
  }

  if (
    body.include_inactive !== undefined &&
    typeof body.include_inactive !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_inactive must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (
    body.limit !== undefined &&
    (!Number.isFinite(Number(body.limit)) ||
      Math.floor(Number(body.limit)) !== Number(body.limit) ||
      Number(body.limit) < 1)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "limit must be an integer >= 1 when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateMcpQueryPrefabInfo(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set([
    "prefab_path",
    "max_depth",
    "node_budget",
    "char_budget",
    "include_components",
    "include_missing_scripts",
  ]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!isNonEmptyString(body.prefab_path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "prefab_path is required",
      statusCode: 400,
    };
  }

  if (!Object.prototype.hasOwnProperty.call(body, "max_depth")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "max_depth is required",
      statusCode: 400,
    };
  }

  if (
    !Number.isFinite(Number(body.max_depth)) ||
    Math.floor(Number(body.max_depth)) !== Number(body.max_depth) ||
    Number(body.max_depth) < 0
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "max_depth must be an integer >= 0",
      statusCode: 400,
    };
  }

  if (
    body.node_budget !== undefined &&
    (!Number.isFinite(Number(body.node_budget)) ||
      Math.floor(Number(body.node_budget)) !== Number(body.node_budget) ||
      Number(body.node_budget) < 1)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "node_budget must be an integer >= 1 when provided",
      statusCode: 400,
    };
  }

  if (
    body.char_budget !== undefined &&
    (!Number.isFinite(Number(body.char_budget)) ||
      Math.floor(Number(body.char_budget)) !== Number(body.char_budget) ||
      Number(body.char_budget) < 256)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "char_budget must be an integer >= 256 when provided",
      statusCode: 400,
    };
  }

  if (
    body.include_components !== undefined &&
    typeof body.include_components !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_components must be a boolean when provided",
      statusCode: 400,
    };
  }

  if (
    body.include_missing_scripts !== undefined &&
    typeof body.include_missing_scripts !== "boolean"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "include_missing_scripts must be a boolean when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateVisualLayerActionsArray(actions, fieldPath, options) {
  const basePath =
    typeof fieldPath === "string" && fieldPath.trim()
      ? fieldPath.trim()
      : "payload.visual_layer_actions";
  if (!Array.isArray(actions)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${basePath} must be an array`,
      statusCode: 400,
    };
  }

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    const itemPath = `${basePath}[${i}]`;
    const hardcutValidation = validateVisualActionHardcut(action, itemPath);
    if (!hardcutValidation.ok) {
      return hardcutValidation;
    }
    const actionType = hardcutValidation.actionType;
    const anchorPolicyValidation = validateActionAnchorPolicyForKnownType(
      action,
      itemPath,
      actionType,
      options
    );
    if (!anchorPolicyValidation.ok) {
      return anchorPolicyValidation;
    }

    if (actionType === COMPOSITE_VISUAL_ACTION_TYPE) {
      const compositeValidation = validateCompositeActionData(
        action.action_data,
        itemPath
      );
      if (!compositeValidation.ok) {
        return compositeValidation;
      }
      continue;
    }

    if (actionType === "add_component") {
      if (
        !isNonEmptyString(
          resolveVisualActionField(action, "component_assembly_qualified_name")
        )
      ) {
        return {
          ok: false,
          errorCode: "E_ACTION_SCHEMA_INVALID",
          message: `${itemPath}.component_assembly_qualified_name is required`,
          statusCode: 400,
        };
      }
      continue;
    }

    if (actionType === "remove_component") {
      const hasComponentRef =
        isNonEmptyString(resolveVisualActionField(action, "component_name")) ||
        isNonEmptyString(
          resolveVisualActionField(action, "component_assembly_qualified_name")
        );
      if (!hasComponentRef) {
        return {
          ok: false,
          errorCode: "E_ACTION_SCHEMA_INVALID",
          message:
            `${itemPath}.component_name or component_assembly_qualified_name is required`,
          statusCode: 400,
        };
      }
      const expectedCount = resolveVisualActionField(action, "expected_count");
      if (
        expectedCount !== undefined &&
        (!Number.isFinite(Number(expectedCount)) ||
          Number(expectedCount) < 0 ||
          Math.floor(Number(expectedCount)) !== Number(expectedCount))
      ) {
        return {
          ok: false,
          errorCode: "E_ACTION_SCHEMA_INVALID",
          message: `${itemPath}.expected_count must be an integer >= 0 when provided`,
          statusCode: 400,
        };
      }
      const removeMode = resolveVisualActionField(action, "remove_mode");
      if (
        removeMode !== undefined &&
        removeMode !== null &&
        typeof removeMode !== "string"
      ) {
        return {
          ok: false,
          errorCode: "E_ACTION_SCHEMA_INVALID",
          message: `${itemPath}.remove_mode must be a string when provided`,
          statusCode: 400,
        };
      }
      continue;
    }

    if (actionType === "replace_component") {
      if (
        !isNonEmptyString(
          resolveVisualActionField(
            action,
            "source_component_assembly_qualified_name"
          )
        )
      ) {
        return {
          ok: false,
          errorCode: "E_ACTION_SCHEMA_INVALID",
          message:
            `${itemPath}.source_component_assembly_qualified_name is required`,
          statusCode: 400,
        };
      }
      if (
        !isNonEmptyString(
          resolveVisualActionField(action, "component_assembly_qualified_name")
        )
      ) {
        return {
          ok: false,
          errorCode: "E_ACTION_SCHEMA_INVALID",
          message: `${itemPath}.component_assembly_qualified_name is required`,
          statusCode: 400,
        };
      }
      continue;
    }

    if (actionType !== "create_gameobject") {
      continue;
    }

    if (!isNonEmptyString(resolveVisualActionField(action, "name"))) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message: `${itemPath}.name is required`,
        statusCode: 400,
      };
    }

    const primitiveType = resolveVisualActionField(action, "primitive_type");
    const uiType = resolveVisualActionField(action, "ui_type");
    const objectType = resolveVisualActionField(action, "object_type");
    if (
      primitiveType !== undefined &&
      (typeof primitiveType !== "string" ||
        (primitiveType.trim().length > 0 &&
          !ALLOWED_PRIMITIVE_TYPES.has(primitiveType.trim())))
    ) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message:
          `${itemPath}.primitive_type must be one of ${Array.from(ALLOWED_PRIMITIVE_TYPES).join("/")}`,
        statusCode: 400,
      };
    }

    if (
      uiType !== undefined &&
      (typeof uiType !== "string" ||
        (uiType.trim().length > 0 && !ALLOWED_UI_TYPES.has(uiType.trim())))
    ) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message:
          `${itemPath}.ui_type must be one of ${Array.from(ALLOWED_UI_TYPES).join("/")}`,
        statusCode: 400,
      };
    }

    if (
      objectType !== undefined &&
      (typeof objectType !== "string" ||
        (objectType.trim().length > 0 &&
          !ALLOWED_CREATE_GAMEOBJECT_TYPES.has(objectType.trim())))
    ) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message:
          `${itemPath}.object_type must be one of ${Array.from(ALLOWED_CREATE_GAMEOBJECT_TYPES).join("/")}`,
        statusCode: 400,
      };
    }

    if (isNonEmptyString(primitiveType) && isNonEmptyString(uiType)) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message: `${itemPath} cannot set both primitive_type and ui_type`,
        statusCode: 400,
      };
    }
  }

  return { ok: true };
}

module.exports = {
  FIXED_ERROR_SUGGESTION_BY_CODE,
  enforceFixedErrorSuggestion,
  validateMcpSubmitUnityTask,
  validateMcpApplyScriptActions,
  validateMcpApplyVisualActions,
  validateMcpSetUiProperties,
  validateMcpGetUnityTaskStatus,
  validateMcpCancelUnityTask,
  validateMcpHeartbeat,
  validateMcpListAssetsInFolder,
  validateMcpGetSceneRoots,
  validateMcpFindObjectsByComponent,
  validateMcpQueryPrefabInfo,
  validateFileActionsApply,
  validateUnityCompileResult,
  validateUnityActionResult,
  validateUnityRuntimePing,
  validateUnityCapabilitiesReport,
  validateUnitySelectionSnapshot,
  validateUnityConsoleSnapshot,
  validateVisualLayerActionsArray,
};

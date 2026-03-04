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

const {
  canonicalizeVisualActionType,
  isCreateLikeVisualActionType,
} = require("../actionTypeCanonicalizer");

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
  E_STALE_SNAPSHOT: "请先调用读工具获取最新 token，并仅重试一次写操作。",
});

function isNullOrUndefined(value) {
  return value === null || value === undefined;
}

function resolveActionContract(actionType, options) {
  const normalizedActionType = canonicalizeVisualActionType(actionType);
  if (!normalizedActionType) {
    return null;
  }
  const opts = options && typeof options === "object" ? options : {};
  const registry =
    opts.actionContractRegistry &&
    typeof opts.actionContractRegistry === "object"
      ? opts.actionContractRegistry
      : null;
  if (!registry || typeof registry.resolveActionContract !== "function") {
    return null;
  }
  const contract = registry.resolveActionContract(normalizedActionType);
  return isObject(contract) ? contract : null;
}

function resolveRequiredActionDataFields(actionType, options) {
  const contract = resolveActionContract(actionType, options);
  if (
    contract &&
    isObject(contract.action_data_schema) &&
    Array.isArray(contract.action_data_schema.required)
  ) {
    return contract.action_data_schema.required.filter((item) =>
      isNonEmptyString(item)
    );
  }

  const opts = options && typeof options === "object" ? options : {};
  if (typeof opts.resolveRequiredActionDataFields === "function") {
    const resolved = opts.resolveRequiredActionDataFields(actionType);
    return Array.isArray(resolved)
      ? resolved.filter((item) => isNonEmptyString(item))
      : [];
  }

  return [];
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

/**
 * Resolve a field value strictly from action.action_data only.
 * R21-detox: removed legacy fallback that also searched action[fieldName]
 * directly, which allowed LLMs to pass fields at the wrong nesting level
 * and masked L2/L3 "yin-yang" validation inconsistencies.
 */
function resolveVisualActionField(action, fieldName) {
  if (!isObject(action) || !isNonEmptyString(fieldName)) {
    return undefined;
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

function validateVisualActionHardcut(action, itemPath, options) {
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

  const actionType = canonicalizeVisualActionType(action.type);
  const anchorPolicy =
    resolveActionAnchorPolicy(actionType, options) ||
    (isCreateLikeVisualActionType(actionType)
      ? "parent_required"
      : "target_or_parent_required");
  let hasTargetAnchor = !isNullOrUndefined(action.target_anchor);
  let hasParentAnchor = !isNullOrUndefined(action.parent_anchor);

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

  const anchorPresenceValidation = validateAnchorPresenceByRequirement({
    anchorRequirement: anchorPolicy,
    hasTargetAnchor,
    hasParentAnchor,
    itemPath,
    errorCode: "E_ACTION_SCHEMA_INVALID",
    includeAnchorPolicySuffix: false,
  });
  if (!anchorPresenceValidation.ok) {
    return anchorPresenceValidation;
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
  if (!isNullOrUndefined(action.action_data_marshaled)) {
    return {
      ok: false,
      errorCode: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
      message: `${itemPath}.action_data_marshaled is not allowed in external payload`,
      statusCode: 400,
    };
  }

  return {
    ok: true,
    actionType,
  };
}

function validateAnchorPresenceByRequirement(options) {
  const opts = options && typeof options === "object" ? options : {};
  const requirement = normalizeAnchorPolicyForValidation(
    opts.anchorRequirement
  ) || "target_or_parent_required";
  const hasTargetAnchor = opts.hasTargetAnchor === true;
  const hasParentAnchor = opts.hasParentAnchor === true;
  const itemPath = isNonEmptyString(opts.itemPath)
    ? String(opts.itemPath).trim()
    : "actions[0]";
  const errorCode = isNonEmptyString(opts.errorCode)
    ? String(opts.errorCode).trim()
    : "E_ACTION_SCHEMA_INVALID";
  const includePolicySuffix = opts.includeAnchorPolicySuffix === true;
  const suffix = includePolicySuffix
    ? ` by anchor_policy(${requirement})`
    : "";

  if (requirement === "target_required" && !hasTargetAnchor) {
    return {
      ok: false,
      errorCode,
      message: `${itemPath}.target_anchor is required${suffix}`,
      statusCode: 400,
    };
  }

  if (requirement === "parent_required" && !hasParentAnchor) {
    return {
      ok: false,
      errorCode,
      message: `${itemPath}.parent_anchor is required${suffix}`,
      statusCode: 400,
    };
  }

  if (
    requirement === "target_and_parent_required" &&
    (!hasTargetAnchor || !hasParentAnchor)
  ) {
    return {
      ok: false,
      errorCode,
      message: `${itemPath}.target_anchor and ${itemPath}.parent_anchor are required${suffix}`,
      statusCode: 400,
    };
  }

  if (
    requirement === "target_or_parent_required" &&
    !hasTargetAnchor &&
    !hasParentAnchor
  ) {
    return {
      ok: false,
      errorCode,
      message: `${itemPath}.target_anchor or ${itemPath}.parent_anchor is required${suffix}`,
      statusCode: 400,
    };
  }

  return { ok: true };
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
  if (normalized === "target_and_parent_required") {
    return "target_and_parent_required";
  }
  return "";
}

function resolveActionAnchorPolicy(actionType, options) {
  const normalizedActionType = canonicalizeVisualActionType(actionType);
  if (!normalizedActionType) {
    return "";
  }
  const aliasActionType = isNonEmptyString(actionType)
    ? String(actionType).trim().toLowerCase()
    : "";

  const opts = options && typeof options === "object" ? options : {};
  const actionContract = resolveActionContract(normalizedActionType, options);
  if (actionContract && isNonEmptyString(actionContract.anchor_policy)) {
    return normalizeAnchorPolicyForValidation(actionContract.anchor_policy);
  }
  if (typeof opts.resolveActionAnchorPolicy === "function") {
    const canonicalPolicy = normalizeAnchorPolicyForValidation(
      opts.resolveActionAnchorPolicy(normalizedActionType)
    );
    if (canonicalPolicy) {
      return canonicalPolicy;
    }
    if (aliasActionType && aliasActionType !== normalizedActionType) {
      return normalizeAnchorPolicyForValidation(
        opts.resolveActionAnchorPolicy(aliasActionType)
      );
    }
    return "";
  }

  const policyMap = opts.actionAnchorPolicyByType;
  if (policyMap instanceof Map) {
    const canonicalPolicy = normalizeAnchorPolicyForValidation(
      policyMap.get(normalizedActionType)
    );
    if (canonicalPolicy) {
      return canonicalPolicy;
    }
    if (aliasActionType && aliasActionType !== normalizedActionType) {
      return normalizeAnchorPolicyForValidation(policyMap.get(aliasActionType));
    }
    return "";
  }

  if (
    isObject(policyMap) &&
    Object.prototype.hasOwnProperty.call(policyMap, normalizedActionType)
  ) {
    return normalizeAnchorPolicyForValidation(policyMap[normalizedActionType]);
  }
  if (
    isObject(policyMap) &&
    aliasActionType &&
    aliasActionType !== normalizedActionType &&
    Object.prototype.hasOwnProperty.call(policyMap, aliasActionType)
  ) {
    return normalizeAnchorPolicyForValidation(policyMap[aliasActionType]);
  }

  return "";
}

function validateActionAnchorPolicyForKnownType(
  action,
  itemPath,
  actionType,
  options
) {
  const anchorPolicy =
    resolveActionAnchorPolicy(actionType, options) ||
    (isCreateLikeVisualActionType(actionType)
      ? "parent_required"
      : "target_or_parent_required");
  if (!anchorPolicy) {
    return { ok: true };
  }

  const hasTargetAnchor = !isNullOrUndefined(action.target_anchor);
  const hasParentAnchor = !isNullOrUndefined(action.parent_anchor);
  return validateAnchorPresenceByRequirement({
    anchorRequirement: anchorPolicy,
    hasTargetAnchor,
    hasParentAnchor,
    itemPath,
    errorCode: "E_ACTION_SCHEMA_INVALID",
    includeAnchorPolicySuffix: true,
  });
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
  const forbiddenTopLevelActionDataField =
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    !isNullOrUndefined(body.action_data_json)
      ? "action_data_json"
      : body &&
          typeof body === "object" &&
          !Array.isArray(body) &&
          !isNullOrUndefined(body.action_data_marshaled)
        ? "action_data_marshaled"
        : "";
  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    forbiddenTopLevelActionDataField
  ) {
    return {
      ok: false,
      errorCode: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
      message: `${forbiddenTopLevelActionDataField} is not allowed in external payload`,
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
    "catalog_version",
    "capability_version",
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
    body.catalog_version !== undefined &&
    body.catalog_version !== null &&
    !isNonEmptyString(body.catalog_version)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "catalog_version must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  if (
    body.capability_version !== undefined &&
    body.capability_version !== null &&
    !isNonEmptyString(body.capability_version)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "capability_version must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  const catalogVersion = isNonEmptyString(body.catalog_version)
    ? body.catalog_version.trim()
    : "";
  const capabilityVersion = isNonEmptyString(body.capability_version)
    ? body.capability_version.trim()
    : "";
  if (catalogVersion && capabilityVersion && catalogVersion !== capabilityVersion) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        "catalog_version and capability_version must match when both are provided",
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
        "action_data_marshaled",
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
    if (!isNullOrUndefined(operation.action_data_marshaled)) {
      return {
        ok: false,
        errorCode: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
        message: `${opPath}.action_data_marshaled is not allowed in external payload`,
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

function validateCompositeActionData(actionData, itemPath, options) {
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
      "action_data_marshaled",
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
    const stepType = canonicalizeVisualActionType(step.type);
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
    if (!isNullOrUndefined(step.action_data_marshaled)) {
      return {
        ok: false,
        errorCode: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
        message: `${stepPath}.action_data_marshaled is not allowed in external payload`,
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
    const stepAnchorRequirement =
      resolveActionAnchorPolicy(stepType, options) ||
      (isCreateLikeVisualActionType(stepType)
        ? "parent_required"
        : "target_or_parent_required");
    const stepAnchorValidation = validateAnchorPresenceByRequirement({
      anchorRequirement: stepAnchorRequirement,
      hasTargetAnchor: hasStepTarget,
      hasParentAnchor: hasStepParent,
      itemPath: stepPath,
      errorCode: "E_COMPOSITE_PAYLOAD_INVALID",
      includeAnchorPolicySuffix: false,
    });
    if (!stepAnchorValidation.ok) {
      // Composite anchors can be either direct anchors or *_anchor_ref aliases.
      // Rewrite message from field names to composite alias-aware wording.
      const message = String(stepAnchorValidation.message || "");
      return {
        ...stepAnchorValidation,
        message: message
          .replace(`${stepPath}.target_anchor`, `${stepPath}.target_anchor or target_anchor_ref`)
          .replace(`${stepPath}.parent_anchor`, `${stepPath}.parent_anchor or parent_anchor_ref`),
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

function hasRequiredActionFieldValue(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

function validateRequiredActionDataFieldsByContract(
  action,
  itemPath,
  actionType,
  options
) {
  const requiredFields = resolveRequiredActionDataFields(actionType, options);
  if (!Array.isArray(requiredFields) || requiredFields.length === 0) {
    return { ok: true };
  }

  for (const fieldName of requiredFields) {
    const resolvedValue = resolveVisualActionField(action, fieldName);
    if (hasRequiredActionFieldValue(resolvedValue)) {
      continue;
    }
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: `${itemPath}.action_data.${fieldName} is required`,
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
    const hardcutValidation = validateVisualActionHardcut(action, itemPath, options);
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
        itemPath,
        options
      );
      if (!compositeValidation.ok) {
        return compositeValidation;
      }
      continue;
    }

    const actionDataContractValidation = validateRequiredActionDataFieldsByContract(
      action,
      itemPath,
      actionType,
      options
    );
    if (!actionDataContractValidation.ok) {
      return actionDataContractValidation;
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

    if (!isCreateLikeVisualActionType(actionType)) {
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
  validateMcpSubmitUnityTask,
  validateMcpApplyScriptActions,
  validateMcpApplyVisualActions,
  validateMcpSetUiProperties,
  validateFileActionsApply,
  validateVisualLayerActionsArray,
};

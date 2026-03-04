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

const ALLOWED_VISUAL_ACTION_TYPES = new Set([
  "add_component",
  "remove_component",
  "replace_component",
  "create_object",
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

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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

  const actionType = canonicalizeVisualActionType(body.payload.action_type);
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

  if (
    body.payload.write_receipt !== undefined &&
    !isObject(body.payload.write_receipt)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.write_receipt must be an object when provided",
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
    isCreateLikeVisualActionType(actionType) &&
    !isNonEmptyString(body.payload.name)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.name is required for create_object",
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
    if (isCreateLikeVisualActionType(actionType)) {
      if (!hasParentRef) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message:
            "payload.parent_path/parent_object_path or payload.parent_object_id is required for create_object",
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
            "payload.parent_path/parent_object_path or parent_object_id/target_object_id is required for create_object",
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
    isCreateLikeVisualActionType(actionType) &&
    !isNonEmptyString(
      body.payload.object_type ||
        body.payload.primitive_type ||
        body.payload.ui_type
    )
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.object_type is required for create_object",
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

module.exports = {
  validateUnityCompileResult,
  validateUnityActionResult,
  validateUnityRuntimePing,
  validateUnityCapabilitiesReport,
  validateUnitySelectionSnapshot,
  validateUnityConsoleSnapshot,
};

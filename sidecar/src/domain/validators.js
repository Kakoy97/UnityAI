"use strict";

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

  if (!ALLOWED_VISUAL_ACTION_TYPES.has(body.payload.action_type)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message:
        "payload.action_type must be add_component/remove_component/replace_component/create_gameobject",
      statusCode: 400,
    };
  }

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
    (body.payload.action_type === "add_component" ||
      body.payload.action_type === "replace_component") &&
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

  if (body.payload.action_type === "remove_component") {
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
    body.payload.action_type === "replace_component" &&
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
    body.payload.action_type === "create_gameobject" &&
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
  if (body.payload.action_type === "create_gameobject") {
    if (!hasParentRef) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          "payload.parent_path/parent_object_path or payload.parent_object_id is required for create_gameobject",
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

  if (
    body.payload.action_type === "create_gameobject" &&
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

  if (
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
    body.payload.action_type === "create_gameobject" &&
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

function validateMcpSubmitUnityTask(body) {
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

  if (!Object.prototype.hasOwnProperty.call(body, "based_on_read_token")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "based_on_read_token is required",
      statusCode: 400,
    };
  }

  if (!isValidReadTokenString(body.based_on_read_token)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "based_on_read_token must be a string with length >= 24",
      statusCode: 400,
    };
  }

  const writeAnchorValidation = validateAnchorObject(
    body.write_anchor,
    "write_anchor",
    "E_ACTION_SCHEMA_INVALID"
  );
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
      "visual_layer_actions"
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

  const writeAnchorValidation = validateAnchorObject(
    body.write_anchor,
    "write_anchor",
    "E_ACTION_SCHEMA_INVALID"
  );
  if (!writeAnchorValidation.ok) {
    return writeAnchorValidation;
  }

  return validateFileActionsArray(body.actions, "actions");
}

function validateMcpApplyVisualActions(body) {
  const base = validateMcpSplitWriteBase(body, "actions");
  if (!base.ok) {
    return base;
  }

  const writeAnchorValidation = validateAnchorObject(
    body.write_anchor,
    "write_anchor",
    "E_ACTION_SCHEMA_INVALID"
  );
  if (!writeAnchorValidation.ok) {
    return writeAnchorValidation;
  }

  const visualValidation = validateVisualLayerActionsArray(body.actions, "actions");
  if (!visualValidation.ok) {
    return visualValidation;
  }

  return { ok: true };
}

function validateMcpSplitWriteBase(body, actionsKey) {
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
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  if (!Object.prototype.hasOwnProperty.call(body, "based_on_read_token")) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "based_on_read_token is required",
      statusCode: 400,
    };
  }

  if (!isValidReadTokenString(body.based_on_read_token)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "based_on_read_token must be a string with length >= 24",
      statusCode: 400,
    };
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

  if (!Object.prototype.hasOwnProperty.call(body, "write_anchor")) {
    return {
      ok: false,
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: "write_anchor is required",
      statusCode: 400,
    };
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
        ? new Set([
            "type",
            "target_anchor",
            "component",
            "component_name",
            "component_assembly_qualified_name",
          ])
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
      const hasComponent =
        isNonEmptyString(item.component) ||
        isNonEmptyString(item.component_name) ||
        isNonEmptyString(item.component_assembly_qualified_name);
      if (!hasComponent) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message:
            `${itemPath} requires component/component_name/component_assembly_qualified_name`,
          statusCode: 400,
        };
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

function validateVisualLayerActionsArray(actions, fieldPath) {
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

  const legacyAnchorFields = [
    "target_object_path",
    "target_path",
    "target_object_id",
    "object_id",
    "parent_path",
    "parent_object_path",
    "parent_object_id",
  ];

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    const itemPath = `${basePath}[${i}]`;
    if (!isObject(action)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${itemPath} must be an object`,
        statusCode: 400,
      };
    }

    if (!ALLOWED_VISUAL_ACTION_TYPES.has(action.type)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `${itemPath}.type must be add_component/remove_component/replace_component/create_gameobject`,
        statusCode: 400,
      };
    }

    if (isMutationVisualActionType(action.type)) {
      const allowed = new Set([
        "type",
        "target_anchor",
        "component_name",
        "component_assembly_qualified_name",
        "source_component_assembly_qualified_name",
        "remove_mode",
        "expected_count",
      ]);
      const keysValidation = validateAllowedKeys(action, allowed, itemPath);
      if (!keysValidation.ok) {
        return {
          ...keysValidation,
          errorCode: "E_ACTION_SCHEMA_INVALID",
        };
      }

      const targetAnchorValidation = validateAnchorObject(
        action.target_anchor,
        `${itemPath}.target_anchor`,
        "E_ACTION_SCHEMA_INVALID"
      );
      if (!targetAnchorValidation.ok) {
        return targetAnchorValidation;
      }

      if (!isNullOrUndefined(action.parent_anchor)) {
        return {
          ok: false,
          errorCode: "E_ACTION_SCHEMA_INVALID",
          message: `${itemPath}.parent_anchor is not allowed for mutation actions`,
          statusCode: 400,
        };
      }

      for (const legacyField of legacyAnchorFields) {
        if (!isNullOrUndefined(action[legacyField])) {
          return {
            ok: false,
            errorCode: "E_ACTION_SCHEMA_INVALID",
            message: `${itemPath}.${legacyField} is not allowed; use target_anchor/parent_anchor`,
            statusCode: 400,
          };
        }
      }

      if (action.type === "add_component") {
        if (!isNonEmptyString(action.component_assembly_qualified_name)) {
          return {
            ok: false,
            errorCode: "E_ACTION_SCHEMA_INVALID",
            message: `${itemPath}.component_assembly_qualified_name is required`,
            statusCode: 400,
          };
        }
      } else if (action.type === "remove_component") {
        const hasComponentRef =
          isNonEmptyString(action.component_name) ||
          isNonEmptyString(action.component_assembly_qualified_name);
        if (!hasComponentRef) {
          return {
            ok: false,
            errorCode: "E_ACTION_SCHEMA_INVALID",
            message:
              `${itemPath}.component_name or component_assembly_qualified_name is required`,
            statusCode: 400,
          };
        }
        if (
          action.expected_count !== undefined &&
          (!Number.isFinite(Number(action.expected_count)) ||
            Number(action.expected_count) < 0 ||
            Math.floor(Number(action.expected_count)) !==
              Number(action.expected_count))
        ) {
          return {
            ok: false,
            errorCode: "E_ACTION_SCHEMA_INVALID",
            message: `${itemPath}.expected_count must be an integer >= 0 when provided`,
            statusCode: 400,
          };
        }
        if (
          action.remove_mode !== undefined &&
          action.remove_mode !== null &&
          typeof action.remove_mode !== "string"
        ) {
          return {
            ok: false,
            errorCode: "E_ACTION_SCHEMA_INVALID",
            message: `${itemPath}.remove_mode must be a string when provided`,
            statusCode: 400,
          };
        }
      } else if (action.type === "replace_component") {
        if (!isNonEmptyString(action.source_component_assembly_qualified_name)) {
          return {
            ok: false,
            errorCode: "E_ACTION_SCHEMA_INVALID",
            message:
              `${itemPath}.source_component_assembly_qualified_name is required`,
            statusCode: 400,
          };
        }
        if (!isNonEmptyString(action.component_assembly_qualified_name)) {
          return {
            ok: false,
            errorCode: "E_ACTION_SCHEMA_INVALID",
            message: `${itemPath}.component_assembly_qualified_name is required`,
            statusCode: 400,
          };
        }
      }

      continue;
    }

    // create_gameobject branch
    const allowed = new Set([
      "type",
      "parent_anchor",
      "name",
      "primitive_type",
      "ui_type",
    ]);
    const keysValidation = validateAllowedKeys(action, allowed, itemPath);
    if (!keysValidation.ok) {
      return {
        ...keysValidation,
        errorCode: "E_ACTION_SCHEMA_INVALID",
      };
    }

    const parentAnchorValidation = validateAnchorObject(
      action.parent_anchor,
      `${itemPath}.parent_anchor`,
      "E_ACTION_SCHEMA_INVALID"
    );
    if (!parentAnchorValidation.ok) {
      return parentAnchorValidation;
    }

    if (!isNullOrUndefined(action.target_anchor)) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message: `${itemPath}.target_anchor is not allowed for create_gameobject`,
        statusCode: 400,
      };
    }

    for (const legacyField of legacyAnchorFields) {
      if (!isNullOrUndefined(action[legacyField])) {
        return {
          ok: false,
          errorCode: "E_ACTION_SCHEMA_INVALID",
          message: `${itemPath}.${legacyField} is not allowed; use target_anchor/parent_anchor`,
          statusCode: 400,
        };
      }
    }

    if (!isNonEmptyString(action.name)) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message: `${itemPath}.name is required`,
        statusCode: 400,
      };
    }

    if (
      action.primitive_type !== undefined &&
      (typeof action.primitive_type !== "string" ||
        (action.primitive_type.trim().length > 0 &&
          !ALLOWED_PRIMITIVE_TYPES.has(action.primitive_type.trim())))
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
      action.ui_type !== undefined &&
      (typeof action.ui_type !== "string" ||
        (action.ui_type.trim().length > 0 &&
          !ALLOWED_UI_TYPES.has(action.ui_type.trim())))
    ) {
      return {
        ok: false,
        errorCode: "E_ACTION_SCHEMA_INVALID",
        message:
          `${itemPath}.ui_type must be one of ${Array.from(ALLOWED_UI_TYPES).join("/")}`,
        statusCode: 400,
      };
    }

    if (isNonEmptyString(action.primitive_type) && isNonEmptyString(action.ui_type)) {
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
  validateUnitySelectionSnapshot,
  validateUnityConsoleSnapshot,
  validateVisualLayerActionsArray,
};

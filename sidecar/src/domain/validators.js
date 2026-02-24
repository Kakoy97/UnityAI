"use strict";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidIsoTimestamp(value) {
  if (!isNonEmptyString(value)) {
    return false;
  }
  const time = Date.parse(value);
  return Number.isFinite(time);
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

function validateSessionStart(body) {
  return validateEnvelope(body, "session.start");
}

function validateTurnSend(body) {
  const envelope = validateEnvelope(body, "turn.send");
  if (!envelope.ok) {
    return envelope;
  }

  if (!isNonEmptyString(body.payload.user_message)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.user_message is required",
      statusCode: 400,
    };
  }

  if (!isObject(body.payload.context)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.context is required",
      statusCode: 400,
    };
  }

  const selectionTree = body.payload.context.selection_tree;
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

  return { ok: true };
}

function validateTurnCancel(body) {
  const envelope = validateEnvelope(body, "turn.cancel");
  if (!envelope.ok) {
    return envelope;
  }

  if (!isNonEmptyString(body.payload.reason)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.reason is required",
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

  if (!isNonEmptyString(body.payload.target)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.target is required",
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

  if (
    body.payload.action_type === "create_gameobject" &&
    !isNonEmptyString(body.payload.parent_path || body.payload.parent_object_path)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.parent_path is required for create_gameobject",
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

function validateMcpSubmitUnityTask(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
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

  if (
    body.task_allocation !== undefined &&
    body.task_allocation !== null &&
    !isObject(body.task_allocation)
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "task_allocation must be an object when provided",
      statusCode: 400,
    };
  }

  if (body.context !== undefined) {
    if (!isObject(body.context)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "context must be an object when provided",
        statusCode: 400,
      };
    }

    const selectionTree = body.context.selection_tree;
    if (!isObject(selectionTree)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "context.selection_tree is required when context is provided",
        statusCode: 400,
      };
    }

    if (selectionTree.max_depth !== 2) {
      return {
        ok: false,
        errorCode: "E_CONTEXT_DEPTH_VIOLATION",
        message: "context.selection_tree.max_depth must be 2",
        statusCode: 400,
      };
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

function validateUnityQueryComponentsResult(body) {
  const envelope = validateEnvelope(body, "unity.query.components.result");
  if (!envelope.ok) {
    return envelope;
  }

  if (!isNonEmptyString(body.payload.query_id)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.query_id is required",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.payload.target_path)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.target_path is required",
      statusCode: 400,
    };
  }

  if (!Array.isArray(body.payload.components)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.components must be an array",
      statusCode: 400,
    };
  }

  for (let i = 0; i < body.payload.components.length; i += 1) {
    const item = body.payload.components[i];
    if (!isObject(item)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.components[${i}] must be an object`,
        statusCode: 400,
      };
    }
    if (!isNonEmptyString(item.short_name)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.components[${i}].short_name is required`,
        statusCode: 400,
      };
    }
    if (!isNonEmptyString(item.assembly_qualified_name)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.components[${i}].assembly_qualified_name is required`,
        statusCode: 400,
      };
    }
  }

  if (
    body.payload.error_message !== undefined &&
    typeof body.payload.error_message !== "string"
  ) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.error_message must be a string when provided",
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

  return { ok: true };
}

function validateVisualLayerActionsArray(actions) {
  if (!Array.isArray(actions)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "payload.visual_layer_actions must be an array",
      statusCode: 400,
    };
  }

  for (let i = 0; i < actions.length; i += 1) {
    const action = actions[i];
    if (!isObject(action)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.visual_layer_actions[${i}] must be an object`,
        statusCode: 400,
      };
    }

    if (!ALLOWED_VISUAL_ACTION_TYPES.has(action.type)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `payload.visual_layer_actions[${i}].type must be add_component/remove_component/replace_component/create_gameobject`,
        statusCode: 400,
      };
    }

    if (
      action.target !== undefined &&
      action.target !== null &&
      action.target !== "" &&
      action.target !== "selection"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.visual_layer_actions[${i}].target must be selection`,
        statusCode: 400,
      };
    }

    if (action.type === "add_component") {
      const keys = Object.keys(action);
      for (const key of keys) {
        if (
          key !== "type" &&
          key !== "target" &&
          key !== "target_object_path" &&
          key !== "component_assembly_qualified_name"
        ) {
          return {
            ok: false,
            errorCode: "E_SCHEMA_INVALID",
            message: `payload.visual_layer_actions[${i}] has unexpected field: ${key}`,
            statusCode: 400,
          };
        }
      }
      if (!isNonEmptyString(action.target_object_path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.visual_layer_actions[${i}].target_object_path is required`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(action.component_assembly_qualified_name)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.visual_layer_actions[${i}].component_assembly_qualified_name is required`,
          statusCode: 400,
        };
      }
      continue;
    }

    if (action.type === "remove_component") {
      const keys = Object.keys(action);
      for (const key of keys) {
        if (
          key !== "type" &&
          key !== "target" &&
          key !== "target_object_path" &&
          key !== "component_name" &&
          key !== "component_assembly_qualified_name"
        ) {
          return {
            ok: false,
            errorCode: "E_SCHEMA_INVALID",
            message: `payload.visual_layer_actions[${i}] has unexpected field: ${key}`,
            statusCode: 400,
          };
        }
      }
      if (!isNonEmptyString(action.target_object_path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.visual_layer_actions[${i}].target_object_path is required`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(action.component_name)) {
        const alias = isNonEmptyString(action.component_assembly_qualified_name)
          ? String(action.component_assembly_qualified_name)
          : "";
        if (alias) {
          continue;
        }
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message:
            `payload.visual_layer_actions[${i}].component_name or component_assembly_qualified_name is required`,
          statusCode: 400,
        };
      }
      continue;
    }

    if (action.type === "replace_component") {
      const keys = Object.keys(action);
      for (const key of keys) {
        if (
          key !== "type" &&
          key !== "target" &&
          key !== "target_object_path" &&
          key !== "source_component_assembly_qualified_name" &&
          key !== "component_assembly_qualified_name"
        ) {
          return {
            ok: false,
            errorCode: "E_SCHEMA_INVALID",
            message: `payload.visual_layer_actions[${i}] has unexpected field: ${key}`,
            statusCode: 400,
          };
        }
      }
      if (!isNonEmptyString(action.target_object_path)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.visual_layer_actions[${i}].target_object_path is required`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(action.source_component_assembly_qualified_name)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message:
            `payload.visual_layer_actions[${i}].source_component_assembly_qualified_name is required`,
          statusCode: 400,
        };
      }
      if (!isNonEmptyString(action.component_assembly_qualified_name)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.visual_layer_actions[${i}].component_assembly_qualified_name is required`,
          statusCode: 400,
        };
      }
      continue;
    }

    const keys = Object.keys(action);
    for (const key of keys) {
      if (
        key !== "type" &&
        key !== "target" &&
        key !== "name" &&
        key !== "parent_path" &&
        key !== "object_type" &&
        key !== "parent_object_path" &&
        key !== "primitive_type" &&
        key !== "ui_type"
      ) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: `payload.visual_layer_actions[${i}] has unexpected field: ${key}`,
          statusCode: 400,
        };
      }
    }

    if (!isNonEmptyString(action.name)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.visual_layer_actions[${i}].name is required`,
        statusCode: 400,
      };
    }

    if (
      action.parent_object_path !== undefined &&
      typeof action.parent_object_path !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.visual_layer_actions[${i}].parent_object_path must be a string when provided`,
        statusCode: 400,
      };
    }

    if (
      action.parent_path !== undefined &&
      typeof action.parent_path !== "string"
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.visual_layer_actions[${i}].parent_path must be a string when provided`,
        statusCode: 400,
      };
    }

    if (
      action.object_type !== undefined &&
      (typeof action.object_type !== "string" ||
        (action.object_type.trim().length > 0 &&
          !ALLOWED_CREATE_GAMEOBJECT_TYPES.has(action.object_type)))
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `payload.visual_layer_actions[${i}].object_type must be one of ${Array.from(ALLOWED_CREATE_GAMEOBJECT_TYPES).join("/")}`,
        statusCode: 400,
      };
    }

    if (!isNonEmptyString(action.parent_path || action.parent_object_path)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.visual_layer_actions[${i}].parent_path is required`,
        statusCode: 400,
      };
    }

    if (
      !isNonEmptyString(action.object_type) &&
      !isNonEmptyString(action.primitive_type) &&
      !isNonEmptyString(action.ui_type)
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `payload.visual_layer_actions[${i}].object_type is required`,
        statusCode: 400,
      };
    }

    if (
      action.primitive_type !== undefined &&
      (typeof action.primitive_type !== "string" ||
        (action.primitive_type.trim().length > 0 &&
          !ALLOWED_PRIMITIVE_TYPES.has(action.primitive_type)))
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `payload.visual_layer_actions[${i}].primitive_type must be one of ${Array.from(ALLOWED_PRIMITIVE_TYPES).join("/")}`,
        statusCode: 400,
      };
    }

    if (
      action.ui_type !== undefined &&
      (typeof action.ui_type !== "string" ||
        (action.ui_type.trim().length > 0 && !ALLOWED_UI_TYPES.has(action.ui_type)))
    ) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `payload.visual_layer_actions[${i}].ui_type must be one of ${Array.from(ALLOWED_UI_TYPES).join("/")}`,
        statusCode: 400,
      };
    }

    if (isNonEmptyString(action.primitive_type) && isNonEmptyString(action.ui_type)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message:
          `payload.visual_layer_actions[${i}] cannot set both primitive_type and ui_type`,
        statusCode: 400,
      };
    }
  }

  return { ok: true };
}

const DEFAULT_PLANNER_SCRIPT_ROOT = "Assets/Scripts/AIGenerated/";
const PLANNER_FORBIDDEN_SERIALIZED_SUFFIXES = [".unity", ".prefab", ".asset"];
const PLANNER_MCP_FIELD_PATTERN = /(mcp|model[_-]?context[_-]?protocol)/i;
const PLANNER_GUARD_PREFIX = "AI \u8fdd\u89c4\u5c1d\u8bd5\u8d8a\u6743\u64cd\u4f5c";

function validatePlannerOutputGuard(plannerResult, options) {
  const opts = options && typeof options === "object" ? options : {};
  const allowedRoot = normalizeAllowedRoot(
    opts.allowedScriptRoot || DEFAULT_PLANNER_SCRIPT_ROOT
  );
  const assistantKey = "assistant_text";
  const allocationKey = "task_allocation";

  if (!isObject(plannerResult)) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage("planner output must be a JSON object")
    );
  }

  const mcpPath = findMcpFieldPath(plannerResult, "", 0);
  if (mcpPath) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage(`detected forbidden MCP-related field at ${mcpPath}`)
    );
  }

  const topKeys = Object.keys(plannerResult);
  for (const key of topKeys) {
    if (key !== assistantKey && key !== allocationKey) {
      return plannerGuardError(
        "E_PLANNING_FAILED",
        plannerGuardMessage(`unexpected top-level field: ${key}`)
      );
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(plannerResult, assistantKey) &&
    plannerResult[assistantKey] !== undefined &&
    plannerResult[assistantKey] !== null &&
    typeof plannerResult[assistantKey] !== "string"
  ) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage("assistant_text must be a string when provided")
    );
  }

  if (!Object.prototype.hasOwnProperty.call(plannerResult, allocationKey)) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage("missing required field task_allocation")
    );
  }

  const allocation = plannerResult[allocationKey];
  if (allocation === null) {
    return {
      ok: true,
      task_allocation: null,
    };
  }

  if (!isObject(allocation)) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage("task_allocation must be an object or null")
    );
  }

  const allocationKeys = Object.keys(allocation);
  for (const key of allocationKeys) {
    if (
      key !== "reasoning_and_plan" &&
      key !== "file_actions" &&
      key !== "visual_layer_actions"
    ) {
      return plannerGuardError(
        "E_PLANNING_FAILED",
        plannerGuardMessage(`unexpected task_allocation field: ${key}`)
      );
    }
  }

  const reasoningAndPlan =
    typeof allocation.reasoning_and_plan === "string"
      ? allocation.reasoning_and_plan.trim()
      : "";
  if (!reasoningAndPlan) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage("task_allocation.reasoning_and_plan must be a non-empty string")
    );
  }

  if (!Array.isArray(allocation.file_actions)) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage("file_actions must be an array")
    );
  }
  if (!Array.isArray(allocation.visual_layer_actions)) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage("visual_layer_actions must be an array")
    );
  }

  const normalizedFileActions = [];
  for (let i = 0; i < allocation.file_actions.length; i += 1) {
    const action = allocation.file_actions[i];
    if (!isObject(action)) {
      return plannerGuardError(
        "E_PLANNING_FAILED",
        plannerGuardMessage(`file_actions[${i}] must be an object`)
      );
    }

    const mcpActionPath = findMcpFieldPath(
      action,
      `task_allocation.file_actions[${i}]`,
      0
    );
    if (mcpActionPath) {
      return plannerGuardError(
        "E_PLANNING_FAILED",
        plannerGuardMessage(`detected forbidden MCP-related field at ${mcpActionPath}`)
      );
    }

    const actionKeys = Object.keys(action);
    if (!ALLOWED_FILE_ACTION_TYPES.has(action.type)) {
      return plannerGuardError(
        "E_PLANNING_FAILED",
        plannerGuardMessage(
          `file_actions[${i}].type must be create_file/update_file/rename_file/delete_file`
        )
      );
    }
    if (action.type === "create_file" || action.type === "update_file") {
      for (const key of actionKeys) {
        if (
          key !== "type" &&
          key !== "path" &&
          key !== "content" &&
          key !== "overwrite_if_exists"
        ) {
          return plannerGuardError(
            "E_PLANNING_FAILED",
            plannerGuardMessage(`unexpected file_actions[${i}] field: ${key}`)
          );
        }
      }

      if (!isNonEmptyString(action.path)) {
        return plannerGuardError(
          "E_PLANNING_FAILED",
          plannerGuardMessage(`file_actions[${i}].path must be a non-empty string`)
        );
      }
      if (typeof action.content !== "string") {
        return plannerGuardError(
          "E_PLANNING_FAILED",
          plannerGuardMessage(`file_actions[${i}].content must be a string`)
        );
      }
      if (typeof action.overwrite_if_exists !== "boolean") {
        return plannerGuardError(
          "E_PLANNING_FAILED",
          plannerGuardMessage(`file_actions[${i}].overwrite_if_exists must be a boolean`)
        );
      }

      const normalizedPath = normalizePlannerPath(action.path);
      if (!normalizedPath) {
        return plannerGuardError(
          "E_PLANNING_FAILED",
          plannerGuardMessage(`file_actions[${i}].path is invalid after normalization`)
        );
      }

      const forbiddenSuffix = findForbiddenSerializedSuffix(normalizedPath);
      if (forbiddenSuffix) {
        return plannerGuardError(
          "E_FILE_PATH_FORBIDDEN",
          plannerGuardMessage(
            `forbidden Unity serialized file path suffix detected: ${forbiddenSuffix}`
          )
        );
      }

      if (!isAllowedPlannerPath(normalizedPath, allowedRoot)) {
        return plannerGuardError(
          "E_FILE_PATH_FORBIDDEN",
          plannerGuardMessage(`file path is outside whitelist: ${normalizedPath}`)
        );
      }

      normalizedFileActions.push({
        type: action.type,
        path: normalizedPath,
        content: action.content,
        overwrite_if_exists: action.overwrite_if_exists,
      });
      continue;
    }

    if (action.type === "rename_file") {
      for (const key of actionKeys) {
        if (
          key !== "type" &&
          key !== "old_path" &&
          key !== "new_path" &&
          key !== "overwrite_if_exists"
        ) {
          return plannerGuardError(
            "E_PLANNING_FAILED",
            plannerGuardMessage(`unexpected file_actions[${i}] field: ${key}`)
          );
        }
      }
      if (!isNonEmptyString(action.old_path) || !isNonEmptyString(action.new_path)) {
        return plannerGuardError(
          "E_PLANNING_FAILED",
          plannerGuardMessage(`file_actions[${i}] old_path/new_path must be non-empty strings`)
        );
      }
      const normalizedOldPath = normalizePlannerPath(action.old_path);
      const normalizedNewPath = normalizePlannerPath(action.new_path);
      if (!normalizedOldPath || !normalizedNewPath) {
        return plannerGuardError(
          "E_PLANNING_FAILED",
          plannerGuardMessage(`file_actions[${i}] path is invalid after normalization`)
        );
      }
      const oldSuffix = findForbiddenSerializedSuffix(normalizedOldPath);
      if (oldSuffix) {
        return plannerGuardError(
          "E_FILE_PATH_FORBIDDEN",
          plannerGuardMessage(
            `forbidden Unity serialized file path suffix detected: ${oldSuffix}`
          )
        );
      }
      const newSuffix = findForbiddenSerializedSuffix(normalizedNewPath);
      if (newSuffix) {
        return plannerGuardError(
          "E_FILE_PATH_FORBIDDEN",
          plannerGuardMessage(
            `forbidden Unity serialized file path suffix detected: ${newSuffix}`
          )
        );
      }
      if (
        !isAllowedPlannerPath(normalizedOldPath, allowedRoot) ||
        !isAllowedPlannerPath(normalizedNewPath, allowedRoot)
      ) {
        return plannerGuardError(
          "E_FILE_PATH_FORBIDDEN",
          plannerGuardMessage(
            `rename file path is outside whitelist: ${normalizedOldPath} -> ${normalizedNewPath}`
          )
        );
      }

      normalizedFileActions.push({
        type: action.type,
        old_path: normalizedOldPath,
        new_path: normalizedNewPath,
        overwrite_if_exists: action.overwrite_if_exists === true,
      });
      continue;
    }

    for (const key of actionKeys) {
      if (key !== "type" && key !== "path") {
        return plannerGuardError(
          "E_PLANNING_FAILED",
          plannerGuardMessage(`unexpected file_actions[${i}] field: ${key}`)
        );
      }
    }
    if (!isNonEmptyString(action.path)) {
      return plannerGuardError(
        "E_PLANNING_FAILED",
        plannerGuardMessage(`file_actions[${i}].path must be a non-empty string`)
      );
    }

    const normalizedPath = normalizePlannerPath(action.path);
    if (!normalizedPath) {
      return plannerGuardError(
        "E_PLANNING_FAILED",
        plannerGuardMessage(`file_actions[${i}].path is invalid after normalization`)
      );
    }

    const forbiddenSuffix = findForbiddenSerializedSuffix(normalizedPath);
    if (forbiddenSuffix) {
      return plannerGuardError(
        "E_FILE_PATH_FORBIDDEN",
        plannerGuardMessage(
          `forbidden Unity serialized file path suffix detected: ${forbiddenSuffix}`
        )
      );
    }

    if (!isAllowedPlannerPath(normalizedPath, allowedRoot)) {
      return plannerGuardError(
        "E_FILE_PATH_FORBIDDEN",
        plannerGuardMessage(`file path is outside whitelist: ${normalizedPath}`)
      );
    }

    normalizedFileActions.push({
      type: action.type,
      path: normalizedPath,
    });
  }

  const visualValidation = validateVisualLayerActionsArray(
    allocation.visual_layer_actions
  );
  if (!visualValidation.ok) {
    return plannerGuardError(
      "E_PLANNING_FAILED",
      plannerGuardMessage(
        `visual_layer_actions is invalid (${visualValidation.message})`
      )
    );
  }

  const normalizedVisualActions = allocation.visual_layer_actions.map((action) => {
    const type = typeof action.type === "string" ? action.type : "";
    const normalized = {
      type,
      target:
        typeof action.target === "string" && action.target.trim()
          ? action.target
          : "selection",
    };

    if (type === "add_component" || type === "remove_component") {
      normalized.target_object_path =
        typeof action.target_object_path === "string"
          ? action.target_object_path
          : "";
      normalized.component_assembly_qualified_name = "";
      if (type === "add_component") {
        normalized.component_assembly_qualified_name =
          typeof action.component_assembly_qualified_name === "string"
            ? action.component_assembly_qualified_name
            : "";
      } else {
        const componentAlias =
          typeof action.component_name === "string" && action.component_name.trim()
            ? action.component_name
            : typeof action.component_assembly_qualified_name === "string"
              ? action.component_assembly_qualified_name
              : "";
        normalized.component_name =
          typeof componentAlias === "string" ? componentAlias : "";
        normalized.component_assembly_qualified_name =
          typeof componentAlias === "string" ? componentAlias : "";
      }
      return normalized;
    }

    if (type === "replace_component") {
      normalized.target_object_path =
        typeof action.target_object_path === "string"
          ? action.target_object_path
          : "";
      normalized.source_component_assembly_qualified_name =
        typeof action.source_component_assembly_qualified_name === "string"
          ? action.source_component_assembly_qualified_name
          : "";
      normalized.component_assembly_qualified_name =
        typeof action.component_assembly_qualified_name === "string"
          ? action.component_assembly_qualified_name
          : "";
      return normalized;
    }

    normalized.name = typeof action.name === "string" ? action.name : "";
    normalized.parent_path =
      typeof action.parent_path === "string" ? action.parent_path : "";
    normalized.object_type =
      typeof action.object_type === "string" ? action.object_type : "";
    normalized.parent_object_path =
      typeof action.parent_object_path === "string"
        ? action.parent_object_path
        : normalized.parent_path;
    const objectType =
      normalized.object_type ||
      (typeof action.primitive_type === "string" ? action.primitive_type : "") ||
      (typeof action.ui_type === "string" ? action.ui_type : "");
    normalized.object_type = objectType;
    normalized.primitive_type = ALLOWED_PRIMITIVE_TYPES.has(objectType)
      ? objectType
      : "";
    normalized.ui_type = ALLOWED_UI_TYPES.has(objectType) ? objectType : "";
    return normalized;
  });

  return {
    ok: true,
    task_allocation: {
      reasoning_and_plan: reasoningAndPlan,
      file_actions: normalizedFileActions,
      visual_layer_actions: normalizedVisualActions,
    },
  };
}

function plannerGuardError(errorCode, message) {
  return {
    ok: false,
    errorCode: errorCode || "E_PLANNING_FAILED",
    message: message || PLANNER_GUARD_PREFIX,
  };
}

function plannerGuardMessage(detail) {
  if (!isNonEmptyString(detail)) {
    return PLANNER_GUARD_PREFIX;
  }
  return `${PLANNER_GUARD_PREFIX}: ${detail}`;
}

function normalizeAllowedRoot(value) {
  const normalized = normalizePlannerPath(value);
  if (!normalized) {
    return normalizePlannerPath(DEFAULT_PLANNER_SCRIPT_ROOT);
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizePlannerPath(value) {
  if (!isNonEmptyString(value)) {
    return "";
  }
  let path = value.trim().replace(/\\/g, "/");
  while (path.startsWith("./")) {
    path = path.slice(2);
  }
  path = path.replace(/\/+/g, "/");
  return path;
}

function findForbiddenSerializedSuffix(path) {
  const normalized = normalizePlannerPath(path).toLowerCase();
  for (const suffix of PLANNER_FORBIDDEN_SERIALIZED_SUFFIXES) {
    if (normalized.endsWith(suffix)) {
      return suffix;
    }
  }
  return "";
}

function isAllowedPlannerPath(path, allowedRoot) {
  const normalizedPath = normalizePlannerPath(path).toLowerCase();
  const normalizedRoot = normalizeAllowedRoot(allowedRoot).toLowerCase();
  if (!normalizedPath.startsWith(normalizedRoot)) {
    return false;
  }
  if (
    normalizedPath.includes("/../") ||
    normalizedPath.startsWith("../") ||
    normalizedPath.includes("..\\")
  ) {
    return false;
  }
  return true;
}

function findMcpFieldPath(value, path, depth) {
  if (depth > 8) {
    return "";
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const nextPath = `${path}[${i}]`;
      const hit = findMcpFieldPath(value[i], nextPath, depth + 1);
      if (hit) {
        return hit;
      }
    }
    return "";
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  for (const key of Object.keys(value)) {
    const nextPath = path ? `${path}.${key}` : key;
    if (PLANNER_MCP_FIELD_PATTERN.test(String(key))) {
      return nextPath;
    }
    const hit = findMcpFieldPath(value[key], nextPath, depth + 1);
    if (hit) {
      return hit;
    }
  }

  return "";
}
module.exports = {
  validateSessionStart,
  validateTurnSend,
  validateTurnCancel,
  validateMcpSubmitUnityTask,
  validateMcpGetUnityTaskStatus,
  validateMcpCancelUnityTask,
  validateFileActionsApply,
  validateUnityCompileResult,
  validateUnityActionResult,
  validateUnityRuntimePing,
  validateUnityQueryComponentsResult,
  validateVisualLayerActionsArray,
  validatePlannerOutputGuard,
};

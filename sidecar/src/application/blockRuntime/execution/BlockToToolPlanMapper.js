"use strict";

const {
  BLOCK_TYPE,
  validateBlockSpec,
} = require("../contracts");
const {
  FAMILY_TOOL_MIGRATION_MATRIX,
  FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE,
  getFamilyToolProfile,
} = require("./FamilyToolMigrationMatrix");
const {
  evaluateFallbackPolicyGuard,
} = require("./FallbackPolicyGuard");

const INTENT_KEY_SOURCE = Object.freeze({
  FAMILY_KEY: "family_key",
  LEGACY_CONCRETE_KEY: "legacy_concrete_key",
});

const LEGACY_INTENT_COMPAT_POLICY = Object.freeze({
  env_key: "BLOCK_RUNTIME_LEGACY_INTENT_COMPAT_ENABLED",
  default_enabled: true,
  enabled_values: Object.freeze(["1", "true", "on", "enabled", "yes"]),
  disabled_values: Object.freeze(["0", "false", "off", "disabled", "no"]),
});

const FAMILY_MAPPING_ROLLBACK_POLICY = Object.freeze({
  env_key: "BLOCK_RUNTIME_DISABLED_FAMILY_KEYS",
});

const MAPPING_VERSION = "phase1_stepB_v1";
const VERIFY_LOCAL_TOOL_NAME = "__block_verify_local__";
const EXECUTION_BACKEND_ROLE = Object.freeze({
  INTERNAL_DIRECT_RUNTIME: "internal_direct_runtime_backend",
  LOCAL_VERIFY_RUNTIME: "local_verify_runtime",
});
const TRANSACTION_STEP_RESERVED_PAYLOAD_FIELDS = new Set([
  "execution_mode",
  "idempotency_key",
  "based_on_read_token",
  "write_anchor_object_id",
  "write_anchor_path",
]);

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hasFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function hasBoolean(value) {
  return typeof value === "boolean";
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => normalizeString(entry))
    .filter((entry) => !!entry);
}

function normalizeCsvSet(value) {
  if (Array.isArray(value)) {
    return new Set(
      value
        .map((item) => normalizeString(item))
        .filter((item) => !!item)
    );
  }
  const raw = normalizeString(value);
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(",")
      .map((item) => normalizeString(item))
      .filter((item) => !!item)
  );
}

function buildMapperError({
  error_code,
  block_error_code,
  error_message,
  details = null,
}) {
  return {
    ok: false,
    error_code,
    block_error_code,
    error_message,
    details,
  };
}

function requireStringField(source, fieldName) {
  const value = normalizeString(source[fieldName]);
  if (!value) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `required field missing: ${fieldName}`,
      }),
    };
  }
  return {
    ok: true,
    value,
  };
}

function requireFiniteNumberField(source, fieldName, errorLabel = fieldName) {
  if (!hasFiniteNumber(source[fieldName])) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `required field missing: ${errorLabel}`,
      }),
    };
  }
  return {
    ok: true,
    value: Number(source[fieldName]),
  };
}

function requireBooleanField(source, fieldName, errorLabel = fieldName) {
  if (!hasBoolean(source[fieldName])) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `required field missing: ${errorLabel} (boolean)`,
      }),
    };
  }
  return {
    ok: true,
    value: source[fieldName],
  };
}

function requireStringTypeField(source, fieldName, errorLabel = fieldName) {
  if (typeof source[fieldName] !== "string") {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `required field missing: ${errorLabel}`,
      }),
    };
  }
  return {
    ok: true,
    value: source[fieldName],
  };
}

function requireNonNegativeIntegerField(
  source,
  fieldName,
  errorLabel = fieldName
) {
  const rawValue = source[fieldName];
  if (!Number.isInteger(rawValue) || rawValue < 0) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `required field missing: ${errorLabel} (non-negative integer)`,
      }),
    };
  }
  return {
    ok: true,
    value: rawValue,
  };
}

function resolveWriteEnvelope(blockSpec) {
  const block = normalizeObject(blockSpec);
  const envelope = normalizeObject(block.write_envelope);
  const basedOnReadToken = normalizeString(block.based_on_read_token);
  const executionMode = normalizeString(envelope.execution_mode);
  const idempotencyKey = normalizeString(envelope.idempotency_key);
  const writeAnchorObjectId = normalizeString(envelope.write_anchor_object_id);
  const writeAnchorPath = normalizeString(envelope.write_anchor_path);

  const missing = [];
  if (!basedOnReadToken) {
    missing.push("based_on_read_token");
  }
  if (!executionMode) {
    missing.push("write_envelope.execution_mode");
  }
  if (!idempotencyKey) {
    missing.push("write_envelope.idempotency_key");
  }
  if (!writeAnchorObjectId) {
    missing.push("write_envelope.write_anchor_object_id");
  }
  if (!writeAnchorPath) {
    missing.push("write_envelope.write_anchor_path");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `write envelope fields missing: ${missing.join(", ")}`,
      }),
    };
  }

  return {
    ok: true,
    payload: {
      execution_mode: executionMode,
      idempotency_key: idempotencyKey,
      based_on_read_token: basedOnReadToken,
      write_anchor_object_id: writeAnchorObjectId,
      write_anchor_path: writeAnchorPath,
    },
  };
}

function resolveAnchor(blockSpec, usageLabel) {
  const block = normalizeObject(blockSpec);
  const anchor = normalizeObject(block.target_anchor);
  const objectId = normalizeString(anchor.object_id);
  const path = normalizeString(anchor.path);
  if (!objectId || !path) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `${usageLabel} requires target_anchor.object_id and target_anchor.path`,
      }),
    };
  }
  return {
    ok: true,
    object_id: objectId,
    path,
  };
}

function mapReadSnapshotForWrite(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const payload = {};
  const scopePath = normalizeString(input.scope_path);
  if (scopePath) {
    payload.scope_path = scopePath;
  } else {
    const anchor = normalizeObject(block.target_anchor);
    const anchorPath = normalizeString(anchor.path);
    if (anchorPath) {
      payload.scope_path = anchorPath;
    }
  }
  return {
    ok: true,
    tool_name: "get_scene_snapshot_for_write",
    payload,
  };
}

function mapReadSceneRoots(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const payload = {};
  if (hasBoolean(input.include_inactive)) {
    payload.include_inactive = input.include_inactive;
  }
  const scenePath = normalizeString(input.scene_path);
  if (scenePath) {
    payload.scene_path = scenePath;
  }
  return {
    ok: true,
    tool_name: "get_scene_roots",
    payload,
  };
}

function mapReadSelectionCurrent(_blockSpec) {
  return {
    ok: true,
    tool_name: "get_current_selection",
    payload: {},
  };
}

function mapReadSelectionByComponent(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const componentQueryOutcome = requireStringField(input, "component_query");
  if (!componentQueryOutcome.ok) {
    return componentQueryOutcome;
  }

  const payload = {
    component_query: componentQueryOutcome.value,
  };
  if (hasBoolean(input.include_inactive)) {
    payload.include_inactive = input.include_inactive;
  }
  if (hasFiniteNumber(input.limit)) {
    payload.limit = Number(input.limit);
  }
  const scenePath = normalizeString(input.scene_path);
  if (scenePath) {
    payload.scene_path = scenePath;
  }
  const underPath = normalizeString(input.under_path);
  if (underPath) {
    payload.under_path = underPath;
  }

  return {
    ok: true,
    tool_name: "find_objects_by_component",
    payload,
  };
}

function mapReadComponents(blockSpec) {
  const anchorOutcome = resolveAnchor(blockSpec, "read.components");
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }
  return {
    ok: true,
    tool_name: "get_gameobject_components",
    payload: {
      target_object_id: anchorOutcome.object_id,
      target_path: anchorOutcome.path,
    },
  };
}

function mapReadSerializedPropertyTree(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const anchorOutcome = resolveAnchor(
    blockSpec,
    "read.components.serialized_property_tree"
  );
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }
  const componentType = requireStringField(
    input,
    "component_assembly_qualified_name"
  );
  if (!componentType.ok) {
    return componentType;
  }

  const payload = {
    target_object_id: anchorOutcome.object_id,
    target_path: anchorOutcome.path,
    component_assembly_qualified_name: componentType.value,
  };

  if (hasFiniteNumber(input.component_index)) {
    payload.component_index = Number(input.component_index);
  }
  if (hasFiniteNumber(input.depth)) {
    payload.depth = Number(input.depth);
  }
  if (hasFiniteNumber(input.node_budget)) {
    payload.node_budget = Number(input.node_budget);
  }
  if (hasFiniteNumber(input.page_size)) {
    payload.page_size = Number(input.page_size);
  }
  if (hasFiniteNumber(input.char_budget)) {
    payload.char_budget = Number(input.char_budget);
  }
  if (hasFiniteNumber(input.timeout_ms)) {
    payload.timeout_ms = Number(input.timeout_ms);
  }
  if (hasBoolean(input.include_non_visible)) {
    payload.include_non_visible = input.include_non_visible;
  }
  if (hasBoolean(input.include_value_summary)) {
    payload.include_value_summary = input.include_value_summary;
  }

  const rootPropertyPath = normalizeString(input.root_property_path);
  if (rootPropertyPath) {
    payload.root_property_path = rootPropertyPath;
  }
  const afterPropertyPath = normalizeString(input.after_property_path);
  if (afterPropertyPath) {
    payload.after_property_path = afterPropertyPath;
  }

  return {
    ok: true,
    tool_name: "get_serialized_property_tree",
    payload,
  };
}

function mapReadAssets(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const folderPath = requireStringField(input, "folder_path");
  if (!folderPath.ok) {
    return folderPath;
  }

  const payload = {
    folder_path: folderPath.value,
  };
  if (hasBoolean(input.include_meta)) {
    payload.include_meta = input.include_meta;
  }
  if (hasBoolean(input.recursive)) {
    payload.recursive = input.recursive;
  }
  if (hasFiniteNumber(input.limit)) {
    payload.limit = Number(input.limit);
  }

  return {
    ok: true,
    tool_name: "list_assets_in_folder",
    payload,
  };
}

function mapVerifyLocalBlock(blockSpec) {
  const block = normalizeObject(blockSpec);
  const rawIntentKey = normalizeString(block.intent_key);
  if (!rawIntentKey || !rawIntentKey.startsWith("verify.")) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "E_BLOCK_INTENT_KEY_UNSUPPORTED",
        error_message: `intent_key not supported for block_type VERIFY: ${rawIntentKey}`,
        details: {
          supported_intent_key_pattern: "verify.*",
        },
      }),
    };
  }
  return {
    ok: true,
    tool_name: VERIFY_LOCAL_TOOL_NAME,
    payload: {
      verify_intent_key: rawIntentKey,
      verify_input: normalizeObject(block.input),
    },
  };
}

function mapReadPrefabInfo(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const prefabPath = requireStringField(input, "prefab_path");
  if (!prefabPath.ok) {
    return prefabPath;
  }
  if (!hasFiniteNumber(input.max_depth)) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: "required field missing: input.max_depth",
      }),
    };
  }

  const payload = {
    prefab_path: prefabPath.value,
    max_depth: Number(input.max_depth),
  };
  if (hasFiniteNumber(input.char_budget)) {
    payload.char_budget = Number(input.char_budget);
  }
  if (hasFiniteNumber(input.node_budget)) {
    payload.node_budget = Number(input.node_budget);
  }
  if (hasBoolean(input.include_components)) {
    payload.include_components = input.include_components;
  }
  if (hasBoolean(input.include_missing_scripts)) {
    payload.include_missing_scripts = input.include_missing_scripts;
  }

  return {
    ok: true,
    tool_name: "query_prefab_info",
    payload,
  };
}

function mapReadHierarchySubtree(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const anchorOutcome = resolveAnchor(blockSpec, "read.hierarchy_subtree");
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }
  const payload = {
    target_object_id: anchorOutcome.object_id,
    target_path: anchorOutcome.path,
  };
  if (hasFiniteNumber(input.depth)) {
    payload.depth = Number(input.depth);
  }
  if (hasFiniteNumber(input.node_budget)) {
    payload.node_budget = Number(input.node_budget);
  }
  if (hasFiniteNumber(input.char_budget)) {
    payload.char_budget = Number(input.char_budget);
  }
  return {
    ok: true,
    tool_name: "get_hierarchy_subtree",
    payload,
  };
}

function mapCreateObject(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }
  const parentAnchorOutcome = resolveAnchor(blockSpec, "create.object");
  if (!parentAnchorOutcome.ok) {
    return parentAnchorOutcome;
  }

  const newObjectNameOutcome = requireStringField(input, "new_object_name");
  if (!newObjectNameOutcome.ok) {
    return newObjectNameOutcome;
  }
  const objectKindOutcome = requireStringField(input, "object_kind");
  if (!objectKindOutcome.ok) {
    return objectKindOutcome;
  }
  if (!hasBoolean(input.set_active)) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: "required field missing: input.set_active (boolean)",
      }),
    };
  }

  const payload = {
    ...envelopeOutcome.payload,
    parent_object_id: parentAnchorOutcome.object_id,
    parent_path: parentAnchorOutcome.path,
    new_object_name: newObjectNameOutcome.value,
    object_kind: objectKindOutcome.value,
    set_active: input.set_active,
  };
  if (Object.prototype.hasOwnProperty.call(input, "name_collision_policy")) {
    const nameCollisionPolicy = normalizeString(input.name_collision_policy);
    if (!nameCollisionPolicy) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message:
            "input.name_collision_policy must be a non-empty string when provided",
        }),
      };
    }
    payload.name_collision_policy = nameCollisionPolicy;
  }
  return {
    ok: true,
    tool_name: "create_object",
    payload,
  };
}

function mapMutateComponentProperties(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }
  const anchorOutcome = resolveAnchor(blockSpec, "mutate.component_properties");
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }

  const componentType = requireStringField(input, "component_type");
  if (!componentType.ok) {
    return componentType;
  }
  const propertyPath = requireStringField(input, "property_path");
  if (!propertyPath.ok) {
    return propertyPath;
  }
  const valueKind = normalizeString(input.value_kind);
  if (!["string", "number", "boolean"].includes(valueKind)) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message:
          "input.value_kind must be one of: string, number, boolean",
      }),
    };
  }

  const payload = {
    ...envelopeOutcome.payload,
    target_object_id: anchorOutcome.object_id,
    target_path: anchorOutcome.path,
    component_type: componentType.value,
    property_path: propertyPath.value,
    value_kind: valueKind,
  };

  if (valueKind === "string") {
    if (!Object.prototype.hasOwnProperty.call(input, "value_string")) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: "required field missing: input.value_string",
        }),
      };
    }
    payload.value_string = String(input.value_string);
  } else if (valueKind === "number") {
    if (!hasFiniteNumber(input.value_number)) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: "required field missing: input.value_number",
        }),
      };
    }
    payload.value_number = Number(input.value_number);
  } else if (valueKind === "boolean") {
    if (!hasBoolean(input.value_boolean)) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: "required field missing: input.value_boolean",
        }),
      };
    }
    payload.value_boolean = input.value_boolean;
  }

  return {
    ok: true,
    tool_name: "set_component_properties",
    payload,
  };
}

function mapMutateUiLayout(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }
  const anchorOutcome = resolveAnchor(blockSpec, "mutate.ui_layout");
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }

  const requiredNumberFields = ["anchored_x", "anchored_y", "width", "height"];
  for (const fieldName of requiredNumberFields) {
    if (!hasFiniteNumber(input[fieldName])) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: `required field missing: input.${fieldName}`,
        }),
      };
    }
  }

  return {
    ok: true,
    tool_name: "modify_ui_layout",
    payload: {
      ...envelopeOutcome.payload,
      target_object_id: anchorOutcome.object_id,
      target_path: anchorOutcome.path,
      anchored_x: Number(input.anchored_x),
      anchored_y: Number(input.anchored_y),
      width: Number(input.width),
      height: Number(input.height),
    },
  };
}

function mapMutateSetActive(blockSpec) {
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }
  const anchorOutcome = resolveAnchor(blockSpec, "mutate.set_active");
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }
  const input = normalizeObject(blockSpec && blockSpec.input);
  if (!hasBoolean(input.active)) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: "required field missing: input.active (boolean)",
      }),
    };
  }
  return {
    ok: true,
    tool_name: "set_active",
    payload: {
      ...envelopeOutcome.payload,
      target_object_id: anchorOutcome.object_id,
      target_path: anchorOutcome.path,
      active: input.active,
    },
  };
}

function mapMutateWriteWithFieldPolicy(blockSpec, mappingConfig) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const config = normalizeObject(mappingConfig);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }
  const usageLabel = normalizeString(config.usage_label) || "write.rect_layout";
  const anchorOutcome = resolveAnchor(blockSpec, usageLabel);
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }
  const toolName = normalizeString(config.tool_name);
  if (!toolName) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_PRECONDITION_FAILED",
        block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
        error_message: `${usageLabel} tool_name missing`,
      }),
    };
  }

  const requiredNumberFields = Array.isArray(config.required_number_fields)
    ? config.required_number_fields
    : [];
  const payload = {
    ...envelopeOutcome.payload,
    target_object_id: anchorOutcome.object_id,
    target_path: anchorOutcome.path,
  };
  for (const fieldNameRaw of requiredNumberFields) {
    const fieldName = normalizeString(fieldNameRaw);
    if (!fieldName) {
      continue;
    }
    const numberOutcome = requireFiniteNumberField(
      input,
      fieldName,
      `input.${fieldName}`
    );
    if (!numberOutcome.ok) {
      return numberOutcome;
    }
    payload[fieldName] = numberOutcome.value;
  }

  const requiredBooleanFields = Array.isArray(config.required_boolean_fields)
    ? config.required_boolean_fields
    : [];
  for (const fieldNameRaw of requiredBooleanFields) {
    const fieldName = normalizeString(fieldNameRaw);
    if (!fieldName) {
      continue;
    }
    const boolOutcome = requireBooleanField(
      input,
      fieldName,
      `input.${fieldName}`
    );
    if (!boolOutcome.ok) {
      return boolOutcome;
    }
    payload[fieldName] = boolOutcome.value;
  }

  const requiredStringFields = Array.isArray(config.required_string_fields)
    ? config.required_string_fields
    : [];
  for (const fieldNameRaw of requiredStringFields) {
    const fieldName = normalizeString(fieldNameRaw);
    if (!fieldName) {
      continue;
    }
    const stringOutcome = requireStringTypeField(
      input,
      fieldName,
      `input.${fieldName}`
    );
    if (!stringOutcome.ok) {
      return stringOutcome;
    }
    payload[fieldName] = stringOutcome.value;
  }

  return {
    ok: true,
    tool_name: toolName,
    payload,
  };
}

function mapWriteRectLayoutAnchoredPosition(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.rect_layout.anchored_position",
    tool_name: "set_rect_anchored_position",
    required_number_fields: ["x", "y"],
  });
}

function mapWriteRectLayoutSizeDelta(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.rect_layout.size_delta",
    tool_name: "set_rect_size_delta",
    required_number_fields: ["x", "y"],
  });
}

function mapWriteRectLayoutPivot(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.rect_layout.pivot",
    tool_name: "set_rect_pivot",
    required_number_fields: ["x", "y"],
  });
}

function mapWriteRectLayoutAnchors(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.rect_layout.anchors",
    tool_name: "set_rect_anchors",
    required_number_fields: ["min_x", "min_y", "max_x", "max_y"],
  });
}

function mapWriteRectLayoutElement(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.rect_layout.layout_element",
    tool_name: "set_layout_element",
    required_number_fields: [
      "min_width",
      "min_height",
      "preferred_width",
      "preferred_height",
      "flexible_width",
      "flexible_height",
    ],
    required_boolean_fields: ["ignore_layout"],
  });
}

function mapWriteUiStyleCanvasGroupAlpha(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.ui_style.canvas_group_alpha",
    tool_name: "set_canvas_group_alpha",
    required_number_fields: ["alpha"],
  });
}

function mapWriteUiStyleImageColor(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.ui_style.image_color",
    tool_name: "set_ui_image_color",
    required_number_fields: ["r", "g", "b", "a"],
  });
}

function mapWriteUiStyleImageRaycastTarget(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.ui_style.image_raycast_target",
    tool_name: "set_ui_image_raycast_target",
    required_boolean_fields: ["raycast_target"],
  });
}

function mapWriteUiStyleTextContent(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.ui_style.text_content",
    tool_name: "set_ui_text_content",
    required_string_fields: ["text"],
  });
}

function mapWriteUiStyleTextColor(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.ui_style.text_color",
    tool_name: "set_ui_text_color",
    required_number_fields: ["r", "g", "b", "a"],
  });
}

function mapWriteUiStyleTextFontSize(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.ui_style.text_font_size",
    tool_name: "set_ui_text_font_size",
    required_number_fields: ["font_size"],
  });
}

function mapWriteTransformLocalPosition(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.transform.local.position",
    tool_name: "set_local_position",
    required_number_fields: ["x", "y", "z"],
  });
}

function mapWriteTransformLocalRotation(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.transform.local.rotation",
    tool_name: "set_local_rotation",
    required_number_fields: ["x", "y", "z"],
  });
}

function mapWriteTransformLocalScale(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.transform.local.scale",
    tool_name: "set_local_scale",
    required_number_fields: ["x", "y", "z"],
  });
}

function mapWriteTransformLocalReset(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.transform.local.reset",
    tool_name: "reset_transform",
  });
}

function mapWriteTransformWorldPosition(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.transform.world.position",
    tool_name: "set_world_position",
    required_number_fields: ["x", "y", "z"],
  });
}

function mapWriteTransformWorldRotation(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.transform.world.rotation",
    tool_name: "set_world_rotation",
    required_number_fields: ["x", "y", "z"],
  });
}

function mapWriteHierarchyParent(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.hierarchy.parent",
    tool_name: "set_parent",
    required_string_fields: ["parent_object_id", "parent_path"],
  });
}

function mapWriteHierarchySiblingIndex(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }
  const anchorOutcome = resolveAnchor(blockSpec, "write.hierarchy.sibling_index");
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }
  const siblingIndexOutcome = requireNonNegativeIntegerField(
    input,
    "sibling_index",
    "input.sibling_index"
  );
  if (!siblingIndexOutcome.ok) {
    return siblingIndexOutcome;
  }
  return {
    ok: true,
    tool_name: "set_sibling_index",
    payload: {
      ...envelopeOutcome.payload,
      target_object_id: anchorOutcome.object_id,
      target_path: anchorOutcome.path,
      sibling_index: siblingIndexOutcome.value,
    },
  };
}

function mapWriteComponentLifecycleAddComponent(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.component_lifecycle.add_component",
    tool_name: "add_component",
    required_string_fields: ["component_type"],
  });
}

function mapWriteComponentLifecycleRemoveComponent(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.component_lifecycle.remove_component",
    tool_name: "remove_component",
    required_string_fields: ["component_type"],
  });
}

function mapWriteComponentLifecycleReplaceComponent(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.component_lifecycle.replace_component",
    tool_name: "replace_component",
    required_string_fields: ["source_component_type", "new_component_type"],
  });
}

function mapWriteObjectLifecycleRenameObject(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.object_lifecycle.rename_object",
    tool_name: "rename_object",
    required_string_fields: ["new_name"],
  });
}

function mapWriteObjectLifecycleDeleteObject(blockSpec) {
  return mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.object_lifecycle.delete_object",
    tool_name: "delete_object",
  });
}

function mapWriteObjectLifecycleDuplicateObject(blockSpec) {
  const baseOutcome = mapMutateWriteWithFieldPolicy(blockSpec, {
    usage_label: "write.object_lifecycle.duplicate_object",
    tool_name: "duplicate_object",
  });
  if (!baseOutcome.ok) {
    return baseOutcome;
  }

  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  if (Object.prototype.hasOwnProperty.call(input, "duplicate_name")) {
    const duplicateNameOutcome = requireStringField(input, "duplicate_name");
    if (!duplicateNameOutcome.ok) {
      return duplicateNameOutcome;
    }
    baseOutcome.payload.duplicate_name = duplicateNameOutcome.value;
  }

  return baseOutcome;
}

function mapWriteTransactionExecute(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }

  const transactionIdOutcome = requireStringField(input, "transaction_id");
  if (!transactionIdOutcome.ok) {
    return transactionIdOutcome;
  }

  const steps = input.steps;
  if (!Array.isArray(steps) || steps.length < 1) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: "required field missing: input.steps (non-empty array)",
      }),
    };
  }

  return {
    ok: true,
    tool_name: "execute_unity_transaction",
    payload: {
      ...envelopeOutcome.payload,
      transaction_id: transactionIdOutcome.value,
      steps,
    },
  };
}

function mapWriteScenePersistenceSaveScene(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }

  const payload = {
    ...envelopeOutcome.payload,
  };
  if (Object.prototype.hasOwnProperty.call(input, "scene_path")) {
    const scenePathOutcome = requireStringField(input, "scene_path");
    if (!scenePathOutcome.ok) {
      return scenePathOutcome;
    }
    payload.scene_path = scenePathOutcome.value;
  }
  if (hasBoolean(input.save_as_new)) {
    payload.save_as_new = input.save_as_new;
  }

  return {
    ok: true,
    tool_name: "save_scene",
    payload,
  };
}

function mapWriteScenePersistenceSavePrefab(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }
  const anchorOutcome = resolveAnchor(blockSpec, "write.scene_persistence.save_prefab");
  if (!anchorOutcome.ok) {
    return anchorOutcome;
  }

  const payload = {
    ...envelopeOutcome.payload,
    target_object_id: anchorOutcome.object_id,
    target_path: anchorOutcome.path,
  };
  if (Object.prototype.hasOwnProperty.call(input, "prefab_path")) {
    const prefabPathOutcome = requireStringField(input, "prefab_path");
    if (!prefabPathOutcome.ok) {
      return prefabPathOutcome;
    }
    payload.prefab_path = prefabPathOutcome.value;
  }
  if (hasBoolean(input.save_as_new)) {
    payload.save_as_new = input.save_as_new;
  }

  return {
    ok: true,
    tool_name: "save_prefab",
    payload,
  };
}

const FILE_ACTION_TYPE_ALIAS = Object.freeze({
  create_or_update_script: "write_file",
  create_script: "create_file",
  update_script: "update_file",
  delete_script: "delete_file",
  rename_script: "rename_file",
  move_script: "move_file",
});

function normalizeActionTypeWithAlias(rawType) {
  const normalizedType = normalizeString(rawType);
  if (!normalizedType) {
    return "";
  }
  const aliasKey = normalizedType.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(FILE_ACTION_TYPE_ALIAS, aliasKey)) {
    return FILE_ACTION_TYPE_ALIAS[aliasKey];
  }
  return normalizedType;
}

function stringifySubmitTaskActionItem(item, label, index) {
  try {
    const text = JSON.stringify(item);
    if (!normalizeString(text)) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: `${label}[${index}] cannot be stringified to JSON`,
        }),
      };
    }
    return {
      ok: true,
      value: text,
    };
  } catch (_error) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `${label}[${index}] contains non-serializable data`,
      }),
    };
  }
}

function normalizeSubmitTaskFileActionItem(rawItem, index) {
  if (typeof rawItem === "string") {
    const normalized = normalizeString(rawItem);
    if (!normalized) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: `input.file_actions[${index}] must not be empty`,
        }),
      };
    }
    return {
      ok: true,
      value: normalized,
    };
  }
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: `input.file_actions[${index}] must be object or JSON string`,
      }),
    };
  }
  const source = normalizeObject(rawItem);
  const actionType =
    normalizeActionTypeWithAlias(source.type) ||
    normalizeActionTypeWithAlias(source.action);
  const normalized = {
    ...source,
  };
  if (actionType) {
    normalized.type = actionType;
  }
  const stringified = stringifySubmitTaskActionItem(
    normalized,
    "input.file_actions",
    index
  );
  if (!stringified.ok) {
    return stringified;
  }
  return {
    ok: true,
    value: stringified.value,
  };
}

function normalizeSubmitTaskVisualActionItem(rawItem, index) {
  if (typeof rawItem === "string") {
    const normalized = normalizeString(rawItem);
    if (!normalized) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: `input.visual_layer_actions[${index}] must not be empty`,
        }),
      };
    }
    return {
      ok: true,
      value: normalized,
    };
  }
  if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem)) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message:
          `input.visual_layer_actions[${index}] must be object or JSON string`,
      }),
    };
  }

  const source = normalizeObject(rawItem);
  const actionType = normalizeString(source.type) || normalizeString(source.action);
  const componentAssemblyQualifiedName =
    normalizeString(source.component_assembly_qualified_name) ||
    normalizeString(source.component_type);
  const sourceTargetAnchor = normalizeObject(source.target_anchor);
  const targetAnchorObjectId =
    normalizeString(sourceTargetAnchor.object_id) ||
    normalizeString(source.target_object_id);
  const targetAnchorPath =
    normalizeString(sourceTargetAnchor.path) || normalizeString(source.target_path);

  const normalized = {
    ...source,
  };
  if (actionType) {
    normalized.type = actionType;
  }
  if (componentAssemblyQualifiedName) {
    normalized.component_assembly_qualified_name = componentAssemblyQualifiedName;
  }
  if (targetAnchorObjectId || targetAnchorPath) {
    normalized.target_anchor = {
      ...(targetAnchorObjectId ? { object_id: targetAnchorObjectId } : {}),
      ...(targetAnchorPath ? { path: targetAnchorPath } : {}),
    };
  }

  const stringified = stringifySubmitTaskActionItem(
    normalized,
    "input.visual_layer_actions",
    index
  );
  if (!stringified.ok) {
    return stringified;
  }
  return {
    ok: true,
    value: stringified.value,
  };
}

function normalizeSubmitTaskActions(rawActions, fieldName) {
  const values = Array.isArray(rawActions) ? rawActions : [];
  const output = [];
  const isVisual = fieldName === "visual_layer_actions";
  for (let index = 0; index < values.length; index += 1) {
    const item = values[index];
    const outcome = isVisual
      ? normalizeSubmitTaskVisualActionItem(item, index)
      : normalizeSubmitTaskFileActionItem(item, index);
    if (!outcome.ok) {
      return outcome;
    }
    output.push(outcome.value);
  }
  return {
    ok: true,
    values: output,
  };
}

function mapWriteAsyncOpsSubmitTask(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const envelopeOutcome = resolveWriteEnvelope(blockSpec);
  if (!envelopeOutcome.ok) {
    return envelopeOutcome;
  }

  const threadIdOutcome = requireStringField(input, "thread_id");
  if (!threadIdOutcome.ok) {
    return threadIdOutcome;
  }
  const userIntentOutcome = requireStringField(input, "user_intent");
  if (!userIntentOutcome.ok) {
    return userIntentOutcome;
  }

  const hasFileActions = Object.prototype.hasOwnProperty.call(input, "file_actions");
  const hasVisualLayerActions = Object.prototype.hasOwnProperty.call(
    input,
    "visual_layer_actions"
  );
  if (hasFileActions === hasVisualLayerActions) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message:
          "input must contain exactly one of file_actions or visual_layer_actions",
      }),
    };
  }

  const payload = {
    thread_id: threadIdOutcome.value,
    idempotency_key: envelopeOutcome.payload.idempotency_key,
    user_intent: userIntentOutcome.value,
    based_on_read_token: envelopeOutcome.payload.based_on_read_token,
    write_anchor: {
      object_id: envelopeOutcome.payload.write_anchor_object_id,
      path: envelopeOutcome.payload.write_anchor_path,
    },
  };

  if (hasFileActions) {
    if (!Array.isArray(input.file_actions)) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: "required field missing: input.file_actions (array)",
        }),
      };
    }
    const normalizedFileActions = normalizeSubmitTaskActions(
      input.file_actions,
      "file_actions"
    );
    if (!normalizedFileActions.ok) {
      return normalizedFileActions;
    }
    payload.file_actions = normalizedFileActions.values;
  } else {
    if (!Array.isArray(input.visual_layer_actions)) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message:
            "required field missing: input.visual_layer_actions (array)",
        }),
      };
    }
    const normalizedVisualActions = normalizeSubmitTaskActions(
      input.visual_layer_actions,
      "visual_layer_actions"
    );
    if (!normalizedVisualActions.ok) {
      return normalizedVisualActions;
    }
    payload.visual_layer_actions = normalizedVisualActions.values;
  }

  if (Object.prototype.hasOwnProperty.call(input, "approval_mode")) {
    const approvalModeOutcome = requireStringField(input, "approval_mode");
    if (!approvalModeOutcome.ok) {
      return approvalModeOutcome;
    }
    payload.approval_mode = approvalModeOutcome.value;
  }
  if (Object.prototype.hasOwnProperty.call(input, "context")) {
    const contextValue = input.context;
    if (!contextValue || typeof contextValue !== "object" || Array.isArray(contextValue)) {
      return {
        ok: false,
        error: buildMapperError({
          error_code: "E_SCHEMA_INVALID",
          block_error_code: "",
          error_message: "input.context must be object",
        }),
      };
    }
    payload.context = contextValue;
  }

  return {
    ok: true,
    tool_name: "submit_unity_task",
    payload,
  };
}

function mapWriteAsyncOpsGetTaskStatus(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const jobIdOutcome = requireStringField(input, "job_id");
  if (!jobIdOutcome.ok) {
    return jobIdOutcome;
  }

  const payload = {
    job_id: jobIdOutcome.value,
  };
  if (Object.prototype.hasOwnProperty.call(input, "thread_id")) {
    const threadIdOutcome = requireStringField(input, "thread_id");
    if (!threadIdOutcome.ok) {
      return threadIdOutcome;
    }
    payload.thread_id = threadIdOutcome.value;
  }

  return {
    ok: true,
    tool_name: "get_unity_task_status",
    payload,
  };
}

function mapWriteAsyncOpsCancelTask(blockSpec) {
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const jobIdOutcome = requireStringField(input, "job_id");
  if (!jobIdOutcome.ok) {
    return jobIdOutcome;
  }

  const payload = {
    job_id: jobIdOutcome.value,
  };
  if (Object.prototype.hasOwnProperty.call(input, "thread_id")) {
    const threadIdOutcome = requireStringField(input, "thread_id");
    if (!threadIdOutcome.ok) {
      return threadIdOutcome;
    }
    payload.thread_id = threadIdOutcome.value;
  }

  return {
    ok: true,
    tool_name: "cancel_unity_task",
    payload,
  };
}

const FAMILY_PRIMARY_PLAN_BUILDER_BY_ID = Object.freeze({
  "read.selection.current": mapReadSelectionCurrent,
  "read.selection.by_component": mapReadSelectionByComponent,
  "read.snapshot_for_write": mapReadSnapshotForWrite,
  "read.scene_roots": mapReadSceneRoots,
  "read.components": mapReadComponents,
  "read.components.serialized_property_tree": mapReadSerializedPropertyTree,
  "read.assets": mapReadAssets,
  "read.assets.prefab_info": mapReadPrefabInfo,
  "read.hierarchy_subtree": mapReadHierarchySubtree,
  "create.object": mapCreateObject,
  "mutate.component_properties": mapMutateComponentProperties,
  "mutate.ui_layout": mapMutateUiLayout,
  "mutate.set_active": mapMutateSetActive,
  "write.rect_layout.anchored_position": mapWriteRectLayoutAnchoredPosition,
  "write.rect_layout.size_delta": mapWriteRectLayoutSizeDelta,
  "write.rect_layout.pivot": mapWriteRectLayoutPivot,
  "write.rect_layout.anchors": mapWriteRectLayoutAnchors,
  "write.rect_layout.layout_element": mapWriteRectLayoutElement,
  "write.ui_style.canvas_group_alpha": mapWriteUiStyleCanvasGroupAlpha,
  "write.ui_style.image_color": mapWriteUiStyleImageColor,
  "write.ui_style.image_raycast_target": mapWriteUiStyleImageRaycastTarget,
  "write.ui_style.text_content": mapWriteUiStyleTextContent,
  "write.ui_style.text_color": mapWriteUiStyleTextColor,
  "write.ui_style.text_font_size": mapWriteUiStyleTextFontSize,
  "write.transform.local.position": mapWriteTransformLocalPosition,
  "write.transform.local.rotation": mapWriteTransformLocalRotation,
  "write.transform.local.scale": mapWriteTransformLocalScale,
  "write.transform.local.reset": mapWriteTransformLocalReset,
  "write.transform.world.position": mapWriteTransformWorldPosition,
  "write.transform.world.rotation": mapWriteTransformWorldRotation,
  "write.hierarchy.parent": mapWriteHierarchyParent,
  "write.hierarchy.sibling_index": mapWriteHierarchySiblingIndex,
  "write.component_lifecycle.add_component":
    mapWriteComponentLifecycleAddComponent,
  "write.component_lifecycle.remove_component":
    mapWriteComponentLifecycleRemoveComponent,
  "write.component_lifecycle.replace_component":
    mapWriteComponentLifecycleReplaceComponent,
  "write.object_lifecycle.rename_object": mapWriteObjectLifecycleRenameObject,
  "write.object_lifecycle.delete_object": mapWriteObjectLifecycleDeleteObject,
  "write.object_lifecycle.duplicate_object":
    mapWriteObjectLifecycleDuplicateObject,
  "write.transaction.execute": mapWriteTransactionExecute,
  "write.scene_persistence.save_scene": mapWriteScenePersistenceSaveScene,
  "write.scene_persistence.save_prefab": mapWriteScenePersistenceSavePrefab,
  "write.async_ops.submit_task": mapWriteAsyncOpsSubmitTask,
  "write.async_ops.get_task_status": mapWriteAsyncOpsGetTaskStatus,
  "write.async_ops.cancel_task": mapWriteAsyncOpsCancelTask,
});

function normalizeFallbackPolicy(profile) {
  const fallback = normalizeObject(profile && profile.fallback);
  const mode = normalizeString(fallback.mode) || "disabled";
  const trigger = normalizeString(fallback.trigger) || "never";
  const tools = Array.isArray(fallback.tools)
    ? fallback.tools
        .map((item) => normalizeString(item))
        .filter((item) => !!item)
    : [];
  return {
    mode,
    trigger,
    tools,
  };
}

function isLegacyConcreteKeyCompatEnabled(options = {}) {
  const source = normalizeObject(options);
  if (typeof source.legacy_intent_compat_enabled === "boolean") {
    return source.legacy_intent_compat_enabled;
  }
  const envValue = normalizeString(
    process.env[LEGACY_INTENT_COMPAT_POLICY.env_key]
  ).toLowerCase();
  if (!envValue) {
    return LEGACY_INTENT_COMPAT_POLICY.default_enabled;
  }
  if (LEGACY_INTENT_COMPAT_POLICY.enabled_values.includes(envValue)) {
    return true;
  }
  if (LEGACY_INTENT_COMPAT_POLICY.disabled_values.includes(envValue)) {
    return false;
  }
  return LEGACY_INTENT_COMPAT_POLICY.default_enabled;
}

function resolveDisabledFamilyKeySet(options = {}) {
  const source = normalizeObject(options);
  if (Array.isArray(source.disabled_family_keys) || typeof source.disabled_family_keys === "string") {
    return normalizeCsvSet(source.disabled_family_keys);
  }
  const envValue = normalizeString(process.env[FAMILY_MAPPING_ROLLBACK_POLICY.env_key]);
  return normalizeCsvSet(envValue);
}

function isFamilyKeyDisabled(disabledFamilyKeySet, familyKey) {
  const normalizedFamilyKey = normalizeString(familyKey);
  if (!normalizedFamilyKey || !(disabledFamilyKeySet instanceof Set)) {
    return false;
  }
  if (disabledFamilyKeySet.has(normalizedFamilyKey)) {
    return true;
  }
  for (const disabledEntryRaw of disabledFamilyKeySet.values()) {
    const disabledEntry = normalizeString(disabledEntryRaw);
    if (!disabledEntry) {
      continue;
    }
    if (normalizedFamilyKey.startsWith(`${disabledEntry}.`)) {
      return true;
    }
  }
  return false;
}

function buildUnsupportedIntentKeyError({
  blockType,
  rawIntentKey,
  compatEnabled,
}) {
  const familyMap = normalizeObject(
    FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[blockType]
  );
  const legacyMap = normalizeObject(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[blockType]
  );
  const supportedFamilyKeys = Object.keys(familyMap);
  const supportedLegacyKeys = compatEnabled ? Object.keys(legacyMap) : [];
  const modeLabel = compatEnabled ? "family_key + legacy_concrete_key" : "family_key";
  return buildMapperError({
    error_code: "E_SCHEMA_INVALID",
    block_error_code: "E_BLOCK_INTENT_KEY_UNSUPPORTED",
    error_message: `intent_key not supported for block_type ${blockType}: ${rawIntentKey} (expected ${modeLabel})`,
      details: {
      supported_family_keys: supportedFamilyKeys,
      supported_legacy_concrete_keys: supportedLegacyKeys,
      compat_enabled: compatEnabled,
      legacy_to_family_to_tool_matrix: LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE[blockType] || {},
    },
  });
}

function buildFamilyMappingDisabledError({
  blockType,
  rawIntentKey,
  familyKey,
  intentKeySource,
}) {
  return buildMapperError({
    error_code: "E_PRECONDITION_FAILED",
    block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
    error_message: `family mapping disabled by rollback policy: ${blockType}/${familyKey}`,
    details: {
      block_type: blockType,
      raw_intent_key: rawIntentKey,
      family_key: familyKey,
      intent_key_source: intentKeySource,
      rollback_policy: "family_disabled",
    },
  });
}

function resolveMappingByIntent(blockSpec, options = {}) {
  const block = normalizeObject(blockSpec);
  const blockType = normalizeString(block.block_type);
  const rawIntentKey = normalizeString(block.intent_key);
  const familyMap = FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[blockType];
  if (!familyMap) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_PRECONDITION_FAILED",
        block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
      error_message: `block_type not supported by StepB mapper: ${blockType}`,
      }),
    };
  }

  const resolvedFromFamilyToolName = familyMap[rawIntentKey];
  if (resolvedFromFamilyToolName) {
    const disabledFamilyKeySet = resolveDisabledFamilyKeySet(options);
    if (isFamilyKeyDisabled(disabledFamilyKeySet, rawIntentKey)) {
      return {
        ok: false,
        error: buildFamilyMappingDisabledError({
          blockType,
          rawIntentKey,
          familyKey: rawIntentKey,
          intentKeySource: INTENT_KEY_SOURCE.FAMILY_KEY,
        }),
      };
    }
    return {
      ok: true,
      block_type: blockType,
      raw_intent_key: rawIntentKey,
      family_key: rawIntentKey,
      intent_key_source: INTENT_KEY_SOURCE.FAMILY_KEY,
      tool_name: resolvedFromFamilyToolName,
      compat_enabled: isLegacyConcreteKeyCompatEnabled(options),
    };
  }

  const compatEnabled = isLegacyConcreteKeyCompatEnabled(options);
  const legacyMap = LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[blockType];
  if (!compatEnabled || !legacyMap) {
    return {
      ok: false,
      error: buildUnsupportedIntentKeyError({
        blockType,
        rawIntentKey,
        compatEnabled,
      }),
    };
  }

  const resolvedFamilyKey = legacyMap[rawIntentKey];
  if (!resolvedFamilyKey) {
    return {
      ok: false,
      error: buildUnsupportedIntentKeyError({
        blockType,
        rawIntentKey,
        compatEnabled,
      }),
    };
  }

  const resolvedToolName = familyMap[resolvedFamilyKey];
  if (!resolvedToolName) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_PRECONDITION_FAILED",
        block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
        error_message: `legacy intent mapping drift for block_type ${blockType}: ${rawIntentKey} -> ${resolvedFamilyKey}`,
      }),
    };
  }

  const disabledFamilyKeySet = resolveDisabledFamilyKeySet(options);
  if (isFamilyKeyDisabled(disabledFamilyKeySet, resolvedFamilyKey)) {
    return {
      ok: false,
      error: buildFamilyMappingDisabledError({
        blockType,
        rawIntentKey,
        familyKey: resolvedFamilyKey,
        intentKeySource: INTENT_KEY_SOURCE.LEGACY_CONCRETE_KEY,
      }),
    };
  }

  return {
    ok: true,
    block_type: blockType,
    raw_intent_key: rawIntentKey,
    family_key: resolvedFamilyKey,
    intent_key_source: INTENT_KEY_SOURCE.LEGACY_CONCRETE_KEY,
    tool_name: resolvedToolName,
    legacy_concrete_key: rawIntentKey,
    compat_enabled: compatEnabled,
  };
}

function mapBlockSpecToToolPlan(blockSpec, options = {}) {
  const schemaOutcome = validateBlockSpec(blockSpec);
  if (!schemaOutcome.ok) {
    return buildMapperError({
      error_code: "E_SCHEMA_INVALID",
      block_error_code: "",
      error_message: "BlockSpec schema validation failed",
      details: schemaOutcome.errors,
    });
  }

  const block = normalizeObject(blockSpec);
  const blockType = normalizeString(block.block_type);
  if (blockType === BLOCK_TYPE.VERIFY) {
    const verifyOutcome = mapVerifyLocalBlock(blockSpec);
    if (!verifyOutcome.ok) {
      return verifyOutcome.error;
    }
    const rawIntentKey = normalizeString(block.intent_key);
    return {
      ok: true,
      tool_name: verifyOutcome.tool_name,
      payload: verifyOutcome.payload,
      mapping_meta: {
        mapper_version: MAPPING_VERSION,
        block_type: blockType,
        intent_key: rawIntentKey,
        family_key: "verify.local",
        primary_tool_name: VERIFY_LOCAL_TOOL_NAME,
        selected_tool_name: VERIFY_LOCAL_TOOL_NAME,
        raw_intent_key: rawIntentKey,
        intent_key_source: INTENT_KEY_SOURCE.FAMILY_KEY,
        legacy_intent_compat_enabled: false,
        fallback_policy_mode: "disabled",
        fallback_trigger: "never",
        fallback_candidates: [],
        fallback_attempted: false,
        fallback_used: false,
        family_mapping_state: "active_local",
        execution_backend_role: EXECUTION_BACKEND_ROLE.LOCAL_VERIFY_RUNTIME,
      },
    };
  }

  const mappingOutcome = resolveMappingByIntent(blockSpec, options);
  if (!mappingOutcome.ok) {
    return mappingOutcome.error;
  }

  const mappedBlockType = mappingOutcome.block_type;
  const familyKey = mappingOutcome.family_key;
  const familyProfile = getFamilyToolProfile(mappedBlockType, familyKey);
  if (!familyProfile) {
    return buildMapperError({
      error_code: "E_PRECONDITION_FAILED",
      block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
      error_message: `family profile missing for mapper: ${mappedBlockType}/${familyKey}`,
    });
  }
  const primaryToolName = normalizeString(familyProfile.primary_tool);
  const mapperId = normalizeString(familyProfile.mapper_id);
  const primaryBuilder = FAMILY_PRIMARY_PLAN_BUILDER_BY_ID[mapperId];
  if (typeof primaryBuilder !== "function") {
    return buildMapperError({
      error_code: "E_PRECONDITION_FAILED",
      block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
      error_message: `family mapper not implemented: ${mappedBlockType}/${familyKey}/${mapperId}`,
    });
  }

  const primaryOutcome = primaryBuilder(blockSpec);
  const fallbackPolicyRaw = normalizeFallbackPolicy(familyProfile);
  if (!primaryOutcome.ok) {
    return primaryOutcome.error;
  }
  if (normalizeString(primaryOutcome.tool_name) !== primaryToolName) {
    return buildMapperError({
      error_code: "E_PRECONDITION_FAILED",
      block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
      error_message: `family primary tool drift: ${mappedBlockType}/${familyKey} -> ${primaryOutcome.tool_name} expected ${primaryToolName}`,
    });
  }
  const fallbackGuardDecision = evaluateFallbackPolicyGuard(
    {
      family_key: familyKey,
      fallback_policy: fallbackPolicyRaw,
    },
    options
  );
  if (!fallbackGuardDecision.ok) {
    return fallbackGuardDecision.error;
  }
  const fallbackPolicy = normalizeObject(fallbackGuardDecision.fallback_policy);
  const sourceCapabilityFamily = normalizeString(
    fallbackGuardDecision.source_capability_family
  );
  const fallbackGuardState = normalizeString(fallbackGuardDecision.guard_state);

  return {
    ok: true,
    tool_name: primaryOutcome.tool_name,
    payload: primaryOutcome.payload,
    mapping_meta: {
      mapper_version: MAPPING_VERSION,
      block_type: mappedBlockType,
      intent_key: familyKey,
      family_key: familyKey,
      primary_tool_name: primaryToolName,
      selected_tool_name: primaryToolName,
      raw_intent_key: mappingOutcome.raw_intent_key,
      intent_key_source: mappingOutcome.intent_key_source,
      legacy_intent_compat_enabled: mappingOutcome.compat_enabled === true,
      fallback_policy_mode: fallbackPolicy.mode,
      fallback_trigger: fallbackPolicy.trigger,
      fallback_candidates: fallbackPolicy.tools,
      fallback_attempted: false,
      fallback_used: false,
      source_capability_family: sourceCapabilityFamily,
      fallback_guard_state: fallbackGuardState,
      family_mapping_state: "active",
      execution_backend_role: EXECUTION_BACKEND_ROLE.INTERNAL_DIRECT_RUNTIME,
      ...(mappingOutcome.legacy_concrete_key
        ? { legacy_concrete_key: mappingOutcome.legacy_concrete_key }
        : {}),
    },
  };
}

function projectTransactionStepPayload(payload) {
  const source = normalizeObject(payload);
  const output = {};
  for (const [key, value] of Object.entries(source)) {
    if (TRANSACTION_STEP_RESERVED_PAYLOAD_FIELDS.has(key)) {
      continue;
    }
    output[key] = value;
  }
  return output;
}

function mapWriteBlockToTransactionStep(blockSpec, options = {}) {
  const block = normalizeObject(blockSpec);
  const blockType = normalizeString(block.block_type);
  if (blockType !== BLOCK_TYPE.CREATE && blockType !== BLOCK_TYPE.MUTATE) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: "transaction step synthesis requires CREATE/MUTATE block",
      }),
    };
  }
  const mappingOutcome = mapBlockSpecToToolPlan(blockSpec, options);
  if (!mappingOutcome.ok) {
    return {
      ok: false,
      error: mappingOutcome,
    };
  }
  const toolName = normalizeString(mappingOutcome.tool_name);
  if (!toolName || toolName === "execute_unity_transaction") {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_PRECONDITION_FAILED",
        block_error_code: "E_BLOCK_NOT_IMPLEMENTED",
        error_message: "transaction step synthesis cannot include nested transaction tool",
      }),
    };
  }
  const stepId = normalizeString(block.block_id);
  if (!stepId) {
    return {
      ok: false,
      error: buildMapperError({
        error_code: "E_SCHEMA_INVALID",
        block_error_code: "",
        error_message: "transaction step synthesis requires block_id",
      }),
    };
  }
  const dependsOn = normalizeStringArray(block.depends_on);
  const step = {
    step_id: stepId,
    tool_name: toolName,
    payload: projectTransactionStepPayload(mappingOutcome.payload),
  };
  if (dependsOn.length > 0) {
    step.depends_on = dependsOn;
  }
  return {
    ok: true,
    step,
    mapping_meta: normalizeObject(mappingOutcome.mapping_meta),
  };
}

module.exports = {
  FAMILY_TOOL_MIGRATION_MATRIX,
  FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_MIGRATION_MATRIX_BY_BLOCK_TYPE,
  INTENT_KEY_SOURCE,
  INTENT_TO_TOOL_BY_BLOCK_TYPE: FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE,
  MAPPING_VERSION,
  VERIFY_LOCAL_TOOL_NAME,
  EXECUTION_BACKEND_ROLE,
  mapBlockSpecToToolPlan,
  mapWriteBlockToTransactionStep,
  resolveMappingByIntent,
  isLegacyConcreteKeyCompatEnabled,
  resolveDisabledFamilyKeySet,
};

"use strict";

const {
  validateMcpApplyVisualActions,
} = require("../../../domain/validators");
const {
  isObject,
  isNonEmptyString,
  validateAllowedKeys,
} = require("../_shared/validationUtils");

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "based_on_read_token",
  "write_anchor",
  "target_anchor",
  "component_selector",
  "patches",
  "preconditions",
  "dry_run",
  "thread_id",
  "idempotency_key",
  "user_intent",
  "approval_mode",
  "context",
  "action_data_json",
  "action_data_marshaled",
]);

const ALLOWED_COMPONENT_SELECTOR_KEYS = new Set([
  "component_assembly_qualified_name",
  "component_index",
]);

const ALLOWED_PATCH_KEYS = new Set([
  "property_path",
  "value_kind",
  "int_value",
  "float_value",
  "string_value",
  "bool_value",
  "enum_value",
  "enum_name",
  "vector2_value",
  "vector3_value",
  "color_value",
  "array_size",
  "object_ref",
  "action_data_json",
  "action_data_marshaled",
]);

const ALLOWED_OBJECT_REF_KEYS = new Set([
  "scene_anchor",
  "asset_guid",
  "asset_path",
  "sub_asset_name",
]);

const ALLOWED_VALUE_KINDS = new Set([
  "integer",
  "float",
  "string",
  "enum",
  "vector2",
  "vector3",
  "color",
  "array",
  "object_reference",
]);

function fail(message, errorCode = "E_SCHEMA_INVALID", statusCode = 400) {
  return {
    ok: false,
    errorCode,
    message,
    statusCode,
  };
}

function validateAnchorObject(anchor, fieldPath) {
  if (!isObject(anchor)) {
    return fail(`${fieldPath} must be an object`);
  }
  const keysValidation = validateAllowedKeys(
    anchor,
    new Set(["object_id", "path"]),
    fieldPath
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }
  if (!isNonEmptyString(anchor.object_id)) {
    return fail(`${fieldPath}.object_id is required`);
  }
  if (!isNonEmptyString(anchor.path)) {
    return fail(`${fieldPath}.path is required`);
  }
  return { ok: true };
}

function validateFiniteNumber(value, fieldPath) {
  if (!Number.isFinite(Number(value))) {
    return fail(`${fieldPath} must be a finite number`);
  }
  return { ok: true };
}

function validateInteger(value, fieldPath, minimum) {
  if (
    !Number.isFinite(Number(value)) ||
    Math.floor(Number(value)) !== Number(value)
  ) {
    return fail(`${fieldPath} must be an integer`);
  }
  if (
    Number.isFinite(Number(minimum)) &&
    Number(value) < Number(minimum)
  ) {
    return fail(`${fieldPath} must be >= ${minimum}`);
  }
  return { ok: true };
}

function validateVector2(value, fieldPath) {
  if (!isObject(value)) {
    return fail(`${fieldPath} must be an object`);
  }
  const keysValidation = validateAllowedKeys(
    value,
    new Set(["x", "y"]),
    fieldPath
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }
  const xValidation = validateFiniteNumber(value.x, `${fieldPath}.x`);
  if (!xValidation.ok) {
    return xValidation;
  }
  return validateFiniteNumber(value.y, `${fieldPath}.y`);
}

function validateVector3(value, fieldPath) {
  if (!isObject(value)) {
    return fail(`${fieldPath} must be an object`);
  }
  const keysValidation = validateAllowedKeys(
    value,
    new Set(["x", "y", "z"]),
    fieldPath
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }
  const xValidation = validateFiniteNumber(value.x, `${fieldPath}.x`);
  if (!xValidation.ok) {
    return xValidation;
  }
  const yValidation = validateFiniteNumber(value.y, `${fieldPath}.y`);
  if (!yValidation.ok) {
    return yValidation;
  }
  return validateFiniteNumber(value.z, `${fieldPath}.z`);
}

function validateColor(value, fieldPath) {
  if (!isObject(value)) {
    return fail(`${fieldPath} must be an object`);
  }
  const keysValidation = validateAllowedKeys(
    value,
    new Set(["r", "g", "b", "a"]),
    fieldPath
  );
  if (!keysValidation.ok) {
    return keysValidation;
  }
  const rValidation = validateFiniteNumber(value.r, `${fieldPath}.r`);
  if (!rValidation.ok) {
    return rValidation;
  }
  const gValidation = validateFiniteNumber(value.g, `${fieldPath}.g`);
  if (!gValidation.ok) {
    return gValidation;
  }
  const bValidation = validateFiniteNumber(value.b, `${fieldPath}.b`);
  if (!bValidation.ok) {
    return bValidation;
  }
  return validateFiniteNumber(value.a, `${fieldPath}.a`);
}

function validateObjectRef(value, fieldPath) {
  if (!isObject(value)) {
    return fail(`${fieldPath} must be an object`);
  }
  const keysValidation = validateAllowedKeys(value, ALLOWED_OBJECT_REF_KEYS, fieldPath);
  if (!keysValidation.ok) {
    return keysValidation;
  }
  if (value.scene_anchor !== undefined) {
    const anchorValidation = validateAnchorObject(
      value.scene_anchor,
      `${fieldPath}.scene_anchor`
    );
    if (!anchorValidation.ok) {
      return anchorValidation;
    }
  }
  if (value.asset_guid !== undefined && !isNonEmptyString(value.asset_guid)) {
    return fail(`${fieldPath}.asset_guid must be a non-empty string when provided`);
  }
  if (value.asset_path !== undefined && !isNonEmptyString(value.asset_path)) {
    return fail(`${fieldPath}.asset_path must be a non-empty string when provided`);
  }
  if (
    value.sub_asset_name !== undefined &&
    value.sub_asset_name !== null &&
    typeof value.sub_asset_name !== "string"
  ) {
    return fail(`${fieldPath}.sub_asset_name must be a string when provided`);
  }
  const hasSceneAnchor = value.scene_anchor !== undefined;
  const hasAssetGuid = isNonEmptyString(value.asset_guid);
  const hasAssetPath = isNonEmptyString(value.asset_path);
  if (!hasSceneAnchor && !hasAssetGuid && !hasAssetPath) {
    return fail(
      `${fieldPath} requires scene_anchor or asset_guid or asset_path`
    );
  }
  return { ok: true };
}

function validatePatchByValueKind(patch, fieldPath) {
  const kind = String(patch.value_kind || "").trim();
  if (!kind || !ALLOWED_VALUE_KINDS.has(kind)) {
    return fail(
      `${fieldPath}.value_kind must be one of integer/float/string/enum/vector2/vector3/color/array/object_reference`
    );
  }

  if (kind === "integer") {
    return validateInteger(patch.int_value, `${fieldPath}.int_value`);
  }
  if (kind === "float") {
    return validateFiniteNumber(patch.float_value, `${fieldPath}.float_value`);
  }
  if (kind === "string") {
    if (typeof patch.string_value !== "string") {
      return fail(`${fieldPath}.string_value must be a string`);
    }
    return { ok: true };
  }
  if (kind === "enum") {
    if (patch.enum_value !== undefined) {
      return validateInteger(patch.enum_value, `${fieldPath}.enum_value`);
    }
    if (!isNonEmptyString(patch.enum_name)) {
      return fail(`${fieldPath} requires enum_value or enum_name for enum`);
    }
    return { ok: true };
  }
  if (kind === "vector2") {
    return validateVector2(patch.vector2_value, `${fieldPath}.vector2_value`);
  }
  if (kind === "vector3") {
    return validateVector3(patch.vector3_value, `${fieldPath}.vector3_value`);
  }
  if (kind === "color") {
    return validateColor(patch.color_value, `${fieldPath}.color_value`);
  }
  if (kind === "array") {
    return validateInteger(patch.array_size, `${fieldPath}.array_size`, 0);
  }
  if (kind === "object_reference") {
    return validateObjectRef(patch.object_ref, `${fieldPath}.object_ref`);
  }
  return { ok: true };
}

function buildSetSerializedPropertyApplyVisualPayload(body) {
  const source = isObject(body) ? body : {};
  return {
    based_on_read_token: source.based_on_read_token,
    write_anchor: source.write_anchor,
    preconditions: source.preconditions,
    dry_run: source.dry_run,
    thread_id: source.thread_id,
    idempotency_key: source.idempotency_key,
    user_intent: source.user_intent,
    approval_mode: source.approval_mode,
    context: source.context,
    actions: [
      {
        type: "set_serialized_property",
        target_anchor: source.target_anchor,
        action_data: {
          component_selector: source.component_selector,
          patches: source.patches,
        },
      },
    ],
  };
}

function validateSetSerializedProperty(body) {
  if (!isObject(body)) {
    return fail("Body must be a JSON object");
  }

  if (body.action_data_json !== undefined || body.action_data_marshaled !== undefined) {
    return fail(
      "action_data_json/action_data_marshaled is not allowed in external payload",
      "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED"
    );
  }

  const keysValidation = validateAllowedKeys(body, ALLOWED_TOP_LEVEL_KEYS, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  const targetAnchorValidation = validateAnchorObject(
    body.target_anchor,
    "target_anchor"
  );
  if (!targetAnchorValidation.ok) {
    return targetAnchorValidation;
  }

  if (!isObject(body.component_selector)) {
    return fail("component_selector must be an object");
  }
  const selectorKeysValidation = validateAllowedKeys(
    body.component_selector,
    ALLOWED_COMPONENT_SELECTOR_KEYS,
    "component_selector"
  );
  if (!selectorKeysValidation.ok) {
    return selectorKeysValidation;
  }
  if (
    !isNonEmptyString(body.component_selector.component_assembly_qualified_name)
  ) {
    return fail("component_selector.component_assembly_qualified_name is required");
  }
  if (body.component_selector.component_index !== undefined) {
    const indexValidation = validateInteger(
      body.component_selector.component_index,
      "component_selector.component_index",
      0
    );
    if (!indexValidation.ok) {
      return indexValidation;
    }
  }

  if (!Array.isArray(body.patches) || body.patches.length === 0) {
    return fail("patches must be a non-empty array");
  }

  for (let index = 0; index < body.patches.length; index += 1) {
    const patch = body.patches[index];
    const patchPath = `patches[${index}]`;
    if (!isObject(patch)) {
      return fail(`${patchPath} must be an object`);
    }
    const patchKeysValidation = validateAllowedKeys(
      patch,
      ALLOWED_PATCH_KEYS,
      patchPath
    );
    if (!patchKeysValidation.ok) {
      return patchKeysValidation;
    }
    if (
      patch.action_data_json !== undefined ||
      patch.action_data_marshaled !== undefined
    ) {
      return fail(
        `${patchPath}.action_data_json/action_data_marshaled is not allowed in external payload`,
        "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED"
      );
    }
    if (!isNonEmptyString(patch.property_path)) {
      return fail(`${patchPath}.property_path is required`);
    }
    if (!isNonEmptyString(patch.value_kind)) {
      return fail(`${patchPath}.value_kind is required`);
    }
    const valueValidation = validatePatchByValueKind(patch, patchPath);
    if (!valueValidation.ok) {
      return valueValidation;
    }
  }

  const mappedPayload = buildSetSerializedPropertyApplyVisualPayload(body);
  return validateMcpApplyVisualActions(mappedPayload);
}

module.exports = {
  buildSetSerializedPropertyApplyVisualPayload,
  validateSetSerializedProperty,
};

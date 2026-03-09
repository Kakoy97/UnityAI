"use strict";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function buildError(message, details = null) {
  return {
    ok: false,
    error: {
      error_code: "E_SCHEMA_INVALID",
      error_message: message,
      suggested_action: "preflight_validate_write_payload",
      retry_policy: {
        can_retry: true,
      },
      details: details && typeof details === "object" ? details : {},
    },
  };
}

function buildSerializedPropertyFallbackPayload(input = {}) {
  const source = normalizeObject(input);
  const primaryPayload = normalizeObject(source.primary_payload);
  const blockSpec = normalizeObject(source.block_spec);
  const blockInput = normalizeObject(blockSpec.input);

  const executionMode = normalizeString(primaryPayload.execution_mode);
  const idempotencyKey = normalizeString(primaryPayload.idempotency_key);
  const basedOnReadToken = normalizeString(primaryPayload.based_on_read_token);
  const writeAnchorObjectId = normalizeString(primaryPayload.write_anchor_object_id);
  const writeAnchorPath = normalizeString(primaryPayload.write_anchor_path);
  const targetObjectId = normalizeString(primaryPayload.target_object_id);
  const targetPath = normalizeString(primaryPayload.target_path);
  const componentType = normalizeString(primaryPayload.component_type);
  const propertyPath = normalizeString(primaryPayload.property_path);

  const missingFields = [];
  if (!executionMode) missingFields.push("execution_mode");
  if (!idempotencyKey) missingFields.push("idempotency_key");
  if (!basedOnReadToken) missingFields.push("based_on_read_token");
  if (!writeAnchorObjectId) missingFields.push("write_anchor_object_id");
  if (!writeAnchorPath) missingFields.push("write_anchor_path");
  if (!targetObjectId) missingFields.push("target_object_id");
  if (!targetPath) missingFields.push("target_path");
  if (!componentType) missingFields.push("component_type");
  if (!propertyPath) missingFields.push("property_path");
  if (missingFields.length > 0) {
    return buildError(
      `fallback payload missing required fields: ${missingFields.join(", ")}`,
      { missing_fields: missingFields }
    );
  }

  const fallbackPayload = {
    execution_mode: executionMode,
    idempotency_key: idempotencyKey,
    based_on_read_token: basedOnReadToken,
    write_anchor_object_id: writeAnchorObjectId,
    write_anchor_path: writeAnchorPath,
    target_object_id: targetObjectId,
    target_path: targetPath,
    component_type: componentType,
    property_path: propertyPath,
  };

  if (hasFiniteNumber(blockInput.component_index)) {
    fallbackPayload.component_index = Number(blockInput.component_index);
  }
  if (typeof blockInput.dry_run === "boolean") {
    fallbackPayload.dry_run = blockInput.dry_run;
  }

  const sourceValueKind = normalizeString(primaryPayload.value_kind).toLowerCase();
  if (sourceValueKind === "string") {
    if (!Object.prototype.hasOwnProperty.call(primaryPayload, "value_string")) {
      return buildError("fallback requires value_string for value_kind=string");
    }
    fallbackPayload.value_kind = "string";
    fallbackPayload.string_value = String(primaryPayload.value_string);
    return { ok: true, payload: fallbackPayload };
  }

  if (sourceValueKind === "boolean") {
    if (!Object.prototype.hasOwnProperty.call(primaryPayload, "value_boolean")) {
      return buildError("fallback requires value_boolean for value_kind=boolean");
    }
    fallbackPayload.value_kind = "boolean";
    fallbackPayload.bool_value = primaryPayload.value_boolean === true;
    return { ok: true, payload: fallbackPayload };
  }

  if (sourceValueKind === "number") {
    if (!hasFiniteNumber(primaryPayload.value_number)) {
      return buildError("fallback requires finite value_number for value_kind=number");
    }
    const numericValue = Number(primaryPayload.value_number);
    if (Number.isInteger(numericValue)) {
      fallbackPayload.value_kind = "integer";
      fallbackPayload.int_value = numericValue;
      return { ok: true, payload: fallbackPayload };
    }
    fallbackPayload.value_kind = "float";
    fallbackPayload.float_value = numericValue;
    return { ok: true, payload: fallbackPayload };
  }

  return buildError(
    `unsupported value_kind for generic fallback mapping: ${sourceValueKind || "<empty>"}`,
    { supported: ["string", "number", "boolean"] }
  );
}

module.exports = {
  buildSerializedPropertyFallbackPayload,
};


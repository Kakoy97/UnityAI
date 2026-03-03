"use strict";

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

const SCHEMA_ISSUE_CATEGORIES = Object.freeze({
  anchor: "anchor",
  action_data: "action_data",
  token: "token",
  generic: "generic",
});

function extractSchemaIssueFieldPath(validation, validationMessage) {
  const source = validation && typeof validation === "object" ? validation : {};
  const directFieldPath = normalizeOptionalString(
    source.field_path || source.fieldPath
  );
  if (directFieldPath) {
    return directFieldPath;
  }

  const message = normalizeOptionalString(validationMessage);
  if (!message) {
    return "";
  }

  const patterns = [
    /((?:actions|visual_layer_actions)\[\d+\]\.[a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)/,
    /((?:write_anchor|target_anchor|parent_anchor)(?:\.[a-zA-Z0-9_]+)*)/,
    /\b(based_on_read_token|read_token|idempotency_key|thread_id)\b/,
  ];
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && normalizeOptionalString(match[1])) {
      return normalizeOptionalString(match[1]);
    }
  }
  return "";
}

function isAnchorSchemaIssue(fieldPath, messageLowerCase) {
  const path = normalizeOptionalString(fieldPath);
  const lower = typeof messageLowerCase === "string" ? messageLowerCase : "";
  if (
    path.startsWith("write_anchor") ||
    path.startsWith("target_anchor") ||
    path.startsWith("parent_anchor") ||
    path.includes(".target_anchor") ||
    path.includes(".parent_anchor")
  ) {
    return true;
  }
  return (
    lower.includes("target_anchor") ||
    lower.includes("parent_anchor") ||
    lower.includes("write_anchor") ||
    lower.includes("anchor_policy") ||
    lower.includes("object_id and path")
  );
}

function isTokenSchemaIssue(fieldPath, messageLowerCase) {
  const path = normalizeOptionalString(fieldPath);
  const lower = typeof messageLowerCase === "string" ? messageLowerCase : "";
  if (
    path === "based_on_read_token" ||
    path === "read_token" ||
    path.startsWith("based_on_read_token.") ||
    path.startsWith("read_token.")
  ) {
    return true;
  }
  return (
    lower.includes("based_on_read_token") ||
    lower.includes("read token") ||
    lower.includes("read_token") ||
    lower.includes("stale snapshot")
  );
}

function isActionDataSchemaIssue(fieldPath, messageLowerCase) {
  const path = normalizeOptionalString(fieldPath);
  const lower = typeof messageLowerCase === "string" ? messageLowerCase : "";
  if (
    path.includes(".action_data") ||
    path.includes(".patches") ||
    path.includes(".component_selector") ||
    path.includes(".operations")
  ) {
    return true;
  }
  return (
    lower.includes("action_data") ||
    lower.includes("deserialize") ||
    lower.includes("dto") ||
    lower.includes("value_kind") ||
    lower.includes("component_selector") ||
    lower.includes("patches")
  );
}

function resolveSchemaIssueClassification(validation) {
  const source = validation && typeof validation === "object" ? validation : {};
  const validationMessage = normalizeOptionalString(
    source.message || source.errorMessage || source.error_message
  );
  const fieldPath = extractSchemaIssueFieldPath(source, validationMessage);
  const messageLower = validationMessage.toLowerCase();

  if (isAnchorSchemaIssue(fieldPath, messageLower)) {
    return {
      category: SCHEMA_ISSUE_CATEGORIES.anchor,
      field_path: fieldPath,
      fix_kind: "anchor_missing_or_invalid",
    };
  }
  if (isTokenSchemaIssue(fieldPath, messageLower)) {
    return {
      category: SCHEMA_ISSUE_CATEGORIES.token,
      field_path: fieldPath,
      fix_kind: "token_missing_or_stale",
    };
  }
  if (isActionDataSchemaIssue(fieldPath, messageLower)) {
    return {
      category: SCHEMA_ISSUE_CATEGORIES.action_data,
      field_path: fieldPath,
      fix_kind: "action_data_invalid_shape",
    };
  }
  return {
    category: SCHEMA_ISSUE_CATEGORIES.generic,
    field_path: fieldPath,
    fix_kind: "payload_shape_invalid",
  };
}

module.exports = {
  SCHEMA_ISSUE_CATEGORIES,
  resolveSchemaIssueClassification,
};


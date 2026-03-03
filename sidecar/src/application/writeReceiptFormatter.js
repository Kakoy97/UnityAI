"use strict";

const { cloneJson } = require("../utils/turnUtils");

const MAX_PROPERTY_PREVIEW = 8;
const MAX_CHANGED_FIELDS = 8;
const MAX_CONSOLE_ERROR_CODES = 6;
const MAX_CONSOLE_ERRORS = 20;
const MAX_TEXT_LENGTH = 320;

function normalizeText(value, maxLength = MAX_TEXT_LENGTH) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength).trimEnd();
}

function toNonNegativeInt(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    return Math.floor(fallback);
  }
  return Math.floor(num);
}

function normalizeStringArray(value, limit = 0) {
  const items = Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => !!item)
    : [];
  if (limit > 0) {
    return items.slice(0, limit);
  }
  return items;
}

function normalizeConsoleSnapshot(consoleSnapshot) {
  if (!consoleSnapshot || typeof consoleSnapshot !== "object") {
    return null;
  }

  const sourceErrors = Array.isArray(consoleSnapshot.errors)
    ? consoleSnapshot.errors
    : [];
  const normalizedErrors = [];
  for (const entry of sourceErrors) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const condition = normalizeText(entry.condition, MAX_TEXT_LENGTH);
    const errorCode = normalizeText(entry.error_code, 64);
    const file = normalizeText(entry.file, 256);
    const logType = normalizeText(entry.log_type, 48);
    if (!condition && !errorCode && !file) {
      continue;
    }
    normalizedErrors.push({
      timestamp: normalizeText(entry.timestamp, 64),
      log_type: logType || "Error",
      error_code: errorCode,
      condition,
      file,
      line: toNonNegativeInt(entry.line, 0),
    });
    if (normalizedErrors.length >= MAX_CONSOLE_ERRORS) {
      break;
    }
  }

  const totalErrors =
    toNonNegativeInt(consoleSnapshot.total_errors, normalizedErrors.length) ||
    normalizedErrors.length;
  const maxEntries = toNonNegativeInt(
    consoleSnapshot.max_entries,
    normalizedErrors.length
  );
  return {
    captured_at: normalizeText(consoleSnapshot.captured_at, 64),
    window_start_at: normalizeText(consoleSnapshot.window_start_at, 64),
    window_end_at: normalizeText(consoleSnapshot.window_end_at, 64),
    window_seconds: toNonNegativeInt(consoleSnapshot.window_seconds, 0),
    max_entries: maxEntries,
    total_errors: totalErrors,
    truncated:
      consoleSnapshot.truncated === true || totalErrors > normalizedErrors.length,
    errors: normalizedErrors,
  };
}

function normalizeWriteReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") {
    return null;
  }

  const clone = cloneJson(receipt);
  const sceneDiff =
    clone.scene_diff && typeof clone.scene_diff === "object"
      ? clone.scene_diff
      : {};
  const targetDelta =
    clone.target_delta && typeof clone.target_delta === "object"
      ? clone.target_delta
      : {};
  const createdDelta =
    clone.created_object_delta && typeof clone.created_object_delta === "object"
      ? clone.created_object_delta
      : {};
  const consoleSnapshot = normalizeConsoleSnapshot(clone.console_snapshot);

  return {
    schema_version: normalizeText(clone.schema_version, 64),
    captured_at: normalizeText(clone.captured_at, 64),
    success: clone.success === true,
    error_code: normalizeText(clone.error_code, 64),
    target_resolution: normalizeText(clone.target_resolution, 64),
    scene_diff: {
      dirty_scene_count_before: toNonNegativeInt(
        sceneDiff.dirty_scene_count_before,
        0
      ),
      dirty_scene_count_after: toNonNegativeInt(sceneDiff.dirty_scene_count_after, 0),
      added_dirty_scene_paths: normalizeStringArray(
        sceneDiff.added_dirty_scene_paths
      ),
      cleared_dirty_scene_paths: normalizeStringArray(
        sceneDiff.cleared_dirty_scene_paths
      ),
      dirty_scene_set_changed: sceneDiff.dirty_scene_set_changed === true,
    },
    target_delta: {
      before:
        targetDelta.before && typeof targetDelta.before === "object"
          ? cloneJson(targetDelta.before)
          : null,
      after:
        targetDelta.after && typeof targetDelta.after === "object"
          ? cloneJson(targetDelta.after)
          : null,
      changed_fields: normalizeStringArray(targetDelta.changed_fields),
    },
    created_object_delta: {
      before:
        createdDelta.before && typeof createdDelta.before === "object"
          ? cloneJson(createdDelta.before)
          : null,
      after:
        createdDelta.after && typeof createdDelta.after === "object"
          ? cloneJson(createdDelta.after)
          : null,
      changed_fields: normalizeStringArray(createdDelta.changed_fields),
    },
    property_changes: normalizeStringArray(clone.property_changes),
    console_snapshot: consoleSnapshot,
  };
}

function summarizeWriteReceipt(receipt) {
  const normalized = normalizeWriteReceipt(receipt);
  if (!normalized) {
    return null;
  }

  const consoleSnapshot = normalized.console_snapshot;
  const consoleErrors =
    consoleSnapshot && Array.isArray(consoleSnapshot.errors)
      ? consoleSnapshot.errors
      : [];
  const consoleErrorCodes = Array.from(
    new Set(
      consoleErrors
        .map((item) => (typeof item.error_code === "string" ? item.error_code : ""))
        .filter((item) => !!item)
    )
  ).slice(0, MAX_CONSOLE_ERROR_CODES);

  return {
    schema_version: normalized.schema_version,
    success: normalized.success === true,
    error_code: normalized.error_code,
    target_resolution: normalized.target_resolution,
    property_change_count: normalized.property_changes.length,
    property_changes_preview: normalized.property_changes.slice(0, MAX_PROPERTY_PREVIEW),
    dirty_scene_set_changed: normalized.scene_diff.dirty_scene_set_changed === true,
    added_dirty_scene_count: normalized.scene_diff.added_dirty_scene_paths.length,
    cleared_dirty_scene_count: normalized.scene_diff.cleared_dirty_scene_paths.length,
    target_changed_fields: normalized.target_delta.changed_fields.slice(
      0,
      MAX_CHANGED_FIELDS
    ),
    created_changed_fields: normalized.created_object_delta.changed_fields.slice(
      0,
      MAX_CHANGED_FIELDS
    ),
    console_error_count: consoleSnapshot
      ? toNonNegativeInt(consoleSnapshot.total_errors, consoleErrors.length)
      : 0,
    console_error_codes: consoleErrorCodes,
    console_window_seconds: consoleSnapshot
      ? toNonNegativeInt(consoleSnapshot.window_seconds, 0)
      : 0,
    console_truncated: consoleSnapshot ? consoleSnapshot.truncated === true : false,
  };
}

function normalizeExecutionReport(report) {
  if (!report || typeof report !== "object") {
    return null;
  }

  const normalized = cloneJson(report);
  const writeReceipt = normalizeWriteReceipt(normalized.action_write_receipt);
  normalized.action_write_receipt = writeReceipt;
  normalized.action_write_receipt_summary = summarizeWriteReceipt(writeReceipt);
  return normalized;
}

function normalizeWriteToolOutcome(outcome) {
  if (!outcome || typeof outcome !== "object") {
    return outcome;
  }
  if (!Number.isFinite(Number(outcome.statusCode))) {
    return outcome;
  }

  const body = outcome.body && typeof outcome.body === "object" ? outcome.body : null;
  if (!body || !body.execution_report || typeof body.execution_report !== "object") {
    return outcome;
  }

  return {
    ...outcome,
    body: {
      ...body,
      execution_report: normalizeExecutionReport(body.execution_report),
    },
  };
}

module.exports = {
  normalizeWriteReceipt,
  summarizeWriteReceipt,
  normalizeExecutionReport,
  normalizeWriteToolOutcome,
};


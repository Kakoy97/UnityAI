"use strict";

const { createHash } = require("node:crypto");
const { SCHEMA_ISSUE_CATEGORIES } = require("./schemaIssueClassifier");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function buildPayloadHash(value) {
  try {
    const text = JSON.stringify(value || {});
    const hash = createHash("sha256").update(text).digest("hex");
    return `sha256:${hash}`;
  } catch {
    return "";
  }
}

function isValidAnchorObject(anchor) {
  return (
    isObject(anchor) &&
    normalizeOptionalString(anchor.object_id) &&
    normalizeOptionalString(anchor.path)
  );
}

function isCreateLikeActionType(value) {
  const type = normalizeOptionalString(value).toLowerCase();
  return type === "create_gameobject" || type === "create_object";
}

function resolveActionListAndPatchPath(payload) {
  if (!isObject(payload)) {
    return { actions: [], targetPath: "", parentPath: "" };
  }
  if (Array.isArray(payload.actions)) {
    return {
      actions: payload.actions,
      targetPath: "/actions/0/target_anchor",
      parentPath: "/actions/0/parent_anchor",
    };
  }
  if (Array.isArray(payload.visual_layer_actions)) {
    return {
      actions: payload.visual_layer_actions,
      targetPath: "/visual_layer_actions/0/target_anchor",
      parentPath: "/visual_layer_actions/0/parent_anchor",
    };
  }
  return { actions: [], targetPath: "", parentPath: "" };
}

function buildAnchorMachineFixCompensation(options, schemaIssue) {
  const opts = options && typeof options === "object" ? options : {};
  const issue = schemaIssue && typeof schemaIssue === "object" ? schemaIssue : {};
  if (issue.category !== SCHEMA_ISSUE_CATEGORIES.anchor) {
    return null;
  }

  const fieldPath = normalizeOptionalString(issue.field_path);
  const requestBody = isObject(opts.requestBody) ? opts.requestBody : {};
  const writeAnchor = requestBody.write_anchor;
  if (!isValidAnchorObject(writeAnchor)) {
    return null;
  }

  const requestResolve = resolveActionListAndPatchPath(requestBody);
  if (!Array.isArray(requestResolve.actions) || requestResolve.actions.length !== 1) {
    return null;
  }
  const requestAction = requestResolve.actions[0];
  if (!isObject(requestAction)) {
    return null;
  }

  const isCreateLike = isCreateLikeActionType(requestAction.type);
  let anchorField = "";
  if (fieldPath.includes("parent_anchor")) {
    anchorField = "parent_anchor";
  } else if (fieldPath.includes("target_anchor") || fieldPath.includes("write_anchor")) {
    anchorField = isCreateLike ? "parent_anchor" : "target_anchor";
  } else if (!fieldPath) {
    anchorField = isCreateLike ? "parent_anchor" : "target_anchor";
  } else {
    return null;
  }

  if (anchorField === "parent_anchor" && !isCreateLike) {
    return null;
  }
  if (anchorField === "target_anchor" && isCreateLike) {
    return null;
  }
  if (isValidAnchorObject(requestAction[anchorField])) {
    return null;
  }

  const preferredCorrected =
    isObject(opts.correctedPayload) || Array.isArray(opts.correctedPayload)
      ? cloneJson(opts.correctedPayload)
      : null;
  const correctedPayload = preferredCorrected || cloneJson(requestBody);
  if (!isObject(correctedPayload)) {
    return null;
  }
  const correctedResolve = resolveActionListAndPatchPath(correctedPayload);
  if (!Array.isArray(correctedResolve.actions) || correctedResolve.actions.length !== 1) {
    return null;
  }
  const correctedAction = correctedResolve.actions[0];
  if (!isObject(correctedAction)) {
    return null;
  }

  const normalizedAnchor = {
    object_id: normalizeOptionalString(writeAnchor.object_id),
    path: normalizeOptionalString(writeAnchor.path),
  };
  correctedAction[anchorField] = normalizedAnchor;
  const patchPath =
    anchorField === "parent_anchor"
      ? correctedResolve.parentPath ||
        requestResolve.parentPath ||
        "/actions/0/parent_anchor"
      : correctedResolve.targetPath ||
        requestResolve.targetPath ||
        "/actions/0/target_anchor";

  return {
    suggested_patch: [
      {
        op: "replace",
        path: patchPath,
        value: normalizedAnchor,
      },
    ],
    corrected_payload: correctedPayload,
    normalization_applied: true,
    original_payload_hash: buildPayloadHash(requestBody),
    next_step: "retry_with_corrected_payload",
  };
}

module.exports = {
  buildAnchorMachineFixCompensation,
};

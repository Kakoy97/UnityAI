"use strict";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToolKind(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isTokenIssuanceEligibleToolKind(kind) {
  const normalized = normalizeToolKind(kind);
  return normalized === "read" || normalized === "write";
}

function stripTokenEnvelope(result) {
  const source = isObject(result) ? result : result;
  if (!isObject(source)) {
    return source;
  }

  let output = source;
  let mutated = false;
  if (Object.prototype.hasOwnProperty.call(output, "read_token")) {
    if (!mutated) {
      output = { ...output };
      mutated = true;
    }
    delete output.read_token;
  }

  const data = isObject(output.data) ? output.data : null;
  if (!data) {
    return output;
  }
  let dataOut = data;
  let dataMutated = false;
  for (const key of ["read_token_candidate", "read_token_candidate_legacy"]) {
    if (Object.prototype.hasOwnProperty.call(dataOut, key)) {
      if (!dataMutated) {
        dataOut = { ...dataOut };
        dataMutated = true;
      }
      delete dataOut[key];
    }
  }
  if (dataMutated) {
    if (!mutated) {
      output = { ...output };
      mutated = true;
    }
    output.data = dataOut;
  }
  return output;
}

function resolveTokenIssuanceDecision(options = {}) {
  const opts = isObject(options) ? options : {};
  const rawResult = isObject(opts.result) ? opts.result : null;
  const result = stripTokenEnvelope(rawResult);
  if (!rawResult) {
    return {
      should_issue: false,
      reason: "result_not_object",
      result,
    };
  }
  if (rawResult.ok !== true) {
    return {
      should_issue: false,
      reason: "result_not_success",
      result,
    };
  }

  const data = isObject(rawResult.data) ? rawResult.data : null;
  if (!data) {
    return {
      should_issue: false,
      reason: "result_data_not_object",
      result,
    };
  }

  const toolName = normalizeString(opts.toolName);
  if (!toolName) {
    return {
      should_issue: false,
      reason: "tool_name_missing",
      result,
    };
  }
  const validatorRegistry =
    opts.validatorRegistry &&
    typeof opts.validatorRegistry.getToolMetadata === "function"
      ? opts.validatorRegistry
      : null;
  if (!validatorRegistry) {
    return {
      should_issue: false,
      reason: "validator_registry_missing",
      result,
    };
  }

  const toolMetadata = validatorRegistry.getToolMetadata(toolName);
  if (!toolMetadata || typeof toolMetadata !== "object") {
    return {
      should_issue: false,
      reason: "tool_metadata_missing",
      result,
    };
  }
  const toolKind = normalizeToolKind(toolMetadata.kind);
  if (!isTokenIssuanceEligibleToolKind(toolKind)) {
    return {
      should_issue: false,
      reason: "tool_kind_not_eligible",
      result,
      tool_kind: toolKind,
    };
  }

  const sceneRevision =
    normalizeString(data.scene_revision) || normalizeString(rawResult.scene_revision);
  if (!sceneRevision) {
    return {
      should_issue: false,
      reason: "scene_revision_missing",
      result,
      tool_kind: toolKind,
    };
  }

  return {
    should_issue: true,
    reason: "eligible",
    result,
    tool_kind: toolKind,
    scene_revision: sceneRevision,
    object_id: normalizeString(data.target_object_id),
    path:
      normalizeString(data.target_path) ||
      normalizeString(data.path) ||
      normalizeString(data.scope_path),
    scope_kind: normalizeString(data.scope_kind),
  };
}

module.exports = {
  isTokenIssuanceEligibleToolKind,
  stripTokenEnvelope,
  resolveTokenIssuanceDecision,
};

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

function isTokenIssuanceEligibleToolKind(kind, continuationKinds = null) {
  const normalized = normalizeToolKind(kind);
  if (!normalized) {
    return false;
  }
  if (continuationKinds instanceof Set && continuationKinds.size > 0) {
    return continuationKinds.has(normalized);
  }
  return normalized === "read" || normalized === "write";
}

function isTokenIssuanceEligibleTokenFamily(family) {
  const normalized = normalizeString(family).toLowerCase();
  return (
    normalized === "read_issues_token" || normalized === "write_requires_token"
  );
}

function resolveToolContinuationPolicy(options = {}) {
  const opts = isObject(options) ? options : {};
  const toolName = normalizeString(opts.toolName);
  const validatorRegistry =
    opts.validatorRegistry &&
    typeof opts.validatorRegistry.getToolMetadata === "function"
      ? opts.validatorRegistry
      : null;
  const tokenPolicyRuntime =
    opts.tokenPolicyRuntime && typeof opts.tokenPolicyRuntime === "object"
      ? opts.tokenPolicyRuntime
      : null;

  let toolPolicy = null;
  if (
    tokenPolicyRuntime &&
    typeof tokenPolicyRuntime.getToolPolicy === "function"
  ) {
    toolPolicy = tokenPolicyRuntime.getToolPolicy(toolName);
  }
  if (!toolPolicy && validatorRegistry) {
    const metadata = validatorRegistry.getToolMetadata(toolName);
    if (metadata && typeof metadata === "object") {
      toolPolicy = {
        name: toolName,
        kind: normalizeToolKind(metadata.kind) || "read",
        token_family:
          normalizeToolKind(metadata.kind) === "write"
            ? "write_requires_token"
            : "read_issues_token",
      };
    }
  }

  let continuationKinds = null;
  if (tokenPolicyRuntime && typeof tokenPolicyRuntime.getContract === "function") {
    const contract = tokenPolicyRuntime.getContract();
    if (contract && Array.isArray(contract.success_continuation)) {
      continuationKinds = new Set(
        contract.success_continuation
          .map((item) => normalizeToolKind(item))
          .filter((item) => !!item)
      );
    }
  }
  return {
    toolPolicy: isObject(toolPolicy) ? toolPolicy : null,
    continuationKinds,
  };
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
  const continuationPolicy = resolveToolContinuationPolicy({
    toolName,
    validatorRegistry: opts.validatorRegistry,
    tokenPolicyRuntime: opts.tokenPolicyRuntime,
  });
  const toolPolicy = continuationPolicy.toolPolicy;
  if (!toolPolicy) {
    return {
      should_issue: false,
      reason: "tool_policy_missing",
      result,
    };
  }
  const toolKind = normalizeToolKind(toolPolicy.kind);
  const tokenFamily = normalizeString(toolPolicy.token_family).toLowerCase();
  if (
    !isTokenIssuanceEligibleToolKind(toolKind, continuationPolicy.continuationKinds)
  ) {
    return {
      should_issue: false,
      reason: "tool_kind_not_eligible",
      result,
      tool_kind: toolKind,
    };
  }
  if (!isTokenIssuanceEligibleTokenFamily(tokenFamily)) {
    return {
      should_issue: false,
      reason: "token_family_not_eligible",
      result,
      tool_kind: toolKind,
      token_family: tokenFamily,
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
    token_family: tokenFamily,
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

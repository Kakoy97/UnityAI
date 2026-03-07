"use strict";

const { SSOT_QUERY_TYPES } = require("./queryTypes");
const { getValidatorRegistrySingleton } = require("./validatorRegistry");
const { getSsotTokenRegistrySingleton } = require("./ssotTokenRegistry");
const { getSsotRevisionStateSingleton } = require("./ssotRevisionState");
const {
  resolveTokenIssuanceDecision,
} = require("./tokenIssuancePolicy");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToolKind(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function buildSsotQueryPayload(toolName, payload) {
  const normalizedToolName = normalizeString(toolName);
  if (!normalizedToolName) {
    throw new Error("SSOT tool name is required.");
  }

  const source = isObject(payload) ? payload : {};
  const payloadJson = JSON.stringify(source);
  return {
    tool_name: normalizedToolName,
    payload_json: payloadJson,
  };
}

function maybeIssueReadTokenFromResponse(options = {}) {
  const opts = isObject(options) ? options : {};
  let validatorRegistry = opts.validatorRegistry || null;
  if (!validatorRegistry) {
    try {
      validatorRegistry = getValidatorRegistrySingleton();
    } catch {
      validatorRegistry = null;
    }
  }
  const decision = resolveTokenIssuanceDecision({
    toolName: opts.toolName,
    result: opts.result,
    validatorRegistry,
  });
  const result = decision.result;
  if (!decision.should_issue) {
    return result;
  }
  const data = isObject(result && result.data) ? result.data : {};

  let tokenRegistry = null;
  try {
    tokenRegistry = opts.tokenRegistry || getSsotTokenRegistrySingleton();
  } catch {
    return result;
  }

  const issued = tokenRegistry.issueToken({
    source_tool_name: normalizeString(opts.toolName),
    scene_revision: decision.scene_revision,
    scope_kind:
      decision.scope_kind ||
      (normalizeToolKind(decision.tool_kind) === "write"
        ? "write_result"
        : "scene"),
    object_id: decision.object_id,
    path: decision.path,
  });
  if (!issued || issued.ok !== true) {
    return result;
  }

  const outputData = {
    ...data,
    read_token_candidate: issued.token,
  };
  delete outputData.read_token_candidate_legacy;

  return {
    ...result,
    data: outputData,
    read_token: {
      token: issued.token,
      issued_at: issued.issued_at,
      hard_max_age_ms: issued.hard_max_age_ms,
      revision_vector: {
        scene_revision: issued.scene_revision,
      },
      scope: {
        kind: issued.scope.kind,
        object_id: issued.scope.object_id,
        path: issued.scope.path,
      },
    },
  };
}

function maybeUpdateLatestKnownSceneRevisionFromResponse(options = {}) {
  const opts = isObject(options) ? options : {};
  const result = isObject(opts.result) ? opts.result : null;
  if (!result || result.ok !== true) {
    return result;
  }

  const data = isObject(result.data) ? result.data : {};
  const sceneRevision =
    normalizeString(data.scene_revision) ||
    normalizeString(result.scene_revision);
  if (!sceneRevision) {
    return result;
  }

  let revisionState = null;
  try {
    revisionState = opts.revisionState || getSsotRevisionStateSingleton();
  } catch {
    return result;
  }
  if (
    !revisionState ||
    typeof revisionState.updateLatestKnownSceneRevision !== "function"
  ) {
    return result;
  }

  revisionState.updateLatestKnownSceneRevision(sceneRevision, {
    source_tool_name: normalizeString(opts.toolName),
    source_query_type: SSOT_QUERY_TYPES.SSOT_REQUEST,
    source_request_id: normalizeString(opts.requestId),
    source_thread_id: normalizeString(opts.threadId),
    source_turn_id: normalizeString(opts.turnId),
  });
  return result;
}

async function dispatchSsotRequest(options) {
  const opts = isObject(options) ? options : {};
  const enqueueAndWaitForUnityQuery = opts.enqueueAndWaitForUnityQuery;
  if (typeof enqueueAndWaitForUnityQuery !== "function") {
    throw new Error("Unity query runtime is not configured.");
  }

  const queryPayload = buildSsotQueryPayload(opts.toolName, opts.payload);
  const unityResult = await enqueueAndWaitForUnityQuery({
    queryType: SSOT_QUERY_TYPES.SSOT_REQUEST,
    payload: queryPayload,
    queryPayloadJson: JSON.stringify(queryPayload),
    timeoutMs: opts.timeoutMs,
    requestId: normalizeString(opts.requestId),
    threadId: normalizeString(opts.threadId),
    turnId: normalizeString(opts.turnId),
  });
  const revisionUpdatedResult = maybeUpdateLatestKnownSceneRevisionFromResponse({
    toolName: opts.toolName,
    result: unityResult,
    revisionState: opts.revisionState,
    requestId: opts.requestId,
    threadId: opts.threadId,
    turnId: opts.turnId,
  });
  return maybeIssueReadTokenFromResponse({
    toolName: opts.toolName,
    result: revisionUpdatedResult,
    validatorRegistry: opts.validatorRegistry,
    tokenRegistry: opts.tokenRegistry,
  });
}

module.exports = {
  buildSsotQueryPayload,
  maybeUpdateLatestKnownSceneRevisionFromResponse,
  maybeIssueReadTokenFromResponse,
  dispatchSsotRequest,
};

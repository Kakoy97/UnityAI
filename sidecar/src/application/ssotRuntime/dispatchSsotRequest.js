"use strict";

const { SSOT_QUERY_TYPES } = require("./queryTypes");
const { getValidatorRegistrySingleton } = require("./validatorRegistry");
const { getSsotTokenRegistrySingleton } = require("./ssotTokenRegistry");
const { getSsotRevisionStateSingleton } = require("./ssotRevisionState");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
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
  const result = isObject(opts.result) ? opts.result : null;
  if (!result || result.ok !== true || !isObject(result.data)) {
    return result;
  }

  const toolName = normalizeString(opts.toolName);
  if (!toolName) {
    return result;
  }

  let validatorRegistry = null;
  try {
    validatorRegistry =
      opts.validatorRegistry || getValidatorRegistrySingleton();
  } catch {
    return result;
  }
  const toolMetadata =
    validatorRegistry && typeof validatorRegistry.getToolMetadata === "function"
      ? validatorRegistry.getToolMetadata(toolName)
      : null;
  if (!toolMetadata || toolMetadata.kind !== "read") {
    return result;
  }

  const data = result.data;
  const sceneRevision = normalizeString(data.scene_revision);
  if (!sceneRevision) {
    return result;
  }

  let tokenRegistry = null;
  try {
    tokenRegistry = opts.tokenRegistry || getSsotTokenRegistrySingleton();
  } catch {
    return result;
  }

  const issued = tokenRegistry.issueToken({
    source_tool_name: toolName,
    scene_revision: sceneRevision,
    scope_kind: normalizeString(data.scope_kind) || "scene",
    object_id: normalizeString(data.target_object_id),
    path:
      normalizeString(data.target_path) ||
      normalizeString(data.path) ||
      normalizeString(data.scope_path),
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

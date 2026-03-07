"use strict";

const { getSsotTokenRegistrySingleton } = require("./ssotTokenRegistry");
const {
  OCC_STALE_SNAPSHOT_SUGGESTION,
} = require("../errorFeedback/errorFeedbackTemplateRegistry");

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validateSsotWriteToken(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const tokenRegistry =
    opts.tokenRegistry || getSsotTokenRegistrySingleton();
  const token = normalizeString(opts.token);
  const currentSceneRevisionFromInput = normalizeString(opts.currentSceneRevision);
  const revisionState =
    opts.revisionState && typeof opts.revisionState === "object"
      ? opts.revisionState
      : null;
  const currentSceneRevisionFromState =
    revisionState &&
    typeof revisionState.getLatestKnownSceneRevision === "function"
      ? normalizeString(revisionState.getLatestKnownSceneRevision())
      : "";
  const currentSceneRevision =
    currentSceneRevisionFromInput || currentSceneRevisionFromState;
  const validation = tokenRegistry.validateToken(token, {
    scene_revision: currentSceneRevision,
  });
  if (validation.ok) {
    return {
      ok: true,
      token_entry: validation.token_entry,
    };
  }

  return {
    ok: false,
    statusCode:
      Number.isFinite(Number(validation.statusCode)) &&
      Number(validation.statusCode) > 0
        ? Math.floor(Number(validation.statusCode))
        : 409,
    error_code:
      normalizeString(validation.error_code) || "E_TOKEN_UNKNOWN",
    message:
      normalizeString(validation.message) ||
      "based_on_read_token validation failed.",
    suggestion: OCC_STALE_SNAPSHOT_SUGGESTION,
    retry_policy: {
      allow_auto_retry: true,
      max_attempts: 1,
      strategy: "refresh_read_token_then_retry_once",
      required_sequence: ["get_current_selection", "retry_write_once"],
    },
  };
}

module.exports = {
  validateSsotWriteToken,
};

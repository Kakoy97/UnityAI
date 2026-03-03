"use strict";

const STALE_RETRY_POLICY = Object.freeze({
  allow_auto_retry: true,
  max_attempts: 1,
  strategy: "refresh_read_token_then_retry_once",
  required_sequence: Object.freeze(["get_current_selection", "retry_write_once"]),
});

const DEFAULT_RETRY_POLICY = Object.freeze({
  allow_auto_retry: false,
  max_attempts: 0,
  strategy: "manual_fix_required",
});

function clonePolicy(policy) {
  return {
    ...policy,
    ...(Array.isArray(policy.required_sequence)
      ? { required_sequence: [...policy.required_sequence] }
      : {}),
  };
}

function normalizeErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return code || "E_INTERNAL";
}

function buildRetryPolicyForErrorCode(errorCode) {
  const code = normalizeErrorCode(errorCode);
  if (code === "E_STALE_SNAPSHOT") {
    return clonePolicy(STALE_RETRY_POLICY);
  }
  return clonePolicy(DEFAULT_RETRY_POLICY);
}

module.exports = {
  buildRetryPolicyForErrorCode,
};


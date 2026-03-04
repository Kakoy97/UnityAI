"use strict";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateAllowedKeys(obj, allowedSet, fieldPath) {
  if (!isObject(obj)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: `${fieldPath} must be an object`,
      statusCode: 400,
    };
  }
  const keys = Object.keys(obj);
  for (const key of keys) {
    if (!allowedSet.has(key)) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: `${fieldPath} has unexpected field: ${key}`,
        statusCode: 400,
      };
    }
  }
  return { ok: true };
}

function validateMcpGetUnityTaskStatus(jobId) {
  const value = typeof jobId === "string" ? jobId.trim() : "";
  if (!value) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "job_id query parameter is required",
      statusCode: 400,
    };
  }
  return { ok: true };
}

function validateMcpCancelUnityTask(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  if (!isNonEmptyString(body.job_id)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "job_id is required",
      statusCode: 400,
    };
  }

  return { ok: true };
}

function validateMcpHeartbeat(body) {
  if (!isObject(body)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "Body must be a JSON object",
      statusCode: 400,
    };
  }

  const allowed = new Set(["thread_id", "job_id"]);
  const keysValidation = validateAllowedKeys(body, allowed, "body");
  if (!keysValidation.ok) {
    return keysValidation;
  }

  const threadId = isNonEmptyString(body.thread_id) ? body.thread_id.trim() : "";
  const jobId = isNonEmptyString(body.job_id) ? body.job_id.trim() : "";
  if (!threadId && !jobId) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "thread_id or job_id is required",
      statusCode: 400,
    };
  }

  if (body.thread_id !== undefined && body.thread_id !== null && !threadId) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "thread_id must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  if (body.job_id !== undefined && body.job_id !== null && !jobId) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      message: "job_id must be a non-empty string when provided",
      statusCode: 400,
    };
  }

  return { ok: true };
}

module.exports = {
  validateMcpGetUnityTaskStatus,
  validateMcpCancelUnityTask,
  validateMcpHeartbeat,
};

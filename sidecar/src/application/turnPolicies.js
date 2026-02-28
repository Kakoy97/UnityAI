"use strict";

const ANCHOR_RETRY_SUGGESTION =
  "请先调用读工具获取目标 object_id 与 path，再重试写操作。";
const OCC_STALE_SNAPSHOT_SUGGESTION = "请先调用读工具获取最新 token。";
const ANCHOR_ERROR_CODES = Object.freeze([
  "E_ACTION_SCHEMA_INVALID",
  "E_TARGET_ANCHOR_CONFLICT",
  // Backward-compatible alias from legacy target resolver.
  "E_TARGET_CONFLICT",
]);
const AUTO_CANCEL_ERROR_CODES = Object.freeze([
  "E_JOB_HEARTBEAT_TIMEOUT",
  "E_JOB_MAX_RUNTIME_EXCEEDED",
  "E_WAITING_FOR_UNITY_REBOOT_TIMEOUT",
]);
const AUTO_CANCEL_ERROR_MESSAGES = Object.freeze({
  E_JOB_HEARTBEAT_TIMEOUT:
    "Job lease heartbeat timed out. Job auto-cancelled.",
  E_JOB_MAX_RUNTIME_EXCEEDED:
    "Job runtime exceeded max_runtime_ms. Job auto-cancelled.",
  E_WAITING_FOR_UNITY_REBOOT_TIMEOUT:
    "Waiting for unity.runtime.ping exceeded reboot_wait_timeout_ms. Job auto-cancelled.",
});
const MCP_ERROR_FEEDBACK_TEMPLATES = Object.freeze({
  E_SCHEMA_INVALID: Object.freeze({
    recoverable: true,
    suggestion:
      "Fix request schema and resubmit. Ensure required fields are non-empty strings.",
  }),
  E_CONTEXT_DEPTH_VIOLATION: Object.freeze({
    recoverable: true,
    suggestion:
      "Set context.selection_tree.max_depth to 2 and retry submit_unity_task.",
  }),
  E_READ_REQUIRED: Object.freeze({
    recoverable: true,
    suggestion:
      "Call get_current_selection (or get_gameobject_components) first and submit with based_on_read_token.",
  }),
  E_STALE_SNAPSHOT: Object.freeze({
    recoverable: true,
    suggestion: OCC_STALE_SNAPSHOT_SUGGESTION,
  }),
  E_PRECONDITION_FAILED: Object.freeze({
    recoverable: true,
    suggestion:
      "Refresh Unity state, adjust preconditions (object/component/compile_idle), then retry the write tool.",
  }),
  E_SELECTION_UNAVAILABLE: Object.freeze({
    recoverable: true,
    suggestion:
      "Ensure Unity editor is connected and has pushed a recent selection snapshot, then retry MCP read tools.",
  }),
  E_TARGET_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "Use get_current_selection to confirm target_path, then call get_gameobject_components again.",
  }),
  E_TARGET_CONFLICT: Object.freeze({
    recoverable: true,
    suggestion: ANCHOR_RETRY_SUGGESTION,
  }),
  E_TARGET_ANCHOR_CONFLICT: Object.freeze({
    recoverable: true,
    suggestion: ANCHOR_RETRY_SUGGESTION,
  }),
  E_ACTION_SCHEMA_INVALID: Object.freeze({
    recoverable: true,
    suggestion: ANCHOR_RETRY_SUGGESTION,
  }),
  E_RESOURCE_NOT_FOUND: Object.freeze({
    recoverable: false,
    suggestion: "Check resources/list and use a valid resource URI.",
  }),
  E_MCP_EYES_DISABLED: Object.freeze({
    recoverable: true,
    suggestion: "Enable MCP read tools with ENABLE_MCP_EYES=true and restart sidecar.",
  }),
  E_JOB_CONFLICT: Object.freeze({
    recoverable: true,
    suggestion:
      "Use running_job_id for status/cancel, then retry after the running job finishes.",
  }),
  E_TOO_MANY_ACTIVE_TURNS: Object.freeze({
    recoverable: true,
    suggestion:
      "Wait for the active turn to finish or cancel it before submitting another job.",
  }),
  E_FILE_PATH_FORBIDDEN: Object.freeze({
    recoverable: true,
    suggestion:
      "Write files only under Assets/Scripts/AIGenerated and retry with a safe path.",
  }),
  E_FILE_SIZE_EXCEEDED: Object.freeze({
    recoverable: true,
    suggestion:
      "Reduce file content size below the configured sidecar maxFileBytes limit and retry.",
  }),
  E_FILE_EXISTS_BLOCKED: Object.freeze({
    recoverable: true,
    suggestion:
      "Use overwrite_if_exists=true or choose a new file path before retrying.",
  }),
  E_ACTION_COMPONENT_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "Query available components on target, then retry with a valid component name/type.",
  }),
  WAITING_FOR_UNITY_REBOOT: Object.freeze({
    recoverable: true,
    suggestion:
      "Wait for unity.runtime.ping recovery, then retry the pending visual action.",
  }),
  E_WAITING_FOR_UNITY_REBOOT: Object.freeze({
    recoverable: true,
    suggestion:
      "Wait for unity.runtime.ping recovery, then retry the pending visual action.",
  }),
  E_JOB_HEARTBEAT_TIMEOUT: Object.freeze({
    recoverable: true,
    suggestion:
      "Heartbeat lease expired. Re-check job status, refresh context, and resubmit with a new idempotency_key if needed.",
  }),
  E_JOB_MAX_RUNTIME_EXCEEDED: Object.freeze({
    recoverable: true,
    suggestion:
      "Job exceeded max runtime. Split the task into smaller actions and resubmit.",
  }),
  E_WAITING_FOR_UNITY_REBOOT_TIMEOUT: Object.freeze({
    recoverable: true,
    suggestion:
      "Unity reboot recovery timed out. Confirm editor compile health, then resubmit the pending action.",
  }),
  E_JOB_NOT_FOUND: Object.freeze({
    recoverable: false,
    suggestion: "Verify job_id and thread scope before polling or cancelling.",
  }),
  E_JOB_RECOVERY_STALE: Object.freeze({
    recoverable: true,
    suggestion:
      "Recovered stale pending job. Resubmit with a new idempotency_key if the task is still needed.",
  }),
  E_STREAM_SUBSCRIBERS_EXCEEDED: Object.freeze({
    recoverable: true,
    suggestion:
      "Too many active stream subscribers. Close stale streams and reconnect, or increase MCP_STREAM_MAX_SUBSCRIBERS.",
  }),
  E_NOT_FOUND: Object.freeze({
    recoverable: false,
    suggestion:
      "Enable MCP adapter (ENABLE_MCP_ADAPTER=true) or fallback to local direct endpoints.",
  }),
});
const MCP_ERROR_FEEDBACK_DEFAULT = Object.freeze({
  recoverable: false,
  timeoutSuggestion:
    "Retry once after backoff. If timeout persists, reduce task scope or inspect sidecar logs.",
  fallbackSuggestion:
    "Inspect error_code/error_message, adjust task payload, then retry if safe.",
});

function withAbortTimeout(promise, controller, timeoutMs, message) {
  const ms = Number(timeoutMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return promise;
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        if (controller && typeof controller.abort === "function") {
          controller.abort();
        }
      } catch {
        // ignore abort errors
      }
      reject(new Error(message || `operation timed out after ${ms}ms`));
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function isUnityRebootWaitErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) {
    return false;
  }
  return (
    code === "WAITING_FOR_UNITY_REBOOT" ||
    code === "E_WAITING_FOR_UNITY_REBOOT"
  );
}

function isAnchorValidationErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) {
    return false;
  }
  return ANCHOR_ERROR_CODES.includes(code);
}

function isAutoCancelErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!code) {
    return false;
  }
  return AUTO_CANCEL_ERROR_CODES.includes(code);
}

function normalizePolicyErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return code || "E_INTERNAL";
}

function resolveAutoCancelErrorMessage(errorCode) {
  const code = normalizePolicyErrorCode(errorCode);
  return AUTO_CANCEL_ERROR_MESSAGES[code] || "";
}

function getMcpErrorFeedbackTemplate(errorCode, errorMessage) {
  const code = normalizePolicyErrorCode(errorCode);
  const message = typeof errorMessage === "string" ? errorMessage : "";
  if (isAnchorValidationErrorCode(code)) {
    return {
      recoverable: true,
      suggestion: ANCHOR_RETRY_SUGGESTION,
    };
  }

  const template = MCP_ERROR_FEEDBACK_TEMPLATES[code];
  if (template && typeof template === "object") {
    return {
      recoverable: template.recoverable === true,
      suggestion: template.suggestion || MCP_ERROR_FEEDBACK_DEFAULT.fallbackSuggestion,
    };
  }

  if (message.toLowerCase().includes("timeout")) {
    return {
      recoverable: MCP_ERROR_FEEDBACK_DEFAULT.recoverable,
      suggestion: MCP_ERROR_FEEDBACK_DEFAULT.timeoutSuggestion,
    };
  }

  return {
    recoverable: MCP_ERROR_FEEDBACK_DEFAULT.recoverable,
    suggestion: MCP_ERROR_FEEDBACK_DEFAULT.fallbackSuggestion,
  };
}

module.exports = {
  ANCHOR_RETRY_SUGGESTION,
  OCC_STALE_SNAPSHOT_SUGGESTION,
  ANCHOR_ERROR_CODES,
  AUTO_CANCEL_ERROR_CODES,
  AUTO_CANCEL_ERROR_MESSAGES,
  MCP_ERROR_FEEDBACK_TEMPLATES,
  withAbortTimeout,
  isUnityRebootWaitErrorCode,
  isAnchorValidationErrorCode,
  isAutoCancelErrorCode,
  resolveAutoCancelErrorMessage,
  getMcpErrorFeedbackTemplate,
};

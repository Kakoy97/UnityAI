/**
 * R10-ARCH-01 Responsibility boundary:
 * - This module only defines policy taxonomy/recoverability/suggestions.
 * - This module must not validate incoming schema payloads.
 * - This module must not build or stringify transport payload bodies.
 */

"use strict";

const {
  resolveSchemaIssueClassification,
} = require("./schemaIssueClassifier");
const { buildRetryPolicyForErrorCode } = require("./retryPolicy");

const ERROR_SCHEMA_HINT_MAX_CHARS = 0;

const ANCHOR_RETRY_SUGGESTION =
  "请先调用读工具获取目标 object_id 与 path，再重试写操作。";
const OCC_STALE_SNAPSHOT_SUGGESTION = "请先调用读工具获取最新 token，并仅重试一次写操作。";
const ASYNC_TERMINAL_POLL_SUGGESTION =
  "写请求提交后必须轮询 get_unity_task_status，直到状态进入 succeeded/failed/cancelled；accepted/queued 仅表示已受理。";
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
      "Fix request schema and resubmit. Ensure required fields are non-empty strings; use get_tool_schema when unsure about tool payload shape.",
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
  E_UNITY_NOT_CONNECTED: Object.freeze({
    recoverable: true,
    suggestion:
      "Wait until Unity connection state is ready (runtime ping + capability report), then retry write tools.",
  }),
  E_CONTRACT_VERSION_MISMATCH: Object.freeze({
    recoverable: true,
    suggestion:
      "Refresh capability contracts (get_write_contract_bundle or get_action_schema/get_action_catalog), then retry write payload with latest catalog_version when Unity state is ready.",
  }),
  E_SCREENSHOT_VIEW_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "Switch to an available Scene/Game view in Unity Editor, then retry capture_scene_screenshot.",
  }),
  E_SCREENSHOT_CAPTURE_FAILED: Object.freeze({
    recoverable: true,
    suggestion:
      "Screenshot capture failed. Check Unity editor state and retry; lower resolution if needed.",
  }),
  E_CAPTURE_MODE_DISABLED: Object.freeze({
    recoverable: true,
    suggestion:
      "capture_scene_screenshot currently keeps render_output as baseline. If you need composite, enable CAPTURE_COMPOSITE_ENABLED + UNITY_CAPTURE_COMPOSITE_ENABLED; otherwise retry with render_output after get_ui_overlay_report.",
  }),
  E_COMPOSITE_BUSY: Object.freeze({
    recoverable: true,
    suggestion:
      "Another composite capture is running. Wait for it to finish, then retry capture_scene_screenshot(capture_mode=composite).",
  }),
  E_COMPOSITE_PLAYMODE_REQUIRED: Object.freeze({
    recoverable: true,
    suggestion:
      "Composite capture currently requires Unity Play Mode. Enter Play Mode or fallback to capture_mode=render_output.",
  }),
  E_COMPOSITE_CAPTURE_RESTRICTED: Object.freeze({
    recoverable: true,
    suggestion:
      "Composite EditMode capture was restricted by safety guard. Retry with capture_mode=render_output and inspect get_ui_overlay_report.",
  }),
  E_UI_OVERLAY_REPORT_SOURCE_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "Overlay UI source was not found. Ensure target Canvas exists and retry get_ui_overlay_report.",
  }),
  E_UI_OVERLAY_REPORT_QUERY_FAILED: Object.freeze({
    recoverable: true,
    suggestion:
      "Overlay report query failed. Check Unity editor state and retry get_ui_overlay_report with lower max_nodes/budgets if needed.",
  }),
  E_UI_TREE_SOURCE_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "UI root/source was not found. Ensure target Canvas/UIDocument exists, then retry get_ui_tree.",
  }),
  E_UI_TREE_QUERY_FAILED: Object.freeze({
    recoverable: true,
    suggestion:
      "UI tree query failed. Check Unity editor state and retry get_ui_tree with lower depth/budget if needed.",
  }),
  E_UI_HIT_TEST_SOURCE_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "UI hit test source is unavailable. Ensure Game view + EventSystem + GraphicRaycaster are active, then retry hit_test_ui_at_viewport_point.",
  }),
  E_UI_HIT_TEST_QUERY_FAILED: Object.freeze({
    recoverable: true,
    suggestion:
      "UI hit test failed. Verify viewport point and resolution mapping, then retry hit_test_ui_at_viewport_point.",
  }),
  E_UI_COORD_MAPPING_INVALID: Object.freeze({
    recoverable: true,
    suggestion:
      "Coordinate mapping is invalid. Check coord_space/coord_origin and ensure x/y are in valid range, then retry hit_test_ui_at_viewport_point.",
  }),
  E_UI_RUNTIME_RESOLUTION_UNAVAILABLE: Object.freeze({
    recoverable: true,
    suggestion:
      "Runtime resolution is unavailable. Provide resolution explicitly or ensure scope points to an active Canvas, then retry.",
  }),
  E_UI_LAYOUT_VALIDATION_FAILED: Object.freeze({
    recoverable: true,
    suggestion:
      "UI layout validation failed. Reduce scope or issue budgets, then retry validate_ui_layout.",
  }),
  E_UI_LAYOUT_SCOPE_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "UI layout scope root was not found. Verify scope.root_path and retry validate_ui_layout.",
  }),
  E_UI_LAYOUT_PARTIAL: Object.freeze({
    recoverable: true,
    suggestion:
      "Layout validation returned partial results due to budget. Increase time_budget_ms/max_issues or narrow scope and retry.",
  }),
  E_COMMAND_DISABLED: Object.freeze({
    recoverable: true,
    suggestion:
      "This command is currently disabled. Use tools/list for current availability and prefer get_ui_overlay_report + get_ui_tree + capture_scene_screenshot(render_output).",
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
  E_JOB_CONFLICT: Object.freeze({
    recoverable: true,
    suggestion:
      `${ASYNC_TERMINAL_POLL_SUGGESTION} Use running_job_id to track the running task, then retry after terminal.`,
  }),
  E_TOO_MANY_ACTIVE_TURNS: Object.freeze({
    recoverable: true,
    suggestion:
      `${ASYNC_TERMINAL_POLL_SUGGESTION} Wait for the active turn to become terminal, or cancel it before submitting another job.`,
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
  E_ACTION_HANDLER_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "Call tools/list (or get_action_schema) to confirm supported action_type, then retry with a registered handler.",
  }),
  E_ACTION_DESERIALIZE_FAILED: Object.freeze({
    recoverable: true,
    suggestion:
      "Fix action_data to match the handler DTO schema. Use get_action_schema for exact field names/types before retry.",
  }),
  E_ACTION_PAYLOAD_INVALID: Object.freeze({
    recoverable: true,
    suggestion:
      "Action payload shape is invalid. Refresh schema via get_action_schema and resubmit with valid action_data + anchors.",
  }),
  E_ACTION_RESULT_MISSING_ERROR_CODE: Object.freeze({
    recoverable: true,
    suggestion:
      "Unity action failed without explicit error_code. Check Unity-side handler error mapping and retry after logs are fixed.",
  }),
  E_ACTION_CAPABILITY_MISMATCH: Object.freeze({
    recoverable: true,
    suggestion:
      "Requested action is not in current Unity capability set. Refresh tools/list and retry with a supported action_type.",
  }),
  E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED: Object.freeze({
    recoverable: true,
    suggestion:
      "Do not send stringified action_data fields. Send action_data as a JSON object and retry.",
  }),
  E_ACTION_PROPERTY_WRITE_RESTRICTED: Object.freeze({
    recoverable: true,
    suggestion:
      "Target property is write-restricted in set_serialized_property (for example ManagedReference/AnimationCurve). Use get_serialized_property_tree to inspect writable fields, then retry with supported paths.",
  }),
  E_COMPOSITE_PAYLOAD_INVALID: Object.freeze({
    recoverable: true,
    suggestion:
      "Fix composite action_data/steps schema (step_id, anchors, bind_outputs) and retry. Use get_action_schema when unsure.",
  }),
  E_COMPOSITE_ALIAS_INVALID: Object.freeze({
    recoverable: true,
    suggestion:
      "Alias name or anchor_ref usage is invalid. Use lower_snake_case aliases and keep *_anchor with *_anchor_ref mutually exclusive.",
  }),
  E_COMPOSITE_ALIAS_DUPLICATED: Object.freeze({
    recoverable: true,
    suggestion:
      "Each alias can be bound only once in a transaction. Rename duplicated aliases and retry.",
  }),
  E_COMPOSITE_ALIAS_FORWARD_REF: Object.freeze({
    recoverable: true,
    suggestion:
      "Alias references must point to outputs of previous steps only. Reorder steps or remove forward refs.",
  }),
  E_COMPOSITE_ALIAS_NOT_FOUND: Object.freeze({
    recoverable: true,
    suggestion:
      "Alias was not found at execution time. Ensure bind_outputs succeeded before referencing target_anchor_ref/parent_anchor_ref.",
  }),
  E_COMPOSITE_ALIAS_INLINE_REF_UNSUPPORTED: Object.freeze({
    recoverable: true,
    suggestion:
      "Inline alias interpolation in action_data is not supported in v1. Split into separate steps or wait for AliasResolver upgrade.",
  }),
  E_COMPOSITE_BUDGET_EXCEEDED: Object.freeze({
    recoverable: true,
    suggestion:
      "Composite budget exceeded limits. Reduce step count/max_step_ms or split the task into smaller transactions.",
  }),
  E_COMPOSITE_STEP_FAILED: Object.freeze({
    recoverable: true,
    suggestion:
      "A composite step failed and transaction rolled back. Fix the failing step payload and retry the whole transaction.",
  }),
  E_COMPOSITE_ROLLBACK_INCOMPLETE: Object.freeze({
    recoverable: false,
    suggestion:
      "Rollback integrity failed and write circuit is closed. Inspect Unity logs and recover editor state before retrying.",
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
      "Unity reboot recovery timed out. Confirm editor compile health, then resubmit and poll get_unity_task_status until terminal.",
  }),
  E_JOB_NOT_FOUND: Object.freeze({
    recoverable: false,
    suggestion: "Verify job_id and thread scope before polling or cancelling.",
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
  const retryPolicy = buildRetryPolicyForErrorCode(code);
  if (isAnchorValidationErrorCode(code)) {
    return {
      recoverable: true,
      suggestion: ANCHOR_RETRY_SUGGESTION,
      retry_policy: retryPolicy,
    };
  }

  const template = MCP_ERROR_FEEDBACK_TEMPLATES[code];
  if (template && typeof template === "object") {
    return {
      recoverable: template.recoverable === true,
      suggestion: template.suggestion || MCP_ERROR_FEEDBACK_DEFAULT.fallbackSuggestion,
      retry_policy: retryPolicy,
    };
  }

  if (message.toLowerCase().includes("timeout")) {
    return {
      recoverable: MCP_ERROR_FEEDBACK_DEFAULT.recoverable,
      suggestion: MCP_ERROR_FEEDBACK_DEFAULT.timeoutSuggestion,
      retry_policy: retryPolicy,
    };
  }

  return {
    recoverable: MCP_ERROR_FEEDBACK_DEFAULT.recoverable,
    suggestion: MCP_ERROR_FEEDBACK_DEFAULT.fallbackSuggestion,
    retry_policy: retryPolicy,
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
  resolveSchemaIssueClassification,
  ERROR_SCHEMA_HINT_MAX_CHARS,
  getMcpErrorFeedbackTemplate,
};


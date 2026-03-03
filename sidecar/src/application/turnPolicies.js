/**
 * R10-ARCH-01 Responsibility boundary:
 * - This module only defines policy taxonomy/recoverability/suggestions.
 * - This module must not validate incoming schema payloads.
 * - This module must not build or stringify transport payload bodies.
 */

"use strict";

const {
  SCHEMA_ISSUE_CATEGORIES,
  resolveSchemaIssueClassification,
} = require("./schemaIssueClassifier");
const {
  buildAnchorMachineFixCompensation,
} = require("./schemaCompensationFixes");
const { buildRetryPolicyForErrorCode } = require("./retryPolicy");

const ANCHOR_RETRY_SUGGESTION =
  "请先调用读工具获取目标 object_id 与 path，再重试写操作。";
const OCC_STALE_SNAPSHOT_SUGGESTION = "请先调用读工具获取最新 token，并仅重试一次写操作。";
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
const ERROR_SCHEMA_HINT_MAX_CHARS = 1200;
const COMPOSITE_ACTION_TYPE = "composite_visual_action";
const SCHEMA_COMPENSATION_ERROR_CODES = new Set([
  "E_SCHEMA_INVALID",
  "E_ACTION_SCHEMA_INVALID",
  "E_ACTION_PAYLOAD_INVALID",
  "E_ACTION_DESERIALIZE_FAILED",
  "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
  "E_COMPOSITE_PAYLOAD_INVALID",
]);
const ACTION_SCHEMA_PRIORITY_ERROR_CODES = new Set([
  "E_ACTION_SCHEMA_INVALID",
  "E_ACTION_PAYLOAD_INVALID",
  "E_ACTION_DESERIALIZE_FAILED",
  "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
  "E_COMPOSITE_PAYLOAD_INVALID",
]);
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

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseIndexedPath(path, pattern) {
  const text = normalizeOptionalString(path);
  if (!text) {
    return -1;
  }
  const match = text.match(pattern);
  if (!match) {
    return -1;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 0 || Math.floor(parsed) !== parsed) {
    return -1;
  }
  return parsed;
}

function measureJsonChars(value) {
  try {
    return JSON.stringify(value || {}).length;
  } catch {
    return ERROR_SCHEMA_HINT_MAX_CHARS + 1;
  }
}

function selectActionListFromRequest(requestBody) {
  const payload = isObject(requestBody) ? requestBody : {};
  if (Array.isArray(payload.actions)) {
    return payload.actions;
  }
  if (Array.isArray(payload.visual_layer_actions)) {
    return payload.visual_layer_actions;
  }
  return [];
}

function resolveCompositeSchemaFocus(validationMessage, requestBody) {
  const actions = selectActionListFromRequest(requestBody);
  const actionIndex = parseIndexedPath(
    validationMessage,
    /(?:actions|visual_layer_actions)\[(\d+)\]/
  );
  const stepIndex = parseIndexedPath(validationMessage, /steps\[(\d+)\]/);
  const compositeAction =
    actionIndex >= 0 && actions[actionIndex] && typeof actions[actionIndex] === "object"
      ? actions[actionIndex]
      : actions.find(
          (item) =>
            item &&
            typeof item === "object" &&
            normalizeOptionalString(item.type) === COMPOSITE_ACTION_TYPE
        ) || null;
  const actionData = compositeAction && isObject(compositeAction.action_data)
    ? compositeAction.action_data
    : {};
  const steps = Array.isArray(actionData.steps) ? actionData.steps : [];
  const focusedStep =
    stepIndex >= 0 && steps[stepIndex] && typeof steps[stepIndex] === "object"
      ? steps[stepIndex]
      : null;
  const focusedStepType = normalizeOptionalString(focusedStep && focusedStep.type);
  return {
    action_type: COMPOSITE_ACTION_TYPE,
    action_index: actionIndex,
    step_index: stepIndex,
    step_action_type: focusedStepType || "",
  };
}

function buildCompositeSchemaHint(focus) {
  const scope = focus && typeof focus === "object" ? focus : {};
  const hint = {
    action_type: COMPOSITE_ACTION_TYPE,
    required: ["schema_version", "transaction_id", "steps"],
    properties: {
      schema_version: {
        type: "string",
        example: "r10.v1",
      },
      transaction_id: {
        type: "string",
        example: "tx_ui_hpbar_001",
      },
      atomic_mode: {
        type: "string",
        enum: ["all_or_nothing"],
      },
      max_step_ms: {
        type: "integer",
        range: [1, 2000],
      },
      steps: {
        type: "array",
        min_items: 1,
        max_items: 8,
        item_required: ["step_id", "type", "action_data"],
        item_properties: {
          step_id: { type: "string", pattern: "^[a-z][a-z0-9_]{2,47}$" },
          type: { type: "string", example: "create_gameobject" },
          target_anchor: {
            type: "object",
            required: ["object_id", "path"],
          },
          target_anchor_ref: { type: "string", pattern: "^[a-z][a-z0-9_]{2,31}$" },
          parent_anchor: {
            type: "object",
            required: ["object_id", "path"],
          },
          parent_anchor_ref: { type: "string", pattern: "^[a-z][a-z0-9_]{2,31}$" },
          action_data: { type: "object" },
          bind_outputs: {
            type: "array",
            item_required: ["source", "alias"],
            item_properties: {
              source: {
                type: "string",
                enum: ["created_object", "target_object", "parent_object"],
              },
              alias: { type: "string", pattern: "^[a-z][a-z0-9_]{2,31}$" },
            },
          },
        },
      },
    },
    example: {
      schema_version: "r10.v1",
      transaction_id: "tx_ui_hpbar_001",
      steps: [
        {
          step_id: "s1_create_root",
          type: "create_gameobject",
          parent_anchor: {
            object_id: "go_canvas",
            path: "Scene/Canvas",
          },
          action_data: {
            name: "HealthBar",
          },
          bind_outputs: [
            {
              source: "created_object",
              alias: "hp_root",
            },
          ],
        },
        {
          step_id: "s2_set_color",
          type: "set_ui_image_color",
          target_anchor_ref: "hp_root",
          action_data: {
            r: 1,
            g: 0.25,
            b: 0.25,
            a: 1,
          },
        },
      ],
    },
  };

  const stepType = normalizeOptionalString(scope.step_action_type);
  if (stepType) {
    hint.focus = {
      step_action_type: stepType,
      message:
        "Current error is within composite step payload. Fix the specific step action_data first.",
    };
  }

  return hint;
}

function buildCompactCompositeSchemaHint() {
  return {
    action_type: COMPOSITE_ACTION_TYPE,
    required: ["schema_version", "transaction_id", "steps"],
    step_required: ["step_id", "type", "action_data"],
    example: {
      schema_version: "r10.v1",
      transaction_id: "tx_ui_hpbar_001",
      steps: [
        {
          step_id: "s1_create_root",
          type: "create_gameobject",
          parent_anchor: { object_id: "go_canvas", path: "Scene/Canvas" },
          action_data: { name: "HealthBar" },
        },
      ],
    },
  };
}

function buildSchemaRef(actionType, catalogVersion) {
  const normalizedType = normalizeOptionalString(actionType) || COMPOSITE_ACTION_TYPE;
  const normalizedVersion = normalizeOptionalString(catalogVersion);
  return {
    tool: "get_action_schema",
    params: {
      action_type: normalizedType,
      ...(normalizedVersion ? { catalog_version: normalizedVersion } : {}),
    },
  };
}

function buildToolSchemaRef(toolName) {
  const normalizedToolName = normalizeOptionalString(toolName);
  if (!normalizedToolName) {
    return null;
  }
  return {
    tool: "get_tool_schema",
    params: {
      tool_name: normalizedToolName,
    },
  };
}

function resolveToolNameForSchemaCompensation(options, requestBody) {
  const opts = options && typeof options === "object" ? options : {};
  const fromOptions = normalizeOptionalString(opts.toolName || opts.commandName);
  if (fromOptions) {
    return fromOptions;
  }
  const payload = isObject(requestBody) ? requestBody : {};
  if (Array.isArray(payload.visual_layer_actions) || Array.isArray(payload.file_actions)) {
    return "submit_unity_task";
  }
  const actions = Array.isArray(payload.actions) ? payload.actions : [];
  if (actions.length <= 0) {
    return "";
  }
  let visualHint = false;
  let scriptHint = false;
  for (const action of actions) {
    if (!isObject(action)) {
      continue;
    }
    if (
      isObject(action.target_anchor) ||
      isObject(action.parent_anchor) ||
      isObject(action.action_data)
    ) {
      visualHint = true;
    }
    if (
      normalizeOptionalString(action.path) ||
      normalizeOptionalString(action.from_path) ||
      normalizeOptionalString(action.to_path) ||
      normalizeOptionalString(action.file_path)
    ) {
      scriptHint = true;
    }
  }
  if (visualHint) {
    return "apply_visual_actions";
  }
  if (scriptHint) {
    return "apply_script_actions";
  }
  return "";
}

function resolveActionTypeForSchemaCompensation(requestBody) {
  const payload = isObject(requestBody) ? requestBody : {};
  const actions = Array.isArray(payload.actions)
    ? payload.actions
    : Array.isArray(payload.visual_layer_actions)
      ? payload.visual_layer_actions
      : [];
  for (const action of actions) {
    const actionType = normalizeOptionalString(action && action.type);
    if (actionType) {
      return actionType;
    }
  }
  return "";
}

function shouldUseActionSchemaCompensation(code, actionSchemaRef, schemaIssue) {
  if (!actionSchemaRef || !ACTION_SCHEMA_PRIORITY_ERROR_CODES.has(code)) {
    return false;
  }

  if (code === "E_ACTION_DESERIALIZE_FAILED") {
    return true;
  }
  if (code === "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED") {
    return true;
  }
  if (code === "E_ACTION_PAYLOAD_INVALID") {
    return schemaIssue.category !== SCHEMA_ISSUE_CATEGORIES.anchor;
  }
  if (code === "E_ACTION_SCHEMA_INVALID") {
    if (
      schemaIssue.category === SCHEMA_ISSUE_CATEGORIES.anchor ||
      schemaIssue.category === SCHEMA_ISSUE_CATEGORIES.token
    ) {
      return false;
    }
    return true;
  }
  return true;
}

function buildValidationSchemaCompensation(validation, options) {
  const source = validation && typeof validation === "object" ? validation : {};
  const code = normalizePolicyErrorCode(source.errorCode || source.error_code);
  if (!SCHEMA_COMPENSATION_ERROR_CODES.has(code)) {
    return null;
  }

  const opts = options && typeof options === "object" ? options : {};
  const requestBody = isObject(opts.requestBody) ? opts.requestBody : {};
  const toolName = resolveToolNameForSchemaCompensation(opts, requestBody);
  const toolSchemaRef = buildToolSchemaRef(toolName);
  const catalogVersion = normalizeOptionalString(
    opts.catalogVersion || opts.capabilityVersion
  );
  const actionType = resolveActionTypeForSchemaCompensation(requestBody);
  const actionSchemaRef = actionType
    ? buildSchemaRef(actionType, catalogVersion)
    : null;
  const schemaIssue = resolveSchemaIssueClassification(source);
  const machineFixCompensation = buildAnchorMachineFixCompensation(
    {
      requestBody,
      correctedPayload: opts.correctedPayload,
    },
    schemaIssue
  );

  if (code !== "E_COMPOSITE_PAYLOAD_INVALID") {
    const useActionSchema = shouldUseActionSchemaCompensation(
      code,
      actionSchemaRef,
      schemaIssue
    );
    const primarySchemaRef = useActionSchema
      ? actionSchemaRef
      : toolSchemaRef || actionSchemaRef;
    if (!primarySchemaRef) {
      return null;
    }
    return {
      retryable: true,
      schema_source: useActionSchema ? "get_action_schema" : "get_tool_schema",
      schema_ref: primarySchemaRef,
      schema_issue_category: schemaIssue.category,
      ...(schemaIssue.field_path ? { field_path: schemaIssue.field_path } : {}),
      ...(schemaIssue.fix_kind ? { fix_kind: schemaIssue.fix_kind } : {}),
      ...(machineFixCompensation ? machineFixCompensation : {}),
      ...(toolSchemaRef &&
      (primarySchemaRef.tool !== toolSchemaRef.tool ||
        primarySchemaRef.params.tool_name !== toolSchemaRef.params.tool_name)
        ? { tool_schema_ref: toolSchemaRef }
        : {}),
    };
  }

  const focus = resolveCompositeSchemaFocus(source.message, requestBody);
  const schemaRef = buildSchemaRef(focus.action_type, catalogVersion);

  const fullHint = buildCompositeSchemaHint(focus);
  const fullChars = measureJsonChars(fullHint);
  if (fullChars <= ERROR_SCHEMA_HINT_MAX_CHARS) {
    return {
      retryable: true,
      schema_source: "inline_hint",
      schema_hint: fullHint,
      schema_hint_chars: fullChars,
      schema_ref: schemaRef,
      ...(toolSchemaRef ? { tool_schema_ref: toolSchemaRef } : {}),
    };
  }

  const compactHint = buildCompactCompositeSchemaHint();
  const compactChars = measureJsonChars(compactHint);
  if (compactChars <= ERROR_SCHEMA_HINT_MAX_CHARS) {
    return {
      retryable: true,
      schema_source: "inline_hint",
      schema_hint: compactHint,
      schema_hint_chars: compactChars,
      schema_hint_truncated: true,
      schema_ref: schemaRef,
      ...(toolSchemaRef ? { tool_schema_ref: toolSchemaRef } : {}),
    };
  }

  return {
    retryable: true,
    schema_source: "get_action_schema",
    schema_ref: schemaRef,
    schema_hint_truncated: true,
    ...(toolSchemaRef ? { tool_schema_ref: toolSchemaRef } : {}),
  };
}

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
  buildValidationSchemaCompensation,
  resolveSchemaIssueClassification,
  ERROR_SCHEMA_HINT_MAX_CHARS,
  getMcpErrorFeedbackTemplate,
};


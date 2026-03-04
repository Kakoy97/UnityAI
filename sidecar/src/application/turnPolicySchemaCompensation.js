"use strict";

const {
  resolveSchemaIssueClassification,
  SCHEMA_ISSUE_CATEGORIES,
} = require("./schemaIssueClassifier");
const {
  canonicalizeVisualActionType,
} = require("../domain/actionTypeCanonicalizer");
// R21-detox: removed schemaCompensationFixes (JSON Patch generator).
// corrected_payload / suggested_patch are no longer emitted.

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

function normalizePolicyErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return code || "E_INTERNAL";
}

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
          type: { type: "string", example: "create_object" },
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
          type: "create_object",
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
          type: "create_object",
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
      return canonicalizeVisualActionType(actionType);
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

module.exports = {
  ERROR_SCHEMA_HINT_MAX_CHARS,
  buildValidationSchemaCompensation,
};

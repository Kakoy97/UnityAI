"use strict";

const DEFAULT_BUNDLE_BUDGET_CHARS = 3600;
const MIN_BUNDLE_BUDGET_CHARS = 800;
const MAX_BUNDLE_BUDGET_CHARS = 12000;
const BUNDLE_TRIM_PRIORITY = Object.freeze([
  "write_envelope_contract",
  "minimal_valid_payload_template",
  "canonical_examples",
  "error_fix_map",
]);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeBudgetChars(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_BUNDLE_BUDGET_CHARS;
  }
  const rounded = Math.floor(numeric);
  if (rounded < MIN_BUNDLE_BUDGET_CHARS) {
    return MIN_BUNDLE_BUDGET_CHARS;
  }
  if (rounded > MAX_BUNDLE_BUDGET_CHARS) {
    return MAX_BUNDLE_BUDGET_CHARS;
  }
  return rounded;
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function measureJsonChars(value) {
  try {
    return JSON.stringify(value || {}).length;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function resolveAnchorRequirement(actionType, anchorPolicy) {
  const type = normalizeString(actionType).toLowerCase();
  const policy = normalizeString(anchorPolicy).toLowerCase();
  if (policy === "parent_required") {
    return "parent_required";
  }
  if (policy === "target_or_parent" || policy === "target_or_parent_required") {
    return "target_or_parent_required";
  }
  if (policy === "target_required") {
    return "target_required";
  }
  if (type === "create_gameobject" || type === "create_object") {
    return "parent_required";
  }
  return "target_required";
}

function buildRequiredSequence(toolName) {
  const name = normalizeString(toolName);
  switch (name) {
    case "apply_visual_actions":
    case "set_ui_properties":
    case "set_serialized_property":
    case "apply_script_actions":
    case "submit_unity_task":
      return ["get_current_selection", name];
    case "get_write_contract_bundle":
      return ["get_write_contract_bundle"];
    default:
      return [];
  }
}

function buildActionAnchorTemplate(anchorRequirement) {
  if (anchorRequirement === "parent_required") {
    return {
      parent_anchor: {
        object_id: "<id>",
        path: "Scene/Path",
      },
    };
  }
  return {
    target_anchor: {
      object_id: "<id>",
      path: "Scene/Path",
    },
  };
}

function buildWriteEnvelopeContract(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName) || "apply_visual_actions";
  const anchorRequirement = resolveAnchorRequirement(
    opts.actionType,
    opts.anchorPolicy
  );

  if (toolName === "set_ui_properties") {
    return {
      tool_name: toolName,
      required_top_level: ["based_on_read_token", "write_anchor", "operations"],
      write_anchor_shape: {
        object_id: "string(minLength=1)",
        path: "string(minLength=1)",
      },
      operation_anchor_shape: {
        object_id: "string(minLength=1)",
        path: "string(minLength=1)",
      },
      required_sequence: buildRequiredSequence(toolName),
    };
  }

  if (toolName === "set_serialized_property") {
    return {
      tool_name: toolName,
      required_top_level: [
        "based_on_read_token",
        "write_anchor",
        "target_anchor",
        "component_selector",
        "patches",
      ],
      write_anchor_shape: {
        object_id: "string(minLength=1)",
        path: "string(minLength=1)",
      },
      target_anchor_shape: {
        object_id: "string(minLength=1)",
        path: "string(minLength=1)",
      },
      required_sequence: buildRequiredSequence(toolName),
    };
  }

  return {
    tool_name: toolName,
    required_top_level: ["based_on_read_token", "write_anchor", "actions"],
    required_action_level:
      anchorRequirement === "parent_required"
        ? ["type", "parent_anchor", "action_data"]
        : ["type", "target_anchor", "action_data"],
    ...(anchorRequirement === "target_or_parent_required"
      ? { required_action_any_of: [["target_anchor"], ["parent_anchor"]] }
      : {}),
    action_anchor_requirement: anchorRequirement,
    write_anchor_shape: {
      object_id: "string(minLength=1)",
      path: "string(minLength=1)",
    },
    required_sequence: buildRequiredSequence(toolName),
  };
}

function buildMinimalValidPayloadTemplate(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName) || "apply_visual_actions";
  const actionType = normalizeString(opts.actionType) || "rename_object";
  const anchorRequirement = resolveAnchorRequirement(actionType, opts.anchorPolicy);

  if (toolName === "set_ui_properties") {
    return {
      based_on_read_token: "<from get_current_selection.read_token>",
      write_anchor: {
        object_id: "<id>",
        path: "Scene/Canvas",
      },
      operations: [
        {
          target_anchor: {
            object_id: "<id>",
            path: "Scene/Canvas/Button",
          },
          text: {
            content: "Play",
          },
        },
      ],
    };
  }

  if (toolName === "set_serialized_property") {
    return {
      based_on_read_token: "<from get_current_selection.read_token>",
      write_anchor: {
        object_id: "<id>",
        path: "Scene/Canvas",
      },
      target_anchor: {
        object_id: "<id>",
        path: "Scene/Canvas/Button",
      },
      component_selector: {
        component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
        component_index: 0,
      },
      patches: [
        {
          property_path: "m_Enabled",
          value_kind: "bool",
          bool_value: true,
        },
      ],
    };
  }

  if (toolName === "submit_unity_task") {
    return {
      thread_id: "t_default",
      idempotency_key: "idem_<unique>",
      user_intent: "apply one visual action",
      based_on_read_token: "<from get_current_selection.read_token>",
      write_anchor: {
        object_id: "<id>",
        path: "Scene/Path",
      },
      visual_layer_actions: [
        {
          type: actionType,
          ...buildActionAnchorTemplate(anchorRequirement),
          action_data: {},
        },
      ],
    };
  }

  if (toolName === "apply_script_actions") {
    return {
      based_on_read_token: "<from get_current_selection.read_token>",
      write_anchor: {
        object_id: "<id>",
        path: "Scene/Path",
      },
      actions: [
        {
          type: "write_file",
          file_path: "Assets/Scripts/AIGenerated/NewFile.cs",
          content: "// generated content",
          overwrite_if_exists: false,
        },
      ],
    };
  }

  return {
    based_on_read_token: "<from get_current_selection.read_token>",
    write_anchor: {
      object_id: "<id>",
      path: "Scene/Path",
    },
    actions: [
      {
        type: actionType,
        ...buildActionAnchorTemplate(anchorRequirement),
        action_data: {},
      },
    ],
  };
}

function buildCanonicalExamples(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName) || "apply_visual_actions";
  const actionType = normalizeString(opts.actionType) || "rename_object";
  return [
    {
      name: "minimal_valid_payload",
      summary: "Smallest valid payload with OCC/read token + anchors.",
      payload: buildMinimalValidPayloadTemplate({
        toolName,
        actionType,
        anchorPolicy: opts.anchorPolicy,
      }),
    },
  ];
}

function buildErrorFixMap() {
  return {
    E_ACTION_SCHEMA_INVALID: {
      summary: "Anchor or payload shape invalid.",
      next_step: "call_get_tool_schema_then_retry",
      preferred_schema_tool: "get_tool_schema",
    },
    E_STALE_SNAPSHOT: {
      summary: "Read token is stale.",
      next_step: "call_get_current_selection_then_retry",
      preferred_schema_tool: "none",
    },
    E_ACTION_DESERIALIZE_FAILED: {
      summary: "action_data does not match action DTO schema.",
      next_step: "call_get_action_schema_then_retry",
      preferred_schema_tool: "get_action_schema",
    },
  };
}

function summarizeActionSchema(actionSchema) {
  const source = actionSchema && typeof actionSchema === "object" ? actionSchema : {};
  const action = source.action && typeof source.action === "object" ? source.action : {};
  return {
    action_type: normalizeString(source.action_type || action.type),
    anchor_policy: normalizeString(action.anchor_policy),
    schema_hint: cloneJson(source.schema_hint || {}),
  };
}

function summarizeToolSchema(toolMetadata) {
  const source =
    toolMetadata && typeof toolMetadata === "object" ? toolMetadata : {};
  const inputSchema =
    source.input_schema && typeof source.input_schema === "object"
      ? source.input_schema
      : {};
  const requiredTopLevel = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((item) => typeof item === "string")
    : [];
  return {
    tool_name: normalizeString(source.name),
    transport: cloneJson(source.transport || {}),
    required_top_level: requiredTopLevel,
  };
}

function trimBundleToBudget(bundle, budgetChars) {
  const result = cloneJson(bundle) || {};
  const removableKeys = [
    "error_fix_map",
    "canonical_examples",
    "tool_schema_summary",
    "action_schema_summary",
  ];
  let truncated = false;

  while (measureJsonChars(result) > budgetChars && removableKeys.length > 0) {
    const key = removableKeys.shift();
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      delete result[key];
      truncated = true;
    }
  }

  if (measureJsonChars(result) > budgetChars) {
    result.minimal_valid_payload_template = {
      based_on_read_token: "<token>",
      write_anchor: {
        object_id: "<id>",
        path: "Scene/Path",
      },
      actions: [{ type: "<action_type>" }],
    };
    truncated = true;
  }

  if (measureJsonChars(result) > budgetChars) {
    const contract =
      result.write_envelope_contract &&
      typeof result.write_envelope_contract === "object"
        ? result.write_envelope_contract
        : {};
    result.write_envelope_contract = {
      tool_name: normalizeString(contract.tool_name) || "apply_visual_actions",
      required_top_level: Array.isArray(contract.required_top_level)
        ? contract.required_top_level
        : ["based_on_read_token", "write_anchor", "actions"],
    };
    truncated = true;
  }

  if (measureJsonChars(result) > budgetChars) {
    delete result.minimal_valid_payload_template;
    truncated = true;
  }

  if (measureJsonChars(result) > budgetChars) {
    delete result.write_envelope_contract;
    truncated = true;
  }

  return {
    bundle: result,
    budget_truncated: truncated || measureJsonChars(result) > budgetChars,
    bundle_chars: measureJsonChars(result),
  };
}

function buildActionSchemaUsabilityPack(options) {
  const opts = options && typeof options === "object" ? options : {};
  const actionType = normalizeString(opts.actionType) || "rename_object";
  const action = opts.action && typeof opts.action === "object" ? opts.action : {};
  return {
    write_envelope_contract: buildWriteEnvelopeContract({
      toolName: "apply_visual_actions",
      actionType,
      anchorPolicy: action.anchor_policy,
    }),
    minimal_valid_payload_template: buildMinimalValidPayloadTemplate({
      toolName: "apply_visual_actions",
      actionType,
      anchorPolicy: action.anchor_policy,
    }),
  };
}

function buildToolSchemaUsabilityPack(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName);
  return {
    required_sequence: buildRequiredSequence(toolName),
    write_envelope_contract: buildWriteEnvelopeContract({
      toolName,
      actionType: normalizeString(opts.actionType),
      anchorPolicy: normalizeString(opts.anchorPolicy),
    }),
    canonical_examples: buildCanonicalExamples({
      toolName,
      actionType: normalizeString(opts.actionType),
      anchorPolicy: normalizeString(opts.anchorPolicy),
    }),
  };
}

function buildWriteContractBundle(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName) || "apply_visual_actions";
  const actionType = normalizeString(opts.actionType) || "rename_object";
  const anchorPolicy = normalizeString(opts.anchorPolicy);
  const budgetChars = normalizeBudgetChars(opts.budget_chars);
  const includeCanonicalExamples = opts.include_canonical_examples !== false;
  const includeErrorFixMap = opts.include_error_fix_map !== false;

  const draft = {
    bundle_budget_chars: budgetChars,
    trim_priority: [...BUNDLE_TRIM_PRIORITY],
    write_envelope_contract: buildWriteEnvelopeContract({
      toolName,
      actionType,
      anchorPolicy,
    }),
    minimal_valid_payload_template: buildMinimalValidPayloadTemplate({
      toolName,
      actionType,
      anchorPolicy,
    }),
    ...(includeCanonicalExamples
      ? {
          canonical_examples: buildCanonicalExamples({
            toolName,
            actionType,
            anchorPolicy,
          }),
        }
      : {}),
    ...(includeErrorFixMap ? { error_fix_map: buildErrorFixMap() } : {}),
    ...(opts.actionSchema ? { action_schema_summary: summarizeActionSchema(opts.actionSchema) } : {}),
    ...(opts.toolMetadata ? { tool_schema_summary: summarizeToolSchema(opts.toolMetadata) } : {}),
    action_schema_ref: {
      tool: "get_action_schema",
      params: {
        action_type: actionType,
      },
    },
    tool_schema_ref: {
      tool: "get_tool_schema",
      params: {
        tool_name: toolName,
      },
    },
  };

  const trimmed = trimBundleToBudget(draft, budgetChars);
  return {
    ...trimmed.bundle,
    budget_truncated: trimmed.budget_truncated,
    bundle_chars: trimmed.bundle_chars,
  };
}

module.exports = {
  DEFAULT_BUNDLE_BUDGET_CHARS,
  MIN_BUNDLE_BUDGET_CHARS,
  MAX_BUNDLE_BUDGET_CHARS,
  BUNDLE_TRIM_PRIORITY,
  normalizeBudgetChars,
  buildWriteEnvelopeContract,
  buildMinimalValidPayloadTemplate,
  buildCanonicalExamples,
  buildActionSchemaUsabilityPack,
  buildToolSchemaUsabilityPack,
  buildWriteContractBundle,
};

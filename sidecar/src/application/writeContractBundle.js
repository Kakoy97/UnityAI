"use strict";

const {
  canonicalizeVisualActionType,
} = require("../domain/actionTypeCanonicalizer");
const {
  normalizeActionDataSchema,
  resolveAnchorRequirement: resolveAnchorRequirementFromPolicy,
} = require("../domain/actionContractRegistry");

const DEFAULT_BUNDLE_BUDGET_CHARS = 3600;
const MIN_BUNDLE_BUDGET_CHARS = 800;
const MAX_BUNDLE_BUDGET_CHARS = 12000;
const BUNDLE_TRIM_PRIORITY = Object.freeze([
  "write_envelope_contract",
  "minimal_valid_payload_template",
  "action_anchor_decision_table",
  "golden_path_templates",
  "canonical_examples",
  "error_fix_map",
]);
const ASYNC_TERMINAL_STATUSES = Object.freeze([
  "succeeded",
  "failed",
  "cancelled",
]);
const ASYNC_TERMINAL_STEP =
  "get_unity_task_status_until_terminal(succeeded|failed|cancelled)";
const DRY_RUN_ALIAS_COMPATIBILITY = Object.freeze({
  status: "deprecated_alias_supported",
  preferred_tool: "preflight_validate_write_payload",
  migration_hint:
    "Replace dry_run write calls with preflight_validate_write_payload({ tool_name, payload }).",
});
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

function buildInlineActionContract(options) {
  const opts = options && typeof options === "object" ? options : {};
  const actionTypeInput = normalizeString(opts.actionType);
  const canonicalActionType =
    canonicalizeVisualActionType(actionTypeInput) || actionTypeInput;
  if (!canonicalActionType) {
    return null;
  }
  const action = opts.action && typeof opts.action === "object" ? opts.action : {};
  const actionDataSchema = normalizeActionDataSchema(action.action_data_schema);
  const anchorPolicy = normalizeString(action.anchor_policy || opts.anchorPolicy);
  return {
    action_type: canonicalActionType,
    aliases: [],
    anchor_policy: anchorPolicy,
    anchor_requirement: resolveAnchorRequirementFromPolicy(anchorPolicy),
    action_data_schema: actionDataSchema,
  };
}

function resolveActionContract(options) {
  const opts = options && typeof options === "object" ? options : {};
  if (opts.actionContract && typeof opts.actionContract === "object") {
    return opts.actionContract;
  }
  const actionTypeInput = normalizeString(opts.actionType);
  const canonicalActionType =
    canonicalizeVisualActionType(actionTypeInput) || actionTypeInput;
  const registry =
    opts.actionContractRegistry && typeof opts.actionContractRegistry === "object"
      ? opts.actionContractRegistry
      : null;
  if (registry && typeof registry.resolveActionContract === "function") {
    const resolved = registry.resolveActionContract(canonicalActionType);
    if (resolved && typeof resolved === "object") {
      return resolved;
    }
  }
  return buildInlineActionContract({
    actionType: canonicalActionType,
    action: opts.action,
    anchorPolicy: opts.anchorPolicy,
  });
}

function resolveAnchorRequirement(actionType, anchorPolicy, actionContract) {
  const contract = actionContract && typeof actionContract === "object"
    ? actionContract
    : null;
  if (contract && normalizeString(contract.anchor_requirement)) {
    return normalizeString(contract.anchor_requirement).toLowerCase();
  }
  const policy = normalizeString(anchorPolicy);
  if (policy) {
    return resolveAnchorRequirementFromPolicy(policy);
  }
  const type = canonicalizeVisualActionType(
    normalizeString(actionType).toLowerCase()
  );
  // R21-detox: removed "create_gameobject" check — canonicalizer already resolves it.
  if (type === "create_object") {
    return "parent_required";
  }
  return "target_required";
}

function inferTemplateValueFromSchemaProperty(propertySchema) {
  const source =
    propertySchema && typeof propertySchema === "object" ? propertySchema : {};
  const normalizedType = normalizeString(source.type).toLowerCase();
  if (Array.isArray(source.enum) && source.enum.length > 0) {
    const first = source.enum[0];
    if (typeof first === "string") {
      return first;
    }
    if (first !== undefined) {
      return cloneJson(first);
    }
  }
  if (normalizedType === "string") {
    return "<value>";
  }
  if (normalizedType === "boolean") {
    return true;
  }
  if (normalizedType === "integer" || normalizedType === "number") {
    return 0;
  }
  if (normalizedType === "array") {
    return [];
  }
  if (normalizedType === "object") {
    return {};
  }
  return "<value>";
}

function buildActionDataTemplate(actionContract) {
  const contract =
    actionContract && typeof actionContract === "object" ? actionContract : {};
  const schema =
    contract.action_data_schema &&
    typeof contract.action_data_schema === "object"
      ? contract.action_data_schema
      : {};
  const requiredFields = Array.isArray(schema.required)
    ? schema.required.filter((item) => typeof item === "string" && item.trim())
    : [];
  const properties =
    schema.properties && typeof schema.properties === "object"
      ? schema.properties
      : {};
  const template = {};
  for (const fieldName of requiredFields) {
    const key = fieldName.trim();
    if (!key) {
      continue;
    }
    template[key] = inferTemplateValueFromSchemaProperty(properties[key]);
  }
  return template;
}

function buildRequiredSequence(toolName) {
  const name = normalizeString(toolName);
  switch (name) {
    case "apply_visual_actions":
    case "set_ui_properties":
    case "set_serialized_property":
    case "apply_script_actions":
    case "submit_unity_task":
      return ["get_current_selection", name, ASYNC_TERMINAL_STEP];
    case "get_write_contract_bundle":
      return ["get_write_contract_bundle"];
    default:
      return [];
  }
}

function buildDryRunLifecycleGuidance(toolName) {
  const name = normalizeString(toolName);
  if (
    name === "apply_visual_actions" ||
    name === "apply_script_actions" ||
    name === "set_ui_properties"
  ) {
    return {
      dry_run_alias_compatibility: {
        ...DRY_RUN_ALIAS_COMPATIBILITY,
        alias_on_tool: name,
      },
      preferred_preflight_entry: {
        tool: "preflight_validate_write_payload",
        payload_shape: {
          tool_name: name,
          payload: "<same as write request body>",
        },
      },
    };
  }
  if (name === "preflight_validate_write_payload") {
    return {
      lifecycle_status: "stable",
      dry_run_alias_compatibility: {
        ...DRY_RUN_ALIAS_COMPATIBILITY,
      },
    };
  }
  return {};
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
  const actionContract = resolveActionContract(opts);
  const anchorRequirement = resolveAnchorRequirement(
    opts.actionType,
    opts.anchorPolicy,
    actionContract
  );
  const requiredActionDataFields =
    actionContract &&
    actionContract.action_data_schema &&
    Array.isArray(actionContract.action_data_schema.required)
      ? actionContract.action_data_schema.required.filter((item) =>
          typeof item === "string" && item.trim()
        )
      : [];

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
      accepted_is_terminal: false,
      async_terminal_statuses: [...ASYNC_TERMINAL_STATUSES],
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
      accepted_is_terminal: false,
      async_terminal_statuses: [...ASYNC_TERMINAL_STATUSES],
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
    ...(anchorRequirement === "target_and_parent_required"
      ? { required_action_level: ["type", "target_anchor", "parent_anchor", "action_data"] }
      : {}),
    action_anchor_requirement: anchorRequirement,
    ...(requiredActionDataFields.length > 0
      ? { required_action_data_fields: requiredActionDataFields }
      : {}),
    write_anchor_shape: {
      object_id: "string(minLength=1)",
      path: "string(minLength=1)",
    },
    accepted_is_terminal: false,
    async_terminal_statuses: [...ASYNC_TERMINAL_STATUSES],
    required_sequence: buildRequiredSequence(toolName),
  };
}

function buildMinimalValidPayloadTemplate(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName) || "apply_visual_actions";
  const actionTypeInput = normalizeString(opts.actionType) || "rename_object";
  const actionType = canonicalizeVisualActionType(actionTypeInput) || actionTypeInput;
  const actionContract = resolveActionContract({
    ...opts,
    actionType,
  });
  const anchorRequirement = resolveAnchorRequirement(
    actionType,
    opts.anchorPolicy,
    actionContract
  );

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
        ...(anchorRequirement === "target_and_parent_required"
          ? {
              parent_anchor: {
                object_id: "<id>",
                path: "Scene/ParentPath",
              },
            }
          : {}),
        action_data: buildActionDataTemplate(actionContract),
      },
    ],
  };
}

function buildCanonicalExamples(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName) || "apply_visual_actions";
  const actionTypeInput = normalizeString(opts.actionType) || "rename_object";
  const actionType = canonicalizeVisualActionType(actionTypeInput) || actionTypeInput;
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

function buildActionAnchorDecisionTable(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName) || "apply_visual_actions";
  if (toolName !== "apply_visual_actions" && toolName !== "submit_unity_task") {
    return [];
  }
  const registry =
    opts.actionContractRegistry && typeof opts.actionContractRegistry === "object"
      ? opts.actionContractRegistry
      : null;
  if (!registry || typeof registry.listActionContracts !== "function") {
    const fallbackContract = resolveActionContract(opts);
    if (!fallbackContract) {
      return [];
    }
    const anchorRequirement = resolveAnchorRequirement(
      fallbackContract.action_type,
      fallbackContract.anchor_policy,
      fallbackContract
    );
    const requiredFields =
      anchorRequirement === "parent_required"
        ? ["type", "parent_anchor", "action_data"]
        : anchorRequirement === "target_or_parent_required"
          ? ["type", "target_anchor|parent_anchor", "action_data"]
          : anchorRequirement === "target_and_parent_required"
            ? ["type", "target_anchor", "parent_anchor", "action_data"]
            : ["type", "target_anchor", "action_data"];
    return [
      {
        action_type: fallbackContract.action_type,
        aliases: Array.isArray(fallbackContract.aliases)
          ? [...fallbackContract.aliases]
          : [],
        anchor_requirement: anchorRequirement,
        required_fields: requiredFields,
      },
    ];
  }

  const contracts = registry.listActionContracts();
  const sourceContracts =
    Array.isArray(contracts) && contracts.length > 0
      ? contracts
      : [resolveActionContract(opts)].filter(Boolean);
  if (sourceContracts.length === 0) {
    return [];
  }

  return sourceContracts.map((contract) => {
    const anchorRequirement = resolveAnchorRequirement(
      contract.action_type,
      contract.anchor_policy,
      contract
    );
    const requiredFields =
      anchorRequirement === "parent_required"
        ? ["type", "parent_anchor", "action_data"]
        : anchorRequirement === "target_or_parent_required"
          ? ["type", "target_anchor|parent_anchor", "action_data"]
          : anchorRequirement === "target_and_parent_required"
            ? ["type", "target_anchor", "parent_anchor", "action_data"]
            : ["type", "target_anchor", "action_data"];
    return {
      action_type: normalizeString(contract.action_type),
      aliases: Array.isArray(contract.aliases) ? [...contract.aliases] : [],
      anchor_requirement: anchorRequirement,
      required_fields: requiredFields,
      required_action_data_fields:
        contract &&
        contract.action_data_schema &&
        Array.isArray(contract.action_data_schema.required)
          ? [...contract.action_data_schema.required]
          : [],
    };
  });
}

function buildGoldenPathTemplates(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName) || "apply_visual_actions";
  if (toolName !== "apply_visual_actions" && toolName !== "submit_unity_task") {
    return [];
  }
  const registry =
    opts.actionContractRegistry && typeof opts.actionContractRegistry === "object"
      ? opts.actionContractRegistry
      : null;
  const contracts =
    registry && typeof registry.listActionContracts === "function"
      ? registry.listActionContracts()
      : [];
  const sourceContracts =
    Array.isArray(contracts) && contracts.length > 0
      ? contracts
      : [resolveActionContract(opts)].filter(Boolean);

  return sourceContracts.map((contract) => {
    const anchorRequirement = resolveAnchorRequirement(
      contract.action_type,
      contract.anchor_policy,
      contract
    );
    const actionTemplate = {
      type: normalizeString(contract.action_type),
      ...buildActionAnchorTemplate(anchorRequirement),
      ...(anchorRequirement === "target_and_parent_required"
        ? {
            parent_anchor: {
              object_id: "<parent_id>",
              path: "Scene/Parent",
            },
          }
        : {}),
      action_data: buildActionDataTemplate(contract),
    };
    return {
      template_id: normalizeString(contract.action_type),
      action_type: normalizeString(contract.action_type),
      aliases: Array.isArray(contract.aliases) ? [...contract.aliases] : [],
      action_template: actionTemplate,
    };
  });
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
    E_JOB_CONFLICT: {
      summary: "Another write job is running; accepted is non-terminal.",
      next_step: "poll_running_job_until_terminal_then_retry",
      required_sequence: [
        "get_unity_task_status(running_job_id)",
        ASYNC_TERMINAL_STEP,
      ],
      preferred_schema_tool: "none",
    },
    E_TOO_MANY_ACTIVE_TURNS: {
      summary: "Active turn slot is full; wait for terminal status first.",
      next_step: "poll_running_job_until_terminal_then_retry",
      required_sequence: [
        "get_unity_task_status(running_job_id)",
        ASYNC_TERMINAL_STEP,
      ],
      preferred_schema_tool: "none",
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
    "golden_path_templates",
    "action_anchor_decision_table",
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
  const actionContract = resolveActionContract({
    actionType,
    action,
    anchorPolicy: action.anchor_policy,
    actionContractRegistry: opts.actionContractRegistry,
  });
  return {
    write_envelope_contract: buildWriteEnvelopeContract({
      toolName: "apply_visual_actions",
      actionType,
      anchorPolicy: action.anchor_policy,
      action,
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
    minimal_valid_payload_template: buildMinimalValidPayloadTemplate({
      toolName: "apply_visual_actions",
      actionType,
      anchorPolicy: action.anchor_policy,
      action,
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
  };
}

function buildToolSchemaUsabilityPack(options) {
  const opts = options && typeof options === "object" ? options : {};
  const toolName = normalizeString(opts.toolName);
  const actionType = normalizeString(opts.actionType);
  const actionContract = resolveActionContract({
    actionType,
    anchorPolicy: normalizeString(opts.anchorPolicy),
    actionContractRegistry: opts.actionContractRegistry,
  });
  return {
    required_sequence: buildRequiredSequence(toolName),
    ...buildDryRunLifecycleGuidance(toolName),
    write_envelope_contract: buildWriteEnvelopeContract({
      toolName,
      actionType,
      anchorPolicy: normalizeString(opts.anchorPolicy),
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
    canonical_examples: buildCanonicalExamples({
      toolName,
      actionType,
      anchorPolicy: normalizeString(opts.anchorPolicy),
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
    action_anchor_decision_table: buildActionAnchorDecisionTable({
      toolName,
      actionType,
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
    golden_path_templates: buildGoldenPathTemplates({
      toolName,
      actionType,
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
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
  const action = opts.action && typeof opts.action === "object" ? opts.action : {};
  const actionContract = resolveActionContract({
    actionType,
    action,
    anchorPolicy,
    actionContractRegistry: opts.actionContractRegistry,
  });

  const draft = {
    bundle_budget_chars: budgetChars,
    trim_priority: [...BUNDLE_TRIM_PRIORITY],
    write_envelope_contract: buildWriteEnvelopeContract({
      toolName,
      actionType,
      anchorPolicy,
      action,
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
    minimal_valid_payload_template: buildMinimalValidPayloadTemplate({
      toolName,
      actionType,
      anchorPolicy,
      action,
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
    ...(includeCanonicalExamples
      ? {
          canonical_examples: buildCanonicalExamples({
            toolName,
            actionType,
            anchorPolicy,
            action,
            actionContract,
            actionContractRegistry: opts.actionContractRegistry,
          }),
        }
      : {}),
    action_anchor_decision_table: buildActionAnchorDecisionTable({
      toolName,
      actionType,
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
    golden_path_templates: buildGoldenPathTemplates({
      toolName,
      actionType,
      actionContract,
      actionContractRegistry: opts.actionContractRegistry,
    }),
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
  buildActionAnchorDecisionTable,
  buildGoldenPathTemplates,
  buildActionSchemaUsabilityPack,
  buildToolSchemaUsabilityPack,
  buildWriteContractBundle,
};

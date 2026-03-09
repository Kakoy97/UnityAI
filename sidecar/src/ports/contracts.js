"use strict";

/**
 * Port contracts placeholder for MVP layering.
 * Runtime code is duck-typed; this file documents dependency shapes.
 */
const {
  loadVisibilityPolicyArtifact,
  loadSidecarCommandManifestArtifact,
} = require("../application/ssotRuntime/startupArtifactsGuard");
const {
  FAMILY_TOOL_MIGRATION_MATRIX,
} = require("../application/blockRuntime/execution/FamilyToolMigrationMatrix");

function normalizeToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toFrozenStringArray(value) {
  const source = Array.isArray(value) ? value : [];
  const output = [];
  const seen = new Set();
  for (const item of source) {
    const normalized = normalizeToolName(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return Object.freeze(output);
}

function normalizeEnvEnum(name, fallback, allowedValues) {
  const allowed = new Set(
    (Array.isArray(allowedValues) ? allowedValues : [])
      .map((item) => normalizeToolName(item))
      .filter((item) => !!item)
  );
  const normalizedFallback = normalizeToolName(fallback);
  const raw = normalizeToolName(process.env[name]);
  if (!raw) {
    return normalizedFallback;
  }
  if (allowed.size > 0 && !allowed.has(raw)) {
    return normalizedFallback;
  }
  return raw;
}

function normalizeEnvNonNegativeNumber(name, fallback) {
  const raw = normalizeToolName(process.env[name]);
  const normalizedFallback = Number.isFinite(Number(fallback)) && Number(fallback) >= 0
    ? Number(fallback)
    : null;
  if (!raw) {
    return normalizedFallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return normalizedFallback;
  }
  return parsed;
}

function normalizeEnvBoolean(name, fallback) {
  const raw = normalizeToolName(process.env[name]).toLowerCase();
  if (!raw) {
    return fallback === true;
  }
  if (["1", "true", "on", "enabled", "yes"].includes(raw)) {
    return true;
  }
  if (["0", "false", "off", "disabled", "no"].includes(raw)) {
    return false;
  }
  return fallback === true;
}

function normalizeEnvCsvArray(name, fallback) {
  const raw = normalizeToolName(process.env[name]);
  if (!raw) {
    return toFrozenStringArray(Array.isArray(fallback) ? fallback : []);
  }
  return toFrozenStringArray(
    raw
      .split(",")
      .map((item) => normalizeToolName(item))
      .filter((item) => !!item)
  );
}

const MCP_ENTRY_MODE = Object.freeze({
  LEGACY: "legacy",
  OBSERVE: "observe",
  REJECT: "reject",
});
const MCP_PLANNER_PRIMARY_ENTRY_TOOL_NAME = "planner_execute_mcp";
const MCP_PLANNER_ALIAS_ENTRY_TOOL_NAME = "";

function appendPlannerPrimaryEntryToolName(toolNames, entryGovernanceContract) {
  const source = Array.isArray(toolNames) ? toolNames : [];
  const governance =
    entryGovernanceContract &&
    typeof entryGovernanceContract === "object" &&
    entryGovernanceContract.enabled === true
      ? entryGovernanceContract
      : null;
  if (!governance) {
    return source;
  }
  const normalized = source
    .map((item) => normalizeToolName(item))
    .filter((item) => !!item);
  if (
    !normalized.includes(MCP_PLANNER_ALIAS_ENTRY_TOOL_NAME) ||
    normalized.includes(MCP_PLANNER_PRIMARY_ENTRY_TOOL_NAME)
  ) {
    return source;
  }
  return [...source, MCP_PLANNER_PRIMARY_ENTRY_TOOL_NAME];
}

function collectPlannerCoveredFamilyAndManagedTools() {
  const familyKeys = [];
  const managedTools = [];
  const managedToolFamilyMap = {};
  const seenFamily = new Set();
  const seenTool = new Set();
  const source =
    FAMILY_TOOL_MIGRATION_MATRIX && typeof FAMILY_TOOL_MIGRATION_MATRIX === "object"
      ? FAMILY_TOOL_MIGRATION_MATRIX
      : {};
  for (const families of Object.values(source)) {
    const familyMap = families && typeof families === "object" ? families : {};
    for (const [familyKeyRaw, profileRaw] of Object.entries(familyMap)) {
      const familyKey = normalizeToolName(familyKeyRaw);
      if (familyKey && !seenFamily.has(familyKey)) {
        seenFamily.add(familyKey);
        familyKeys.push(familyKey);
      }
      const profile = profileRaw && typeof profileRaw === "object" ? profileRaw : {};
      const primaryTool = normalizeToolName(profile.primary_tool);
      if (primaryTool && !seenTool.has(primaryTool)) {
        seenTool.add(primaryTool);
        managedTools.push(primaryTool);
        if (familyKey) {
          managedToolFamilyMap[primaryTool] = familyKey;
        }
      }
    }
  }
  return Object.freeze({
    covered_family_keys: Object.freeze(familyKeys),
    managed_tool_names: Object.freeze(managedTools),
    managed_tool_family_map: Object.freeze({ ...managedToolFamilyMap }),
  });
}

const {
  visibilityPolicyPath: MCP_VISIBILITY_POLICY_PATH,
  visibilityPolicy: MCP_VISIBILITY_POLICY,
} = loadVisibilityPolicyArtifact();
const {
  sidecarCommandManifestPath: MCP_SIDECAR_COMMAND_MANIFEST_PATH,
  sidecarCommandManifest: MCP_SIDECAR_COMMAND_MANIFEST,
} = loadSidecarCommandManifestArtifact();

const MCP_ENTRY_GOVERNANCE_CONTRACT = Object.freeze({
  policy_formula:
    "single-state-machine for external MCP entry governance: legacy|observe|reject",
  supported_modes: Object.freeze([
    MCP_ENTRY_MODE.LEGACY,
    MCP_ENTRY_MODE.OBSERVE,
    MCP_ENTRY_MODE.REJECT,
  ]),
  enabled: normalizeEnvBoolean("MCP_ENTRY_GOVERNANCE_ENABLED", true),
  mode: normalizeEnvEnum("MCP_ENTRY_MODE", MCP_ENTRY_MODE.REJECT, [
    MCP_ENTRY_MODE.LEGACY,
    MCP_ENTRY_MODE.OBSERVE,
    MCP_ENTRY_MODE.REJECT,
  ]),
  observe_shadow: normalizeEnvBoolean("MCP_ENTRY_OBSERVE_SHADOW", false),
  planner_primary_tool_name: MCP_PLANNER_PRIMARY_ENTRY_TOOL_NAME,
  planner_alias_tool_name: MCP_PLANNER_ALIAS_ENTRY_TOOL_NAME,
});

const MCP_ACTIVE_TOOL_NAMES = toFrozenStringArray(
  appendPlannerPrimaryEntryToolName(
    MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.active_tool_names,
    MCP_ENTRY_GOVERNANCE_CONTRACT
  )
);
const MCP_DEPRECATED_TOOL_NAMES = toFrozenStringArray(
  MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.deprecated_tool_names
);
const MCP_REMOVED_TOOL_NAMES = toFrozenStringArray(
  MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.removed_tool_names
);
const MCP_EXPOSED_TOOL_NAMES = toFrozenStringArray(
  appendPlannerPrimaryEntryToolName(
    MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.exposed_tool_names,
    MCP_ENTRY_GOVERNANCE_CONTRACT
  )
);
const MCP_LOCAL_STATIC_TOOL_NAMES = toFrozenStringArray(
  appendPlannerPrimaryEntryToolName(
    MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.local_static_tool_names,
    MCP_ENTRY_GOVERNANCE_CONTRACT
  )
);
const MCP_DISABLED_TOOL_NAMES = Object.freeze([]);
const MCP_TRANSACTION_ENABLED_WRITE_TOOL_NAMES = toFrozenStringArray(
  (MCP_SIDECAR_COMMAND_MANIFEST &&
  Array.isArray(MCP_SIDECAR_COMMAND_MANIFEST.commands)
    ? MCP_SIDECAR_COMMAND_MANIFEST.commands
    : []
  )
    .filter((command) => {
      const source =
        command && typeof command === "object" ? command : {};
      const transaction =
        source.transaction && typeof source.transaction === "object"
          ? source.transaction
          : {};
      return (
        normalizeToolName(source.kind).toLowerCase() === "write" &&
        transaction.enabled === true &&
        transaction.undo_safe === true
      );
    })
    .map((command) => command.name)
);
const STEP_C_PLANNER_SCOPE = collectPlannerCoveredFamilyAndManagedTools();
const MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT = Object.freeze({
  profile_formula:
    "tools/list visible = exposed & active - disabled - managed_when_planner_first",
  supported_profiles: Object.freeze(["legacy_full", "planner_first"]),
  requested_profile: normalizeEnvEnum("MCP_VISIBILITY_PROFILE", "planner_first", [
    "legacy_full",
    "planner_first",
  ]),
  covered_family_keys: STEP_C_PLANNER_SCOPE.covered_family_keys,
  managed_tool_names: STEP_C_PLANNER_SCOPE.managed_tool_names,
  enable_gate: Object.freeze({
    covered_family_ratio_min: 0.8,
    planner_path_failure_rate_max: 0.01,
    planner_path_p95_regression_max: 0.1,
    metrics: Object.freeze({
      covered_family_ratio: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_COVERED_FAMILY_RATIO_7D",
        Number.NaN
      ),
      planner_path_failure_rate: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_PATH_FAILURE_RATE_7D",
        Number.NaN
      ),
      planner_path_p95_regression: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_PATH_P95_REGRESSION_7D",
        Number.NaN
      ),
    }),
  }),
  rollback_trigger: Object.freeze({
    planner_path_failure_rate_1h_max: 0.02,
    planner_path_p95_regression_1h_max: 0.2,
    metrics: Object.freeze({
      planner_path_failure_rate_1h: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_PATH_FAILURE_RATE_1H",
        Number.NaN
      ),
      planner_path_p95_regression_1h: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_PATH_P95_REGRESSION_1H",
        Number.NaN
      ),
    }),
  }),
});
const MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT = Object.freeze({
  policy_formula:
    "direct mode for managed tools = allow|warn|deny; deny gated by Step D thresholds with rollback-to-warn",
  supported_modes: Object.freeze(["allow", "warn", "deny"]),
  requested_mode: normalizeEnvEnum("MCP_PLANNER_DIRECT_MODE", "allow", [
    "allow",
    "warn",
    "deny",
  ]),
  managed_tool_names: STEP_C_PLANNER_SCOPE.managed_tool_names,
  managed_tool_family_map: STEP_C_PLANNER_SCOPE.managed_tool_family_map,
  deny_gate: Object.freeze({
    direct_warn_soak_days_min: 7,
    planner_success_rate_min: 0.99,
    direct_share_for_deny_max: 0.1,
    metrics: Object.freeze({
      direct_warn_soak_days: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_DIRECT_WARN_SOAK_DAYS",
        Number.NaN
      ),
      planner_success_rate_for_deny: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_SUCCESS_RATE_FOR_DENY_7D",
        Number.NaN
      ),
      direct_share_for_deny: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_DIRECT_SHARE_FOR_DENY_7D",
        Number.NaN
      ),
    }),
  }),
  rollback_trigger: Object.freeze({
    deny_incident_guard_max: 0,
    deny_failure_guard_24h_max: 0.015,
    metrics: Object.freeze({
      deny_incident_count_24h: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_DENY_P1_INCIDENT_COUNT_24H",
        Number.NaN
      ),
      deny_failure_rate_24h: normalizeEnvNonNegativeNumber(
        "MCP_PLANNER_DENY_FAILURE_RATE_24H",
        Number.NaN
      ),
    }),
  }),
  data_source: Object.freeze({
    evaluation_mode: "env_snapshot_static",
    metric_env_keys: Object.freeze({
      direct_warn_soak_days: "MCP_PLANNER_DIRECT_WARN_SOAK_DAYS",
      planner_success_rate_for_deny: "MCP_PLANNER_SUCCESS_RATE_FOR_DENY_7D",
      direct_share_for_deny: "MCP_PLANNER_DIRECT_SHARE_FOR_DENY_7D",
      deny_incident_count_24h: "MCP_PLANNER_DENY_P1_INCIDENT_COUNT_24H",
      deny_failure_rate_24h: "MCP_PLANNER_DENY_FAILURE_RATE_24H",
    }),
    threshold_source: "contracts.step_d_thresholds",
    note:
      "Step D uses process env snapshots at boot-time; not rolling-window stream aggregation yet.",
  }),
});
const MCP_PLANNER_EXIT_POLICY_CONTRACT = Object.freeze({
  policy_formula:
    "planner entry fail-fast exit policy: classify no_family/no_tool/no_safe_fallback then allow minimal escape backend by whitelist",
  enabled: normalizeEnvBoolean("MCP_PLANNER_EXIT_POLICY_ENABLED", true),
  error_codes: Object.freeze({
    no_family: "E_PLANNER_UNSUPPORTED_FAMILY",
    no_tool: "E_PLANNER_NO_TOOL_MAPPING",
    no_safe_fallback: "E_PLANNER_NO_SAFE_FALLBACK",
    exit_not_allowed: "E_PLANNER_EXIT_NOT_ALLOWED",
  }),
  escape_family_allowlist: Object.freeze(["write.async_ops"]),
  escape_tool_allowlist: Object.freeze(["get_unity_task_status"]),
  never_escape_family_prefixes: Object.freeze([
    "write.hierarchy",
    "write.component_lifecycle",
    "write.object_lifecycle",
    "write.transform",
    "write.rect_layout",
    "write.ui_style",
  ]),
  data_source: Object.freeze({
    evaluation_mode: "env_snapshot_static",
    env_keys: Object.freeze({
      enabled: "MCP_PLANNER_EXIT_POLICY_ENABLED",
    }),
    note:
      "Step4 PlannerExitPolicy enable switch only applies after planner entry is selected.",
  }),
});
const MCP_PLANNER_GENERIC_PROPERTY_FALLBACK_POLICY_CONTRACT = Object.freeze({
  policy_formula:
    "generic fallback allowed only for policy families and only when Step E preconditions are satisfied",
  enabled: normalizeEnvBoolean("MCP_PLANNER_GENERIC_FALLBACK_ENABLED", true),
  fallback_tool_name: "set_serialized_property",
  allowed_source_capability_families: normalizeEnvCsvArray(
    "MCP_PLANNER_GENERIC_FALLBACK_ALLOWED_CAPABILITY_FAMILIES",
    ["Write.GenericProperty"]
  ),
  source_family_alias_map: Object.freeze({
    "mutate.component_properties": "Write.GenericProperty",
  }),
  component_type_whitelist_patterns: Object.freeze([
    "^UnityEngine\\.[A-Za-z0-9_+.]+\\s*,\\s*[A-Za-z0-9_+.]+$",
  ]),
  property_path_whitelist_patterns: Object.freeze([
    "^m_[A-Za-z0-9_.\\[\\]-]+$",
  ]),
  precondition_requirements: Object.freeze({
    specialized_attempted_source: "primary_tool_failure",
    service_verified_preflight_required: true,
    preflight_tool_name: "preflight_validate_write_payload",
    component_type_whitelist_match_required: true,
    property_path_whitelist_match_required: true,
  }),
  data_source: Object.freeze({
    evaluation_mode: "env_snapshot_static",
    env_keys: Object.freeze({
      enabled: "MCP_PLANNER_GENERIC_FALLBACK_ENABLED",
      allowed_source_capability_families:
        "MCP_PLANNER_GENERIC_FALLBACK_ALLOWED_CAPABILITY_FAMILIES",
    }),
    note:
      "Step E fallback gating uses boot-time env snapshot + static whitelist patterns.",
  }),
});

const OCC_WRITE_GUARD_CONTRACT = Object.freeze({
  based_on_read_token_required: true,
  supports_disable_switch: false,
  hard_fail_error_code: "E_STALE_SNAPSHOT",
});

const WRITE_ANCHOR_GUARD_CONTRACT = Object.freeze({
  top_level_write_anchor_required: true,
  write_anchor_shape: Object.freeze({
    object_id: "string(minLength=1)",
    path: "string(minLength=1)",
  }),
  action_anchor_union: Object.freeze({
    action_type_enum_enforced: false,
    dynamic_action_types_allowed: true,
    minimum_anchor_requirement: "at_least_one_of_target_anchor_or_parent_anchor",
    known_legacy_overrides: Object.freeze({
      mutation_types: Object.freeze([
        "add_component",
        "remove_component",
        "replace_component",
      ]),
      mutation_required_anchor: "target_anchor",
      // R21-detox: removed "create_gameobject" deprecated alias.
      create_types: Object.freeze(["create_object"]),
      create_required_anchor: "parent_anchor",
    }),
  }),
  legacy_single_anchor_fields_supported: false,
  implicit_target_resolution_supported: false,
  hard_fail_error_code: "E_ACTION_SCHEMA_INVALID",
});

const LEGACY_ANCHOR_MIGRATION_CONTRACT = Object.freeze({
  mode_env: "LEGACY_ANCHOR_MODE",
  allowed_modes: Object.freeze(["warn", "deny"]),
  default_mode: "warn",
  reject_error_code: "E_ACTION_SCHEMA_INVALID",
  deny_switch_gate: Object.freeze({
    required_zero_hit_days: 7,
    manual_signoff_env: "LEGACY_ANCHOR_DENY_SIGNOFF",
  }),
});

const ROUTER_PROTOCOL_FREEZE_CONTRACT = Object.freeze({
  mcp_write_http_routes: Object.freeze([
    "/mcp/submit_unity_task",
    "/mcp/apply_script_actions",
    "/mcp/apply_visual_actions",
    "/mcp/set_ui_properties",
    "/mcp/modify_ui_layout",
    "/mcp/set_component_properties",
    "/mcp/set_serialized_property",
  ]),
  mcp_read_http_routes: Object.freeze([
    "/mcp/get_scene_snapshot_for_write",
    "/mcp/get_current_selection",
    "/mcp/get_gameobject_components",
    "/mcp/get_hierarchy_subtree",
    "/mcp/list_assets_in_folder",
    "/mcp/get_scene_roots",
    "/mcp/find_objects_by_component",
    "/mcp/query_prefab_info",
    "/mcp/get_action_catalog",
    "/mcp/get_action_schema",
    "/mcp/get_tool_schema",
    "/mcp/get_write_contract_bundle",
    "/mcp/preflight_validate_write_payload",
    "/mcp/setup_cursor_mcp",
    "/mcp/verify_mcp_setup",
    "/mcp/capture_scene_screenshot",
    "/mcp/get_ui_overlay_report",
    "/mcp/get_ui_tree",
    "/mcp/get_serialized_property_tree",
    "/mcp/hit_test_ui_at_viewport_point",
    "/mcp/validate_ui_layout",
    "/mcp/hit_test_ui_at_screen_point",
  ]),
  mcp_status_http_routes: Object.freeze([
    "/mcp/get_unity_task_status",
    "/mcp/cancel_unity_task",
    "/mcp/capabilities",
  ]),
  unity_callback_http_routes: Object.freeze([
    "/unity/selection/snapshot",
    "/unity/runtime/ping",
    "/unity/capabilities/report",
    "/unity/query/pull",
    "/unity/query/report",
  ]),
  deprecated_http_routes: Object.freeze([
    "/file-actions/apply",
    "/unity/query/components/result",
    "/unity/console/snapshot",
    "/mcp/get_prefab_info",
    "/mcp/get_compile_state",
    "/mcp/get_console_errors",
    "/mcp/resources/list",
    "/mcp/resources/read",
    "/mcp/heartbeat",
    "/mcp/metrics",
    "/mcp/stream",
    "/unity/compile/result",
    "/unity/action/result",
  ]),
  mcp_tool_names: MCP_ACTIVE_TOOL_NAMES,
  deprecated_mcp_tool_names: MCP_DEPRECATED_TOOL_NAMES,
  removed_mcp_tool_names: MCP_REMOVED_TOOL_NAMES,
});

const MCP_TOOL_VISIBILITY_FREEZE_CONTRACT = Object.freeze({
  visibility_formula: "visible = exposed & active - disabled",
  registry_snapshot_source: "McpCommandRegistry.listMcpToolNames()",
  active_tool_names: MCP_ACTIVE_TOOL_NAMES,
  exposed_tool_names: MCP_EXPOSED_TOOL_NAMES,
  deprecated_tool_names: MCP_DEPRECATED_TOOL_NAMES,
  removed_tool_names: MCP_REMOVED_TOOL_NAMES,
  local_static_tool_names: MCP_LOCAL_STATIC_TOOL_NAMES,
  active_source: "visibility-policy.generated.json.active_tool_names",
  deprecated_blocklist_source:
    "visibility-policy.generated.json.deprecated_tool_names",
  removed_blocklist_source: "visibility-policy.generated.json.removed_tool_names",
  visibility_policy_path: MCP_VISIBILITY_POLICY_PATH,
  visibility_policy_version:
    Number.isFinite(Number(MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.version))
      ? Number(MCP_VISIBILITY_POLICY.version)
      : 0,
  disabled_tools: MCP_DISABLED_TOOL_NAMES,
  disabled_tool_notes: Object.freeze({}),
  capture_mode_notes: Object.freeze({
    capture_scene_screenshot: "render_output_stable_composite_flagged",
  }),
});

const MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT = Object.freeze({
  step_policy_formula:
    "transaction_step_allowed = active - deprecated - removed - disabled & transaction_enabled_write",
  active_tool_names: MCP_ACTIVE_TOOL_NAMES,
  deprecated_tool_names: MCP_DEPRECATED_TOOL_NAMES,
  removed_tool_names: MCP_REMOVED_TOOL_NAMES,
  disabled_tool_names: MCP_DISABLED_TOOL_NAMES,
  transaction_enabled_write_tool_names: MCP_TRANSACTION_ENABLED_WRITE_TOOL_NAMES,
  sidecar_manifest_path: MCP_SIDECAR_COMMAND_MANIFEST_PATH,
  visibility_policy_path: MCP_VISIBILITY_POLICY_PATH,
  sidecar_manifest_version:
    Number.isFinite(
      Number(
        MCP_SIDECAR_COMMAND_MANIFEST && MCP_SIDECAR_COMMAND_MANIFEST.version
      )
    )
      ? Number(MCP_SIDECAR_COMMAND_MANIFEST.version)
      : 0,
});

module.exports = {
  OCC_WRITE_GUARD_CONTRACT,
  WRITE_ANCHOR_GUARD_CONTRACT,
  LEGACY_ANCHOR_MIGRATION_CONTRACT,
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
  MCP_ENTRY_GOVERNANCE_CONTRACT,
  MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT,
  MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT,
  MCP_PLANNER_EXIT_POLICY_CONTRACT,
  MCP_PLANNER_GENERIC_PROPERTY_FALLBACK_POLICY_CONTRACT,
  MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT,
};

"use strict";

/**
 * Port contracts placeholder for MVP layering.
 * Runtime code is duck-typed; this file documents dependency shapes.
 */
const {
  loadVisibilityPolicyArtifact,
  loadSidecarCommandManifestArtifact,
} = require("../application/ssotRuntime/startupArtifactsGuard");

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

const {
  visibilityPolicyPath: MCP_VISIBILITY_POLICY_PATH,
  visibilityPolicy: MCP_VISIBILITY_POLICY,
} = loadVisibilityPolicyArtifact();
const {
  sidecarCommandManifestPath: MCP_SIDECAR_COMMAND_MANIFEST_PATH,
  sidecarCommandManifest: MCP_SIDECAR_COMMAND_MANIFEST,
} = loadSidecarCommandManifestArtifact();

const MCP_ACTIVE_TOOL_NAMES = toFrozenStringArray(
  MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.active_tool_names
);
const MCP_DEPRECATED_TOOL_NAMES = toFrozenStringArray(
  MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.deprecated_tool_names
);
const MCP_REMOVED_TOOL_NAMES = toFrozenStringArray(
  MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.removed_tool_names
);
const MCP_EXPOSED_TOOL_NAMES = toFrozenStringArray(
  MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.exposed_tool_names
);
const MCP_LOCAL_STATIC_TOOL_NAMES = toFrozenStringArray(
  MCP_VISIBILITY_POLICY && MCP_VISIBILITY_POLICY.local_static_tool_names
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
  MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT,
};

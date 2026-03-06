"use strict";

/**
 * Port contracts placeholder for MVP layering.
 * Runtime code is duck-typed; this file documents dependency shapes.
 */

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
  mcp_tool_names: Object.freeze([
    "submit_unity_task",
    "get_unity_task_status",
    "cancel_unity_task",
    "get_scene_snapshot_for_write",
    "get_current_selection",
    "get_gameobject_components",
    "get_hierarchy_subtree",
    "apply_script_actions",
    "apply_visual_actions",
    "set_ui_properties",
    "modify_ui_layout",
    "set_component_properties",
    "add_component",
    "remove_component",
    "replace_component",
    "create_object",
    "duplicate_object",
    "delete_object",
    "rename_object",
    "set_active",
    "set_parent",
    "set_sibling_index",
    "set_local_position",
    "set_local_rotation",
    "set_local_scale",
    "set_world_position",
    "set_world_rotation",
    "reset_transform",
    "set_rect_anchored_position",
    "set_rect_size_delta",
    "set_rect_pivot",
    "set_rect_anchors",
    "set_canvas_group_alpha",
    "set_layout_element",
    "set_ui_image_color",
    "set_ui_image_raycast_target",
    "set_ui_text_content",
    "set_ui_text_color",
    "set_ui_text_font_size",
    "execute_unity_transaction",
    "set_serialized_property",
    "list_assets_in_folder",
    "get_scene_roots",
    "find_objects_by_component",
    "query_prefab_info",
    "get_action_catalog",
    "get_action_schema",
    "get_tool_schema",
    "get_write_contract_bundle",
    "preflight_validate_write_payload",
    "setup_cursor_mcp",
    "verify_mcp_setup",
    "capture_scene_screenshot",
    "get_ui_overlay_report",
    "get_ui_tree",
    "get_serialized_property_tree",
    "hit_test_ui_at_viewport_point",
    "validate_ui_layout",
    "hit_test_ui_at_screen_point",
  ]),
  deprecated_mcp_tool_names: Object.freeze([
    "get_prefab_info",
    "get_compile_state",
    "get_console_errors",
    "instantiate_prefab",
  ]),
});

const MCP_TOOL_VISIBILITY_FREEZE_CONTRACT = Object.freeze({
  visibility_formula: "visible = exposed & allowlist - disabled",
  registry_snapshot_source: "McpCommandRegistry.listMcpToolNames()",
  security_allowlist: Object.freeze([
    ...(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names || []),
  ]),
  allowlist_source: "MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.security_allowlist",
  deprecated_blocklist_source:
    "ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names",
  disabled_tools: Object.freeze([]),
  disabled_tool_notes: Object.freeze({}),
  capture_mode_notes: Object.freeze({
    capture_scene_screenshot: "render_output_stable_composite_flagged",
  }),
});

module.exports = {
  OCC_WRITE_GUARD_CONTRACT,
  WRITE_ANCHOR_GUARD_CONTRACT,
  LEGACY_ANCHOR_MIGRATION_CONTRACT,
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
};

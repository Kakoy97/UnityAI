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

const ACTION_DATA_WIRE_BRIDGE_CONTRACT = Object.freeze({
  external_schema_rule: "action_data_object_only",
  external_forbidden_fields: Object.freeze([
    "action_data_json",
    "action_data_marshaled",
    "steps[*].action_data_json",
    "steps[*].action_data_marshaled",
  ]),
  external_hard_fail_error_code: "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
  internal_wire_field: "action_data_marshaled",
  internal_wire_fallback_field: "action_data_json",
  internal_wire_owner: "turnPayloadBuilders.buildVisualActionDataBridge",
  composite_step_wire_bridge:
    "turnPayloadBuilders.normalizeCompositeStepForUnity",
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

const JOB_LEASE_CONTRACT = Object.freeze({
  owner_binding: "thread_id",
  required_fields: Object.freeze([
    "owner_client_id",
    "last_heartbeat_at",
    "heartbeat_timeout_ms",
    "max_runtime_ms",
    "orphaned",
  ]),
  defaults: Object.freeze({
    heartbeat_timeout_ms: 60000,
    max_runtime_ms: 300000,
    reboot_wait_timeout_ms: 180000,
    janitor_interval_ms: 1000,
  }),
  minimums: Object.freeze({
    heartbeat_timeout_ms: 1000,
    max_runtime_ms: 1000,
    reboot_wait_timeout_ms: 1000,
    janitor_interval_ms: 250,
  }),
  startup_env: Object.freeze({
    heartbeat_timeout_ms: "MCP_LEASE_HEARTBEAT_TIMEOUT_MS",
    max_runtime_ms: "MCP_LEASE_MAX_RUNTIME_MS",
    reboot_wait_timeout_ms: "MCP_REBOOT_WAIT_TIMEOUT_MS",
    janitor_interval_ms: "MCP_LEASE_JANITOR_INTERVAL_MS",
  }),
  supports_disable_switch: false,
  forbidden_disable_switches: Object.freeze([
    "--disable-mcp-auto-cleanup",
    "--disable-mcp-lease-janitor",
    "--disable-job-janitor",
  ]),
  forbidden_disable_envs: Object.freeze([
    "MCP_DISABLE_AUTO_CLEANUP",
    "MCP_DISABLE_LEASE_JANITOR",
    "MCP_AUTO_CLEANUP_ENABLED",
    "ENABLE_MCP_JOB_JANITOR",
  ]),
  auto_cancel_error_codes: Object.freeze([
    "E_JOB_HEARTBEAT_TIMEOUT",
    "E_JOB_MAX_RUNTIME_EXCEEDED",
    "E_WAITING_FOR_UNITY_REBOOT_TIMEOUT",
  ]),
});

const ROUTER_PROTOCOL_FREEZE_CONTRACT = Object.freeze({
  mcp_write_http_routes: Object.freeze([
    "/mcp/submit_unity_task",
    "/mcp/apply_script_actions",
    "/mcp/apply_visual_actions",
    "/mcp/set_ui_properties",
    "/mcp/set_serialized_property",
  ]),
  mcp_read_http_routes: Object.freeze([
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
    "/mcp/heartbeat",
    "/mcp/metrics",
    "/mcp/stream",
    "/mcp/capabilities",
  ]),
  unity_callback_http_routes: Object.freeze([
    "/unity/compile/result",
    "/unity/action/result",
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
  ]),
  mcp_tool_names: Object.freeze([
    "submit_unity_task",
    "get_unity_task_status",
    "cancel_unity_task",
    "apply_script_actions",
    "apply_visual_actions",
    "set_ui_properties",
    "set_serialized_property",
    "get_current_selection",
    "get_gameobject_components",
    "get_hierarchy_subtree",
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
  disabled_tools: Object.freeze(["hit_test_ui_at_screen_point"]),
  disabled_tool_notes: Object.freeze({
    hit_test_ui_at_screen_point:
      "hidden_from_tools_list_and_blocked_in_tools_call; HTTP route returns E_COMMAND_DISABLED",
  }),
  capture_mode_notes: Object.freeze({
    capture_scene_screenshot: "render_output_stable_composite_flagged",
  }),
});

const MCP_PROTOCOL_USABILITY_CONTRACT = Object.freeze({
  shortest_write_sequence: Object.freeze([
    "get_current_selection",
    "apply_visual_actions",
  ]),
  schema_recovery_sequence: Object.freeze([
    "get_tool_schema",
    "get_action_schema",
  ]),
  deprecated_alias_noise_policy: Object.freeze({
    hide_deprecated_tools_from_tools_list: true,
    disabled_tools_hidden_by_default: true,
    prefer_phase2_primitive_action_names: true,
  }),
});

const RUNTIME_MODE_FREEZE_CONTRACT = Object.freeze({
  gateway_mode_required: true,
  mcp_adapter_always_enabled: true,
  mcp_eyes_always_enabled: true,
  forbidden_disable_switches: Object.freeze([
    "--disable-mcp-adapter",
    "--disable-mcp-eyes",
  ]),
  forbidden_disable_envs: Object.freeze([
    "ENABLE_MCP_ADAPTER",
    "ENABLE_MCP_EYES",
  ]),
});

const OBSERVABILITY_FREEZE_CONTRACT = Object.freeze({
  phase: "phase6_freeze",
  metrics_contract_version: "mcp.metrics.v1",
  stream_event_contract_version: "mcp.stream.event.v1",
  stream_ready_contract_version: "mcp.stream.ready.v1",
  frozen_metrics_fields: Object.freeze([
    "observability_phase",
    "metrics_contract_version",
    "status_query_calls",
    "stream_connect_calls",
    "stream_events_published",
    "stream_events_delivered",
    "stream_replay_events_sent",
    "stream_recovery_jobs_sent",
    "stream_subscriber_rejects",
    "stream_subscriber_drops",
    "push_events_total",
    "query_to_push_ratio",
    "active_stream_subscribers",
    "stream_max_subscribers",
    "stream_recovery_jobs_max",
    "recent_stream_buffer_size",
    "running_job_id",
    "queued_job_count",
    "total_job_count",
    "auto_cleanup_enforced",
    "lease_heartbeat_timeout_ms",
    "lease_max_runtime_ms",
    "reboot_wait_timeout_ms",
    "lease_janitor_interval_ms",
    "auto_cancel_total",
    "auto_cancel_heartbeat_timeout_total",
    "auto_cancel_max_runtime_total",
    "auto_cancel_reboot_wait_timeout_total",
    "lock_release_total",
    "queue_promote_total",
    "error_feedback_normalized_total",
    "error_stack_sanitized_total",
    "error_path_sanitized_total",
    "error_message_truncated_total",
    "error_fixed_suggestion_enforced_total",
    "error_feedback_by_code",
    "legacy_anchor_mode_requested",
    "legacy_anchor_mode_effective",
    "legacy_anchor_deny_signoff",
    "legacy_anchor_deny_gate_required_days",
    "legacy_anchor_zero_hit_window_days",
    "legacy_anchor_deny_gate_ready",
    "legacy_anchor_warn_hits_total",
    "legacy_anchor_warn_hits_by_action",
    "legacy_anchor_last_hit_at",
    "legacy_anchor_requested_deny_blocked_total",
    "action_error_code_missing_total",
    "r20_protocol_governance",
    "capture_composite",
  ]),
  frozen_stream_event_fields: Object.freeze([
    "stream_event_contract_version",
    "seq",
    "event",
    "timestamp",
    "thread_id",
    "job_id",
    "status",
    "stage",
    "message",
    "progress_message",
    "error_code",
    "error_message",
    "suggestion",
    "recoverable",
    "request_id",
    "running_job_id",
    "approval_mode",
    "execution_report",
    "created_at",
    "updated_at",
  ]),
  frozen_stream_ready_fields: Object.freeze([
    "stream_ready_contract_version",
    "seq",
    "event",
    "timestamp",
    "cursor_source",
    "requested_cursor",
    "oldest_event_seq",
    "latest_event_seq",
    "replay_from_seq",
    "replay_truncated",
    "fallback_query_suggested",
    "recovery_jobs_count",
    "recovery_jobs",
    "replay_count",
  ]),
});

module.exports = {
  OCC_WRITE_GUARD_CONTRACT,
  WRITE_ANCHOR_GUARD_CONTRACT,
  ACTION_DATA_WIRE_BRIDGE_CONTRACT,
  LEGACY_ANCHOR_MIGRATION_CONTRACT,
  JOB_LEASE_CONTRACT,
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
  MCP_PROTOCOL_USABILITY_CONTRACT,
  RUNTIME_MODE_FREEZE_CONTRACT,
  OBSERVABILITY_FREEZE_CONTRACT,
};

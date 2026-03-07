"use strict";

const LOCAL_STATIC_TOOL_NAMES = new Set([
  "get_action_catalog",
  "get_action_schema",
  "get_tool_schema",
  "get_write_contract_bundle",
  "preflight_validate_write_payload",
  "setup_cursor_mcp",
  "verify_mcp_setup",
  "run_unity_tests",
]);

module.exports = {
  LOCAL_STATIC_TOOL_NAMES,
};

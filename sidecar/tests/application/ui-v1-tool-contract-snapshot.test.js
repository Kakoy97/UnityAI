"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
} = require("../../src/ports/contracts");

const V1_UI_TOOLS = Object.freeze([
  "get_ui_overlay_report",
  "get_ui_tree",
  "hit_test_ui_at_viewport_point",
  "validate_ui_layout",
  "set_ui_properties",
]);

test("UI-V1 tools are present in command registry and tools/list visibility formula", () => {
  const registry = getMcpCommandRegistry();
  const tools = registry.getToolsListCache({});
  const names = tools.map((item) => item.name);

  const allowlist = new Set(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.security_allowlist)
      ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.security_allowlist
      : []
  );
  const disabled = new Set(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools)
      ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools
      : []
  );
  const deprecated = new Set(
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names)
      ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names
      : []
  );

  for (const toolName of V1_UI_TOOLS) {
    const command = registry.getCommandByName(toolName);
    assert.ok(command, `command missing: ${toolName}`);
    assert.equal(command.mcp && command.mcp.expose, true);

    const expectedVisible =
      (allowlist.size === 0 || allowlist.has(toolName)) &&
      !disabled.has(toolName) &&
      !deprecated.has(toolName);
    assert.equal(
      names.includes(toolName),
      expectedVisible,
      `tools/list visibility mismatch: ${toolName}`
    );
  }
});

test("UI-V1 tool required-field snapshot remains stable", () => {
  const registry = getMcpCommandRegistry();
  const expectedRequiredByTool = {
    get_ui_overlay_report: [],
    get_ui_tree: [],
    hit_test_ui_at_viewport_point: ["x", "y"],
    validate_ui_layout: [],
    set_ui_properties: ["based_on_read_token", "operations", "write_anchor"],
  };

  for (const toolName of V1_UI_TOOLS) {
    const metadata = registry.getToolMetadataByName(toolName, {});
    assert.ok(metadata, `metadata missing: ${toolName}`);
    const required =
      metadata &&
      metadata.input_schema &&
      Array.isArray(metadata.input_schema.required)
        ? [...metadata.input_schema.required].sort()
        : [];
    assert.deepEqual(required, [...expectedRequiredByTool[toolName]].sort());
  }
});

test("UI-V1 schema key snapshots stay stable for mapping/runtime fields", () => {
  const registry = getMcpCommandRegistry();

  const overlay = registry.getToolMetadataByName("get_ui_overlay_report", {});
  const overlayProps = overlay.input_schema.properties;
  assert.equal(Object.prototype.hasOwnProperty.call(overlayProps, "scope"), true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(overlayProps, "max_nodes"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      overlayProps,
      "max_children_per_canvas"
    ),
    true
  );

  const tree = registry.getToolMetadataByName("get_ui_tree", {});
  const treeProps = tree.input_schema.properties;
  assert.equal(
    Object.prototype.hasOwnProperty.call(treeProps, "include_interaction"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(treeProps, "include_text_metrics"),
    true
  );
  assert.equal(Object.prototype.hasOwnProperty.call(treeProps, "resolution"), true);

  const hit = registry.getToolMetadataByName("hit_test_ui_at_viewport_point", {});
  const hitProps = hit.input_schema.properties;
  assert.deepEqual(
    [...hitProps.coord_origin.enum].sort(),
    ["bottom_left", "top_left"]
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(hitProps, "resolution_width"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(hitProps, "resolution_height"),
    true
  );

  const validate = registry.getToolMetadataByName("validate_ui_layout", {});
  const validateProps =
    validate && validate.input_schema && validate.input_schema.properties
      ? validate.input_schema.properties
      : {};
  assert.equal(
    Object.prototype.hasOwnProperty.call(validateProps, "checks_csv"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(validateProps, "resolution_width"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(validateProps, "resolution_height"),
    true
  );

  const setUi = registry.getToolMetadataByName("set_ui_properties", {});
  const setProps = setUi.input_schema.properties;
  assert.equal(Object.prototype.hasOwnProperty.call(setProps, "dry_run"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(setProps, "operations"), true);
  assert.equal(Object.prototype.hasOwnProperty.call(setProps, "atomic"), true);
});

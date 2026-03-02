"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  validateGetSerializedPropertyTree,
} = require("../../src/mcp/commands/get_serialized_property_tree/validator");

function getRequired(name) {
  const registry = getMcpCommandRegistry();
  const metadata = registry.getToolMetadataByName(name, {});
  assert.ok(metadata, `metadata missing: ${name}`);
  return Array.isArray(metadata.input_schema && metadata.input_schema.required)
    ? [...metadata.input_schema.required].sort()
    : [];
}

test("get_serialized_property_tree schema required snapshot aligns with validator", () => {
  assert.deepEqual(getRequired("get_serialized_property_tree"), [
    "component_selector",
    "target_anchor",
  ]);
});

test("get_serialized_property_tree validator rejects missing required fields", () => {
  const missingTarget = validateGetSerializedPropertyTree({
    component_selector: {
      component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
      component_index: 0,
    },
  });
  assert.equal(missingTarget.ok, false);
  assert.equal(missingTarget.errorCode, "E_SCHEMA_INVALID");

  const missingSelector = validateGetSerializedPropertyTree({
    target_anchor: {
      object_id: "go_img",
      path: "Scene/Canvas/Image",
    },
  });
  assert.equal(missingSelector.ok, false);
  assert.equal(missingSelector.errorCode, "E_SCHEMA_INVALID");
});

test("get_serialized_property_tree validator rejects unknown keys and accepts valid payload", () => {
  const unknown = validateGetSerializedPropertyTree({
    target_anchor: {
      object_id: "go_img",
      path: "Scene/Canvas/Image",
    },
    component_selector: {
      component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
      component_index: 0,
    },
    unknown_key: true,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errorCode, "E_SCHEMA_INVALID");

  const ok = validateGetSerializedPropertyTree({
    target_anchor: {
      object_id: "go_img",
      path: "Scene/Canvas/Image",
    },
    component_selector: {
      component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
      component_index: 0,
    },
    root_property_path: "",
    depth: 1,
    page_size: 64,
    node_budget: 128,
    char_budget: 12000,
    include_value_summary: true,
    include_non_visible: false,
    timeout_ms: 3000,
  });
  assert.equal(ok.ok, true);
});

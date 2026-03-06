"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const { getCommandValidator } = require("../adapters/commandValidator");

const validateGetSerializedPropertyTree = getCommandValidator(
  "get_serialized_property_tree"
);

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
    "component_assembly_qualified_name",
    "target_object_id",
    "target_path",
  ]);
});

test("get_serialized_property_tree validator rejects missing required fields", () => {
  const missingComponentType = validateGetSerializedPropertyTree({
    target_object_id: "go_img",
    target_path: "Scene/Canvas/Image",
  });
  assert.equal(missingComponentType.ok, false);
  assert.equal(missingComponentType.errorCode, "E_SSOT_SCHEMA_INVALID");

  const missingTarget = validateGetSerializedPropertyTree({
    component_assembly_qualified_name:
      "UnityEngine.UI.Image, UnityEngine.UI",
    target_object_id: "go_img",
  });
  assert.equal(missingTarget.ok, false);
  assert.equal(missingTarget.errorCode, "E_SSOT_SCHEMA_INVALID");
});

test("get_serialized_property_tree validator rejects unknown keys and accepts valid payload", () => {
  const unknown = validateGetSerializedPropertyTree({
    target_object_id: "go_img",
    target_path: "Scene/Canvas/Image",
    component_assembly_qualified_name:
      "UnityEngine.UI.Image, UnityEngine.UI",
    unknown_key: true,
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.errorCode, "E_SSOT_SCHEMA_INVALID");

  const ok = validateGetSerializedPropertyTree({
    target_object_id: "go_img",
    target_path: "Scene/Canvas/Image",
    component_assembly_qualified_name:
      "UnityEngine.UI.Image, UnityEngine.UI",
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

test("get_serialized_property_tree validator rejects deprecated component_selectors payload", () => {
  const invalid = validateGetSerializedPropertyTree({
    target_object_id: "go_img",
    target_path: "Scene/Canvas/Image",
    component_assembly_qualified_name:
      "UnityEngine.UI.Image, UnityEngine.UI",
    component_selectors: [
      {
        component_assembly_qualified_name:
          "UnityEngine.RectTransform, UnityEngine.CoreModule",
        component_index: 0,
      },
    ],
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorCode, "E_SSOT_SCHEMA_INVALID");
});

test("get_serialized_property_tree validator accepts after_property_path in single-component mode", () => {
  const ok = validateGetSerializedPropertyTree({
    target_object_id: "go_img",
    target_path: "Scene/Canvas/Image",
    component_assembly_qualified_name:
      "UnityEngine.UI.Image, UnityEngine.UI",
    after_property_path: "m_Color",
  });
  assert.equal(ok.ok, true);
});

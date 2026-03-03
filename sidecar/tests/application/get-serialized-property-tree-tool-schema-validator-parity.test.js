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
    "target_anchor",
  ]);
});

test("get_serialized_property_tree validator rejects missing required fields", () => {
  const missingSelectors = validateGetSerializedPropertyTree({
    target_anchor: {
      object_id: "go_img",
      path: "Scene/Canvas/Image",
    },
  });
  assert.equal(missingSelectors.ok, false);
  assert.equal(missingSelectors.errorCode, "E_SCHEMA_INVALID");

  const missingTarget = validateGetSerializedPropertyTree({
    component_selector: {
      component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
      component_index: 0,
    },
  });
  assert.equal(missingTarget.ok, false);
  assert.equal(missingTarget.errorCode, "E_SCHEMA_INVALID");
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

test("get_serialized_property_tree validator accepts component_selectors-only payload", () => {
  const ok = validateGetSerializedPropertyTree({
    target_anchor: {
      object_id: "go_img",
      path: "Scene/Canvas/Image",
    },
    component_selectors: [
      {
        component_assembly_qualified_name: "UnityEngine.RectTransform, UnityEngine.CoreModule",
        component_index: 0,
      },
      {
        component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
        component_index: 0,
      },
    ],
    depth: 1,
    page_size: 64,
  });
  assert.equal(ok.ok, true);
});

test("get_serialized_property_tree validator rejects after_property_path in multi-component mode", () => {
  const invalid = validateGetSerializedPropertyTree({
    target_anchor: {
      object_id: "go_img",
      path: "Scene/Canvas/Image",
    },
    component_selectors: [
      {
        component_assembly_qualified_name: "UnityEngine.RectTransform, UnityEngine.CoreModule",
        component_index: 0,
      },
      {
        component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
        component_index: 0,
      },
    ],
    after_property_path: "m_Color",
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorCode, "E_SCHEMA_INVALID");
});

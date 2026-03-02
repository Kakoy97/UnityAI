"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  buildSetSerializedPropertyApplyVisualPayload,
  validateSetSerializedProperty,
} = require("../../src/mcp/commands/set_serialized_property/validator");

const VALID_TOKEN = "tok_set_serialized_property_1234567890";

function getRequired(name) {
  const registry = getMcpCommandRegistry();
  const metadata = registry.getToolMetadataByName(name, {});
  assert.ok(metadata, `metadata missing: ${name}`);
  return Array.isArray(metadata.input_schema && metadata.input_schema.required)
    ? [...metadata.input_schema.required].sort()
    : [];
}

function buildValidPayload() {
  return {
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_canvas",
      path: "Scene/Canvas",
    },
    target_anchor: {
      object_id: "go_button",
      path: "Scene/Canvas/Button",
    },
    component_selector: {
      component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
      component_index: 0,
    },
    patches: [
      {
        property_path: "m_Color",
        value_kind: "color",
        color_value: {
          r: 1,
          g: 0.5,
          b: 0.25,
          a: 1,
        },
      },
    ],
    dry_run: true,
  };
}

test("set_serialized_property schema required snapshot aligns with validator", () => {
  assert.deepEqual(getRequired("set_serialized_property"), [
    "based_on_read_token",
    "component_selector",
    "patches",
    "target_anchor",
    "write_anchor",
  ]);
});

test("set_serialized_property validator rejects stringified action_data hardcut fields", () => {
  const withJson = validateSetSerializedProperty({
    ...buildValidPayload(),
    action_data_json: "{\"x\":1}",
  });
  assert.equal(withJson.ok, false);
  assert.equal(withJson.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");

  const withMarshaled = validateSetSerializedProperty({
    ...buildValidPayload(),
    action_data_marshaled: "eyJ4IjoxfQ",
  });
  assert.equal(withMarshaled.ok, false);
  assert.equal(withMarshaled.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");
});

test("set_serialized_property validator validates object_reference payload variants", () => {
  const sceneRef = buildValidPayload();
  sceneRef.patches = [
    {
      property_path: "objectRef",
      value_kind: "object_reference",
      object_ref: {
        scene_anchor: {
          object_id: "go_target",
          path: "Scene/Canvas/Button",
        },
      },
    },
  ];
  assert.equal(validateSetSerializedProperty(sceneRef).ok, true);

  const assetRef = buildValidPayload();
  assetRef.patches = [
    {
      property_path: "objectRef",
      value_kind: "object_reference",
      object_ref: {
        asset_guid: "0123456789abcdef0123456789abcdef",
      },
    },
  ];
  assert.equal(validateSetSerializedProperty(assetRef).ok, true);

  const invalidRef = buildValidPayload();
  invalidRef.patches = [
    {
      property_path: "objectRef",
      value_kind: "object_reference",
      object_ref: {},
    },
  ];
  const invalid = validateSetSerializedProperty(invalidRef);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errorCode, "E_SCHEMA_INVALID");
});

test("set_serialized_property maps to apply_visual_actions contract payload", () => {
  const payload = buildValidPayload();
  const mapped = buildSetSerializedPropertyApplyVisualPayload(payload);

  assert.equal(mapped.based_on_read_token, payload.based_on_read_token);
  assert.deepEqual(mapped.write_anchor, payload.write_anchor);
  assert.equal(Array.isArray(mapped.actions), true);
  assert.equal(mapped.actions.length, 1);
  assert.equal(mapped.actions[0].type, "set_serialized_property");
  assert.deepEqual(mapped.actions[0].target_anchor, payload.target_anchor);
  assert.deepEqual(
    mapped.actions[0].action_data.component_selector,
    payload.component_selector
  );
  assert.deepEqual(mapped.actions[0].action_data.patches, payload.patches);
});

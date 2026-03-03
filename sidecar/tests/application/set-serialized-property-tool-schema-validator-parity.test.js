"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  buildSetSerializedPropertyApplyVisualPayload,
  validateSetSerializedProperty,
} = require("../../src/mcp/commands/set_serialized_property/validator");

const VALID_TOKEN = "tok_set_serialized_property_1234567890";
const MAX_PATCHES_PER_ACTION = 64;

function getMetadata(name) {
  const registry = getMcpCommandRegistry();
  const metadata = registry.getToolMetadataByName(name, {});
  assert.ok(metadata, `metadata missing: ${name}`);
  return metadata;
}

function getRequired(name) {
  const metadata = getMetadata(name);
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

test("set_serialized_property schema enum includes bool and enforces max patches", () => {
  const metadata = getMetadata("set_serialized_property");
  const patches = metadata.input_schema.properties.patches;
  assert.equal(patches.minItems, 1);
  assert.equal(patches.maxItems, MAX_PATCHES_PER_ACTION);
  assert.deepEqual(
    patches.items.properties.value_kind.enum,
    [
      "integer",
      "float",
      "string",
      "bool",
      "enum",
      "quaternion",
      "vector4",
      "vector2",
      "vector3",
      "rect",
      "color",
      "array",
      "animation_curve",
      "object_reference",
    ]
  );
  assert.deepEqual(
    patches.items.properties.op.enum,
    ["set", "insert", "remove", "clear"]
  );
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

test("set_serialized_property validator accepts bool and rejects non-boolean bool_value", () => {
  const valid = buildValidPayload();
  valid.patches = [
    {
      property_path: "m_RaycastTarget",
      value_kind: "bool",
      bool_value: false,
    },
  ];
  assert.equal(validateSetSerializedProperty(valid).ok, true);

  const invalid = buildValidPayload();
  invalid.patches = [
    {
      property_path: "m_RaycastTarget",
      value_kind: "bool",
      bool_value: "false",
    },
  ];
  const outcome = validateSetSerializedProperty(invalid);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "E_SCHEMA_INVALID");
});

test("set_serialized_property validator rejects patch count over hard limit", () => {
  const payload = buildValidPayload();
  payload.patches = [];
  for (let i = 0; i < MAX_PATCHES_PER_ACTION + 1; i += 1) {
    payload.patches.push({
      property_path: "m_SomeInt",
      value_kind: "integer",
      int_value: i,
    });
  }

  const outcome = validateSetSerializedProperty(payload);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    outcome.message.includes(`max allowed ${MAX_PATCHES_PER_ACTION}`),
    true
  );
});

test("set_serialized_property validator validates array op payloads", () => {
  const insertPayload = buildValidPayload();
  insertPayload.patches = [
    {
      property_path: "m_Items",
      value_kind: "array",
      op: "insert",
      index: 2,
    },
  ];
  assert.equal(validateSetSerializedProperty(insertPayload).ok, true);

  const removePayload = buildValidPayload();
  removePayload.patches = [
    {
      property_path: "m_Items",
      value_kind: "array",
      op: "remove",
      indices: [1, 3],
    },
  ];
  assert.equal(validateSetSerializedProperty(removePayload).ok, true);

  const clearPayload = buildValidPayload();
  clearPayload.patches = [
    {
      property_path: "m_Items",
      value_kind: "array",
      op: "clear",
    },
  ];
  assert.equal(validateSetSerializedProperty(clearPayload).ok, true);
});

test("set_serialized_property validator validates quaternion/vector4/rect kinds", () => {
  const quaternionPayload = buildValidPayload();
  quaternionPayload.patches = [
    {
      property_path: "rotation",
      value_kind: "quaternion",
      quaternion_value: {
        x: 0,
        y: 0,
        z: 0,
        w: 1,
      },
    },
  ];
  assert.equal(validateSetSerializedProperty(quaternionPayload).ok, true);

  const vector4Payload = buildValidPayload();
  vector4Payload.patches = [
    {
      property_path: "weights",
      value_kind: "vector4",
      vector4_value: {
        x: 1,
        y: 2,
        z: 3,
        w: 4,
      },
    },
  ];
  assert.equal(validateSetSerializedProperty(vector4Payload).ok, true);

  const rectPayload = buildValidPayload();
  rectPayload.patches = [
    {
      property_path: "rectValue",
      value_kind: "rect",
      rect_value: {
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      },
    },
  ];
  assert.equal(validateSetSerializedProperty(rectPayload).ok, true);
});

test("set_serialized_property validator accepts animation_curve kind placeholder payload", () => {
  const payload = buildValidPayload();
  payload.patches = [
    {
      property_path: "curve",
      value_kind: "animation_curve",
      animation_curve_value: {
        keys: [],
      },
    },
  ];
  assert.equal(validateSetSerializedProperty(payload).ok, true);
});

test("set_serialized_property validator rejects invalid array op payloads", () => {
  const missingIndex = buildValidPayload();
  missingIndex.patches = [
    {
      property_path: "m_Items",
      value_kind: "array",
      op: "insert",
    },
  ];
  const missingIndexOutcome = validateSetSerializedProperty(missingIndex);
  assert.equal(missingIndexOutcome.ok, false);
  assert.equal(missingIndexOutcome.errorCode, "E_SCHEMA_INVALID");

  const removeMissingTargets = buildValidPayload();
  removeMissingTargets.patches = [
    {
      property_path: "m_Items",
      value_kind: "array",
      op: "remove",
    },
  ];
  const removeOutcome = validateSetSerializedProperty(removeMissingTargets);
  assert.equal(removeOutcome.ok, false);
  assert.equal(removeOutcome.errorCode, "E_SCHEMA_INVALID");

  const badOp = buildValidPayload();
  badOp.patches = [
    {
      property_path: "m_Items",
      value_kind: "array",
      op: "merge",
      array_size: 2,
    },
  ];
  const badOpOutcome = validateSetSerializedProperty(badOp);
  assert.equal(badOpOutcome.ok, false);
  assert.equal(badOpOutcome.errorCode, "E_SCHEMA_INVALID");
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
  assert.equal(mapped.actions[0].action_data.dry_run, true);
});

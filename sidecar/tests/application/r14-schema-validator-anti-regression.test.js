"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const { validateMcpApplyVisualActions } = require("../../src/domain/validators");

const VALID_TOKEN = "tok_r14_schema_guard_123456789012345678";

function buildApplyVisualBody(action) {
  return {
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      action,
    ],
  };
}

test("R14-L2-08 apply_visual_actions full schema keeps action_data-only external contract", () => {
  const registry = getMcpCommandRegistry();
  const metadata = registry.getToolMetadataByName("apply_visual_actions", {});

  assert.ok(metadata);
  const itemsSchema =
    metadata &&
    metadata.input_schema &&
    metadata.input_schema.properties &&
    metadata.input_schema.properties.actions &&
    metadata.input_schema.properties.actions.items;
  assert.ok(itemsSchema);
  assert.equal(
    Object.prototype.hasOwnProperty.call(itemsSchema.properties, "action_data_json"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(itemsSchema.properties.type || {}, "enum"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(itemsSchema.properties.type || {}, "oneOf"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(itemsSchema.properties.type || {}, "anyOf"),
    false
  );
});

test("R14-L2-08 apply_visual_actions tools/list compact schema does not re-expose action_data_json", () => {
  const registry = getMcpCommandRegistry();
  const tools = registry.getToolsListCache({});
  const visual = tools.find((item) => item && item.name === "apply_visual_actions");

  assert.ok(visual);
  const itemsSchema =
    visual &&
    visual.inputSchema &&
    visual.inputSchema.properties &&
    visual.inputSchema.properties.actions &&
    visual.inputSchema.properties.actions.items;
  assert.ok(itemsSchema);
  assert.equal(
    Object.prototype.hasOwnProperty.call(itemsSchema.properties, "action_data_json"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(itemsSchema.properties.type || {}, "enum"),
    false
  );
});

test("R14-L2-08 validator hard-rejects external stringified action_data fields", () => {
  const validation = validateMcpApplyVisualActions(
    buildApplyVisualBody({
      type: "set_ui_image_color",
      target_anchor: {
        object_id: "go_img",
        path: "Scene/Canvas/Image",
      },
      action_data_json: "{\"r\":1}",
    })
  );

  assert.equal(validation.ok, false);
  assert.equal(validation.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");
  assert.equal(validation.statusCode, 400);

  const marshaledValidation = validateMcpApplyVisualActions(
    buildApplyVisualBody({
      type: "set_ui_image_color",
      target_anchor: {
        object_id: "go_img",
        path: "Scene/Canvas/Image",
      },
      action_data_marshaled: "eyJyIjoxfQ",
    })
  );
  assert.equal(marshaledValidation.ok, false);
  assert.equal(
    marshaledValidation.errorCode,
    "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED"
  );
  assert.equal(marshaledValidation.statusCode, 400);
});

test("R14-L2-08 validator keeps unknown action submit-open with action_data object", () => {
  const validation = validateMcpApplyVisualActions(
    buildApplyVisualBody({
      type: "set_rect_transform",
      parent_anchor: {
        object_id: "go_panel",
        path: "Scene/Canvas/Panel",
      },
      action_data: {
        anchored_position: { x: 12, y: 24 },
      },
    })
  );

  assert.equal(validation.ok, true);
});

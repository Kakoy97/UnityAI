"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateMcpApplyVisualActions,
  validateMcpSubmitUnityTask,
} = require("../../src/domain/validators");

const VALID_TOKEN = "tok_composite_123456789012345678901234";

function buildCompositeAction(extra) {
  return {
    type: "composite_visual_action",
    target_anchor: {
      object_id: "go_canvas",
      path: "Scene/Canvas",
    },
    action_data: {
      schema_version: "r10.v1",
      transaction_id: "tx_ui_hpbar_001",
      atomic_mode: "all_or_nothing",
      max_step_ms: 1500,
      steps: [
        {
          step_id: "s1_create_root",
          type: "create_gameobject",
          parent_anchor: {
            object_id: "go_canvas",
            path: "Scene/Canvas",
          },
          action_data: {
            name: "HealthBar",
          },
          bind_outputs: [
            {
              source: "created_object",
              alias: "hp_root",
            },
          ],
        },
        {
          step_id: "s2_set_color",
          type: "set_ui_image_color",
          target_anchor_ref: "hp_root",
          action_data: {
            r: 1,
            g: 0.25,
            b: 0.25,
            a: 1,
          },
        },
      ],
    },
    ...(extra && typeof extra === "object" ? extra : {}),
  };
}

function buildApplyBody(action) {
  return {
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_canvas",
      path: "Scene/Canvas",
    },
    actions: [action],
  };
}

test("apply_visual_actions rejects top-level action_data_json from external payload", () => {
  const result = validateMcpApplyVisualActions(
    buildApplyBody({
      type: "set_ui_image_color",
      target_anchor: {
        object_id: "go_img",
        path: "Scene/Canvas/Image",
      },
      action_data: {
        r: 1,
        g: 0,
        b: 0,
        a: 1,
      },
      action_data_json: "{\"r\":1}",
    })
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");
});

test("apply_visual_actions rejects nested step action_data_json in composite payload", () => {
  const action = buildCompositeAction();
  action.action_data.steps[1].action_data_json = "{\"r\":1}";
  delete action.action_data.steps[1].action_data;
  const result = validateMcpApplyVisualActions(buildApplyBody(action));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");
});

test("apply_visual_actions rejects action_data_marshaled in external payload", () => {
  const topLevel = validateMcpApplyVisualActions(
    buildApplyBody({
      type: "set_ui_image_color",
      target_anchor: {
        object_id: "go_img",
        path: "Scene/Canvas/Image",
      },
      action_data_marshaled: "eyJyIjoxfQ",
    })
  );
  assert.equal(topLevel.ok, false);
  assert.equal(topLevel.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");

  const compositeAction = buildCompositeAction();
  compositeAction.action_data.steps[1].action_data_marshaled = "eyJyIjoxfQ";
  delete compositeAction.action_data.steps[1].action_data;
  const nested = validateMcpApplyVisualActions(buildApplyBody(compositeAction));
  assert.equal(nested.ok, false);
  assert.equal(nested.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");
});

test("apply_visual_actions rejects inline alias interpolation in composite step action_data", () => {
  const action = buildCompositeAction();
  action.action_data.steps[1].action_data = {
    component_ref: "$ref:hp_root",
  };
  const result = validateMcpApplyVisualActions(buildApplyBody(action));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_COMPOSITE_ALIAS_INLINE_REF_UNSUPPORTED");
});

test("apply_visual_actions rejects forward alias reference in composite steps", () => {
  const action = buildCompositeAction();
  action.action_data.steps = [
    {
      step_id: "s1_set_color_first",
      type: "set_ui_image_color",
      target_anchor_ref: "hp_root",
      action_data: {
        r: 1,
        g: 0.25,
        b: 0.25,
        a: 1,
      },
    },
    ...action.action_data.steps,
  ];
  const result = validateMcpApplyVisualActions(buildApplyBody(action));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_COMPOSITE_ALIAS_FORWARD_REF");
});

test("apply_visual_actions rejects composite budget overflow", () => {
  const action = buildCompositeAction();
  action.action_data.max_step_ms = 2000;
  action.action_data.steps = [
    action.action_data.steps[0],
    action.action_data.steps[1],
    {
      step_id: "s3_create_x1",
      type: "create_gameobject",
      parent_anchor_ref: "hp_root",
      action_data: { name: "X1" },
      bind_outputs: [{ source: "created_object", alias: "x_001" }],
    },
    {
      step_id: "s4_create_x2",
      type: "create_gameobject",
      parent_anchor_ref: "hp_root",
      action_data: { name: "X2" },
      bind_outputs: [{ source: "created_object", alias: "x_002" }],
    },
    {
      step_id: "s5_create_x3",
      type: "create_gameobject",
      parent_anchor_ref: "hp_root",
      action_data: { name: "X3" },
      bind_outputs: [{ source: "created_object", alias: "x_003" }],
    },
    {
      step_id: "s6_create_x4",
      type: "create_gameobject",
      parent_anchor_ref: "hp_root",
      action_data: { name: "X4" },
      bind_outputs: [{ source: "created_object", alias: "x_004" }],
    },
    {
      step_id: "s7_create_x5",
      type: "create_gameobject",
      parent_anchor_ref: "hp_root",
      action_data: { name: "X5" },
      bind_outputs: [{ source: "created_object", alias: "x_005" }],
    },
  ];
  const result = validateMcpApplyVisualActions(buildApplyBody(action));

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_COMPOSITE_BUDGET_EXCEEDED");
});

test("apply_visual_actions rejects duplicate alias binding in composite steps", () => {
  const action = buildCompositeAction();
  action.action_data.steps.push({
    step_id: "s3_create_dup_alias",
    type: "create_gameobject",
    parent_anchor_ref: "hp_root",
    action_data: {
      name: "DupAliasObject",
    },
    bind_outputs: [
      {
        source: "created_object",
        alias: "hp_root",
      },
    ],
  });

  const result = validateMcpApplyVisualActions(buildApplyBody(action));
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_COMPOSITE_ALIAS_DUPLICATED");
});

test("apply_visual_actions rejects duplicate step_id in composite steps", () => {
  const action = buildCompositeAction();
  action.action_data.steps[1].step_id = "s1_create_root";

  const result = validateMcpApplyVisualActions(buildApplyBody(action));
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_COMPOSITE_PAYLOAD_INVALID");
});

test("apply_visual_actions accepts valid composite payload", () => {
  const result = validateMcpApplyVisualActions(
    buildApplyBody(buildCompositeAction())
  );

  assert.equal(result.ok, true);
});

test("submit_unity_task also rejects external action_data_json", () => {
  const result = validateMcpSubmitUnityTask({
    thread_id: "thread_composite",
    idempotency_key: "idem_composite",
    approval_mode: "auto",
    user_intent: "composite validation test",
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_canvas",
      path: "Scene/Canvas",
    },
    visual_layer_actions: [
      {
        type: "set_ui_image_color",
        target_anchor: {
          object_id: "go_img",
          path: "Scene/Canvas/Image",
        },
        action_data_json: "{\"r\":1}",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");
});

test("submit_unity_task also rejects external action_data_marshaled", () => {
  const result = validateMcpSubmitUnityTask({
    thread_id: "thread_composite",
    idempotency_key: "idem_composite_marshaled",
    approval_mode: "auto",
    user_intent: "composite marshaled validation test",
    based_on_read_token: VALID_TOKEN,
    write_anchor: {
      object_id: "go_canvas",
      path: "Scene/Canvas",
    },
    visual_layer_actions: [
      {
        type: "set_ui_image_color",
        target_anchor: {
          object_id: "go_img",
          path: "Scene/Canvas/Image",
        },
        action_data_marshaled: "eyJyIjoxfQ",
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED");
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildValidationSchemaCompensation,
  resolveSchemaIssueClassification,
} = require("../../src/application/turnPolicies");

function buildBaseOptions() {
  return {
    toolName: "apply_visual_actions",
    catalogVersion: "sha256:r20_ux_test",
    requestBody: {
      actions: [
        {
          type: "rename_object",
        },
      ],
    },
  };
}

test("R20-UX-A-01 anchor schema errors prefer get_tool_schema compensation", () => {
  const compensation = buildValidationSchemaCompensation(
    {
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: "actions[0].target_anchor.object_id is required",
    },
    buildBaseOptions()
  );

  assert.ok(compensation && typeof compensation === "object");
  assert.equal(compensation.schema_source, "get_tool_schema");
  assert.equal(compensation.schema_ref.tool, "get_tool_schema");
  assert.equal(compensation.schema_ref.params.tool_name, "apply_visual_actions");
  assert.equal(compensation.schema_issue_category, "anchor");
  assert.equal(compensation.field_path, "actions[0].target_anchor.object_id");
  assert.equal(compensation.fix_kind, "anchor_missing_or_invalid");
});

test("R20-UX-A-01 action_data schema errors keep get_action_schema compensation", () => {
  const compensation = buildValidationSchemaCompensation(
    {
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: "actions[0].action_data.name is required",
    },
    buildBaseOptions()
  );

  assert.ok(compensation && typeof compensation === "object");
  assert.equal(compensation.schema_source, "get_action_schema");
  assert.equal(compensation.schema_ref.tool, "get_action_schema");
  assert.equal(compensation.schema_ref.params.action_type, "rename_object");
  assert.equal(compensation.schema_issue_category, "action_data");
  assert.equal(compensation.field_path, "actions[0].action_data.name");
  assert.equal(compensation.fix_kind, "action_data_invalid_shape");
});

test("R20-UX-A-02 classifier marks read token errors as token category", () => {
  const compensation = buildValidationSchemaCompensation(
    {
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: "based_on_read_token is required",
    },
    buildBaseOptions()
  );

  assert.ok(compensation && typeof compensation === "object");
  assert.equal(compensation.schema_source, "get_tool_schema");
  assert.equal(compensation.schema_issue_category, "token");
  assert.equal(compensation.field_path, "based_on_read_token");
  assert.equal(compensation.fix_kind, "token_missing_or_stale");
});

test("R20-UX-A-02 classifier marks target_anchor field path as anchor", () => {
  const classification = resolveSchemaIssueClassification({
    errorCode: "E_ACTION_SCHEMA_INVALID",
    message: "actions[0].target_anchor.path is required",
  });

  assert.equal(classification.category, "anchor");
  assert.equal(classification.field_path, "actions[0].target_anchor.path");
  assert.equal(classification.fix_kind, "anchor_missing_or_invalid");
});

test("R20-UX-C-03 anchor error includes suggested_patch + corrected_payload", () => {
  const compensation = buildValidationSchemaCompensation(
    {
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: "actions[0].target_anchor.object_id is required",
    },
    {
      toolName: "apply_visual_actions",
      requestBody: {
        based_on_read_token: "tok_r20_c03_123456789012345678",
        write_anchor: {
          object_id: "go_panel",
          path: "Scene/Canvas/Panel",
        },
        actions: [
          {
            type: "rename_object",
            target_anchor: {},
            action_data: {
              name: "Panel_Renamed",
            },
          },
        ],
      },
    }
  );

  assert.ok(compensation && typeof compensation === "object");
  assert.equal(Array.isArray(compensation.suggested_patch), true);
  assert.equal(compensation.suggested_patch.length, 1);
  assert.equal(compensation.suggested_patch[0].path, "/actions/0/target_anchor");
  assert.equal(
    compensation.suggested_patch[0].value.object_id,
    "go_panel"
  );
  assert.ok(compensation.corrected_payload);
  assert.equal(
    compensation.corrected_payload.actions[0].target_anchor.path,
    "Scene/Canvas/Panel"
  );
  assert.equal(compensation.normalization_applied, true);
  assert.equal(compensation.next_step, "retry_with_corrected_payload");
  assert.equal(
    typeof compensation.original_payload_hash === "string" &&
      compensation.original_payload_hash.startsWith("sha256:"),
    true
  );
});

test("R20-UX-C-03 action_data errors do not emit anchor auto-fix patch", () => {
  const compensation = buildValidationSchemaCompensation(
    {
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: "actions[0].action_data.name is required",
    },
    {
      toolName: "apply_visual_actions",
      requestBody: {
        based_on_read_token: "tok_r20_c03_222222222222222222",
        write_anchor: {
          object_id: "go_panel",
          path: "Scene/Canvas/Panel",
        },
        actions: [
          {
            type: "rename_object",
            target_anchor: {
              object_id: "go_panel",
              path: "Scene/Canvas/Panel",
            },
            action_data: {},
          },
        ],
      },
    }
  );

  assert.ok(compensation && typeof compensation === "object");
  assert.equal(Object.prototype.hasOwnProperty.call(compensation, "suggested_patch"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(compensation, "corrected_payload"), false);
});

test("R20-UX-C-03 create action parent_anchor error includes suggested_patch + corrected_payload", () => {
  const compensation = buildValidationSchemaCompensation(
    {
      errorCode: "E_ACTION_SCHEMA_INVALID",
      message: "actions[0].parent_anchor.object_id is required",
    },
    {
      toolName: "apply_visual_actions",
      requestBody: {
        based_on_read_token: "tok_r20_c03_create_123456789012",
        write_anchor: {
          object_id: "go_canvas",
          path: "Scene/Canvas",
        },
        actions: [
          {
            type: "create_gameobject",
            parent_anchor: {},
            action_data: {
              name: "StartButton",
              ui_type: "Button",
            },
          },
        ],
      },
    }
  );

  assert.ok(compensation && typeof compensation === "object");
  assert.equal(Array.isArray(compensation.suggested_patch), true);
  assert.equal(compensation.suggested_patch.length, 1);
  assert.equal(compensation.suggested_patch[0].path, "/actions/0/parent_anchor");
  assert.equal(compensation.suggested_patch[0].value.object_id, "go_canvas");
  assert.ok(compensation.corrected_payload);
  assert.equal(
    compensation.corrected_payload.actions[0].parent_anchor.path,
    "Scene/Canvas"
  );
  assert.equal(compensation.normalization_applied, true);
  assert.equal(compensation.next_step, "retry_with_corrected_payload");
});

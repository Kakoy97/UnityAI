"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateUnityCapabilitiesReport,
  validateMcpApplyScriptActions,
} = require("../../src/domain/validators");
const {
  validateGetActionSchema,
} = require("../../src/mcp/commands/get_action_schema/validator");
const {
  validateGetActionCatalog,
} = require("../../src/mcp/commands/get_action_catalog/validator");
const {
  validateGetToolSchema,
} = require("../../src/mcp/commands/get_tool_schema/validator");
const {
  validateGetWriteContractBundle,
} = require("../../src/mcp/commands/get_write_contract_bundle/validator");

function buildCapabilitiesReport(extraPayload) {
  return {
    event: "unity.capabilities.report",
    request_id: "req_capability_report_1",
    thread_id: "t_default",
    turn_id: "turn_capability_report_1",
    timestamp: new Date().toISOString(),
    payload: {
      capability_version: "sha256:test-capability-v1",
      actions: [
        {
          type: "set_ui_image_color",
          description: "Set Image color",
          anchor_policy: "target_required",
          action_data_schema: {
            type: "object",
            required: ["r", "g", "b", "a"],
          },
        },
      ],
      ...(extraPayload && typeof extraPayload === "object" ? extraPayload : {}),
    },
  };
}

test("validateUnityCapabilitiesReport accepts valid capability payload", () => {
  const result = validateUnityCapabilitiesReport(buildCapabilitiesReport());
  assert.equal(result.ok, true);
});

test("validateUnityCapabilitiesReport rejects missing capability_version", () => {
  const result = validateUnityCapabilitiesReport(
    buildCapabilitiesReport({ capability_version: "" })
  );
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(result.message, "payload.capability_version is required");
});

test("validateMcpGetActionSchema validates required action_type", () => {
  const ok = validateGetActionSchema({
    action_type: "set_ui_image_color",
    catalog_version: "sha256:test-capability-v1",
    if_none_match: "\"schema:test\"",
  });
  assert.equal(ok.ok, true);

  const bad = validateGetActionSchema({});
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "E_SCHEMA_INVALID");
  assert.equal(bad.message, "action_type is required");
});

test("validateMcpGetActionCatalog validates optional paging/filter fields", () => {
  const ok = validateGetActionCatalog({
    domain: "ui",
    tier: "core",
    lifecycle: "stable",
    cursor: 0,
    limit: 10,
    catalog_version: "sha256:test-capability-v1",
    if_none_match: "\"catalog:test\"",
  });
  assert.equal(ok.ok, true);

  const bad = validateGetActionCatalog({
    cursor: -1,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "E_SCHEMA_INVALID");
  assert.equal(bad.message, "cursor must be an integer >= 0 when provided");
});

test("validateMcpGetToolSchema validates required tool_name", () => {
  const ok = validateGetToolSchema({
    tool_name: "apply_visual_actions",
  });
  assert.equal(ok.ok, true);

  const bad = validateGetToolSchema({});
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "E_SCHEMA_INVALID");
  assert.equal(bad.message, "tool_name is required");
});

test("validateGetWriteContractBundle validates optional fields and rejects invalid payload", () => {
  const ok = validateGetWriteContractBundle({
    tool_name: "apply_visual_actions",
    action_type: "rename_object",
    catalog_version: "sha256:capability_v1",
    budget_chars: 3600,
    include_error_fix_map: true,
    include_canonical_examples: false,
  });
  assert.equal(ok.ok, true);

  const bad = validateGetWriteContractBundle({
    budget_chars: 0,
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.errorCode, "E_SCHEMA_INVALID");
  assert.equal(
    bad.message,
    "budget_chars must be an integer >= 1 when provided"
  );
});

test("apply_script_actions rejects legacy component_name precondition alias", () => {
  const result = validateMcpApplyScriptActions({
    based_on_read_token: "tok_capability_test_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "delete_file",
        path: "Assets/Scripts/AIGenerated/T.cs",
      },
    ],
    preconditions: [
      {
        type: "component_exists",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        component_name: "CanvasRenderer",
      },
    ],
  });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "E_SCHEMA_INVALID");
  assert.equal(result.message, "preconditions[0] has unexpected field: component_name");
});

test("apply_script_actions accepts standardized component precondition field", () => {
  const result = validateMcpApplyScriptActions({
    based_on_read_token: "tok_capability_test_123456789012345678",
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    actions: [
      {
        type: "delete_file",
        path: "Assets/Scripts/AIGenerated/T.cs",
      },
    ],
    preconditions: [
      {
        type: "component_exists",
        target_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        component: "CanvasRenderer",
      },
    ],
  });
  assert.equal(result.ok, true);
});

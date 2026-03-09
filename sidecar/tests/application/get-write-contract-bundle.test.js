"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  getWriteContractBundleView,
} = require("../../src/application/ssotRuntime/staticContractViews");

async function dispatchBodyCommand(registry, path, body, turnService) {
  return registry.dispatchHttpCommand({
    method: "POST",
    path,
    url: new URL(`http://127.0.0.1:46321${path}`),
    req: {},
    readJsonBody: async () => body,
    turnService,
  });
}

function createMockTurnService() {
  return {
    nowIso: () => "2026-03-03T00:00:00.000Z",
    getWriteContractBundleForMcp(payload) {
      return getWriteContractBundleView(payload);
    },
  };
}

test("get_write_contract_bundle returns static contract payload for SSOT write tool", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "modify_ui_layout",
      action_type: "rename_object",
      budget_chars: 16000,
      include_related: true,
      include_enhanced: true,
      include_legacy: true,
      context: {
        scenario: "batch_ui_create",
      },
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.contract_version, "2.0");
  assert.equal(outcome.body.tool_name, "modify_ui_layout");
  assert.equal(outcome.body.action_type, "rename_object");
  assert.equal(outcome.body.schema_source, "ssot_static_artifact");
  assert.equal(outcome.body.validation_tool, "preflight_validate_write_payload");
  assert.deepEqual(
    Array.isArray(outcome.body.required_fields),
    true
  );
  assert.equal(Array.isArray(outcome.body.required_business_fields), true);
  assert.equal(Array.isArray(outcome.body.system_fields), true);
  assert.equal(Array.isArray(outcome.body.auto_filled_fields), true);
  assert.equal(typeof outcome.body.minimal_valid_template, "object");
  assert.equal(typeof outcome.body.common_aliases, "object");
  assert.equal(outcome.body.required_fields.includes("target_path"), true);
  assert.equal(outcome.body.required_business_fields.includes("target_path"), true);
  assert.equal(outcome.body.required_business_fields.includes("anchored_x"), true);
  assert.equal(outcome.body.system_fields.includes("execution_mode"), true);
  assert.equal(outcome.body.system_fields.includes("idempotency_key"), true);
  assert.equal(outcome.body.system_fields.includes("based_on_read_token"), true);
  assert.equal(outcome.body.auto_filled_fields.length, 0);
  assert.equal(
    outcome.body.minimal_valid_template.target_path,
    "Scene/Canvas/Button"
  );
  assert.equal(Object.keys(outcome.body.common_aliases).length, 0);
  assert.ok(outcome.body.write_envelope_contract);
  assert.equal(outcome.body.write_envelope_contract.mode, "static");
  assert.ok(outcome.body.minimal_valid_payload_template);
  assert.equal(outcome.body.schema_ref.tool, "get_tool_schema");
  assert.equal(typeof outcome.body.common_mistakes, "object");
  assert.equal(typeof outcome.body.quick_fixes, "object");
  assert.equal(Array.isArray(outcome.body.recovery_paths), true);
  assert.equal(typeof outcome.body.contract_budget_policy, "object");
  assert.equal(
    Array.isArray(outcome.body.contract_budget_policy.minimal_required_fields),
    true
  );
  assert.equal(
    outcome.body.contract_budget_policy.minimal_required_fields.includes(
      "required_fields"
    ),
    true
  );
  assert.equal(
    outcome.body.quick_fixes.E_TARGET_NOT_FOUND.suggested_action,
    "get_ui_tree"
  );
  assert.equal(
    outcome.body.quick_fixes.E_TARGET_NOT_FOUND.suggested_tool,
    "get_ui_tree"
  );
  assert.equal(
    Array.isArray(outcome.body.quick_fixes.E_TARGET_NOT_FOUND.fix_steps),
    true
  );
  assert.equal(
    outcome.body.quick_fixes.E_TARGET_NOT_FOUND.fix_steps[0].tool,
    "get_ui_tree"
  );
  assert.equal(
    outcome.body.quick_fixes.E_TARGET_NOT_FOUND.fix_steps[0].required,
    true
  );
  assert.equal(
    Number.isFinite(
      Number(outcome.body.quick_fixes.E_TARGET_NOT_FOUND.fix_steps[0].step)
    ),
    true
  );
  assert.equal(Array.isArray(outcome.body.related_contracts), true);
  assert.equal(typeof outcome.body.enhanced_fields, "object");
  assert.equal(typeof outcome.body.legacy_fields, "object");
  assert.equal(typeof outcome.body.metadata, "object");
  assert.equal(
    Number.isFinite(Number(outcome.body.metadata.min_required_budget)),
    true
  );
  assert.equal(
    Number.isFinite(Number(outcome.body.metadata.budget_chars_requested)),
    true
  );
  assert.equal(
    outcome.body.enhanced_fields.quick_fixes.E_TARGET_NOT_FOUND.suggested_tool,
    "get_ui_tree"
  );
  assert.equal(
    typeof outcome.body.quick_fixes.E_TARGET_ANCHOR_CONFLICT,
    "object"
  );
  assert.equal(
    outcome.body.quick_fixes.E_TARGET_ANCHOR_CONFLICT.suggested_action,
    "get_hierarchy_subtree"
  );
  assert.equal(
    Array.isArray(outcome.body.quick_fixes.E_TARGET_ANCHOR_CONFLICT.fix_steps),
    true
  );
  assert.equal(
    outcome.body.quick_fixes.E_TARGET_ANCHOR_CONFLICT.fix_steps.length >= 3,
    true
  );
  assert.equal(
    outcome.body.quick_fixes.E_TARGET_ANCHOR_CONFLICT.fix_steps[0].tool,
    "get_hierarchy_subtree"
  );
  assert.equal(
    Array.isArray(
      outcome.body.quick_fixes.E_TARGET_ANCHOR_CONFLICT.fix_steps[0]
        .context_bindings
    ),
    true
  );
  assert.equal(
    outcome.body.quick_fixes.E_TARGET_ANCHOR_CONFLICT.fix_steps[2].tool,
    "modify_ui_layout"
  );
});

test("get_write_contract_bundle returns tool not found for unknown tool", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "unknown_write_tool",
      action_type: "rename_object",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.ok, false);
  assert.equal(outcome.body.error_code, "E_TOOL_SCHEMA_NOT_FOUND");
  assert.equal(typeof outcome.body.guidance, "string");
});

test("get_write_contract_bundle rejects read tool in static mode", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "get_current_selection",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.ok, false);
  assert.equal(outcome.body.error_code, "E_SSOT_WRITE_TOOL_REQUIRED");
});

test("get_write_contract_bundle supports include_legacy false and budget too small guard", async () => {
  const registry = getMcpCommandRegistry();
  const minimalOutcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "modify_ui_layout",
      include_legacy: false,
      include_related: false,
      include_canonical_examples: false,
      include_error_fix_map: false,
      budget_chars: 1800,
    },
    createMockTurnService()
  );
  assert.equal(minimalOutcome.statusCode, 200);
  assert.equal(minimalOutcome.body.ok, true);
  assert.equal(
    minimalOutcome.body.legacy_fields === undefined ||
      (minimalOutcome.body.legacy_fields &&
        Object.keys(minimalOutcome.body.legacy_fields).length === 0),
    true
  );
  assert.equal(
    minimalOutcome.body.metadata.truncated === true ||
      minimalOutcome.body.metadata.truncated === false,
    true
  );

  const tooSmallOutcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "modify_ui_layout",
      budget_chars: 20,
    },
    createMockTurnService()
  );
  assert.equal(tooSmallOutcome.statusCode, 400);
  assert.equal(tooSmallOutcome.body.ok, false);
  assert.equal(tooSmallOutcome.body.error_code, "E_CONTRACT_BUDGET_TOO_SMALL");
  assert.equal(Number.isFinite(Number(tooSmallOutcome.body.min_required_budget)), true);
});

test("get_write_contract_bundle keeps at least one common_mistake in tight budget success case", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "modify_ui_layout",
      include_related: false,
      include_enhanced: false,
      include_legacy: false,
      budget_chars: 1800,
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(Array.isArray(outcome.body.common_mistakes), true);
  assert.equal(outcome.body.common_mistakes.length >= 1, true);
  assert.equal(Array.isArray(outcome.body.required_fields), true);
  assert.equal(outcome.body.required_fields.length >= 1, true);
});

test("get_write_contract_bundle exposes create pre-check policy for create family tool", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "create_object",
      include_enhanced: true,
      include_legacy: false,
      budget_chars: 12000,
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(typeof outcome.body.enhanced_fields, "object");
  assert.equal(
    typeof outcome.body.enhanced_fields.create_pre_check_policy,
    "object"
  );
  assert.equal(
    outcome.body.enhanced_fields.create_pre_check_policy.policy_field,
    "name_collision_policy"
  );
  assert.equal(
    Array.isArray(
      outcome.body.enhanced_fields.create_pre_check_policy.allowed_policies
    ),
    true
  );
  assert.equal(
    outcome.body.enhanced_fields.create_pre_check_policy.allowed_policies.includes(
      "suffix"
    ),
    true
  );
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeStaticToolCatalog,
} = require("../../src/application/ssotRuntime/staticToolCatalog");

function buildTool(name, overrides = {}) {
  return {
    name,
    kind: "write",
    lifecycle: "stable",
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
    examples: [],
    tool_priority: "P1",
    must_configure: false,
    priority_score: 0,
    usage_notes: "",
    examples_positive: [],
    examples_negative: [],
    common_error_fixes: {},
    related_tools: [],
    tool_combinations: [],
    ...overrides,
  };
}

function buildCatalog(tools, globalContracts = {}) {
  return {
    version: 1,
    global_contracts: globalContracts,
    tools,
  };
}

function buildErrorFeedbackContract(overrides = {}) {
  return {
    catalog_version: "v1",
    defaults: {
      fallback_suggestion:
        "Inspect error_code/error_message, adjust task payload, then retry if safe.",
      timeout_suggestion:
        "Retry once after backoff. If timeout persists, reduce task scope or inspect sidecar logs.",
    },
    anchor_error_codes: [
      "E_ACTION_SCHEMA_INVALID",
      "E_TARGET_ANCHOR_CONFLICT",
      "E_TARGET_CONFLICT",
    ],
    error_templates: {
      E_STALE_SNAPSHOT: {
        recoverable: true,
        suggestion: "请先调用读工具获取最新 token，并仅重试一次写操作。",
      },
      E_ACTION_SCHEMA_INVALID: {
        recoverable: true,
        suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
      },
      E_TARGET_ANCHOR_CONFLICT: {
        recoverable: true,
        suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
      },
      E_TARGET_CONFLICT: {
        recoverable: true,
        suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
      },
    },
    ...overrides,
  };
}

test("static tool catalog accepts valid common_error_fixes and fix_steps links", () => {
  const payload = buildCatalog([
    buildTool("get_scene_snapshot_for_write", { kind: "read" }),
    buildTool("execute_unity_transaction", {
      common_error_fixes: {
        E_SCENE_REVISION_DRIFT: {
          suggested_action: "get_scene_snapshot_for_write",
          fix_hint: "refresh token",
          auto_fixable: true,
          fix_steps: [
            {
              step: 1,
              tool: "get_scene_snapshot_for_write",
            },
          ],
        },
      },
    }),
  ]);

  const normalized = normalizeStaticToolCatalog(payload, "<test>");
  assert.equal(normalized.tools.length, 2);
});

test("static tool catalog rejects unknown suggested_action in common_error_fixes", () => {
  const payload = buildCatalog([
    buildTool("execute_unity_transaction", {
      common_error_fixes: {
        E_SCENE_REVISION_DRIFT: {
          suggested_action: "unknown_tool",
          fix_hint: "refresh token",
        },
      },
    }),
  ]);

  assert.throws(
    () => normalizeStaticToolCatalog(payload, "<test>"),
    /suggested_action references unknown tool/
  );
});

test("static tool catalog rejects unknown fix_steps tool", () => {
  const payload = buildCatalog([
    buildTool("get_scene_snapshot_for_write", { kind: "read" }),
    buildTool("execute_unity_transaction", {
      common_error_fixes: {
        E_SCENE_REVISION_DRIFT: {
          suggested_action: "get_scene_snapshot_for_write",
          fix_hint: "refresh token",
          auto_fixable: true,
          fix_steps: [
            {
              step: 1,
              tool: "unknown_tool",
            },
          ],
        },
      },
    }),
  ]);

  assert.throws(
    () => normalizeStaticToolCatalog(payload, "<test>"),
    /fix_steps\[0\]\.tool references unknown tool/
  );
});

test("static tool catalog rejects auto_fixable without fix_steps", () => {
  const payload = buildCatalog([
    buildTool("get_scene_snapshot_for_write", { kind: "read" }),
    buildTool("execute_unity_transaction", {
      common_error_fixes: {
        E_SCENE_REVISION_DRIFT: {
          suggested_action: "get_scene_snapshot_for_write",
          fix_hint: "refresh token",
          auto_fixable: true,
        },
      },
    }),
  ]);

  assert.throws(
    () => normalizeStaticToolCatalog(payload, "<test>"),
    /requires fix_steps when auto_fixable=true/
  );
});

test("static tool catalog accepts nested_error_routes with valid tools", () => {
  const payload = buildCatalog([
    buildTool("get_scene_snapshot_for_write", { kind: "read" }),
    buildTool("get_write_contract_bundle", { kind: "read" }),
    buildTool("execute_unity_transaction", {
      common_error_fixes: {
        E_TRANSACTION_STEP_FAILED: {
          suggested_action: "get_write_contract_bundle",
          fix_hint: "inspect nested error",
          fix_steps: [
            {
              step: 1,
              tool: "get_write_contract_bundle",
            },
          ],
          nested_error_routes: {
            E_SCENE_REVISION_DRIFT: {
              suggested_action: "get_scene_snapshot_for_write",
              fix_hint: "refresh token",
              fix_steps: [
                {
                  step: 1,
                  tool: "get_scene_snapshot_for_write",
                },
              ],
            },
          },
        },
      },
    }),
  ]);

  const normalized = normalizeStaticToolCatalog(payload, "<test>");
  assert.equal(normalized.tools.length, 3);
});

test("static tool catalog rejects unknown tool in nested_error_routes", () => {
  const payload = buildCatalog([
    buildTool("get_write_contract_bundle", { kind: "read" }),
    buildTool("execute_unity_transaction", {
      common_error_fixes: {
        E_TRANSACTION_STEP_FAILED: {
          suggested_action: "get_write_contract_bundle",
          fix_hint: "inspect nested error",
          fix_steps: [
            {
              step: 1,
              tool: "get_write_contract_bundle",
            },
          ],
          nested_error_routes: {
            E_SCENE_REVISION_DRIFT: {
              suggested_action: "unknown_tool",
              fix_hint: "refresh token",
              fix_steps: [
                {
                  step: 1,
                  tool: "unknown_tool",
                },
              ],
            },
          },
        },
      },
    }),
  ]);

  assert.throws(
    () => normalizeStaticToolCatalog(payload, "<test>"),
    /nested_error_routes/
  );
});

test("static tool catalog rejects unknown failure_handling required_action", () => {
  const payload = buildCatalog([
    buildTool("execute_unity_transaction", {
      tool_combinations: [
        {
          scenario: "batch_ui_create",
          tools: ["execute_unity_transaction"],
          failure_handling: {
            after_write_failure: {
              required_action: "unknown_tool",
            },
          },
        },
      ],
    }),
  ]);

  assert.throws(
    () => normalizeStaticToolCatalog(payload, "<test>"),
    /after_write_failure\.required_action references unknown tool/
  );
});

test("static tool catalog accepts valid global error feedback contract", () => {
  const payload = buildCatalog(
    [buildTool("execute_unity_transaction")],
    {
      error_feedback_contract: buildErrorFeedbackContract(),
    }
  );
  const normalized = normalizeStaticToolCatalog(payload, "<test>");
  assert.equal(
    normalized.globalContracts.error_feedback_contract.catalog_version,
    "v1"
  );
});

test("static tool catalog rejects anchor_error_codes without template entry", () => {
  const payload = buildCatalog(
    [buildTool("execute_unity_transaction")],
    {
      error_feedback_contract: buildErrorFeedbackContract({
        error_templates: {
          E_STALE_SNAPSHOT: {
            recoverable: true,
            suggestion: "stale",
          },
        },
      }),
    }
  );
  assert.throws(
    () => normalizeStaticToolCatalog(payload, "<test>"),
    /anchor_error_codes requires error_templates entry/
  );
});

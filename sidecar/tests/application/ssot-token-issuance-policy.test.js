"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  stripTokenEnvelope,
  resolveTokenIssuanceDecision,
} = require("../../src/application/ssotRuntime/tokenIssuancePolicy");

function buildValidatorRegistry(toolName, kind) {
  return {
    getToolMetadata(name) {
      if (name === toolName) {
        return {
          toolName: name,
          kind,
          inputSchema: { type: "object", properties: {} },
        };
      }
      return null;
    },
  };
}

test("token issuance policy strips read_token envelope from any response", () => {
  const input = {
    ok: false,
    read_token: {
      token: "ssot_rt_should_be_removed",
    },
    data: {
      read_token_candidate: "ssot_rt_candidate_should_be_removed",
      read_token_candidate_legacy: "legacy_candidate_should_be_removed",
      keep_field: "x",
    },
  };

  const outcome = stripTokenEnvelope(input);
  assert.notEqual(outcome, input);
  assert.equal(Object.prototype.hasOwnProperty.call(outcome, "read_token"), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.data, "read_token_candidate"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.data, "read_token_candidate_legacy"),
    false
  );
  assert.equal(outcome.data.keep_field, "x");
});

test("token issuance policy rejects non-success response", () => {
  const decision = resolveTokenIssuanceDecision({
    toolName: "modify_ui_layout",
    result: {
      ok: false,
      data: {
        scene_revision: "ssot_rev_any",
      },
    },
    validatorRegistry: buildValidatorRegistry("modify_ui_layout", "write"),
  });
  assert.equal(decision.should_issue, false);
  assert.equal(decision.reason, "result_not_success");
});

test("token issuance policy rejects unsupported tool kind", () => {
  const decision = resolveTokenIssuanceDecision({
    toolName: "setup_cursor_mcp",
    result: {
      ok: true,
      data: {
        scene_revision: "ssot_rev_any",
      },
    },
    validatorRegistry: buildValidatorRegistry("setup_cursor_mcp", "local_static"),
  });
  assert.equal(decision.should_issue, false);
  assert.equal(decision.reason, "tool_kind_not_eligible");
});

test("token issuance policy rejects when scene_revision missing", () => {
  const decision = resolveTokenIssuanceDecision({
    toolName: "get_scene_roots",
    result: {
      ok: true,
      data: {},
    },
    validatorRegistry: buildValidatorRegistry("get_scene_roots", "read"),
  });
  assert.equal(decision.should_issue, false);
  assert.equal(decision.reason, "scene_revision_missing");
});

test("token issuance policy accepts read/write tool with scene_revision", () => {
  const readDecision = resolveTokenIssuanceDecision({
    toolName: "get_scene_roots",
    result: {
      ok: true,
      data: {
        scene_revision: "ssot_rev_read_1",
      },
    },
    validatorRegistry: buildValidatorRegistry("get_scene_roots", "read"),
  });
  assert.equal(readDecision.should_issue, true);
  assert.equal(readDecision.reason, "eligible");
  assert.equal(readDecision.tool_kind, "read");

  const writeDecision = resolveTokenIssuanceDecision({
    toolName: "modify_ui_layout",
    result: {
      ok: true,
      data: {
        scene_revision: "ssot_rev_write_1",
      },
    },
    validatorRegistry: buildValidatorRegistry("modify_ui_layout", "write"),
  });
  assert.equal(writeDecision.should_issue, true);
  assert.equal(writeDecision.reason, "eligible");
  assert.equal(writeDecision.tool_kind, "write");
});


"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  maybeIssueReadTokenFromResponse,
} = require("../../src/application/ssotRuntime/dispatchSsotRequest");
const {
  SsotTokenRegistry,
} = require("../../src/application/ssotRuntime/ssotTokenRegistry");

test("dispatch issues L2 token for read tool response and replaces L3 candidate", () => {
  const tokenRegistry = new SsotTokenRegistry({
    hardMaxAgeMs: 3000,
  });
  const validatorRegistry = {
    getToolMetadata(toolName) {
      if (toolName === "get_current_selection") {
        return {
          toolName,
          kind: "read",
          inputSchema: { type: "object", properties: {} },
        };
      }
      return null;
    },
  };

  const outcome = maybeIssueReadTokenFromResponse({
    toolName: "get_current_selection",
    result: {
      ok: true,
      tool_name: "get_current_selection",
      data: {
        scene_revision: "ssot_rev_dispatch_a",
        target_object_id: "go_target",
        target_path: "Scene/Canvas/B",
        read_token_candidate: "legacy_rt_candidate_should_be_ignored",
      },
    },
    validatorRegistry,
    tokenRegistry,
  });

  assert.equal(outcome.ok, true);
  assert.ok(outcome.data.read_token_candidate.startsWith("ssot_rt_"));
  assert.notEqual(
    outcome.data.read_token_candidate,
    "legacy_rt_candidate_should_be_ignored"
  );
  assert.ok(outcome.read_token);
  assert.equal(outcome.read_token.token, outcome.data.read_token_candidate);
});

test("dispatch does not issue L2 token for write tool response", () => {
  const tokenRegistry = new SsotTokenRegistry({
    hardMaxAgeMs: 3000,
  });
  const validatorRegistry = {
    getToolMetadata(toolName) {
      if (toolName === "modify_ui_layout") {
        return {
          toolName,
          kind: "write",
          inputSchema: {
            type: "object",
            properties: { based_on_read_token: { type: "string" } },
          },
        };
      }
      return null;
    },
  };

  const input = {
    ok: true,
    tool_name: "modify_ui_layout",
    data: {
      scene_revision: "ssot_rev_dispatch_b",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
    },
  };
  const outcome = maybeIssueReadTokenFromResponse({
    toolName: "modify_ui_layout",
    result: input,
    validatorRegistry,
    tokenRegistry,
  });
  assert.equal(outcome, input);
});

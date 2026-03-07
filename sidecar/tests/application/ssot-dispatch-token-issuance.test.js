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

test("dispatch issues L2 continuation token for write tool response", () => {
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
      read_token_candidate: "legacy_l3_candidate_should_be_replaced",
    },
  };
  const outcome = maybeIssueReadTokenFromResponse({
    toolName: "modify_ui_layout",
    result: input,
    validatorRegistry,
    tokenRegistry,
  });
  assert.notEqual(outcome, input);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.data.scene_revision, "ssot_rev_dispatch_b");
  assert.ok(outcome.data.read_token_candidate.startsWith("ssot_rt_"));
  assert.notEqual(
    outcome.data.read_token_candidate,
    "legacy_l3_candidate_should_be_replaced"
  );
  assert.ok(outcome.read_token);
  assert.equal(outcome.read_token.token, outcome.data.read_token_candidate);
  assert.equal(outcome.read_token.scope.kind, "write_result");
});

test("dispatch write response without scene_revision does not issue token", () => {
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
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      read_token_candidate: "l3_candidate_should_be_stripped",
    },
  };

  const outcome = maybeIssueReadTokenFromResponse({
    toolName: "modify_ui_layout",
    result: input,
    validatorRegistry,
    tokenRegistry,
  });

  assert.notEqual(outcome, input);
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.data, "read_token_candidate"),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(outcome, "read_token"), false);
});

test("dispatch does not issue token for failed response and strips leaked candidate", () => {
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
    ok: false,
    error_code: "E_TARGET_NOT_FOUND",
    data: {
      read_token_candidate: "l3_failed_candidate_should_be_stripped",
      scene_revision: "ssot_rev_failed_ignore",
    },
  };

  const outcome = maybeIssueReadTokenFromResponse({
    toolName: "modify_ui_layout",
    result: input,
    validatorRegistry,
    tokenRegistry,
  });

  assert.notEqual(outcome, input);
  assert.equal(outcome.ok, false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.data, "read_token_candidate"),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(outcome, "read_token"), false);
});

test("dispatch does not issue token for unsupported tool kind and strips leaked candidate", () => {
  const tokenRegistry = new SsotTokenRegistry({
    hardMaxAgeMs: 3000,
  });
  const validatorRegistry = {
    getToolMetadata(toolName) {
      if (toolName === "setup_cursor_mcp") {
        return {
          toolName,
          kind: "local_static",
          inputSchema: { type: "object", properties: {} },
        };
      }
      return null;
    },
  };
  const input = {
    ok: true,
    tool_name: "setup_cursor_mcp",
    data: {
      scene_revision: "ssot_rev_local_static_1",
      read_token_candidate: "l3_local_static_candidate_should_be_stripped",
    },
  };

  const outcome = maybeIssueReadTokenFromResponse({
    toolName: "setup_cursor_mcp",
    result: input,
    validatorRegistry,
    tokenRegistry,
  });
  assert.notEqual(outcome, input);
  assert.equal(
    Object.prototype.hasOwnProperty.call(outcome.data, "read_token_candidate"),
    false
  );
  assert.equal(Object.prototype.hasOwnProperty.call(outcome, "read_token"), false);
});

test("dispatch issues token when scene_revision is on root response", () => {
  const tokenRegistry = new SsotTokenRegistry({
    hardMaxAgeMs: 3000,
  });
  const validatorRegistry = {
    getToolMetadata(toolName) {
      if (toolName === "get_scene_roots") {
        return {
          toolName,
          kind: "read",
          inputSchema: { type: "object", properties: {} },
        };
      }
      return null;
    },
  };
  const input = {
    ok: true,
    scene_revision: "ssot_rev_root_only",
    data: {
      target_object_id: "go_root",
      target_path: "Scene",
    },
  };

  const outcome = maybeIssueReadTokenFromResponse({
    toolName: "get_scene_roots",
    result: input,
    validatorRegistry,
    tokenRegistry,
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.data.read_token_candidate.startsWith("ssot_rt_"), true);
  assert.equal(outcome.read_token.scope.kind, "scene");
});

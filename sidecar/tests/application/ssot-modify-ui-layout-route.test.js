"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");

async function dispatchBodyCommand(registry, body, turnService) {
  const path = "/mcp/modify_ui_layout";
  return registry.dispatchHttpCommand({
    method: "POST",
    path,
    url: new URL(`http://127.0.0.1:46321${path}`),
    req: {},
    readJsonBody: async () => body,
    turnService,
  });
}

test("ssot modify_ui_layout route dispatches to turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async dispatchSsotToolForMcp(toolName, payload) {
      assert.equal(toolName, "modify_ui_layout");
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "modify_ui_layout",
          data: {
            target_path: payload.target_path,
            width: payload.width,
          },
        },
      };
    },
  };
  const body = {
    execution_mode: "EXECUTE",
    idempotency_key: "idem_ssot_route_test",
    based_on_read_token: "tok_ssot_route_test",
    write_anchor_object_id: "go_canvas",
    write_anchor_path: "Scene/Canvas",
    target_object_id: "go_button",
    target_path: "Scene/Canvas/Button",
    anchored_x: 100,
    anchored_y: 100,
    width: 240,
    height: 80,
  };

  const outcome = await dispatchBodyCommand(registry, body, turnService);
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "modify_ui_layout");
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].execution_mode).toUpperCase(), "EXECUTE");
});

test("ssot modify_ui_layout route fails fast on schema invalid payload", async () => {
  const registry = getMcpCommandRegistry();
  let called = false;
  const turnService = {
    async dispatchSsotToolForMcp() {
      called = true;
      throw new Error("should_not_be_called");
    },
  };

  const outcome = await dispatchBodyCommand(
    registry,
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_ssot_route_test",
      based_on_read_token: "tok_ssot_route_test",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_button",
      target_path: "Scene/Canvas/Button",
      anchored_x: 100,
      anchored_y: 100,
      width: "240",
      height: 80,
    },
    turnService
  );
  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_SSOT_SCHEMA_INVALID");
  assert.equal(called, false);
});

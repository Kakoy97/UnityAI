"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  INTERNAL_TOOL_INVOKER_VERSION,
  INVOKE_METHOD_NAME,
  DISPATCH_METHOD_NAME,
  assertTurnServiceDispatchContract,
  createInternalToolInvoker,
} = require("../../src/application/blockRuntime/entry");

test("PLNR-006 internal tool invoker exports stable symbols", () => {
  assert.equal(typeof INTERNAL_TOOL_INVOKER_VERSION, "string");
  assert.equal(INTERNAL_TOOL_INVOKER_VERSION.length > 0, true);
  assert.equal(INVOKE_METHOD_NAME, "invokeTool");
  assert.equal(DISPATCH_METHOD_NAME, "dispatchSsotToolForMcp");
});

test("PLNR-006 assertTurnServiceDispatchContract rejects invalid turnService", () => {
  assert.throws(
    () => assertTurnServiceDispatchContract(null),
    /must be an object/
  );
  assert.throws(
    () => assertTurnServiceDispatchContract({}),
    /missing required method: dispatchSsotToolForMcp\(\)/
  );
});

test("PLNR-006 internal tool invoker delegates to turnService dispatch", async () => {
  const calls = [];
  const invoker = createInternalToolInvoker({
    turnService: {
      async dispatchSsotToolForMcp(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          statusCode: 200,
          body: {
            ok: true,
            data: {
              tool_name: toolName,
            },
          },
        };
      },
    },
  });
  const payload = { scope_path: "Scene/Canvas" };
  const outcome = await invoker.invokeTool("get_scene_snapshot_for_write", payload);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "get_scene_snapshot_for_write");
  assert.deepEqual(calls[0].payload, payload);
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
});

test("PLNR-006 internal tool invoker validates tool_name and payload", async () => {
  const invoker = createInternalToolInvoker({
    turnService: {
      async dispatchSsotToolForMcp() {
        return {
          statusCode: 200,
          body: {},
        };
      },
    },
  });

  await assert.rejects(
    invoker.invokeTool("", {}),
    /tool_name must be non-empty string/
  );
  await assert.rejects(
    invoker.invokeTool("set_active", null),
    /payload must be a plain object/
  );
});

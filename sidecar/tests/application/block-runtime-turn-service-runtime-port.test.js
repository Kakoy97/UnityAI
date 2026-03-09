"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertBlockRuntimePort,
  DISPATCH_METHOD_NAME,
  INTERNAL_INVOKER_METHOD_NAME,
  TURN_SERVICE_RUNTIME_PORT_VERSION,
  assertTurnServiceDispatchContract,
  assertInternalToolInvokerContract,
  createTurnServiceRuntimePort,
} = require("../../src/application/blockRuntime/runtime");

test("S2A-T3 runtime exports turnService port symbols", () => {
  assert.equal(DISPATCH_METHOD_NAME, "dispatchSsotToolForMcp");
  assert.equal(INTERNAL_INVOKER_METHOD_NAME, "invokeTool");
  assert.equal(typeof TURN_SERVICE_RUNTIME_PORT_VERSION, "string");
  assert.equal(TURN_SERVICE_RUNTIME_PORT_VERSION.length > 0, true);
});

test("S2A-T3 assertTurnServiceDispatchContract rejects invalid service", () => {
  assert.throws(
    () => assertTurnServiceDispatchContract(null),
    /must be an object/
  );
  assert.throws(
    () => assertTurnServiceDispatchContract({}),
    /missing required method: dispatchSsotToolForMcp\(\)/
  );
});

test("PLNR-006 assertInternalToolInvokerContract rejects invalid invoker", () => {
  assert.throws(
    () => assertInternalToolInvokerContract(null),
    /must be an object/
  );
  assert.throws(
    () => assertInternalToolInvokerContract({}),
    /missing required method: invokeTool\(\)/
  );
});

test("S2A-T3 createTurnServiceRuntimePort returns valid runtime port", () => {
  const runtimePort = createTurnServiceRuntimePort({
    turnService: {
      async dispatchSsotToolForMcp() {
        return {
          statusCode: 200,
          body: { ok: true },
        };
      },
    },
  });
  const validated = assertBlockRuntimePort(runtimePort);
  assert.equal(validated, runtimePort);
});

test("S2A-T3 runtime port forwards request to turnService dispatch", async () => {
  const calls = [];
  const runtimePort = createTurnServiceRuntimePort({
    turnService: {
      async dispatchSsotToolForMcp(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          statusCode: 200,
          body: {
            ok: true,
            data: { tool_name: toolName },
          },
        };
      },
    },
  });

  const payload = { target_object_id: "obj_1", active: false };
  const outcome = await runtimePort.executeToolPlan("set_active", payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.deepEqual(calls[0].payload, payload);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status_code, 200);
  assert.equal(outcome.tool_name, "set_active");
  assert.deepEqual(outcome.body, {
    ok: true,
    data: { tool_name: "set_active" },
  });
});

test("PLNR-006 runtime port prefers internal invoker over turnService dispatch", async () => {
  const calls = [];
  const runtimePort = createTurnServiceRuntimePort({
    turnService: {
      async dispatchSsotToolForMcp() {
        throw new Error("turnService dispatch should not be called");
      },
    },
    internalToolInvoker: {
      async invokeTool(toolName, payload) {
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

  const payload = { target_object_id: "obj_2", active: true };
  const outcome = await runtimePort.executeToolPlan("set_active", payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.deepEqual(calls[0].payload, payload);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.status_code, 200);
});

test("S2A-T3 runtime port normalizes non-2xx as failed execution", async () => {
  const runtimePort = createTurnServiceRuntimePort({
    turnService: {
      async dispatchSsotToolForMcp() {
        return {
          statusCode: 409,
          body: {
            status: "failed",
            error_code: "E_SCENE_REVISION_DRIFT",
          },
        };
      },
    },
  });

  const outcome = await runtimePort.executeToolPlan("set_active", {
    target_object_id: "obj_1",
    active: false,
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status_code, 409);
  assert.equal(outcome.body.error_code, "E_SCENE_REVISION_DRIFT");
});

test("S2A-T3 runtime port rejects invalid dispatch outcome shape", async () => {
  const runtimePort = createTurnServiceRuntimePort({
    turnService: {
      async dispatchSsotToolForMcp() {
        return {
          statusCode: "bad-status-code",
          body: {},
        };
      },
    },
  });

  await assert.rejects(
    runtimePort.executeToolPlan("set_active", {
      target_object_id: "obj_1",
      active: true,
    }),
    /statusCode must be finite number/
  );
});

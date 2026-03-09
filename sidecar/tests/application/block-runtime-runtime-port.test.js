"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PORT_CONTRACT_VERSION,
  REQUIRED_METHOD_NAMES,
  assertBlockRuntimePort,
  validateExecuteToolPlanRequest,
  executeToolPlan,
} = require("../../src/application/blockRuntime/runtime");

test("S2A-T2 runtime port exports stable contract constants", () => {
  assert.equal(typeof PORT_CONTRACT_VERSION, "string");
  assert.equal(PORT_CONTRACT_VERSION.length > 0, true);
  assert.deepEqual(REQUIRED_METHOD_NAMES, ["executeToolPlan"]);
});

test("S2A-T2 assertBlockRuntimePort accepts valid runtime port", () => {
  const port = {
    executeToolPlan() {
      return { ok: true };
    },
  };
  const outcome = assertBlockRuntimePort(port, { label: "testPort" });
  assert.equal(outcome, port);
});

test("S2A-T2 assertBlockRuntimePort rejects missing method", () => {
  assert.throws(
    () => assertBlockRuntimePort({}, { label: "testPort" }),
    /missing required method: executeToolPlan/
  );
});

test("S2A-T2 validateExecuteToolPlanRequest enforces tool_name and payload", () => {
  const valid = validateExecuteToolPlanRequest("set_active", { active: true });
  assert.equal(valid.tool_name, "set_active");
  assert.deepEqual(valid.payload, { active: true });

  assert.throws(
    () => validateExecuteToolPlanRequest("", { active: true }),
    /tool_name must be non-empty string/
  );
  assert.throws(
    () => validateExecuteToolPlanRequest("set_active", null),
    /payload must be a plain object/
  );
  assert.throws(
    () => validateExecuteToolPlanRequest("set_active", []),
    /payload must be a plain object/
  );
});

test("S2A-T2 executeToolPlan forwards normalized request to runtime port", async () => {
  const calls = [];
  const port = {
    async executeToolPlan(toolName, payload) {
      calls.push({ toolName, payload });
      return {
        ok: true,
        data: {
          tool_name: toolName,
          echoed_payload: payload,
        },
      };
    },
  };
  const payload = { target_object_id: "obj_1", active: false };
  const outcome = await executeToolPlan(port, "set_active", payload);

  assert.equal(outcome.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.deepEqual(calls[0].payload, payload);
});


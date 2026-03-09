"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const { BLOCK_TYPE } = require("../../src/application/blockRuntime/contracts");

function createService({ blockBypassRouter } = {}) {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60_000,
  });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso: () => "2026-03-08T00:00:00.000Z",
    blockPipelineEnabled: true,
    blockBypassRouter: blockBypassRouter === true,
    fileActionExecutor: {
      execute() {
        return {
          ok: true,
          changes: [],
        };
      },
    },
  });
}

function buildReadBlockSpec(overrides = {}) {
  return {
    block_id: "block_channel_placeholder_read_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.snapshot_for_write",
    input: {
      scope_path: "Scene/Canvas",
    },
    ...overrides,
  };
}

test("S6-T3 requested_channel=vision is reserved and does not invoke execution adapter", async () => {
  const service = createService({
    blockBypassRouter: false,
  });
  let adapterInvokeCount = 0;
  let dispatchInvokeCount = 0;
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock() {
      adapterInvokeCount += 1;
      throw new Error("execution adapter must not be called for reserved channel");
    },
  });
  service.dispatchSsotToolForMcp = async () => {
    dispatchInvokeCount += 1;
    throw new Error("dispatchSsotToolForMcp must not be called for reserved channel");
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec(),
    execution_context: {
      requested_channel: "vision",
    },
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_PRECONDITION_FAILED");
  assert.equal(outcome.body.block_error_code, "E_BLOCK_CHANNEL_RESERVED");
  assert.equal(outcome.body.data.route_result.route_status, "reserved");
  assert.equal(outcome.body.data.route_result.channel_id, "vision");
  assert.equal(outcome.body.data.route_result.channel_status, "reserved");
  assert.equal(
    typeof outcome.body.data.route_result.reserved_reason === "string" &&
      outcome.body.data.route_result.reserved_reason.length > 0,
    true
  );
  assert.equal(adapterInvokeCount, 0);
  assert.equal(dispatchInvokeCount, 0);
});

test("S6-T3 requested_channel=gui_fallback is reserved and does not invoke execution adapter", async () => {
  const service = createService({
    blockBypassRouter: false,
  });
  let adapterInvokeCount = 0;
  let dispatchInvokeCount = 0;
  service.getBlockRuntimeExecutionAdapter = () => ({
    async executeBlock() {
      adapterInvokeCount += 1;
      throw new Error("execution adapter must not be called for reserved channel");
    },
  });
  service.dispatchSsotToolForMcp = async () => {
    dispatchInvokeCount += 1;
    throw new Error("dispatchSsotToolForMcp must not be called for reserved channel");
  };

  const outcome = await service.executeBlockSpecForMvp({
    block_spec: buildReadBlockSpec({
      block_id: "block_channel_placeholder_read_2",
    }),
    execution_context: {
      requested_channel: "gui_fallback",
    },
  });

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_PRECONDITION_FAILED");
  assert.equal(outcome.body.block_error_code, "E_BLOCK_CHANNEL_RESERVED");
  assert.equal(outcome.body.data.route_result.route_status, "reserved");
  assert.equal(outcome.body.data.route_result.channel_id, "gui_fallback");
  assert.equal(outcome.body.data.route_result.channel_status, "reserved");
  assert.equal(
    typeof outcome.body.data.route_result.reserved_reason === "string" &&
      outcome.body.data.route_result.reserved_reason.length > 0,
    true
  );
  assert.equal(adapterInvokeCount, 0);
  assert.equal(dispatchInvokeCount, 0);
});

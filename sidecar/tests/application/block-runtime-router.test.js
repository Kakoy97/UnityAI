"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { BLOCK_TYPE } = require("../../src/application/blockRuntime/contracts");
const {
  THIN_BLOCK_ROUTER_VERSION,
  CHANNEL_ID,
  CHANNEL_STATUS,
  createChannelSlotManifest,
  ROUTE_STATUS,
  createThinBlockRouter,
} = require("../../src/application/blockRuntime/routing");

function buildBlockSpec(blockType) {
  return {
    block_id: `block_router_${String(blockType || "").toLowerCase()}`,
    block_type: blockType,
    intent_key: "router.test.intent",
    input: {},
  };
}

function assertRouteResultContract(routeResult) {
  assert.equal(typeof routeResult, "object");
  assert.equal(typeof routeResult.ok, "boolean");
  assert.equal(typeof routeResult.block_id, "string");
  assert.equal(typeof routeResult.channel_id, "string");
  assert.equal(typeof routeResult.route_status, "string");
  assert.equal(typeof routeResult.route_reason, "string");
}

test("S3-T1 thin router exports stable contract symbols", () => {
  assert.equal(typeof THIN_BLOCK_ROUTER_VERSION, "string");
  assert.equal(THIN_BLOCK_ROUTER_VERSION.length > 0, true);
  assert.equal(CHANNEL_ID.EXECUTION, "execution");
  assert.equal(CHANNEL_STATUS.RESERVED, "reserved");
  assert.equal(ROUTE_STATUS.ROUTED, "routed");
});

test("S3-T1 routes READ_STATE/CREATE/MUTATE/VERIFY to execution by default", () => {
  const router = createThinBlockRouter();
  const blockTypes = [
    BLOCK_TYPE.READ_STATE,
    BLOCK_TYPE.CREATE,
    BLOCK_TYPE.MUTATE,
    BLOCK_TYPE.VERIFY,
  ];
  for (const blockType of blockTypes) {
    const outcome = router.routeBlock(buildBlockSpec(blockType), {});
    assertRouteResultContract(outcome);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.channel_id, CHANNEL_ID.EXECUTION);
    assert.equal(outcome.route_status, ROUTE_STATUS.ROUTED);
    assert.equal(outcome.route_reason, "default_execution_route");
    assert.equal(Object.prototype.hasOwnProperty.call(outcome, "error_code"), false);
    assert.equal(
      Object.prototype.hasOwnProperty.call(outcome, "block_error_code"),
      false
    );
  }
});

test("S3-T1 requested execution channel remains routed", () => {
  const router = createThinBlockRouter();
  const outcome = router.routeBlock(buildBlockSpec(BLOCK_TYPE.MUTATE), {
    requested_channel: "execution",
  });
  assertRouteResultContract(outcome);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.channel_id, CHANNEL_ID.EXECUTION);
  assert.equal(outcome.route_status, ROUTE_STATUS.ROUTED);
  assert.equal(outcome.route_reason, "requested_execution_channel");
});

test("S3-T1 requested reserved channel returns reserved fail-closed route result", () => {
  const router = createThinBlockRouter();
  const channels = [CHANNEL_ID.VISION, CHANNEL_ID.GUI_FALLBACK];
  for (const channelId of channels) {
    const outcome = router.routeBlock(buildBlockSpec(BLOCK_TYPE.READ_STATE), {
      requested_channel: channelId,
    });
    assertRouteResultContract(outcome);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.channel_id, channelId);
    assert.equal(outcome.route_status, ROUTE_STATUS.RESERVED);
    assert.equal(outcome.route_reason, "requested_channel_reserved");
    assert.equal(outcome.error_code, "E_PRECONDITION_FAILED");
    assert.equal(outcome.block_error_code, "E_BLOCK_CHANNEL_RESERVED");
    assert.equal(outcome.channel_status, "reserved");
    assert.equal(typeof outcome.reserved_reason, "string");
    assert.equal(outcome.reserved_reason.length > 0, true);
    assert.equal(typeof outcome.message, "string");
    assert.equal(outcome.message.length > 0, true);
  }
});

test("S6-T2 router reads channel slot manifest instead of hard-coded route sets", () => {
  const customManifest = createChannelSlotManifest({
    version: "1.0.0",
    default_channel: "execution",
    channels: [
      {
        channel_id: "execution",
        status: "active",
        reason: "custom_execution",
        supported_block_types: [BLOCK_TYPE.READ_STATE, BLOCK_TYPE.CREATE],
      },
      {
        channel_id: "vision",
        status: "active",
        reason: "custom_vision_enabled",
        supported_block_types: [BLOCK_TYPE.READ_STATE],
      },
      {
        channel_id: "gui_fallback",
        status: "reserved",
        reason: "custom_gui_reserved",
        supported_block_types: [],
      },
    ],
  });
  const router = createThinBlockRouter({
    channelSlotManifest: customManifest,
  });

  const routedToVision = router.routeBlock(buildBlockSpec(BLOCK_TYPE.READ_STATE), {
    requested_channel: "vision",
  });
  assert.equal(routedToVision.ok, true);
  assert.equal(routedToVision.channel_id, "vision");
  assert.equal(routedToVision.route_status, ROUTE_STATUS.ROUTED);
  assert.equal(routedToVision.route_reason, "requested_channel_routed");
  assert.equal(routedToVision.channel_status, "active");

  const unsupportedByVision = router.routeBlock(buildBlockSpec(BLOCK_TYPE.MUTATE), {
    requested_channel: "vision",
  });
  assert.equal(unsupportedByVision.ok, false);
  assert.equal(unsupportedByVision.channel_id, "vision");
  assert.equal(unsupportedByVision.route_status, ROUTE_STATUS.UNSUPPORTED);
  assert.equal(
    unsupportedByVision.route_reason,
    "requested_channel_block_type_unsupported"
  );
  assert.equal(unsupportedByVision.error_code, "E_PRECONDITION_FAILED");
  assert.equal(unsupportedByVision.block_error_code, "E_BLOCK_CHANNEL_UNSUPPORTED");
});

test("S3-T1 unknown requested channel is unsupported", () => {
  const router = createThinBlockRouter();
  const outcome = router.routeBlock(buildBlockSpec(BLOCK_TYPE.CREATE), {
    requested_channel: "audio",
  });
  assertRouteResultContract(outcome);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.channel_id, CHANNEL_ID.EXECUTION);
  assert.equal(outcome.route_status, ROUTE_STATUS.UNSUPPORTED);
  assert.equal(outcome.route_reason, "requested_channel_unsupported");
  assert.equal(outcome.error_code, "E_PRECONDITION_FAILED");
  assert.equal(outcome.block_error_code, "E_BLOCK_CHANNEL_UNSUPPORTED");
});

test("S3-T1 unsupported block type is fail-closed unsupported", () => {
  const router = createThinBlockRouter();
  const outcome = router.routeBlock(buildBlockSpec("DELETE"), {});
  assertRouteResultContract(outcome);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.channel_id, CHANNEL_ID.EXECUTION);
  assert.equal(outcome.route_status, ROUTE_STATUS.UNSUPPORTED);
  assert.equal(outcome.route_reason, "block_type_unsupported");
  assert.equal(outcome.error_code, "E_PRECONDITION_FAILED");
  assert.equal(outcome.block_error_code, "E_BLOCK_TYPE_UNSUPPORTED");
});

test("S3-T1 invalid block_spec shape returns unsupported route result", () => {
  const router = createThinBlockRouter();
  const outcome = router.routeBlock(null, {});
  assertRouteResultContract(outcome);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.channel_id, CHANNEL_ID.EXECUTION);
  assert.equal(outcome.route_status, ROUTE_STATUS.UNSUPPORTED);
  assert.equal(outcome.route_reason, "invalid_block_spec");
  assert.equal(outcome.error_code, "E_SCHEMA_INVALID");
  assert.equal(outcome.block_error_code, "E_BLOCK_SCHEMA_INVALID");
});

test("S3-T4 router normalizes requested_channel with trim + case-insensitive matching", () => {
  const router = createThinBlockRouter();
  const reservedOutcome = router.routeBlock(buildBlockSpec(BLOCK_TYPE.READ_STATE), {
    requested_channel: "  VISION  ",
  });
  assert.equal(reservedOutcome.ok, false);
  assert.equal(reservedOutcome.route_status, ROUTE_STATUS.RESERVED);
  assert.equal(reservedOutcome.channel_id, CHANNEL_ID.VISION);

  const routedOutcome = router.routeBlock(buildBlockSpec(BLOCK_TYPE.MUTATE), {
    requested_channel: "  EXECUTION ",
  });
  assert.equal(routedOutcome.ok, true);
  assert.equal(routedOutcome.route_status, ROUTE_STATUS.ROUTED);
  assert.equal(routedOutcome.channel_id, CHANNEL_ID.EXECUTION);
});

test("S3-T4 router defaults to execution when execution_context is not a plain object", () => {
  const router = createThinBlockRouter();
  const outcome = router.routeBlock(buildBlockSpec(BLOCK_TYPE.CREATE), null);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.channel_id, CHANNEL_ID.EXECUTION);
  assert.equal(outcome.route_status, ROUTE_STATUS.ROUTED);
});

test("S3-T4 unsupported block_type keeps incoming block_id for diagnosis", () => {
  const router = createThinBlockRouter();
  const outcome = router.routeBlock(
    {
      block_id: "block_custom_unsupported",
      block_type: "UPSERT",
      intent_key: "custom",
      input: {},
    },
    {}
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.block_id, "block_custom_unsupported");
  assert.equal(outcome.error_code, "E_PRECONDITION_FAILED");
  assert.equal(outcome.block_error_code, "E_BLOCK_TYPE_UNSUPPORTED");
});

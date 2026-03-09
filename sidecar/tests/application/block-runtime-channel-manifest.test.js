"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CHANNEL_SLOT_MANIFEST_VERSION,
  CHANNEL_SLOT_MANIFEST_SCHEMA_VERSION,
  CHANNEL_ID,
  CHANNEL_STATUS,
  DEFAULT_CHANNEL_SLOT_MANIFEST,
  createChannelSlotManifest,
} = require("../../src/application/blockRuntime/channels");

test("S6-T1 channel slot manifest exports stable symbols", () => {
  assert.equal(CHANNEL_SLOT_MANIFEST_VERSION, "phase1_step6_t1_v1");
  assert.equal(CHANNEL_SLOT_MANIFEST_SCHEMA_VERSION, "1.0.0");
  assert.equal(CHANNEL_ID.EXECUTION, "execution");
  assert.equal(CHANNEL_ID.VISION, "vision");
  assert.equal(CHANNEL_ID.GUI_FALLBACK, "gui_fallback");
  assert.equal(CHANNEL_STATUS.ACTIVE, "active");
  assert.equal(CHANNEL_STATUS.RESERVED, "reserved");
  assert.equal(CHANNEL_STATUS.DISABLED, "disabled");
});

test("S6-T1 default manifest keeps fixed structure with execution default", () => {
  assert.equal(DEFAULT_CHANNEL_SLOT_MANIFEST.version, "1.0.0");
  assert.equal(DEFAULT_CHANNEL_SLOT_MANIFEST.default_channel, "execution");
  assert.equal(Array.isArray(DEFAULT_CHANNEL_SLOT_MANIFEST.channels), true);
  assert.equal(DEFAULT_CHANNEL_SLOT_MANIFEST.channels.length, 3);

  const manifest = createChannelSlotManifest().getManifest();
  assert.equal(manifest.version, "1.0.0");
  assert.equal(manifest.default_channel, "execution");
  assert.equal(Array.isArray(manifest.channels), true);
  assert.equal(manifest.channels.length, 3);

  const execution = manifest.channels.find((slot) => slot.channel_id === "execution");
  assert.ok(execution);
  assert.equal(execution.status, "active");
  assert.equal(
    execution.supported_block_types.includes("READ_STATE") &&
      execution.supported_block_types.includes("CREATE") &&
      execution.supported_block_types.includes("MUTATE") &&
      execution.supported_block_types.includes("VERIFY"),
    true
  );
});

test("S6-T1 slot status is queryable by channel id", () => {
  const manifest = createChannelSlotManifest();
  assert.equal(manifest.getDefaultChannelId(), "execution");

  assert.equal(manifest.getChannelStatus("execution"), "active");
  assert.equal(manifest.getChannelStatus("vision"), "reserved");
  assert.equal(manifest.getChannelStatus("gui_fallback"), "reserved");
  assert.equal(manifest.getChannelStatus("unknown_channel"), "");

  const visionSlot = manifest.getChannelSlot("  VISION  ");
  assert.ok(visionSlot);
  assert.equal(visionSlot.channel_id, "vision");
  assert.equal(visionSlot.status, "reserved");
});


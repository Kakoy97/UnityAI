"use strict";

const { BLOCK_TYPE } = require("../contracts");

const CHANNEL_SLOT_MANIFEST_VERSION = "phase1_step6_t1_v1";
const CHANNEL_SLOT_MANIFEST_SCHEMA_VERSION = "1.0.0";

const CHANNEL_ID = Object.freeze({
  EXECUTION: "execution",
  VISION: "vision",
  GUI_FALLBACK: "gui_fallback",
});

const CHANNEL_STATUS = Object.freeze({
  ACTIVE: "active",
  RESERVED: "reserved",
  DISABLED: "disabled",
});

const PHASE1_CHANNEL_SLOTS = Object.freeze([
  Object.freeze({
    channel_id: CHANNEL_ID.EXECUTION,
    status: CHANNEL_STATUS.ACTIVE,
    reason: "default_execution_channel",
    supported_block_types: Object.freeze([
      BLOCK_TYPE.READ_STATE,
      BLOCK_TYPE.CREATE,
      BLOCK_TYPE.MUTATE,
      BLOCK_TYPE.VERIFY,
    ]),
    capabilities: Object.freeze({
      supports_transaction: true,
      supports_verify: true,
    }),
  }),
  Object.freeze({
    channel_id: CHANNEL_ID.VISION,
    status: CHANNEL_STATUS.RESERVED,
    reason: "reserved_for_phase2_vision",
    supported_block_types: Object.freeze([]),
    capabilities: Object.freeze({
      supports_transaction: false,
      supports_verify: false,
    }),
  }),
  Object.freeze({
    channel_id: CHANNEL_ID.GUI_FALLBACK,
    status: CHANNEL_STATUS.RESERVED,
    reason: "reserved_for_phase2_gui_fallback",
    supported_block_types: Object.freeze([]),
    capabilities: Object.freeze({
      supports_transaction: false,
      supports_verify: false,
    }),
  }),
]);

const DEFAULT_CHANNEL_SLOT_MANIFEST = Object.freeze({
  version: CHANNEL_SLOT_MANIFEST_SCHEMA_VERSION,
  default_channel: CHANNEL_ID.EXECUTION,
  channels: PHASE1_CHANNEL_SLOTS,
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function cloneChannelSlot(slot) {
  const source = slot && typeof slot === "object" && !Array.isArray(slot) ? slot : {};
  const capabilities =
    source.capabilities && typeof source.capabilities === "object" && !Array.isArray(source.capabilities)
      ? source.capabilities
      : {};
  return {
    channel_id: normalizeString(source.channel_id),
    status: normalizeString(source.status),
    reason: normalizeString(source.reason),
    supported_block_types: Array.isArray(source.supported_block_types)
      ? source.supported_block_types
          .map((item) => normalizeString(item))
          .filter((item) => item.length > 0)
      : [],
    capabilities: {
      supports_transaction: capabilities.supports_transaction === true,
      supports_verify: capabilities.supports_verify === true,
    },
  };
}

function cloneManifest(manifest) {
  const source =
    manifest && typeof manifest === "object" && !Array.isArray(manifest)
      ? manifest
      : DEFAULT_CHANNEL_SLOT_MANIFEST;
  const channels = Array.isArray(source.channels)
    ? source.channels.map(cloneChannelSlot)
    : [];
  return {
    version: normalizeString(source.version) || CHANNEL_SLOT_MANIFEST_SCHEMA_VERSION,
    default_channel:
      normalizeString(source.default_channel) || CHANNEL_ID.EXECUTION,
    channels,
  };
}

function createChannelSlotManifest(manifest = DEFAULT_CHANNEL_SLOT_MANIFEST) {
  const normalizedManifest = cloneManifest(manifest);
  const channelMap = new Map();
  for (const slot of normalizedManifest.channels) {
    if (!slot.channel_id) {
      continue;
    }
    channelMap.set(slot.channel_id.toLowerCase(), slot);
  }
  const defaultChannelId =
    normalizeString(normalizedManifest.default_channel).toLowerCase() ||
    CHANNEL_ID.EXECUTION;

  return {
    getManifest() {
      return cloneManifest(normalizedManifest);
    },
    listChannels() {
      return normalizedManifest.channels.map(cloneChannelSlot);
    },
    getDefaultChannelId() {
      return defaultChannelId;
    },
    getChannelSlot(channelId) {
      const normalizedChannelId = normalizeString(channelId).toLowerCase();
      if (!normalizedChannelId) {
        return null;
      }
      const slot = channelMap.get(normalizedChannelId);
      return slot ? cloneChannelSlot(slot) : null;
    },
    getChannelStatus(channelId) {
      const slot = this.getChannelSlot(channelId);
      return slot ? normalizeString(slot.status) : "";
    },
  };
}

module.exports = {
  CHANNEL_SLOT_MANIFEST_VERSION,
  CHANNEL_SLOT_MANIFEST_SCHEMA_VERSION,
  CHANNEL_ID,
  CHANNEL_STATUS,
  DEFAULT_CHANNEL_SLOT_MANIFEST,
  createChannelSlotManifest,
};


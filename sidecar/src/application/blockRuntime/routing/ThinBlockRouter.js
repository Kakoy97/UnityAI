"use strict";

const { BLOCK_TYPE, isBlockType } = require("../contracts");
const {
  CHANNEL_ID,
  CHANNEL_STATUS,
  DEFAULT_CHANNEL_SLOT_MANIFEST,
  createChannelSlotManifest,
} = require("../channels");

const THIN_BLOCK_ROUTER_VERSION = "phase1_step6_t2_v1";

const ROUTE_STATUS = Object.freeze({
  ROUTED: "routed",
  RESERVED: "reserved",
  UNSUPPORTED: "unsupported",
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeChannelSlot(slot) {
  const source = isPlainObject(slot) ? slot : {};
  const supportedBlockTypes = Array.isArray(source.supported_block_types)
    ? source.supported_block_types
        .map((item) => normalizeString(item))
        .filter((item) => item.length > 0)
    : [];
  return {
    channel_id: normalizeString(source.channel_id).toLowerCase(),
    status: normalizeString(source.status).toLowerCase(),
    reason: normalizeString(source.reason),
    supported_block_types: supportedBlockTypes,
  };
}

function buildStaticSetsFromManifest(manifest) {
  const channels =
    manifest && Array.isArray(manifest.channels) ? manifest.channels : [];
  const reserved = [];
  const supported = [];
  for (const channel of channels) {
    const normalized = normalizeChannelSlot(channel);
    if (!normalized.channel_id) {
      continue;
    }
    if (normalized.status === CHANNEL_STATUS.RESERVED) {
      reserved.push(normalized.channel_id);
    }
    if (normalized.status === CHANNEL_STATUS.ACTIVE) {
      supported.push(...normalized.supported_block_types);
    }
  }
  return {
    reservedSet: new Set(reserved),
    supportedSet: new Set(supported),
  };
}

const STATIC_SETS = buildStaticSetsFromManifest(DEFAULT_CHANNEL_SLOT_MANIFEST);
const RESERVED_CHANNEL_SET = STATIC_SETS.reservedSet;
const SUPPORTED_BLOCK_TYPE_SET = STATIC_SETS.supportedSet;

const DEFAULT_CHANNEL_SLOT_RUNTIME = createChannelSlotManifest(
  DEFAULT_CHANNEL_SLOT_MANIFEST
);

function buildRouteResult({
  ok,
  blockId,
  channelId,
  routeStatus,
  routeReason,
  errorCode = "",
  blockErrorCode = "",
  message = "",
  channelStatus = "",
  reservedReason = "",
}) {
  const output = {
    ok: ok === true,
    block_id: normalizeString(blockId),
    channel_id: normalizeString(channelId) || CHANNEL_ID.EXECUTION,
    route_status: normalizeString(routeStatus) || ROUTE_STATUS.UNSUPPORTED,
    route_reason: normalizeString(routeReason) || "route_unknown",
  };
  const normalizedErrorCode = normalizeString(errorCode);
  if (normalizedErrorCode) {
    output.error_code = normalizedErrorCode;
  }
  const normalizedBlockErrorCode = normalizeString(blockErrorCode);
  if (normalizedBlockErrorCode) {
    output.block_error_code = normalizedBlockErrorCode;
  }
  const normalizedMessage = normalizeString(message);
  if (normalizedMessage) {
    output.message = normalizedMessage;
  }
  const normalizedChannelStatus = normalizeString(channelStatus);
  if (normalizedChannelStatus) {
    output.channel_status = normalizedChannelStatus;
  }
  const normalizedReservedReason = normalizeString(reservedReason);
  if (normalizedReservedReason) {
    output.reserved_reason = normalizedReservedReason;
  }
  return output;
}

function resolveRequestedChannel(executionContext) {
  const source = isPlainObject(executionContext) ? executionContext : {};
  return normalizeString(source.requested_channel).toLowerCase();
}

function resolveChannelRuntime(channelSlotManifest) {
  if (
    channelSlotManifest &&
    typeof channelSlotManifest.getChannelSlot === "function" &&
    typeof channelSlotManifest.getDefaultChannelId === "function"
  ) {
    return channelSlotManifest;
  }
  return DEFAULT_CHANNEL_SLOT_RUNTIME;
}

function resolveChannelSlot(channelRuntime, channelId) {
  const slot =
    channelRuntime && typeof channelRuntime.getChannelSlot === "function"
      ? channelRuntime.getChannelSlot(channelId)
      : null;
  return normalizeChannelSlot(slot);
}

function isBlockTypeSupportedBySlot(slot, blockType) {
  return (
    isPlainObject(slot) &&
    Array.isArray(slot.supported_block_types) &&
    slot.supported_block_types.includes(blockType)
  );
}

function createThinBlockRouter(options = {}) {
  const channelRuntime = resolveChannelRuntime(options.channelSlotManifest);

  return {
    routeBlock(blockSpec, executionContext = {}) {
      if (!isPlainObject(blockSpec)) {
        return buildRouteResult({
          ok: false,
          blockId: "",
          channelId: CHANNEL_ID.EXECUTION,
          routeStatus: ROUTE_STATUS.UNSUPPORTED,
          routeReason: "invalid_block_spec",
          errorCode: "E_SCHEMA_INVALID",
          blockErrorCode: "E_BLOCK_SCHEMA_INVALID",
          message: "block_spec must be a plain object",
        });
      }

      const blockId = normalizeString(blockSpec.block_id);
      const blockType = normalizeString(blockSpec.block_type);
      const requestedChannel = resolveRequestedChannel(executionContext);
      const defaultChannelId =
        normalizeString(channelRuntime.getDefaultChannelId()).toLowerCase() ||
        CHANNEL_ID.EXECUTION;
      const defaultSlot = resolveChannelSlot(channelRuntime, defaultChannelId);

      if (!isBlockType(blockType)) {
        return buildRouteResult({
          ok: false,
          blockId,
          channelId: defaultChannelId || CHANNEL_ID.EXECUTION,
          routeStatus: ROUTE_STATUS.UNSUPPORTED,
          routeReason: "block_type_unsupported",
          errorCode: "E_PRECONDITION_FAILED",
          blockErrorCode: "E_BLOCK_TYPE_UNSUPPORTED",
          message: "block_type is not supported by thin block router",
          channelStatus: defaultSlot.status,
        });
      }

      if (requestedChannel) {
        const requestedSlot = resolveChannelSlot(channelRuntime, requestedChannel);
        if (!requestedSlot.channel_id) {
          return buildRouteResult({
            ok: false,
            blockId,
            channelId: defaultChannelId || CHANNEL_ID.EXECUTION,
            routeStatus: ROUTE_STATUS.UNSUPPORTED,
            routeReason: "requested_channel_unsupported",
            errorCode: "E_PRECONDITION_FAILED",
            blockErrorCode: "E_BLOCK_CHANNEL_UNSUPPORTED",
            message: "requested channel is unsupported",
          });
        }
        if (requestedSlot.status === CHANNEL_STATUS.RESERVED) {
          return buildRouteResult({
            ok: false,
            blockId,
            channelId: requestedSlot.channel_id,
            routeStatus: ROUTE_STATUS.RESERVED,
            routeReason: "requested_channel_reserved",
            errorCode: "E_PRECONDITION_FAILED",
            blockErrorCode: "E_BLOCK_CHANNEL_RESERVED",
            message: "requested channel is reserved in Phase 1",
            channelStatus: requestedSlot.status,
            reservedReason: requestedSlot.reason,
          });
        }
        if (requestedSlot.status === CHANNEL_STATUS.DISABLED) {
          return buildRouteResult({
            ok: false,
            blockId,
            channelId: requestedSlot.channel_id,
            routeStatus: ROUTE_STATUS.UNSUPPORTED,
            routeReason: "requested_channel_disabled",
            errorCode: "E_PRECONDITION_FAILED",
            blockErrorCode: "E_BLOCK_CHANNEL_UNSUPPORTED",
            message: "requested channel is disabled",
            channelStatus: requestedSlot.status,
          });
        }
        if (!isBlockTypeSupportedBySlot(requestedSlot, blockType)) {
          return buildRouteResult({
            ok: false,
            blockId,
            channelId: requestedSlot.channel_id,
            routeStatus: ROUTE_STATUS.UNSUPPORTED,
            routeReason: "requested_channel_block_type_unsupported",
            errorCode: "E_PRECONDITION_FAILED",
            blockErrorCode: "E_BLOCK_CHANNEL_UNSUPPORTED",
            message: "requested channel does not support block_type",
            channelStatus: requestedSlot.status,
          });
        }
        return buildRouteResult({
          ok: true,
          blockId,
          channelId: requestedSlot.channel_id,
          routeStatus: ROUTE_STATUS.ROUTED,
          routeReason:
            requestedSlot.channel_id === CHANNEL_ID.EXECUTION
              ? "requested_execution_channel"
              : "requested_channel_routed",
          channelStatus: requestedSlot.status,
        });
      }

      if (
        defaultSlot.channel_id &&
        defaultSlot.status === CHANNEL_STATUS.ACTIVE &&
        isBlockTypeSupportedBySlot(defaultSlot, blockType)
      ) {
        return buildRouteResult({
          ok: true,
          blockId,
          channelId: defaultSlot.channel_id,
          routeStatus: ROUTE_STATUS.ROUTED,
          routeReason: "default_execution_route",
          channelStatus: defaultSlot.status,
        });
      }

      return buildRouteResult({
        ok: false,
        blockId,
        channelId: defaultChannelId || CHANNEL_ID.EXECUTION,
        routeStatus: ROUTE_STATUS.UNSUPPORTED,
        routeReason: "default_channel_unavailable",
        errorCode: "E_PRECONDITION_FAILED",
        blockErrorCode: "E_BLOCK_CHANNEL_UNSUPPORTED",
        message: "default channel is unavailable for block_type",
        channelStatus: defaultSlot.status,
      });
    },
  };
}

module.exports = {
  THIN_BLOCK_ROUTER_VERSION,
  CHANNEL_ID,
  ROUTE_STATUS,
  SUPPORTED_BLOCK_TYPE_SET,
  RESERVED_CHANNEL_SET,
  createThinBlockRouter,
};


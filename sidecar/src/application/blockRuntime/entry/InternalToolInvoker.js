"use strict";

const INTERNAL_TOOL_INVOKER_VERSION = "phase1_step3_plnr006_v1";
const DISPATCH_METHOD_NAME = "dispatchSsotToolForMcp";
const INVOKE_METHOD_NAME = "invokeTool";

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function assertTurnServiceDispatchContract(turnService, options = {}) {
  const label = normalizeString(options.label) || "turnService";
  if (!isPlainObject(turnService)) {
    throw new TypeError(`[${label}] must be an object`);
  }
  if (typeof turnService[DISPATCH_METHOD_NAME] !== "function") {
    throw new TypeError(
      `[${label}] missing required method: ${DISPATCH_METHOD_NAME}()`
    );
  }
  return turnService;
}

function createInternalToolInvoker(options = {}) {
  const input = isPlainObject(options) ? options : {};
  const turnService = assertTurnServiceDispatchContract(input.turnService, {
    label: "turnService",
  });

  return {
    version: INTERNAL_TOOL_INVOKER_VERSION,
    async [INVOKE_METHOD_NAME](toolName, payload) {
      const normalizedToolName = normalizeString(toolName);
      if (!normalizedToolName) {
        throw new TypeError(
          "[InternalToolInvoker] tool_name must be non-empty string"
        );
      }
      if (!isPlainObject(payload)) {
        throw new TypeError("[InternalToolInvoker] payload must be a plain object");
      }
      return turnService[DISPATCH_METHOD_NAME](normalizedToolName, payload);
    },
  };
}

module.exports = {
  INTERNAL_TOOL_INVOKER_VERSION,
  INVOKE_METHOD_NAME,
  DISPATCH_METHOD_NAME,
  assertTurnServiceDispatchContract,
  createInternalToolInvoker,
};

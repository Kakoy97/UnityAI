"use strict";

const DISPATCH_METHOD_NAME = "dispatchSsotToolForMcp";
const INTERNAL_INVOKER_METHOD_NAME = "invokeTool";
const TURN_SERVICE_RUNTIME_PORT_VERSION = "phase1_step2a_t3_v1";

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

function assertInternalToolInvokerContract(internalToolInvoker, options = {}) {
  const label = normalizeString(options.label) || "internalToolInvoker";
  if (!isPlainObject(internalToolInvoker)) {
    throw new TypeError(`[${label}] must be an object`);
  }
  if (typeof internalToolInvoker[INTERNAL_INVOKER_METHOD_NAME] !== "function") {
    throw new TypeError(
      `[${label}] missing required method: ${INTERNAL_INVOKER_METHOD_NAME}()`
    );
  }
  return internalToolInvoker;
}

function normalizeDispatchOutcome(outcome, toolName) {
  if (!isPlainObject(outcome)) {
    throw new TypeError(
      `[TurnServiceRuntimePort] dispatch outcome must be object for tool: ${toolName}`
    );
  }
  if (!Number.isFinite(Number(outcome.statusCode))) {
    throw new TypeError(
      `[TurnServiceRuntimePort] dispatch outcome statusCode must be finite number for tool: ${toolName}`
    );
  }
  const statusCode = Number(outcome.statusCode);
  return {
    ok: statusCode >= 200 && statusCode < 300,
    status_code: statusCode,
    tool_name: toolName,
    body: isPlainObject(outcome.body) ? outcome.body : {},
  };
}

function createTurnServiceRuntimePort(options = {}) {
  const input = isPlainObject(options) ? options : {};
  const turnService =
    input.turnService === undefined
      ? null
      : assertTurnServiceDispatchContract(input.turnService, {
          label: "turnService",
        });
  const internalToolInvoker =
    input.internalToolInvoker === undefined
      ? null
      : assertInternalToolInvokerContract(input.internalToolInvoker, {
          label: "internalToolInvoker",
        });
  if (!turnService && !internalToolInvoker) {
    throw new TypeError(
      "[TurnServiceRuntimePort] requires turnService or internalToolInvoker"
    );
  }

  return {
    async executeToolPlan(toolName, payload) {
      const normalizedToolName = normalizeString(toolName);
      if (!normalizedToolName) {
        throw new TypeError(
          "[TurnServiceRuntimePort] tool_name must be non-empty string"
        );
      }
      if (!isPlainObject(payload)) {
        throw new TypeError("[TurnServiceRuntimePort] payload must be a plain object");
      }
      const outcome = internalToolInvoker
        ? await internalToolInvoker[INTERNAL_INVOKER_METHOD_NAME](
            normalizedToolName,
            payload
          )
        : await turnService[DISPATCH_METHOD_NAME](normalizedToolName, payload);
      return normalizeDispatchOutcome(outcome, normalizedToolName);
    },
  };
}

module.exports = {
  DISPATCH_METHOD_NAME,
  INTERNAL_INVOKER_METHOD_NAME,
  TURN_SERVICE_RUNTIME_PORT_VERSION,
  assertTurnServiceDispatchContract,
  assertInternalToolInvokerContract,
  createTurnServiceRuntimePort,
};

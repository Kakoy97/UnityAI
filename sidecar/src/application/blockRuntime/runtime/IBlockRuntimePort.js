"use strict";

const PORT_CONTRACT_VERSION = "phase1_step2a_t2_v1";
const REQUIRED_METHOD_NAMES = Object.freeze(["executeToolPlan"]);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function assertBlockRuntimePort(port, options = {}) {
  const label = normalizeString(options.label) || "runtimePort";
  if (!isPlainObject(port)) {
    throw new TypeError(`[${label}] must be an object implementing IBlockRuntimePort`);
  }
  for (const methodName of REQUIRED_METHOD_NAMES) {
    if (typeof port[methodName] !== "function") {
      throw new TypeError(
        `[${label}] missing required method: ${methodName}()`
      );
    }
  }
  return port;
}

function validateExecuteToolPlanRequest(toolName, payload) {
  const normalizedToolName = normalizeString(toolName);
  if (!normalizedToolName) {
    throw new TypeError("[IBlockRuntimePort] tool_name must be non-empty string");
  }
  if (!isPlainObject(payload)) {
    throw new TypeError("[IBlockRuntimePort] payload must be a plain object");
  }
  return {
    tool_name: normalizedToolName,
    payload,
  };
}

async function executeToolPlan(port, toolName, payload) {
  const normalizedPort = assertBlockRuntimePort(port);
  const request = validateExecuteToolPlanRequest(toolName, payload);
  return normalizedPort.executeToolPlan(request.tool_name, request.payload);
}

module.exports = {
  PORT_CONTRACT_VERSION,
  REQUIRED_METHOD_NAMES,
  assertBlockRuntimePort,
  validateExecuteToolPlanRequest,
  executeToolPlan,
};


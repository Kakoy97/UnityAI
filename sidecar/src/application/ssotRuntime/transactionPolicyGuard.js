"use strict";

const {
  MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT,
} = require("../../ports/contracts");

const TRANSACTION_STEP_TOOL_FORBIDDEN_ERROR_CODE =
  "E_TRANSACTION_STEP_TOOL_FORBIDDEN";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toToolNameSet(value) {
  const source = Array.isArray(value) ? value : [];
  const output = new Set();
  for (const item of source) {
    const normalized = normalizeString(item);
    if (!normalized) {
      continue;
    }
    output.add(normalized);
  }
  return output;
}

function readPolicySets(policyContract) {
  const source =
    policyContract && typeof policyContract === "object"
      ? policyContract
      : {};
  return {
    active: toToolNameSet(source.active_tool_names),
    deprecated: toToolNameSet(source.deprecated_tool_names),
    removed: toToolNameSet(source.removed_tool_names),
    disabled: toToolNameSet(source.disabled_tool_names),
    transactionEnabledWrite: toToolNameSet(
      source.transaction_enabled_write_tool_names
    ),
  };
}

function appendStructuredSteps(stepEntries, payload) {
  const steps =
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Array.isArray(payload.steps)
      ? payload.steps
      : [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index] && typeof steps[index] === "object" ? steps[index] : {};
    stepEntries.push({
      source: "steps",
      step_index: index,
      step_id: normalizeString(step.step_id),
      tool_name: normalizeString(step.tool_name),
    });
  }
}

function extractTransactionStepEntries(payload) {
  const entries = [];
  appendStructuredSteps(entries, payload);
  return entries;
}

function evaluateStepToolPolicy(toolName, policySets) {
  const normalizedToolName = normalizeString(toolName);
  if (!normalizedToolName) {
    return {
      ok: false,
      reason: "missing_tool_name",
      message: "transaction step tool_name is required",
      tool_name: normalizedToolName,
    };
  }
  if (policySets.deprecated.has(normalizedToolName)) {
    return {
      ok: false,
      reason: "deprecated",
      message: `deprecated tool is blocked in transaction: ${normalizedToolName}`,
      tool_name: normalizedToolName,
    };
  }
  if (policySets.removed.has(normalizedToolName)) {
    return {
      ok: false,
      reason: "removed",
      message: `removed tool is blocked in transaction: ${normalizedToolName}`,
      tool_name: normalizedToolName,
    };
  }
  if (policySets.disabled.has(normalizedToolName)) {
    return {
      ok: false,
      reason: "disabled",
      message: `disabled tool is blocked in transaction: ${normalizedToolName}`,
      tool_name: normalizedToolName,
    };
  }
  if (!policySets.active.has(normalizedToolName)) {
    return {
      ok: false,
      reason: "inactive",
      message: `inactive tool is blocked in transaction: ${normalizedToolName}`,
      tool_name: normalizedToolName,
    };
  }
  if (!policySets.transactionEnabledWrite.has(normalizedToolName)) {
    return {
      ok: false,
      reason: "transaction_forbidden",
      message: `tool is not transaction-enabled write: ${normalizedToolName}`,
      tool_name: normalizedToolName,
    };
  }
  return {
    ok: true,
    reason: "allowed",
    message: "",
    tool_name: normalizedToolName,
  };
}

function createTransactionPolicyGuard(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const policyContract =
    opts.policyContract || MCP_TRANSACTION_STEP_POLICY_FREEZE_CONTRACT;
  const policySets = readPolicySets(policyContract);

  return function guardExecuteUnityTransactionSteps(payload) {
    const stepEntries = extractTransactionStepEntries(payload);
    for (const entry of stepEntries) {
      const verdict = evaluateStepToolPolicy(entry.tool_name, policySets);
      if (!verdict.ok) {
        return {
          ok: false,
          error_code: TRANSACTION_STEP_TOOL_FORBIDDEN_ERROR_CODE,
          message: `Transaction step tool policy rejected: ${verdict.message}`,
          failed_step_index: entry.step_index,
          failed_step_id: entry.step_id,
          failed_tool_name: verdict.tool_name,
          reason: verdict.reason,
          source: entry.source,
        };
      }
    }

    return {
      ok: true,
      inspected_step_count: stepEntries.length,
    };
  };
}

const guardExecuteUnityTransactionSteps = createTransactionPolicyGuard();

module.exports = {
  TRANSACTION_STEP_TOOL_FORBIDDEN_ERROR_CODE,
  extractTransactionStepEntries,
  createTransactionPolicyGuard,
  guardExecuteUnityTransactionSteps,
};

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const COMMANDS_MODULE_PATH = require.resolve("../../src/mcp/commands");
const MANIFEST_MODULE_PATH = require.resolve(
  "../../src/mcp/commands/commandDefinitionManifest"
);
const REGISTRY_MODULE_PATH = require.resolve("../../src/mcp/commandRegistry");

function loadCommandDefinitionsWithEntryGovernanceEnabled(enabled) {
  const previous = process.env.MCP_ENTRY_GOVERNANCE_ENABLED;
  process.env.MCP_ENTRY_GOVERNANCE_ENABLED = enabled ? "true" : "false";
  delete require.cache[COMMANDS_MODULE_PATH];
  delete require.cache[MANIFEST_MODULE_PATH];
  delete require.cache[REGISTRY_MODULE_PATH];

  try {
    const { MCP_COMMAND_DEFINITIONS } = require(COMMANDS_MODULE_PATH);
    return Array.isArray(MCP_COMMAND_DEFINITIONS) ? MCP_COMMAND_DEFINITIONS : [];
  } finally {
    if (previous === undefined) {
      delete process.env.MCP_ENTRY_GOVERNANCE_ENABLED;
    } else {
      process.env.MCP_ENTRY_GOVERNANCE_ENABLED = previous;
    }
    delete require.cache[COMMANDS_MODULE_PATH];
    delete require.cache[MANIFEST_MODULE_PATH];
    delete require.cache[REGISTRY_MODULE_PATH];
  }
}

test("PLNR-012 planner_execute_mcp command definition is materialized from SSOT manifest", () => {
  const definitions = loadCommandDefinitionsWithEntryGovernanceEnabled(true);
  const byName = new Map(
    definitions.map((item) => [String(item && item.name || "").trim(), item])
  );

  const plannerEntry = byName.get("planner_execute_mcp");
  assert.ok(plannerEntry, "planner_execute_mcp definition should be present");
  assert.equal(plannerEntry.dispatch_mode, "local_static");
  assert.equal(plannerEntry.turnServiceMethod, "executePlannerEntryForMcp");
  assert.equal(plannerEntry.http.path, "/mcp/planner_execute_mcp");
  assert.equal(byName.has("execute_block_spec_mvp"), false);
});

test("PLNR-012 planner_execute_mcp remains available when MCP_ENTRY_GOVERNANCE_ENABLED=false", () => {
  const definitions = loadCommandDefinitionsWithEntryGovernanceEnabled(false);
  const plannerEntryExists = definitions.some(
    (item) => String(item && item.name || "").trim() === "planner_execute_mcp"
  );
  assert.equal(plannerEntryExists, true);
});

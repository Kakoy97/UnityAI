"use strict";

const assert = require("node:assert/strict");

const { MCP_COMMAND_DEFINITIONS } = require("../../src/mcp/commands");

function getCommandValidator(toolName) {
  const normalizedToolName = String(toolName || "").trim();
  assert.ok(normalizedToolName, "toolName is required");

  const definition = MCP_COMMAND_DEFINITIONS.find(
    (item) => item && item.name === normalizedToolName
  );
  assert.ok(
    definition,
    `command definition is missing for tool '${normalizedToolName}'`
  );
  assert.equal(
    typeof definition.validate,
    "function",
    `command validator is missing for tool '${normalizedToolName}'`
  );

  return definition.validate;
}

module.exports = {
  getCommandValidator,
};

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { MCP_COMMAND_DEFINITIONS } = require("../../src/mcp/commands");
const { TurnService } = require("../../src/application/turnService");

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

test("SSOT command definitions enforce turnServiceMethod + validate only", () => {
  assert.ok(Array.isArray(MCP_COMMAND_DEFINITIONS));
  assert.ok(MCP_COMMAND_DEFINITIONS.length > 0);

  const turnServiceProto =
    TurnService && TurnService.prototype ? TurnService.prototype : {};

  for (const command of MCP_COMMAND_DEFINITIONS) {
    assert.ok(command && typeof command === "object");
    assert.ok(typeof command.name === "string" && command.name.trim());
    assert.ok(
      typeof command.turnServiceMethod === "string" &&
        command.turnServiceMethod.trim(),
      `turnServiceMethod is required for '${command.name || "<unknown>"}'`
    );
    assert.equal(
      typeof turnServiceProto[command.turnServiceMethod],
      "function",
      `turnService handler missing: '${command.turnServiceMethod}' for '${command.name}'`
    );
    assert.equal(
      typeof command.validate,
      "function",
      `validate is required for '${command.name || "<unknown>"}'`
    );
    assert.equal(
      hasOwn(command, "execute"),
      false,
      `legacy execute field is forbidden for '${command.name || "<unknown>"}'`
    );
    assert.equal(
      hasOwn(command, "handler"),
      false,
      `legacy handler field is forbidden for '${command.name || "<unknown>"}'`
    );
  }
});

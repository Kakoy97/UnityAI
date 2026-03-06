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
  assert.equal(
    typeof turnServiceProto.dispatchSsotToolForMcp,
    "function",
    "TurnService must expose dispatchSsotToolForMcp for ssot_query commands"
  );

  for (const command of MCP_COMMAND_DEFINITIONS) {
    assert.ok(command && typeof command === "object");
    assert.ok(typeof command.name === "string" && command.name.trim());
    assert.ok(
      typeof command.dispatch_mode === "string" && command.dispatch_mode.trim(),
      `dispatch_mode is required for '${command.name || "<unknown>"}'`
    );
    assert.ok(
      ["ssot_query", "local_static"].includes(command.dispatch_mode),
      `unsupported dispatch_mode '${command.dispatch_mode}' for '${command.name || "<unknown>"}'`
    );
    if (command.dispatch_mode === "local_static") {
      assert.ok(
        typeof command.turnServiceMethod === "string" &&
          command.turnServiceMethod.trim(),
        `turnServiceMethod is required for local_static '${command.name || "<unknown>"}'`
      );
      assert.equal(
        typeof turnServiceProto[command.turnServiceMethod],
        "function",
        `turnService handler missing: '${command.turnServiceMethod}' for '${command.name}'`
      );
    } else {
      assert.equal(
        hasOwn(command, "turnServiceMethod"),
        false,
        `ssot_query command must not declare turnServiceMethod: '${command.name}'`
      );
    }
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

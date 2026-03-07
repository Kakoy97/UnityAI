"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  emitSidecarCommandManifest,
} = require("../emitters/l2/emitSidecarCommandManifest");

test("emitSidecarCommandManifest emits transaction policy for each command", () => {
  const manifest = emitSidecarCommandManifest({
    version: 1,
    tools: [
      {
        name: "create_object",
        kind: "write",
        lifecycle: "stable",
        transaction: {
          enabled: true,
          undo_safe: true,
        },
      },
      {
        name: "save_scene",
        kind: "write",
        lifecycle: "stable",
        transaction: {
          enabled: false,
          undo_safe: false,
        },
      },
    ],
  });

  assert.equal(manifest.commands.length, 2);
  assert.deepEqual(manifest.commands[0].transaction, {
    enabled: true,
    undo_safe: true,
  });
  assert.deepEqual(manifest.commands[1].transaction, {
    enabled: false,
    undo_safe: false,
  });
});

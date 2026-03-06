"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  maybeUpdateLatestKnownSceneRevisionFromResponse,
} = require("../../src/application/ssotRuntime/dispatchSsotRequest");
const {
  SsotRevisionState,
} = require("../../src/application/ssotRuntime/ssotRevisionState");

test("dispatch revision hook records latest scene revision from successful response", () => {
  const revisionState = new SsotRevisionState();
  const input = {
    ok: true,
    data: {
      scene_revision: "3100",
    },
  };

  const output = maybeUpdateLatestKnownSceneRevisionFromResponse({
    toolName: "get_current_selection",
    result: input,
    revisionState,
    requestId: "req_1",
    threadId: "thread_1",
    turnId: "turn_1",
  });

  assert.equal(output, input);
  assert.equal(revisionState.getLatestKnownSceneRevision(), "3100");
});

test("dispatch revision hook ignores out-of-order scene revision", () => {
  const revisionState = new SsotRevisionState();
  revisionState.updateLatestKnownSceneRevision("4002", {
    source_tool_name: "get_scene_roots",
  });

  maybeUpdateLatestKnownSceneRevisionFromResponse({
    toolName: "get_current_selection",
    result: {
      ok: true,
      data: {
        scene_revision: "4001",
      },
    },
    revisionState,
  });

  assert.equal(revisionState.getLatestKnownSceneRevision(), "4002");
});


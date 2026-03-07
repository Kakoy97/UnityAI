"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emitBindingsCs } = require("../emitters/l3/emitBindingsCs");

test("emitBindingsCs generates tool_name dispatcher and typed JsonUtility deserialization", () => {
  const output = emitBindingsCs({
    version: 1,
    tools: [
      { name: "modify_ui_layout" },
      { name: "get_scene_snapshot_for_write" },
    ],
  });

  assert.match(output, /using UnityEngine;/);
  assert.match(output, /public sealed class SsotToolEnvelopeDto/);
  assert.match(output, /public static bool TryDeserializeEnvelope/);
  assert.match(output, /case ModifyUiLayoutRequestDto\.ToolName:/);
  assert.match(output, /case GetSceneSnapshotForWriteRequestDto\.ToolName:/);
  assert.match(output, /TryDeserialize<ModifyUiLayoutRequestDto>\(payloadJson, out requestDto, out errorMessage\)/);
  assert.match(output, /TryDeserialize<GetSceneSnapshotForWriteRequestDto>\(payloadJson, out requestDto, out errorMessage\)/);
  assert.match(output, /string\.Equals\(typeof\(T\)\.Name, "ExecuteUnityTransactionRequestDto"/);
  assert.match(output, /ExecuteUnityTransactionPayloadParser\.TryDeserialize/);
  assert.match(output, /JsonUtility\.FromJson<T>\(payloadJson\)/);
  assert.match(output, /public static bool TryDeserializeModifyUiLayout/);
  assert.match(output, /public static bool TryDeserializeGetSceneSnapshotForWrite/);
});

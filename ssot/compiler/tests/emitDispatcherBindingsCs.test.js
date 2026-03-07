"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emitDispatcherBindingsCs } = require("../emitters/l3/emitDispatcherBindingsCs");

test("emitDispatcherBindingsCs marks local_static tools as unsupported in L3", () => {
  const output = emitDispatcherBindingsCs({
    version: 1,
    tools: [{ name: "run_unity_tests" }, { name: "modify_ui_layout" }],
  });

  assert.match(
    output,
    /bindings\[RunUnityTestsRequestDto\.ToolName\]\s*=\s*[\s\S]*CreateUnsupportedBinding\(RunUnityTestsRequestDto\.ToolName\);/
  );
  assert.match(
    output,
    /CreateExecutorBinding<ModifyUiLayoutRequestDto, ModifyUiLayoutSsotExecutor>/
  );
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emitDispatcherBindingsCs } = require("../emitters/l3/emitDispatcherBindingsCs");

test("emitDispatcherBindingsCs marks local_static tools as unsupported in L3", () => {
  const output = emitDispatcherBindingsCs({
    version: 1,
    tools: [
      { name: "run_unity_tests" },
      { name: "planner_execute_mcp" },
      { name: "modify_ui_layout" },
    ],
  });

  assert.match(
    output,
    /bindings\[RunUnityTestsRequestDto\.ToolName\]\s*=\s*[\s\S]*CreateUnsupportedBinding\(RunUnityTestsRequestDto\.ToolName\);/
  );
  assert.match(
    output,
    /bindings\[PlannerExecuteMcpRequestDto\.ToolName\]\s*=\s*[\s\S]*CreateUnsupportedBinding\(PlannerExecuteMcpRequestDto\.ToolName\);/
  );
  assert.match(
    output,
    /CreateExecutorBinding<ModifyUiLayoutRequestDto, ModifyUiLayoutSsotExecutor>/
  );
});

test("emitDispatcherBindingsCs emits executor bindings for async workflow task tools", () => {
  const output = emitDispatcherBindingsCs({
    version: 1,
    tools: [
      { name: "submit_unity_task" },
      { name: "get_unity_task_status" },
      { name: "cancel_unity_task" },
      { name: "apply_script_actions" },
    ],
  });

  assert.match(
    output,
    /CreateExecutorBinding<SubmitUnityTaskRequestDto, SubmitUnityTaskSsotExecutor>/
  );
  assert.match(
    output,
    /CreateExecutorBinding<GetUnityTaskStatusRequestDto, GetUnityTaskStatusSsotExecutor>/
  );
  assert.match(
    output,
    /CreateExecutorBinding<CancelUnityTaskRequestDto, CancelUnityTaskSsotExecutor>/
  );
  assert.match(
    output,
    /CreateUnsupportedBinding\(ApplyScriptActionsRequestDto\.ToolName\);/
  );
});

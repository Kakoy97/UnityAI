"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

function loadSequentialBatchOrchestratorModule() {
  try {
    return require("../../src/application/blockRuntime/batch/SequentialBatchOrchestrator");
  } catch (error) {
    if (error && error.code === "MODULE_NOT_FOUND") {
      return {};
    }
    throw error;
  }
}

function buildSequentialBatchPlan(stepCount = 2) {
  const steps = [];
  for (let index = 0; index < stepCount; index += 1) {
    steps.push({
      step_id: `batch_step_${index + 1}`,
      tool_name: index === 0 ? "set_active" : "set_sibling_index",
      payload: {
        execution_mode: "execute",
        based_on_read_token: "ssot_rt_seq_batch",
        write_anchor_object_id: "GlobalObjectId_V1-canvas",
        write_anchor_path: "Scene/Canvas",
        target_object_id: `GlobalObjectId_V1-target_${index + 1}`,
        target_path: `Scene/Canvas/Button_${index + 1}`,
        ...(index === 0 ? { active: true } : { sibling_index: index }),
      },
    });
  }
  return {
    entry_domain: "batch_entry",
    atomicity_preference: "none",
    failure_policy: "stop_on_first_failure",
    step_count: steps.length,
    steps,
  };
}

test("BATCH-004 sequential orchestrator executes steps in order and returns aggregate success fields", async () => {
  const { createSequentialBatchOrchestrator } = loadSequentialBatchOrchestratorModule();
  assert.equal(typeof createSequentialBatchOrchestrator, "function");

  const callOrder = [];
  const orchestrator = createSequentialBatchOrchestrator({
    async executeStep(step) {
      callOrder.push(step.step_id);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          tool_name: step.tool_name,
          data: {
            applied_step_id: step.step_id,
          },
        },
      };
    },
  });

  const outcome = await orchestrator.executeBatch({
    batch_plan: buildSequentialBatchPlan(2),
  });

  assert.deepEqual(callOrder, ["batch_step_1", "batch_step_2"]);
  assert.equal(outcome.status, "succeeded");
  assert.equal(Array.isArray(outcome.step_results), true);
  assert.equal(outcome.step_results.length, 2);
  assert.deepEqual(outcome.successful_step_ids, ["batch_step_1", "batch_step_2"]);
  assert.equal(outcome.first_failed_step_id, "");
  assert.equal(outcome.rollback_applied, false);
});

test("BATCH-004 sequential orchestrator stops on first failure and does not execute later steps", async () => {
  const { createSequentialBatchOrchestrator } = loadSequentialBatchOrchestratorModule();
  assert.equal(typeof createSequentialBatchOrchestrator, "function");

  const callOrder = [];
  const orchestrator = createSequentialBatchOrchestrator({
    async executeStep(step) {
      callOrder.push(step.step_id);
      if (step.step_id === "batch_step_2") {
        return {
          statusCode: 409,
          body: {
            ok: false,
            status: "failed",
            error_code: "E_STEP_FAILED",
            message: "step failed",
          },
        };
      }
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          tool_name: step.tool_name,
          data: {
            applied_step_id: step.step_id,
          },
        },
      };
    },
  });

  const outcome = await orchestrator.executeBatch({
    batch_plan: buildSequentialBatchPlan(3),
  });

  assert.deepEqual(callOrder, ["batch_step_1", "batch_step_2"]);
  assert.equal(outcome.status, "failed");
  assert.equal(Array.isArray(outcome.step_results), true);
  assert.equal(outcome.step_results.length, 2);
  assert.deepEqual(outcome.successful_step_ids, ["batch_step_1"]);
  assert.equal(outcome.first_failed_step_id, "batch_step_2");
  assert.equal(outcome.rollback_applied, false);
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BLOCK_TYPE,
  validateBlockResult,
} = require("../../src/application/blockRuntime/contracts");
const {
  createExecutionChannelAdapter,
} = require("../../src/application/blockRuntime/execution");

function buildWriteBlockSpec(overrides = {}) {
  return {
    block_id: "block_shape_error_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Image",
    },
    based_on_read_token: "ssot_rt_shape_err",
    write_envelope: {
      idempotency_key: "idp_shape_err_1",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

test("S2B-T3 exposes shape_degraded and shape_reason in BlockResult execution_meta", async () => {
  const adapter = createExecutionChannelAdapter({
    runtimeBridge: {
      async executeMappedToolPlan() {
        return {
          ok: true,
          tool_name: "set_active",
          status_code: 200,
          output_data: {
            scene_revision: "ssot_rev_shape",
            read_token_candidate: "ssot_rt_shape",
          },
          scene_revision: "ssot_rev_shape",
          read_token_candidate: "ssot_rt_shape",
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildWriteBlockSpec(), {
    shape: "single_step",
    shape_degraded: true,
    shape_reason: "transaction_capability_unavailable",
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.execution_meta.shape, "single_step");
  assert.equal(result.execution_meta.shape_degraded, true);
  assert.equal(
    result.execution_meta.shape_reason,
    "transaction_capability_unavailable"
  );
  const schema = validateBlockResult(result);
  assert.equal(schema.ok, true);
});

test("S2B-T3 propagates transaction failure observability fields on failed block", async () => {
  const adapter = createExecutionChannelAdapter({
    runtimeBridge: {
      async executeMappedToolPlan() {
        return {
          ok: false,
          tool_name: "execute_unity_transaction",
          status_code: 409,
          output_data: {
            transaction_rollback_applied: true,
            failed_blocks: [
              {
                block_id: "block_2",
                tool_name: "set_component_properties",
              },
            ],
          },
          error: {
            error_code: "E_TRANSACTION_STEP_FAILED",
            error_message: "transaction step failed",
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildWriteBlockSpec(), {
    shape: "transaction",
    shape_degraded: true,
    shape_reason: "transaction_failed_then_degraded",
  });

  assert.equal(result.status, "failed");
  assert.equal(result.error.error_code, "E_TRANSACTION_STEP_FAILED");
  assert.equal(result.execution_meta.shape, "transaction");
  assert.equal(result.execution_meta.shape_degraded, true);
  assert.equal(result.execution_meta.transaction_rollback_applied, true);
  assert.equal(Array.isArray(result.execution_meta.failed_blocks), true);
  assert.equal(result.execution_meta.failed_blocks.length, 1);
  assert.equal(
    result.execution_meta.failed_blocks[0].tool_name,
    "set_component_properties"
  );
  const schema = validateBlockResult(result);
  assert.equal(schema.ok, true);
});


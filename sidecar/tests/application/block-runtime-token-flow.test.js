"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { BLOCK_TYPE } = require("../../src/application/blockRuntime/contracts");
const {
  EFFECTIVE_TOKEN_SOURCE,
  resolveEffectiveReadTokenForBlock,
  materializeBlockSpecWithEffectiveToken,
  extractReadTokenCandidateFromBlockResult,
  createExecutionChannelAdapter,
} = require("../../src/application/blockRuntime/execution");

function buildWriteBlockSpec(overrides = {}) {
  return {
    block_id: "block_mutate_token_1",
    block_type: BLOCK_TYPE.MUTATE,
    intent_key: "mutate.set_active",
    input: {
      active: true,
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Image",
    },
    based_on_read_token: "ssot_rt_block",
    write_envelope: {
      idempotency_key: "idp_token_1",
      write_anchor_object_id: "GlobalObjectId_V1-canvas",
      write_anchor_path: "Scene/Canvas",
      execution_mode: "execute",
    },
    ...overrides,
  };
}

function buildReadBlockSpec(overrides = {}) {
  return {
    block_id: "block_read_token_1",
    block_type: BLOCK_TYPE.READ_STATE,
    intent_key: "read.snapshot_for_write",
    input: {
      scope_path: "Scene/Canvas",
    },
    ...overrides,
  };
}

test("S2A-T6 token resolver single-step prefers block based_on_read_token", () => {
  const outcome = resolveEffectiveReadTokenForBlock(buildWriteBlockSpec(), {
    shape: "single_step",
    previous_read_token_candidate: "ssot_rt_prev",
  });
  assert.equal(outcome.token, "ssot_rt_block");
  assert.equal(outcome.source, EFFECTIVE_TOKEN_SOURCE.BLOCK_BASED_ON_READ_TOKEN);
});

test("S2A-T6 token resolver single-step falls back to previous candidate", () => {
  const writeBlock = buildWriteBlockSpec();
  delete writeBlock.based_on_read_token;
  const outcome = resolveEffectiveReadTokenForBlock(writeBlock, {
    shape: "single_step",
    previous_read_token_candidate: "ssot_rt_prev",
  });
  assert.equal(outcome.token, "ssot_rt_prev");
  assert.equal(outcome.source, EFFECTIVE_TOKEN_SOURCE.PREVIOUS_READ_TOKEN_CANDIDATE);
});

test("S2A-T6 token resolver transaction prefers plan initial token", () => {
  const outcome = resolveEffectiveReadTokenForBlock(buildWriteBlockSpec(), {
    shape: "transaction",
    plan_initial_read_token: "ssot_rt_plan",
    previous_read_token_candidate: "ssot_rt_prev",
    transaction_read_token_candidate: "ssot_rt_txn",
  });
  assert.equal(outcome.token, "ssot_rt_plan");
  assert.equal(outcome.source, EFFECTIVE_TOKEN_SOURCE.PLAN_INITIAL_READ_TOKEN);
});

test("S2A-T6 token resolver transaction falls back block then previous", () => {
  const withBlockToken = resolveEffectiveReadTokenForBlock(buildWriteBlockSpec(), {
    shape: "transaction",
    previous_read_token_candidate: "ssot_rt_prev",
  });
  assert.equal(withBlockToken.token, "ssot_rt_block");
  assert.equal(
    withBlockToken.source,
    EFFECTIVE_TOKEN_SOURCE.BLOCK_BASED_ON_READ_TOKEN
  );

  const withoutBlockToken = buildWriteBlockSpec();
  delete withoutBlockToken.based_on_read_token;
  const fallback = resolveEffectiveReadTokenForBlock(withoutBlockToken, {
    shape: "transaction",
    previous_read_token_candidate: "ssot_rt_prev",
  });
  assert.equal(fallback.token, "ssot_rt_prev");
  assert.equal(
    fallback.source,
    EFFECTIVE_TOKEN_SOURCE.PREVIOUS_READ_TOKEN_CANDIDATE
  );
});

test("S2A-T6 materialize keeps read block unchanged and injects write token", () => {
  const readOutcome = materializeBlockSpecWithEffectiveToken(buildReadBlockSpec(), {
    shape: "single_step",
    previous_read_token_candidate: "ssot_rt_prev",
  });
  assert.equal(
    readOutcome.token_flow.source,
    EFFECTIVE_TOKEN_SOURCE.NOT_WRITE_BLOCK
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(readOutcome.block_spec, "based_on_read_token"),
    false
  );

  const writeBlock = buildWriteBlockSpec();
  delete writeBlock.based_on_read_token;
  const writeOutcome = materializeBlockSpecWithEffectiveToken(writeBlock, {
    shape: "single_step",
    previous_read_token_candidate: "ssot_rt_prev",
  });
  assert.equal(writeOutcome.block_spec.based_on_read_token, "ssot_rt_prev");
  assert.equal(
    writeOutcome.token_flow.source,
    EFFECTIVE_TOKEN_SOURCE.PREVIOUS_READ_TOKEN_CANDIDATE
  );
});

test("S2A-T6 ExecutionChannelAdapter injects previous token for non-transaction write", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_after_write",
              read_token_candidate: "ssot_rt_after_write",
            },
          },
        };
      },
    },
  });

  const writeBlock = buildWriteBlockSpec();
  delete writeBlock.based_on_read_token;
  const result = await adapter.executeBlock(writeBlock, {
    shape: "single_step",
    previous_read_token_candidate: "ssot_rt_prev",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].toolName, "set_active");
  assert.equal(calls[0].payload.based_on_read_token, "ssot_rt_prev");
  assert.equal(result.status, "succeeded");
  assert.equal(
    result.execution_meta.effective_read_token_source,
    EFFECTIVE_TOKEN_SOURCE.PREVIOUS_READ_TOKEN_CANDIDATE
  );
  assert.equal(result.read_token_candidate, "ssot_rt_after_write");
});

test("S2A-T6 ExecutionChannelAdapter transaction write prefers plan initial token", async () => {
  const calls = [];
  const adapter = createExecutionChannelAdapter({
    runtimePort: {
      async executeToolPlan(toolName, payload) {
        calls.push({ toolName, payload });
        return {
          ok: true,
          status_code: 200,
          tool_name: toolName,
          body: {
            ok: true,
            data: {
              scene_revision: "ssot_rev_txn",
              read_token_candidate: "ssot_rt_txn_out",
            },
          },
        };
      },
    },
  });

  const result = await adapter.executeBlock(buildWriteBlockSpec(), {
    shape: "transaction",
    plan_initial_read_token: "ssot_rt_plan",
    previous_read_token_candidate: "ssot_rt_prev",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.based_on_read_token, "ssot_rt_plan");
  assert.equal(result.status, "succeeded");
  assert.equal(
    result.execution_meta.effective_read_token_source,
    EFFECTIVE_TOKEN_SOURCE.PLAN_INITIAL_READ_TOKEN
  );
});

test("S2A-T6 extractReadTokenCandidateFromBlockResult follows succeeded-only rule", () => {
  assert.equal(
    extractReadTokenCandidateFromBlockResult({
      status: "succeeded",
      read_token_candidate: "ssot_rt_ok",
    }),
    "ssot_rt_ok"
  );
  assert.equal(
    extractReadTokenCandidateFromBlockResult({
      status: "failed",
      read_token_candidate: "ssot_rt_failed",
    }),
    ""
  );
  assert.equal(extractReadTokenCandidateFromBlockResult(null), "");
});


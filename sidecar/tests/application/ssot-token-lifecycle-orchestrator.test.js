"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTokenLifecycleOrchestrator,
} = require("../../src/application/ssotRuntime/tokenLifecycleOrchestrator");
const {
  SsotTokenRegistry,
} = require("../../src/application/ssotRuntime/ssotTokenRegistry");
const {
  SsotRevisionState,
} = require("../../src/application/ssotRuntime/ssotRevisionState");
const {
  createTokenPolicyRuntime,
} = require("../../src/application/ssotRuntime/tokenPolicyRuntime");

function createTokenPolicyRuntimeForTests() {
  return createTokenPolicyRuntime({
    manifest: {
      version: 1,
      generated_at: "",
      source: {},
      contract: {
        issuance_authority: "l2",
        token_families: [
          "read_issues_token",
          "write_requires_token",
          "local_static_no_token",
        ],
        success_continuation: ["read", "write"],
        drift_recovery: {
          enabled: true,
          error_code: "E_SCENE_REVISION_DRIFT",
          max_retry: 1,
          requires_idempotency: true,
          refresh_tool_name: "get_scene_snapshot_for_write",
        },
        redaction_policy: {
          strip_fields: [
            "read_token",
            "read_token_candidate",
            "read_token_candidate_legacy",
          ],
        },
        auto_retry_policy: {
          max_retry: 1,
          requires_idempotency_key: true,
          on_retry_failure: "return_both_errors",
        },
        auto_retry_safe_family: ["write_requires_token"],
      },
      tools: [
        {
          name: "modify_ui_layout",
          kind: "write",
          lifecycle: "stable",
          dispatch_mode: "ssot_query",
          token_family: "write_requires_token",
          scene_revision_capable: true,
          auto_retry_safe: true,
          requires_based_on_read_token: true,
          declares_based_on_read_token: true,
        },
        {
          name: "get_scene_roots",
          kind: "read",
          lifecycle: "stable",
          dispatch_mode: "ssot_query",
          token_family: "read_issues_token",
          scene_revision_capable: true,
          auto_retry_safe: false,
          requires_based_on_read_token: false,
          declares_based_on_read_token: false,
        },
      ],
    },
  });
}

test("token lifecycle orchestrator validates write token before dispatch", () => {
  const tokenRegistry = new SsotTokenRegistry();
  const revisionState = new SsotRevisionState();
  revisionState.updateLatestKnownSceneRevision("ssot_rev_orch_1", {
    source_tool_name: "test",
  });

  const orchestrator = createTokenLifecycleOrchestrator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    tokenRegistry,
    revisionState,
  });
  const blocked = orchestrator.validateBeforeDispatch({
    toolName: "modify_ui_layout",
    payload: {
      based_on_read_token: "ssot_rt_missing",
    },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error_code, "E_TOKEN_UNKNOWN");
  assert.equal(blocked.context.stage, "before_write");
});

test("token lifecycle orchestrator issues continuation token after successful write", () => {
  const tokenRegistry = new SsotTokenRegistry();
  const revisionState = new SsotRevisionState();
  revisionState.updateLatestKnownSceneRevision("ssot_rev_orch_100", {
    source_tool_name: "test",
  });

  const issued = tokenRegistry.issueToken({
    source_tool_name: "get_scene_snapshot_for_write",
    scene_revision: "ssot_rev_orch_100",
  });
  assert.equal(issued.ok, true);

  const orchestrator = createTokenLifecycleOrchestrator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    tokenRegistry,
    revisionState,
  });
  const validation = orchestrator.validateBeforeDispatch({
    toolName: "modify_ui_layout",
    payload: {
      based_on_read_token: issued.token,
    },
  });
  assert.equal(validation.ok, true);

  const finalized = orchestrator.finalizeDispatchResult({
    toolName: "modify_ui_layout",
    result: {
      ok: true,
      data: {
        scene_revision: "ssot_rev_orch_101",
        target_object_id: "go_target",
        target_path: "Scene/Canvas/Target",
        read_token_candidate: "legacy_candidate_should_be_replaced",
      },
    },
    requestId: "req_orch_1",
    threadId: "thread_orch_1",
    turnId: "turn_orch_1",
  });

  assert.equal(finalized.ok, true);
  assert.equal(finalized.data.scene_revision, "ssot_rev_orch_101");
  assert.equal(typeof finalized.data.read_token_candidate, "string");
  assert.equal(
    finalized.data.read_token_candidate.startsWith("ssot_rt_"),
    true
  );
  assert.notEqual(
    finalized.data.read_token_candidate,
    "legacy_candidate_should_be_replaced"
  );
  assert.equal(revisionState.getLatestKnownSceneRevision(), "ssot_rev_orch_101");
});

test("token lifecycle orchestrator strips token fields when auto issue disabled", () => {
  const orchestrator = createTokenLifecycleOrchestrator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    tokenAutoIssueEnabled: false,
    tokenRegistry: new SsotTokenRegistry(),
    revisionState: new SsotRevisionState(),
  });

  const finalized = orchestrator.finalizeDispatchResult({
    toolName: "get_scene_roots",
    result: {
      ok: true,
      data: {
        scene_revision: "ssot_rev_orch_roots_1",
        read_token_candidate: "legacy_candidate_should_be_removed",
      },
      read_token: {
        token: "ssot_rt_should_be_removed",
      },
    },
  });

  assert.equal(finalized.ok, true);
  assert.equal(
    Object.prototype.hasOwnProperty.call(finalized.data, "read_token_candidate"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(finalized, "read_token"),
    false
  );
});

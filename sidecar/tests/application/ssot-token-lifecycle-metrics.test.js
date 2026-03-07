"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createTokenLifecycleOrchestrator,
} = require("../../src/application/ssotRuntime/tokenLifecycleOrchestrator");
const {
  TokenLifecycleMetricsCollector,
} = require("../../src/application/ssotRuntime/tokenLifecycleMetricsCollector");
const {
  createTokenPolicyRuntime,
} = require("../../src/application/ssotRuntime/tokenPolicyRuntime");
const {
  SsotTokenRegistry,
} = require("../../src/application/ssotRuntime/ssotTokenRegistry");
const {
  SsotRevisionState,
} = require("../../src/application/ssotRuntime/ssotRevisionState");

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
          name: "get_tool_schema",
          kind: "read",
          lifecycle: "stable",
          dispatch_mode: "local_static",
          token_family: "local_static_no_token",
          scene_revision_capable: false,
          auto_retry_safe: false,
          requires_based_on_read_token: false,
          declares_based_on_read_token: false,
        },
      ],
    },
  });
}

test("token lifecycle metrics collector captures continuation/redaction/anomaly rates", () => {
  const metricsCollector = new TokenLifecycleMetricsCollector({
    nowIso: () => "2026-03-08T10:00:00.000Z",
  });
  const orchestrator = createTokenLifecycleOrchestrator({
    tokenPolicyRuntime: createTokenPolicyRuntimeForTests(),
    tokenRegistry: new SsotTokenRegistry(),
    revisionState: new SsotRevisionState(),
    metricsCollector,
    tokenAutoIssueEnabled: true,
  });

  orchestrator.finalizeDispatchResult({
    toolName: "modify_ui_layout",
    result: {
      ok: true,
      data: {
        scene_revision: "ssot_rev_metrics_1",
        target_object_id: "go_target_1",
        target_path: "Scene/Canvas/Target1",
        read_token_candidate: "legacy_candidate_1",
      },
    },
  });
  orchestrator.finalizeDispatchResult({
    toolName: "modify_ui_layout",
    result: {
      ok: true,
      data: {
        target_object_id: "go_target_2",
        target_path: "Scene/Canvas/Target2",
      },
    },
  });
  orchestrator.finalizeDispatchResult({
    toolName: "get_tool_schema",
    result: {
      ok: true,
      data: {
        read_token_candidate: "legacy_candidate_local_static",
      },
    },
  });

  const snapshot = metricsCollector.getSnapshot();
  assert.equal(snapshot.totals.events_total, 3);
  assert.equal(snapshot.totals.continuation_eligible_success_total, 2);
  assert.equal(snapshot.totals.continuation_issued_total, 1);
  assert.equal(snapshot.continuation_hit_rate, 0.5);
  assert.equal(snapshot.totals.redaction_candidates_total, 2);
  assert.equal(snapshot.totals.redaction_applied_total, 2);
  assert.equal(snapshot.redaction_hit_rate, 1);
  assert.equal(snapshot.totals.anomaly_total, 1);
  assert.equal(snapshot.anomaly_samples.length, 1);
  assert.equal(
    snapshot.anomaly_samples[0].anomaly_code,
    "CONTINUATION_SKIPPED_MISSING_SCENE_REVISION"
  );
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildObservabilityReport,
} = require("../../scripts/generate-g2-token-auto-issue-observability-report");

test("g2 auto-issue observability script parseArgs supports overrides", () => {
  const options = parseArgs([
    "--input",
    "./tmp/auto-issue-input.json",
    "--output",
    "./tmp/auto-issue-output.json",
    "--min-continuation-hit-rate",
    "0.92",
    "--min-redaction-hit-rate",
    "0.97",
    "--max-anomaly-count",
    "2",
    "--git-commit",
    "abc123",
    "--timestamp",
    "2026-03-08T10:00:00.000Z",
    "--ci",
  ]);

  assert.ok(
    options.inputPath.endsWith("tmp\\auto-issue-input.json") ||
      options.inputPath.endsWith("tmp/auto-issue-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\auto-issue-output.json") ||
      options.outputPath.endsWith("tmp/auto-issue-output.json")
  );
  assert.equal(options.minContinuationHitRate, 0.92);
  assert.equal(options.minRedactionHitRate, 0.97);
  assert.equal(options.maxAnomalyCount, 2);
  assert.equal(options.gitCommit, "abc123");
  assert.equal(options.timestamp, "2026-03-08T10:00:00.000Z");
  assert.equal(options.ci, true);
});

test("g2 auto-issue observability script computes hit rates and checks", () => {
  const report = buildObservabilityReport({
    inputPath: "./tmp/auto-issue-input.json",
    minContinuationHitRate: 0.8,
    minRedactionHitRate: 0.9,
    maxAnomalyCount: 1,
    gitCommit: "commit_001",
    timestamp: "2026-03-08T10:00:00.000Z",
    snapshot: {
      schema_version: "g2_token_auto_issue_samples.v1",
      events: [
        {
          sample_id: "evt_1",
          tool_name: "modify_ui_layout",
          token_family: "write_requires_token",
          continuation_eligible_success: true,
          continuation_issued: true,
          redaction_candidate: true,
          redaction_applied: true,
          finalize_duration_ms: 1,
          decision_reason: "eligible",
        },
        {
          sample_id: "evt_2",
          tool_name: "set_component_properties",
          token_family: "write_requires_token",
          continuation_eligible_success: true,
          continuation_issued: false,
          skipped_missing_scene_revision: true,
          redaction_candidate: false,
          redaction_applied: false,
          anomaly_code: "CONTINUATION_SKIPPED_MISSING_SCENE_REVISION",
          finalize_duration_ms: 1.2,
          decision_reason: "scene_revision_missing",
        },
        {
          sample_id: "evt_3",
          tool_name: "get_tool_schema",
          token_family: "local_static_no_token",
          continuation_eligible_success: false,
          continuation_issued: false,
          redaction_candidate: true,
          redaction_applied: true,
          finalize_duration_ms: 0.4,
          decision_reason: "token_family_not_eligible",
        },
      ],
    },
  });

  assert.equal(report.source.git_commit, "commit_001");
  assert.equal(report.source.sample_total, 3);
  assert.equal(report.metrics.continuation_eligible_success_total, 2);
  assert.equal(report.metrics.continuation_issued_total, 1);
  assert.equal(report.metrics.continuation_skipped_missing_scene_revision_total, 1);
  assert.equal(report.metrics.continuation_hit_rate, 0.5);
  assert.equal(report.metrics.continuation_issueable_total, 1);
  assert.equal(report.metrics.continuation_issueable_hit_rate, 1);
  assert.equal(report.metrics.redaction_candidates_total, 2);
  assert.equal(report.metrics.redaction_applied_total, 2);
  assert.equal(report.metrics.redaction_hit_rate, 1);
  assert.equal(report.metrics.anomaly_total, 1);
  assert.equal(report.anomaly_samples.length, 1);
  assert.equal(report.checks.length, 3);
  assert.equal(report.all_passed, true);
  assert.equal(
    report.checks.find((item) => item.id === "continuation_hit_rate").pass,
    true
  );
});

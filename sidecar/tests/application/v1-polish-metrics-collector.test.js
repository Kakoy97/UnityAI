"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  V1PolishMetricsCollector,
  METRICS_SCHEMA_VERSION,
} = require("../../src/application/v1PolishMetricsCollector");

function createMemorySnapshotStore() {
  let snapshot = null;
  return {
    loadSnapshot() {
      return snapshot;
    },
    saveSnapshot(next) {
      snapshot = JSON.parse(JSON.stringify(next));
      return true;
    },
    inspect() {
      return snapshot;
    },
  };
}

test("collector aggregates write/read/finalize metrics and derived ratios", () => {
  const store = createMemorySnapshotStore();
  const nowMs = Date.parse("2026-03-02T08:00:00.000Z");
  const collector = new V1PolishMetricsCollector({
    nowMs: () => nowMs,
    snapshotStore: store,
    storagePath: ".state/v1-polish-metrics.json",
    retentionDays: 7,
    topN: 5,
  });

  collector.recordToolInvocation({
    command_name: "set_serialized_property",
    command_kind: "write",
    payload: {
      dry_run: true,
      patches: [
        { property_path: "m_Text", value_kind: "string", op: "set" },
        { property_path: "m_Text", value_kind: "string", op: "set" },
        { property_path: "m_FontSize", value_kind: "integer" },
      ],
    },
  });
  collector.recordReadTokenValidation({
    ok: false,
    error_code: "E_STALE_SNAPSHOT",
    message: "based_on_read_token exceeded hard_max_age_ms",
  });
  collector.recordWriteJobFinalized({
    status: "failed",
    error_code: "E_COMPOSITE_ROLLBACK_INCOMPLETE",
    runtime: {
      visual_actions: [{ type: "composite_visual_action" }],
    },
  });

  const snapshot = collector.getSnapshot();
  assert.equal(snapshot.schema_version, METRICS_SCHEMA_VERSION);
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.counters.tool_calls_total, 1);
  assert.equal(snapshot.counters.write_tool_calls_total, 1);
  assert.equal(snapshot.counters.generalized_write_total, 1);
  assert.equal(snapshot.counters.primitive_write_total, 0);
  assert.equal(snapshot.counters.property_path_samples_total, 3);
  assert.equal(snapshot.counters.dry_run_total, 1);
  assert.equal(snapshot.counters.read_token_checks_total, 1);
  assert.equal(snapshot.counters.read_token_fail_total, 1);
  assert.equal(snapshot.counters.read_token_expiry_total, 1);
  assert.equal(snapshot.counters.write_jobs_finalized_total, 1);
  assert.equal(snapshot.counters.write_jobs_failed_total, 1);
  assert.equal(snapshot.counters.write_jobs_rollback_inferred_total, 1);

  assert.equal(snapshot.derived.avg_tool_calls_per_task, 1);
  assert.equal(snapshot.derived.read_token_expiry_rate, 1);
  assert.equal(snapshot.derived.dry_run_usage_rate, 1);
  assert.equal(snapshot.derived.write_rollback_rate, 1);

  assert.deepEqual(snapshot.top_property_paths[0], {
    property_path: "m_Text",
    count: 2,
  });
  assert.deepEqual(snapshot.top_value_kinds[0], {
    value_kind: "string",
    count: 2,
  });
  assert.deepEqual(snapshot.top_array_ops[0], {
    op: "set",
    count: 2,
  });
  assert.equal(snapshot.by_tool[0].tool_name, "set_serialized_property");
  assert.equal(snapshot.by_tool[0].dry_run_calls, 1);
});

test("collector enforces retention window by day bucket", () => {
  const store = createMemorySnapshotStore();
  let nowMs = Date.parse("2026-03-01T01:00:00.000Z");
  const collector = new V1PolishMetricsCollector({
    nowMs: () => nowMs,
    snapshotStore: store,
    retentionDays: 2,
  });

  collector.recordToolInvocation({
    command_name: "set_serialized_property",
    command_kind: "write",
    payload: {
      patches: [{ property_path: "m_Text", value_kind: "string" }],
    },
  });

  nowMs = Date.parse("2026-03-04T01:00:00.000Z");
  collector.recordToolInvocation({
    command_name: "set_serialized_property",
    command_kind: "write",
    payload: {
      patches: [{ property_path: "m_FontSize", value_kind: "integer" }],
    },
  });

  const snapshot = collector.getSnapshot();
  assert.equal(snapshot.counters.tool_calls_total, 1);
  assert.equal(snapshot.counters.property_path_samples_total, 1);
  assert.equal(snapshot.top_property_paths.length, 1);
  assert.equal(snapshot.top_property_paths[0].property_path, "m_FontSize");
});

test("collector restores persisted day buckets on startup", () => {
  const store = createMemorySnapshotStore();
  const nowMs = Date.parse("2026-03-02T09:00:00.000Z");
  const firstCollector = new V1PolishMetricsCollector({
    nowMs: () => nowMs,
    snapshotStore: store,
  });
  firstCollector.recordToolInvocation({
    command_name: "apply_visual_actions",
    command_kind: "write",
    payload: {
      actions: [
        {
          type: "set_serialized_property",
          action_data: {
            patches: [{ property_path: "m_Color", value_kind: "color" }],
          },
        },
      ],
    },
  });

  const secondCollector = new V1PolishMetricsCollector({
    nowMs: () => nowMs,
    snapshotStore: store,
  });
  const snapshot = secondCollector.getSnapshot();
  assert.equal(snapshot.counters.tool_calls_total, 1);
  assert.equal(snapshot.counters.generalized_write_total, 1);
  assert.equal(snapshot.top_property_paths[0].property_path, "m_Color");
});


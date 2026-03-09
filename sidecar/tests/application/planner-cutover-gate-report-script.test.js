"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildPlannerCutoverGateReport,
} = require("../../scripts/generate-planner-cutover-gate-report");

function buildDailyRows({ aliasPerDay = 1, plannerPerDay = 300 } = {}) {
  const rows = [];
  const base = new Date("2026-02-23T00:00:00.000Z");
  for (let i = 0; i < 14; i += 1) {
    const next = new Date(base.getTime() + i * 86400000);
    rows.push({
      date: next.toISOString().slice(0, 10),
      planner_entry_call_total: plannerPerDay,
      planner_entry_alias_call_total:
        typeof aliasPerDay === "function" ? aliasPerDay(i) : aliasPerDay,
      p1_incident_count: 0,
    });
  }
  return rows;
}

test("planner cutover gate script parseArgs supports input/output/ci", () => {
  const options = parseArgs([
    "--input",
    "./tmp/planner-cutover-input.json",
    "--output",
    "./tmp/planner-cutover-output.json",
    "--ci",
  ]);
  assert.ok(
    options.inputPath.endsWith("tmp\\planner-cutover-input.json") ||
      options.inputPath.endsWith("tmp/planner-cutover-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\planner-cutover-output.json") ||
      options.outputPath.endsWith("tmp/planner-cutover-output.json")
  );
  assert.equal(options.ci, true);
});

test("PLNR-STEP6 cutover report passes when Step C/D + reject default + alias gate all satisfy", () => {
  const report = buildPlannerCutoverGateReport({
    snapshot: {
      mcp_runtime: {
        planner_visibility_profile: {
          requested_profile: "planner_first",
          active_profile: "planner_first",
          reason: "planner_first_enabled",
          gate: { passed: true, reasons: [] },
          rollback: { triggered: false, reasons: [] },
        },
        planner_direct_compatibility: {
          policy_state: {
            requested_mode: "deny",
            active_mode: "deny",
            reason: "deny_enabled",
            deny_gate: { passed: true, reasons: [] },
            rollback: { triggered: false, reasons: [] },
          },
          totals: {
            decisions_total: 40,
            allow_total: 0,
            warn_total: 0,
            deny_total: 40,
          },
        },
        planner_only_exposure: {
          policy_state: {
            enabled: true,
            requested_mode: "reject",
            active_mode: "reject",
          },
          counters: {
            planner_entry_call_total: 400,
            planner_entry_alias_call_total: 0,
            external_direct_runtime_call_total: 0,
          },
        },
      },
    },
    alias_retirement_window: {
      required_consecutive_days: 14,
      alias_share_max: 0.01,
      required_release_windows: 2,
      p1_incident_max: 0,
      announcement_published: true,
      release_windows_completed: 2,
      daily: buildDailyRows({
        aliasPerDay: (index) => (index % 4 === 0 ? 2 : 1),
      }),
    },
  });

  assert.equal(report.schema_version, "planner_cutover_gate_report.v1");
  assert.equal(report.all_passed, true);
  assert.equal(report.recommendation, "eligible_for_step6_cutover_complete");
});

test("PLNR-STEP6 cutover report fails when external direct or alias gate is not satisfied", () => {
  const report = buildPlannerCutoverGateReport({
    snapshot: {
      mcp_runtime: {
        planner_visibility_profile: {
          requested_profile: "planner_first",
          active_profile: "planner_first",
          reason: "planner_first_enabled",
          gate: { passed: true, reasons: [] },
          rollback: { triggered: false, reasons: [] },
        },
        planner_direct_compatibility: {
          policy_state: {
            requested_mode: "deny",
            active_mode: "deny",
            reason: "deny_enabled",
            deny_gate: { passed: true, reasons: [] },
            rollback: { triggered: false, reasons: [] },
          },
        },
        planner_only_exposure: {
          policy_state: {
            enabled: true,
            requested_mode: "reject",
            active_mode: "reject",
          },
          counters: {
            planner_entry_call_total: 120,
            planner_entry_alias_call_total: 3,
            external_direct_runtime_call_total: 6,
          },
        },
      },
    },
    alias_retirement_window: {
      required_consecutive_days: 14,
      alias_share_max: 0.01,
      required_release_windows: 2,
      p1_incident_max: 0,
      announcement_published: false,
      release_windows_completed: 1,
      daily: buildDailyRows({
        aliasPerDay: (index) => (index === 13 ? 5 : 1),
        plannerPerDay: 100,
      }),
    },
  });

  assert.equal(report.all_passed, false);
  const failedKeys = report.checks
    .filter((item) => item.pass !== true)
    .map((item) => item.key);
  assert.equal(
    failedKeys.includes("external_direct_runtime_call_total_zero"),
    true
  );
  assert.equal(failedKeys.includes("planner_alias_call_total_zero"), true);
  assert.equal(failedKeys.includes("alias_retirement_gate_all_passed"), true);
  assert.equal(report.recommendation, "keep_cutover_observing");
});

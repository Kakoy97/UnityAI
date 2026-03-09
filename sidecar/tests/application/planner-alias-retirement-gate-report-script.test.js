"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildPlannerAliasRetirementGateReport,
} = require("../../scripts/generate-planner-alias-retirement-gate-report");

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

test("planner alias retirement gate script parseArgs supports input/output/ci", () => {
  const options = parseArgs([
    "--input",
    "./tmp/planner-alias-input.json",
    "--output",
    "./tmp/planner-alias-output.json",
    "--ci",
  ]);
  assert.ok(
    options.inputPath.endsWith("tmp\\planner-alias-input.json") ||
      options.inputPath.endsWith("tmp/planner-alias-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\planner-alias-output.json") ||
      options.outputPath.endsWith("tmp/planner-alias-output.json")
  );
  assert.equal(options.ci, true);
});

test("PLNR-009 alias retirement gate report passes when <1%/14d/2-windows/no-P1 are satisfied", () => {
  const report = buildPlannerAliasRetirementGateReport({
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

  assert.equal(report.schema_version, "planner_alias_retirement_gate_report.v1");
  assert.equal(report.all_passed, true);
  assert.equal(report.recommendation, "eligible_for_alias_removal");
});

test("PLNR-009 alias retirement gate report fails when threshold/window gates are not met", () => {
  const report = buildPlannerAliasRetirementGateReport({
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
  assert.equal(failedKeys.includes("alias_share_below_threshold"), true);
  assert.equal(
    failedKeys.includes("alias_retirement_announcement_published"),
    true
  );
  assert.equal(
    failedKeys.includes("alias_retirement_release_windows_completed"),
    true
  );
  assert.equal(report.recommendation, "keep_alias_for_compat");
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildPlannerStepCdGateReport,
} = require("../../scripts/generate-planner-stepcd-gate-report");

test("planner step C/D gate script parseArgs supports input/output/ci", () => {
  const options = parseArgs([
    "--input",
    "./tmp/planner-stepcd-input.json",
    "--output",
    "./tmp/planner-stepcd-output.json",
    "--ci",
  ]);
  assert.ok(
    options.inputPath.endsWith("tmp\\planner-stepcd-input.json") ||
      options.inputPath.endsWith("tmp/planner-stepcd-input.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\planner-stepcd-output.json") ||
      options.outputPath.endsWith("tmp/planner-stepcd-output.json")
  );
  assert.equal(options.ci, true);
});

test("planner step C/D gate report passes coherent planner_first + deny state", () => {
  const report = buildPlannerStepCdGateReport({
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
            decisions_total: 20,
            allow_total: 0,
            warn_total: 3,
            deny_total: 17,
          },
          by_family: [
            {
              family_key: "write.rect_layout",
              decisions_total: 20,
              allow_total: 0,
              warn_total: 3,
              deny_total: 17,
            },
          ],
        },
      },
    },
  });
  assert.equal(report.schema_version, "planner_stepcd_gate_report.v1");
  assert.equal(report.step_c.active_profile, "planner_first");
  assert.equal(report.step_d.policy_state.active_mode, "deny");
  assert.equal(report.all_passed, true);
});

test("planner step C/D gate report fails incoherent deny transition", () => {
  const report = buildPlannerStepCdGateReport({
    snapshot: {
      mcp_runtime: {
        planner_visibility_profile: {
          requested_profile: "planner_first",
          active_profile: "legacy_full",
          reason: "planner_first_enabled",
          gate: { passed: true, reasons: [] },
          rollback: { triggered: false, reasons: [] },
        },
        planner_direct_compatibility: {
          policy_state: {
            requested_mode: "deny",
            active_mode: "deny",
            reason: "deny_enabled",
            deny_gate: { passed: false, reasons: ["planner_success_rate_for_deny_below_min"] },
            rollback: { triggered: false, reasons: [] },
          },
          totals: {
            decisions_total: 5,
            allow_total: 5,
            warn_total: 0,
            deny_total: 0,
          },
        },
      },
    },
  });
  assert.equal(report.all_passed, false);
  const failedKeys = report.checks
    .filter((item) => item.pass !== true)
    .map((item) => item.key);
  assert.equal(failedKeys.includes("step_c_profile_transition_coherent"), true);
  assert.equal(failedKeys.includes("step_d_mode_transition_coherent"), true);
});


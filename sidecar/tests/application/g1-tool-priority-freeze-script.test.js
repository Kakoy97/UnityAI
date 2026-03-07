"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildPriorityFreeze,
  applyFreezeToDictionary,
} = require("../../scripts/generate-g1-tool-priority-freeze");

function buildBaselineFixture() {
  return {
    schema_version: "g1_baseline_metrics_report.v1",
    generated_at: "2026-03-07T08:00:00.000Z",
    source: {
      git_commit: "commit-x",
    },
    representativeness: {
      all_passed: true,
      checks: [
        { id: "required_scenario_types_present", pass: true },
        { id: "min_samples_per_scenario", pass: true },
      ],
    },
    tool_priority: {
      tools: [
        {
          tool_name: "execute_unity_transaction",
          priority: "P0",
          score: 0.4,
          call_ratio: 0.3,
          error_ratio: 0.5,
          call_count: 12,
          error_count: 5,
        },
        {
          tool_name: "save_scene",
          priority: "P1",
          score: 0.08,
          call_ratio: 0.1,
          error_ratio: 0.05,
          call_count: 4,
          error_count: 1,
        },
      ],
    },
  };
}

function buildDictionaryFixture() {
  return {
    version: "1.0.0",
    _definitions: {},
    compiler: {},
    tools: [
      {
        name: "execute_unity_transaction",
        kind: "write",
        transaction: {
          enabled: true,
          undo_safe: true,
        },
        input: {},
      },
      {
        name: "save_scene",
        kind: "write",
        transaction: {
          enabled: true,
          undo_safe: true,
        },
        input: {},
      },
      {
        name: "create_object",
        kind: "write",
        transaction: {
          enabled: true,
          undo_safe: true,
        },
        input: {},
      },
    ],
  };
}

test("g1 priority freeze parseArgs supports dictionary write option", () => {
  const options = parseArgs([
    "--baseline",
    "./tmp/baseline.json",
    "--output",
    "./tmp/freeze.json",
    "--dictionary",
    "./tmp/tools.json",
    "--write-dictionary",
    "--allow-representativeness-fail",
  ]);
  assert.ok(
    options.baselinePath.endsWith("tmp\\baseline.json") ||
      options.baselinePath.endsWith("tmp/baseline.json")
  );
  assert.ok(
    options.outputPath.endsWith("tmp\\freeze.json") ||
      options.outputPath.endsWith("tmp/freeze.json")
  );
  assert.ok(
    options.dictionaryPath.endsWith("tmp\\tools.json") ||
      options.dictionaryPath.endsWith("tmp/tools.json")
  );
  assert.equal(options.writeDictionary, true);
  assert.equal(options.allowRepresentativenessFail, true);
});

test("g1 priority freeze builds p0/p1/p2 list with default p2 for unobserved tools", () => {
  const freeze = buildPriorityFreeze(buildBaselineFixture(), buildDictionaryFixture(), {});
  assert.equal(freeze.schema_version, "g1_tool_priority_freeze.v1");
  assert.deepEqual(freeze.p0_tools, ["execute_unity_transaction"]);
  assert.deepEqual(freeze.p1_tools, ["save_scene"]);
  assert.ok(freeze.p2_tools.includes("create_object"));
  assert.ok(freeze.unobserved_tools.includes("create_object"));

  const createRow = freeze.tools.find((item) => item.tool_name === "create_object");
  assert.ok(createRow);
  assert.equal(createRow.tool_priority, "P2");
  assert.equal(createRow.must_configure, false);
  assert.equal(createRow.observed_in_baseline, false);
});

test("g1 priority freeze rejects unknown baseline tools", () => {
  const baseline = buildBaselineFixture();
  baseline.tool_priority.tools.push({
    tool_name: "tool_missing_in_dictionary",
    priority: "P0",
    score: 0.2,
  });
  assert.throws(
    () => buildPriorityFreeze(baseline, buildDictionaryFixture(), {}),
    /Baseline contains tools absent in dictionary/
  );
});

test("g1 priority freeze can write tool_priority back into dictionary", () => {
  const freeze = buildPriorityFreeze(buildBaselineFixture(), buildDictionaryFixture(), {});
  const dictionary = buildDictionaryFixture();
  const updated = applyFreezeToDictionary(dictionary, freeze);
  const transactionTool = updated.tools.find(
    (tool) => tool.name === "execute_unity_transaction"
  );
  const createTool = updated.tools.find((tool) => tool.name === "create_object");
  assert.equal(transactionTool.tool_priority, "P0");
  assert.equal(transactionTool.must_configure, true);
  assert.equal(typeof transactionTool.priority_score, "number");
  assert.equal(createTool.tool_priority, "P2");
  assert.equal(createTool.must_configure, false);
  assert.ok(updated._definitions.g1_priority_freeze);
});


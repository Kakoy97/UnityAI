"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  buildPrimitiveCandidateReport,
  suggestPrimitiveName,
} = require("../../scripts/generate-v1-polish-primitive-report");

test("primitive report script parseArgs applies defaults", () => {
  const options = parseArgs([]);
  assert.equal(typeof options.inputPath, "string");
  assert.equal(typeof options.outputPath, "string");
  assert.equal(options.topN, 20);
  assert.equal(options.minCount, 2);
  assert.equal(options.ci, false);
});

test("primitive report script parseArgs handles overrides", () => {
  const options = parseArgs([
    "--input",
    "./tmp/input.json",
    "--output",
    "./tmp/output.json",
    "--top",
    "8",
    "--min-count",
    "3",
    "--ci",
  ]);
  assert.ok(options.inputPath.endsWith("tmp\\input.json") || options.inputPath.endsWith("tmp/input.json"));
  assert.ok(options.outputPath.endsWith("tmp\\output.json") || options.outputPath.endsWith("tmp/output.json"));
  assert.equal(options.topN, 8);
  assert.equal(options.minCount, 3);
  assert.equal(options.ci, true);
});

test("primitive report script builds sorted TopN candidates", () => {
  const report = buildPrimitiveCandidateReport(
    {
      schema_version: "v1_polish_metrics.v1",
      retention_days: 7,
      daily_buckets: {
        "2026-03-01": {
          counters: {
            property_path_samples_total: 8,
          },
          property_path_frequency: {
            m_Text: 4,
            m_FontSize: 2,
            m_Color: 2,
          },
        },
      },
    },
    {
      topN: 2,
      minCount: 2,
    }
  );

  assert.equal(report.summary.total_property_path_samples, 8);
  assert.equal(report.summary.candidate_count, 2);
  assert.equal(report.candidates[0].property_path, "m_Text");
  assert.equal(report.candidates[0].hit_count, 4);
  assert.equal(report.candidates[0].hit_ratio_pct, 50);
  assert.equal(report.candidates[1].property_path, "m_Color");
});

test("suggestPrimitiveName normalizes common serialized paths", () => {
  assert.equal(suggestPrimitiveName("m_Text"), "set_text");
  assert.equal(
    suggestPrimitiveName("m_Points.Array.data[0].x"),
    "set_points_x"
  );
});


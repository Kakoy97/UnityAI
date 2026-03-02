"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseArgs,
  summarizeTopStrategies,
} = require("../../scripts/diagnose-ui-specialist");

test("diagnose-ui-specialist parseArgs applies defaults and flags", () => {
  const options = parseArgs(["--strict", "--skip-catalog"]);
  assert.equal(options.baseUrl, "http://127.0.0.1:46321");
  assert.equal(options.width, 1920);
  assert.equal(options.height, 1080);
  assert.equal(options.maxRepairSuggestions, 6);
  assert.equal(options.repairStyle, "balanced");
  assert.equal(options.strict, true);
  assert.equal(options.skipCatalog, true);
});

test("diagnose-ui-specialist parseArgs normalizes repair style and suggestion limit", () => {
  const options = parseArgs([
    "--repair-style",
    "aggressive",
    "--max-repair-suggestions",
    "999",
    "--width",
    "1366",
    "--height",
    "768",
  ]);
  assert.equal(options.repairStyle, "aggressive");
  assert.equal(options.maxRepairSuggestions, 20);
  assert.equal(options.width, 1366);
  assert.equal(options.height, 768);
});

test("diagnose-ui-specialist summarizeTopStrategies aggregates strategy counts", () => {
  const summary = summarizeTopStrategies([
    { strategy: "separate_by_position" },
    { strategy: "reduce_font_size" },
    { strategy: "separate_by_position" },
    { strategy: "reduce_font_size" },
    { strategy: "reduce_font_size" },
  ]);

  assert.deepEqual(summary, [
    { strategy: "reduce_font_size", count: 3 },
    { strategy: "separate_by_position", count: 2 },
  ]);
});

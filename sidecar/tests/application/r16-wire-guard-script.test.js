"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { runGuard } = require("../../scripts/r16-wire-guard");

test("R16 wire guard reports wire status and atomic coverage structure", () => {
  const result = runGuard();
  assert.ok(result && typeof result === "object");
  assert.equal(result.ok, true, (result.failures || []).join("\n"));
  assert.ok(result.report && typeof result.report === "object");
  assert.ok(result.report.wire && typeof result.report.wire === "object");
  assert.ok(
    result.report.atomic_coverage &&
      Array.isArray(result.report.atomic_coverage.atomic_action_types)
  );
  assert.ok(
    Array.isArray(result.report.atomic_coverage.covered_action_types)
  );
  assert.ok(
    Array.isArray(result.report.atomic_coverage.missing_action_types)
  );
});

test("R16 wire guard strict mode turns missing atomic coverage into hard failures", () => {
  const result = runGuard({ strictAtomic: true });
  assert.ok(result && typeof result === "object");
  assert.ok(Array.isArray(result.failures));
  if (
    result.report &&
    result.report.atomic_coverage &&
    Array.isArray(result.report.atomic_coverage.missing_action_types) &&
    result.report.atomic_coverage.missing_action_types.length > 0
  ) {
    assert.equal(result.ok, false);
  }
});

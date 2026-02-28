"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const {
  resetMcpErrorFeedbackMetrics,
} = require("../../src/application/mcpGateway/mcpErrorFeedback");

function createService() {
  const turnStore = new TurnStore({ maintenanceIntervalMs: 60000 });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso: () => new Date().toISOString(),
    enableMcpAdapter: true,
    enableMcpEyes: true,
    fileActionExecutor: {
      execute() {
        return { ok: true, changes: [] };
      },
    },
  });
}

test.beforeEach(() => {
  resetMcpErrorFeedbackMetrics();
});

test("/mcp/metrics snapshot includes error feedback counters", () => {
  const service = createService();

  const rejectOutcome = service.submitUnityTask(null);
  assert.equal(rejectOutcome.statusCode, 400);

  const metricsOutcome = service.getMcpMetrics();
  assert.equal(metricsOutcome.statusCode, 200);
  assert.ok(metricsOutcome.body.error_feedback_normalized_total >= 1);
  assert.ok(metricsOutcome.body.error_feedback_by_code.E_SCHEMA_INVALID >= 1);
  assert.equal(
    typeof metricsOutcome.body.error_stack_sanitized_total,
    "number"
  );
  assert.equal(typeof metricsOutcome.body.error_path_sanitized_total, "number");
});

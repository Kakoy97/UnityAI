"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { McpGateway } = require("../../src/application/mcpGateway/mcpGateway");

test("normalizeUnityActionResultBody does not backfill payload.action.type", () => {
  const gateway = new McpGateway({
    enableMcpAdapter: false,
    nowIso: () => "2026-02-28T00:00:00.000Z",
  });

  const normalized = gateway.normalizeUnityActionResultBody({
    payload: {
      action: {
        type: "add_component",
      },
      success: true,
      error_message: "",
    },
  });

  assert.equal(normalized.payload.action_type, "");
});

test("normalizeUnityActionResultBody infers E_ACTION_HANDLER_NOT_FOUND when error_code is missing", () => {
  const gateway = new McpGateway({
    enableMcpAdapter: false,
    nowIso: () => "2026-02-28T00:00:00.000Z",
  });

  const normalized = gateway.normalizeUnityActionResultBody({
    payload: {
      action_type: "set_rect_transform",
      success: false,
      error_message: "No handler registered for action_type set_rect_transform",
    },
  });

  assert.equal(normalized.payload.error_code, "E_ACTION_HANDLER_NOT_FOUND");
});

test("normalizeUnityActionResultBody keeps explicit error_code over inferred fallback", () => {
  const gateway = new McpGateway({
    enableMcpAdapter: false,
    nowIso: () => "2026-02-28T00:00:00.000Z",
  });

  const normalized = gateway.normalizeUnityActionResultBody({
    payload: {
      action_type: "set_rect_transform",
      success: false,
      error_code: "E_ACTION_PAYLOAD_INVALID",
      error_message: "No handler registered for action_type set_rect_transform",
    },
  });

  assert.equal(normalized.payload.error_code, "E_ACTION_PAYLOAD_INVALID");
});

test("normalizeUnityActionResultBody uses missing-code marker when Unity omits error_code", () => {
  const gateway = new McpGateway({
    enableMcpAdapter: false,
    nowIso: () => "2026-02-28T00:00:00.000Z",
  });

  const normalized = gateway.normalizeUnityActionResultBody({
    payload: {
      action_type: "set_rect_transform",
      success: false,
      error_message: "Unexpected runtime failure",
    },
  });

  assert.equal(
    normalized.payload.error_code,
    "E_ACTION_RESULT_MISSING_ERROR_CODE"
  );
  const metrics = gateway.getMcpMetrics();
  assert.equal(metrics.action_error_code_missing_total, 1);
});

test("resolveApprovalModeByRequestId ignores legacy mcpJobsById compatibility map", () => {
  const gateway = new McpGateway({
    enableMcpAdapter: false,
    nowIso: () => "2026-02-28T00:00:00.000Z",
  });

  gateway.mcpJobsById = new Map([
    [
      "legacy_job_1",
      {
        request_id: "legacy_req_1",
        approval_mode: "auto",
      },
    ],
  ]);

  assert.equal(gateway.resolveApprovalModeByRequestId("legacy_req_1"), "require_user");
});

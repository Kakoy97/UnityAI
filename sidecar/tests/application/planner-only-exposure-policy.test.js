"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createPlannerOnlyExposurePolicy,
} = require("../../src/mcp/plannerOnlyExposurePolicy");

test("PLNR-005 plannerOnlyExposurePolicy emits unified reject envelope and tracks reject metrics", () => {
  const policy = createPlannerOnlyExposurePolicy({
    entry_governance_state: {
      enabled: true,
      requested_mode: "reject",
      active_mode: "reject",
      planner_primary_tool_name: "planner_execute_mcp",
      planner_alias_tool_name: "execute_block_spec_mvp",
    },
    local_static_tool_name_set: new Set(["planner_execute_mcp", "get_tool_schema"]),
    managed_tool_family_map: {
      set_parent: "write.hierarchy.parent",
    },
  });

  const tracking = policy.beginToolCall({
    tool_name: "set_parent",
    args: {
      _meta: {
        client_version: "client-1",
      },
    },
    entry_decision: {
      mode: "reject",
      decision: "deny",
      reason: "external_direct_runtime_rejected",
    },
  });

  const rejectError = policy.getExternalDirectRejectError("set_parent");
  assert.equal(rejectError.error_code, "E_USE_PLANNER_ENTRY");
  assert.equal(
    rejectError.error_message,
    "E_USE_PLANNER_ENTRY: external direct runtime tool is blocked by MCP entry governance: set_parent; use planner_execute_mcp"
  );

  policy.completeToolCall(tracking, {
    error: true,
    dispatch_result: {
      status: "failed",
      error_code: rejectError.error_code,
    },
  });

  const controlPlaneTracking = policy.beginToolCall({
    tool_name: "get_tool_schema",
    args: {
      _meta: {
        client_version: "client-1",
      },
    },
    entry_decision: {
      mode: "reject",
      decision: "allow",
      reason: "control_support_plane_tool",
    },
  });
  policy.completeToolCall(controlPlaneTracking, {
    dispatch_result: {
      ok: true,
      dispatched_tool: "get_tool_schema",
    },
  });

  const plannerTracking = policy.beginToolCall({
    tool_name: "planner_execute_mcp",
    args: {
      _meta: {
        client_version: "client-1",
      },
    },
    entry_decision: {
      mode: "reject",
      decision: "allow",
      reason: "planner_entry_tool",
    },
  });
  policy.completeToolCall(plannerTracking, {
    dispatch_result: {
      ok: true,
      dispatched_tool: "planner_execute_mcp",
    },
  });
  const plannerAliasTracking = policy.beginToolCall({
    tool_name: "execute_block_spec_mvp",
    args: {
      _meta: {
        client_version: "client-1",
      },
    },
    entry_decision: {
      mode: "reject",
      decision: "allow",
      reason: "planner_entry_tool",
    },
  });
  policy.completeToolCall(plannerAliasTracking, {
    dispatch_result: {
      ok: true,
      dispatched_tool: "execute_block_spec_mvp",
    },
  });

  const snapshot = policy.getSnapshot();
  assert.equal(snapshot.metrics.external_direct_runtime_call_total, 1);
  assert.equal(snapshot.metrics.external_direct_runtime_unique_clients, 1);
  assert.equal(snapshot.metrics.external_direct_runtime_error_rate, 1);
  assert.equal(snapshot.metrics.planner_redirect_adoption_rate, 0);
  assert.equal(snapshot.metrics.planner_alias_call_share, 0.5);
  assert.equal(snapshot.counters.observe_prompt_total, 0);
  assert.equal(snapshot.counters.planner_entry_call_total, 2);
  assert.equal(snapshot.counters.planner_entry_primary_call_total, 1);
  assert.equal(snapshot.counters.planner_entry_alias_call_total, 1);

  const byTool = Array.isArray(snapshot.breakdown.by_tool)
    ? snapshot.breakdown.by_tool
    : [];
  const plannerEntryByTool = byTool.find(
    (item) => item && item.tool_name === "planner_execute_mcp"
  );
  const plannerAliasByTool = byTool.find(
    (item) => item && item.tool_name === "execute_block_spec_mvp"
  );
  assert.ok(plannerEntryByTool);
  assert.ok(plannerAliasByTool);
  assert.equal(plannerEntryByTool.planner_entry_primary_call_total, 1);
  assert.equal(plannerAliasByTool.planner_entry_alias_call_total, 1);
});

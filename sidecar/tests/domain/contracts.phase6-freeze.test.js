"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  OBSERVABILITY_FREEZE_CONTRACT,
} = require("../../src/ports/contracts");

test("phase6 router freeze contract keeps active/deprecated MCP tools disjoint", () => {
  const active = new Set(
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names)
      ? ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names
      : []
  );
  const deprecated = new Set(
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names)
      ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names
      : []
  );

  assert.ok(active.size > 0);
  assert.ok(deprecated.size > 0);
  for (const item of deprecated) {
    assert.equal(active.has(item), false, `deprecated tool is still active: ${item}`);
  }
});

test("phase6 observability freeze contract exports required version markers", () => {
  assert.equal(
    OBSERVABILITY_FREEZE_CONTRACT.metrics_contract_version,
    "mcp.metrics.v1"
  );
  assert.equal(
    OBSERVABILITY_FREEZE_CONTRACT.stream_event_contract_version,
    "mcp.stream.event.v1"
  );
  assert.equal(
    OBSERVABILITY_FREEZE_CONTRACT.stream_ready_contract_version,
    "mcp.stream.ready.v1"
  );
  assert.ok(
    Array.isArray(OBSERVABILITY_FREEZE_CONTRACT.frozen_metrics_fields) &&
      OBSERVABILITY_FREEZE_CONTRACT.frozen_metrics_fields.includes(
        "metrics_contract_version"
      )
  );
  assert.ok(
    Array.isArray(OBSERVABILITY_FREEZE_CONTRACT.frozen_stream_event_fields) &&
      OBSERVABILITY_FREEZE_CONTRACT.frozen_stream_event_fields.includes(
        "stream_event_contract_version"
      )
  );
  assert.ok(
    Array.isArray(OBSERVABILITY_FREEZE_CONTRACT.frozen_stream_ready_fields) &&
      OBSERVABILITY_FREEZE_CONTRACT.frozen_stream_ready_fields.includes(
        "stream_ready_contract_version"
      )
  );
});

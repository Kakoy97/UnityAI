"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");

async function dispatchBodyCommand(registry, path, body, turnService) {
  return registry.dispatchHttpCommand({
    method: "POST",
    path,
    url: new URL(`http://127.0.0.1:46321${path}`),
    req: {},
    readJsonBody: async () => body,
    turnService,
  });
}

function createMockTurnService() {
  return {
    capabilityStore: {
      getActionSchema() {
        return {
          ok: true,
          action_type: "rename_object",
          action: {
            type: "rename_object",
            anchor_policy: "target_required",
            action_data_schema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
              },
            },
          },
          schema_hint: {
            type: "object",
            required: ["name"],
          },
        };
      },
      getSnapshot() {
        return {
          capability_version: "sha256:capability_mock_v1",
          unity_connection_state: "ready",
        };
      },
    },
    queryCoordinator: {},
    unitySnapshotService: {},
    nowIso: () => "2026-03-04T00:00:00.000Z",
  };
}

test("R20-UX-GOV-08 preflight tool lifecycle is stable with dry_run compatibility guidance", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_tool_schema",
    {
      tool_name: "preflight_validate_write_payload",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "preflight_validate_write_payload");
  assert.equal(outcome.body.lifecycle, "stable");
  assert.ok(outcome.body.dry_run_alias_compatibility);
  assert.equal(
    outcome.body.dry_run_alias_compatibility.preferred_tool,
    "preflight_validate_write_payload"
  );
  assert.equal(outcome.body.lifecycle_status, "stable");
});

test("R20-UX-GOV-08 write tool schema includes preflight migration guidance", async () => {
  const registry = getMcpCommandRegistry();
  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_tool_schema",
    {
      tool_name: "apply_visual_actions",
    },
    createMockTurnService()
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "apply_visual_actions");
  assert.ok(outcome.body.dry_run_alias_compatibility);
  assert.equal(
    outcome.body.dry_run_alias_compatibility.status,
    "deprecated_alias_supported"
  );
  assert.ok(outcome.body.preferred_preflight_entry);
  assert.equal(
    outcome.body.preferred_preflight_entry.tool,
    "preflight_validate_write_payload"
  );
});

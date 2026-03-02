"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");

function createRegistry() {
  return getMcpCommandRegistry();
}

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

test("R11-L2-06 get_action_catalog/get_action_schema/get_tool_schema run via command handlers", async () => {
  const registry = createRegistry();
  const turnService = {
    capabilityStore: {
      getActionCatalog(payload) {
        assert.equal(payload.domain, "ui");
        return {
          ok: true,
          capability_version: "sha256:cap_v1",
          entries: [
            {
              type: "set_ui_image_color",
            },
          ],
        };
      },
      getActionSchema(payload) {
        assert.equal(payload.action_type, "set_ui_image_color");
        return {
          ok: true,
          schema: {
            type: "object",
          },
          etag: "schema_etag_v1",
        };
      },
      getSnapshot() {
        return {
          capability_version: "sha256:cap_v1",
          unity_connection_state: "ready",
        };
      },
    },
    queryCoordinator: {},
    unitySnapshotService: {},
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const catalogOutcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_action_catalog",
    { domain: "ui" },
    turnService
  );
  assert.equal(catalogOutcome.statusCode, 200);
  assert.equal(catalogOutcome.body.ok, true);
  assert.equal(Array.isArray(catalogOutcome.body.entries), true);

  const schemaOutcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_action_schema",
    { action_type: "set_ui_image_color" },
    turnService
  );
  assert.equal(schemaOutcome.statusCode, 200);
  assert.equal(schemaOutcome.body.ok, true);
  assert.equal(schemaOutcome.body.action_type, "set_ui_image_color");
  assert.deepEqual(schemaOutcome.body.schema, { type: "object" });

  const toolSchemaOutcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_tool_schema",
    { tool_name: "apply_visual_actions" },
    turnService
  );
  assert.equal(toolSchemaOutcome.statusCode, 200);
  assert.equal(toolSchemaOutcome.body.ok, true);
  assert.equal(toolSchemaOutcome.body.tool_name, "apply_visual_actions");
  assert.equal(toolSchemaOutcome.body.schema_source, "registry_full");
  assert.ok(
    toolSchemaOutcome.body.input_schema &&
      typeof toolSchemaOutcome.body.input_schema === "object"
  );
  assert.ok(
    toolSchemaOutcome.body.tools_list_input_schema &&
      typeof toolSchemaOutcome.body.tools_list_input_schema === "object"
  );
});

test("R11-L2-07 capture_scene_screenshot uses query coordinator and returns read token", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-01T00:00:01.000Z",
          data: {
            artifact_uri: "artifact://unity/snapshots/scene_001.png",
            mime_type: "image/png",
            width: 1280,
            height: 720,
          },
        };
      },
    },
    unitySnapshotService: {
      issueReadTokenForQueryResult(queryType) {
        assert.equal(queryType, "capture_scene_screenshot");
        return {
          token: "readtok_capture_001",
          scope: {
            kind: "scene",
            object_id: "",
            path: "",
          },
        };
      },
    },
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "scene",
      capture_mode: "render_output",
      output_mode: "artifact_uri",
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.data.artifact_uri, "artifact://unity/snapshots/scene_001.png");
  assert.equal(outcome.body.read_token.token, "readtok_capture_001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "capture_scene_screenshot");
  assert.equal(calls[0].payload.view_mode, "scene");
  assert.equal(calls[0].payload.capture_mode, "render_output");
  assert.equal(calls[0].timeoutMs, 3000);
  assert.equal(outcome.body.data.capture_mode_effective, "render_output");
});

test("R11-L2-07 capture_scene_screenshot maps known view error code", async () => {
  const registry = createRegistry();
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery() {
        throw {
          error_code: "E_SCREENSHOT_VIEW_NOT_FOUND",
          message: "No active scene view",
        };
      },
    },
    unitySnapshotService: {},
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "scene",
    },
    turnService
  );

  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.error_code, "E_SCREENSHOT_VIEW_NOT_FOUND");
  assert.equal(outcome.body.recoverable, true);
});

test("R11-CLOSE-L2-01 capture_scene_screenshot rejects disabled capture modes before Unity query", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          data: {
            artifact_uri: "artifact://should-not-be-used.png",
          },
        };
      },
    },
    unitySnapshotService: {},
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "scene",
      capture_mode: "final_pixels",
    },
    turnService
  );

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_CAPTURE_MODE_DISABLED");
  assert.equal(outcome.body.recoverable, true);
  assert.equal(calls.length, 0);
});

test("R11-L2-09 get_ui_tree uses query coordinator and returns read token", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-01T00:00:02.000Z",
          data: {
            ui_system: "ugui",
            roots: [
              {
                path: "Scene/Canvas/HUD",
                object_id: "go_hud",
              },
            ],
          },
        };
      },
    },
    unitySnapshotService: {
      issueReadTokenForQueryResult(queryType) {
        assert.equal(queryType, "get_ui_tree");
        return {
          token: "readtok_ui_tree_001",
          scope: {
            kind: "scene",
            object_id: "",
            path: "",
          },
        };
      },
    },
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_ui_tree",
    {
      ui_system: "ugui",
      max_depth: 4,
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.data.ui_system, "ugui");
  assert.equal(outcome.body.read_token.token, "readtok_ui_tree_001");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "get_ui_tree");
  assert.equal(calls[0].payload.ui_system, "ugui");
  assert.equal(calls[0].payload.max_depth, 4);
  assert.equal(calls[0].timeoutMs, 3000);
});

test("V1-CLOSE-L2-02 hit_test_ui_at_viewport_point uses query coordinator and clamps mapped_point", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-01T00:00:03.000Z",
          data: {
            runtime_resolution: {
              width: 1920,
              height: 1080,
            },
            mapped_point: {
              x: 1920,
              y: 1080,
            },
            hits: [],
          },
        };
      },
    },
    unitySnapshotService: {
      issueReadTokenForQueryResult(queryType) {
        assert.equal(queryType, "hit_test_ui_at_viewport_point");
        return {
          token: "readtok_hit_test_001",
        };
      },
    },
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/hit_test_ui_at_viewport_point",
    {
      coord_space: "viewport_px",
      x: 1920,
      y: 1080,
      resolution: {
        width: 1920,
        height: 1080,
      },
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.read_token.token, "readtok_hit_test_001");
  assert.equal(outcome.body.data.mapped_point.x, 1919);
  assert.equal(outcome.body.data.mapped_point.y, 1079);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "hit_test_ui_at_viewport_point");
});

test("V1-CLOSE-L2-03 validate_ui_layout uses query coordinator and normalizes issue modes", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-01T00:00:04.000Z",
          data: {
            runtime_resolution_name: "landscape_fhd",
            issues: [
              {
                issue_type: "TEXT_OVERFLOW",
                resolution: "portrait_fhd",
              },
              {
                issue_type: "NOT_CLICKABLE",
                approximate: true,
                approx_reason: "NO_RAYCAST_SOURCE",
              },
            ],
          },
        };
      },
    },
    unitySnapshotService: {
      issueReadTokenForQueryResult(queryType) {
        assert.equal(queryType, "validate_ui_layout");
        return {
          token: "readtok_validate_layout_001",
        };
      },
    },
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/validate_ui_layout",
    {
      resolutions: [
        { name: "landscape_fhd", width: 1920, height: 1080 },
        { name: "portrait_fhd", width: 1080, height: 1920 },
      ],
      checks: ["TEXT_OVERFLOW", "NOT_CLICKABLE"],
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.read_token.token, "readtok_validate_layout_001");
  assert.equal(outcome.body.data.issues[0].mode, "derived_only");
  assert.equal(outcome.body.data.issues[0].severity, "warning");
  assert.equal(outcome.body.data.issues[1].mode, "static_only");
  assert.equal(outcome.body.data.issues[1].severity, "warning");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "validate_ui_layout");
});

test("R11-CLOSE-L2-03 hit_test_ui_at_screen_point is disabled with recoverable feedback", async () => {
  const registry = createRegistry();
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {},
    unitySnapshotService: {},
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/hit_test_ui_at_screen_point",
    {
      view_mode: "game",
      x: 120,
      y: 240,
      reference_width: 1280,
      reference_height: 720,
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_COMMAND_DISABLED");
  assert.equal(outcome.body.recoverable, true);
});

test("V1-CLOSE-L2-04 set_ui_properties routes through turnService and returns planning payload", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {},
    unitySnapshotService: {},
    nowIso: () => "2026-03-01T00:00:00.000Z",
    setUiPropertiesForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "planned",
          dry_run: true,
          planned_actions_count: 2,
          mapped_actions: [
            "set_rect_transform_anchored_position",
            "set_ui_text_content",
          ],
        },
      };
    },
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_properties",
    {
      based_on_read_token: "tok_set_ui_properties_12345678901234567890",
      write_anchor: {
        object_id: "go_canvas",
        path: "Scene/Canvas",
      },
      operations: [
        {
          target_anchor: {
            object_id: "go_button",
            path: "Scene/Canvas/Button",
          },
          rect_transform: {
            anchored_position: { x: 10, y: 20 },
          },
          text: {
            content: "Play",
          },
        },
      ],
      dry_run: true,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.status, "planned");
  assert.deepEqual(outcome.body.mapped_actions, [
    "set_rect_transform_anchored_position",
    "set_ui_text_content",
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].dry_run, true);
});

test("V1-CLOSE-L2-04 set_ui_properties validation fail includes set_ui_properties schema compensation", async () => {
  const registry = createRegistry();
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {},
    unitySnapshotService: {},
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_properties",
    {
      based_on_read_token: "tok_set_ui_properties_12345678901234567890",
      write_anchor: {
        object_id: "go_canvas",
        path: "Scene/Canvas",
      },
      operations: [
        {
          target_anchor: {
            object_id: "go_button",
            path: "Scene/Canvas/Button",
          },
        },
      ],
    },
    turnService
  );

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_SCHEMA_INVALID");
  assert.equal(outcome.body.schema_source, "get_tool_schema");
  assert.equal(outcome.body.schema_ref.tool, "get_tool_schema");
  assert.equal(outcome.body.schema_ref.params.tool_name, "set_ui_properties");
});

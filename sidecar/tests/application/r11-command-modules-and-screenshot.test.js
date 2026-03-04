"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  createCaptureCompositeRuntime,
} = require("../../src/application/captureCompositeRuntime");

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

test("R11-L2-06 get_action_catalog/get_action_schema/get_tool_schema/get_write_contract_bundle/preflight_validate_write_payload run via command handlers", async () => {
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
    preflightValidateWritePayloadForMcp(payload) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          preflight: {
            tool_name: payload && payload.tool_name ? payload.tool_name : "",
            valid: true,
            normalization_applied: true,
            normalized_payload: {
              based_on_read_token:
                payload &&
                payload.payload &&
                payload.payload.based_on_read_token
                  ? payload.payload.based_on_read_token
                  : "",
              write_anchor:
                payload && payload.payload && payload.payload.write_anchor
                  ? payload.payload.write_anchor
                  : null,
              actions: [
                {
                  type: "rename_object",
                  target_anchor:
                    payload &&
                    payload.payload &&
                    payload.payload.write_anchor
                      ? payload.payload.write_anchor
                      : null,
                  action_data: {
                    name: "Panel_Renamed",
                  },
                },
              ],
            },
            blocking_errors: [],
            non_blocking_warnings: [],
          },
        },
      };
    },
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
  assert.deepEqual(
    toolSchemaOutcome.body.required_sequence,
    [
      "get_current_selection",
      "apply_visual_actions",
      "get_unity_task_status_until_terminal(succeeded|failed|cancelled)",
    ]
  );
  assert.equal(
    String(toolSchemaOutcome.body.description || "").includes(
      "get_unity_task_status"
    ),
    true
  );
  assert.equal(Array.isArray(toolSchemaOutcome.body.canonical_examples), true);
  assert.ok(toolSchemaOutcome.body.write_envelope_contract);
  assert.equal(
    Array.isArray(toolSchemaOutcome.body.action_anchor_decision_table),
    true
  );
  assert.equal(
    Array.isArray(toolSchemaOutcome.body.golden_path_templates),
    true
  );

  const writeBundleOutcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "apply_visual_actions",
      action_type: "set_ui_image_color",
      budget_chars: 3600,
    },
    turnService
  );
  assert.equal(writeBundleOutcome.statusCode, 200);
  assert.equal(writeBundleOutcome.body.ok, true);
  assert.equal(writeBundleOutcome.body.tool_name, "apply_visual_actions");
  assert.equal(writeBundleOutcome.body.action_type, "set_ui_image_color");
  assert.ok(
    writeBundleOutcome.body.write_envelope_contract &&
      typeof writeBundleOutcome.body.write_envelope_contract === "object"
  );
  assert.ok(
    writeBundleOutcome.body.minimal_valid_payload_template &&
      typeof writeBundleOutcome.body.minimal_valid_payload_template === "object"
  );

  const preflightOutcome = await dispatchBodyCommand(
    registry,
    "/mcp/preflight_validate_write_payload",
    {
      tool_name: "apply_visual_actions",
      payload: {
        based_on_read_token: "tok_r20_preflight_123456789012345678",
        write_anchor: {
          object_id: "go_canvas",
          path: "Scene/Canvas",
        },
        actions: [
          {
            type: "rename_object",
            target_anchor: {},
            action_data: {
              name: "Panel_Renamed",
            },
          },
        ],
      },
    },
    turnService
  );
  assert.equal(preflightOutcome.statusCode, 200);
  assert.equal(preflightOutcome.body.ok, true);
  assert.equal(preflightOutcome.body.preflight.valid, true);
  assert.equal(preflightOutcome.body.preflight.normalization_applied, true);
  assert.equal(
    preflightOutcome.body.preflight.normalized_payload.actions[0].target_anchor.object_id,
    "go_canvas"
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
            visual_evidence: {
              artifact_uri: "artifact://unity/snapshots/scene_001.png",
              pixel_hash: "abc123",
              diff_summary: "mode:render_output",
            },
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
      max_base64_bytes: 300000,
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.data.artifact_uri, "artifact://unity/snapshots/scene_001.png");
  assert.equal(outcome.body.read_token.token, "readtok_capture_001");
  assert.equal(outcome.body.data.visual_evidence.artifact_uri, "artifact://unity/snapshots/scene_001.png");
  assert.equal(outcome.body.data.visual_evidence.pixel_hash, "abc123");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "capture_scene_screenshot");
  assert.equal(calls[0].payload.view_mode, "scene");
  assert.equal(calls[0].payload.capture_mode, "render_output");
  assert.equal(calls[0].payload.max_base64_bytes, 300000);
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

test("R18-CAPTURE-B-02 capture_scene_screenshot synthesizes visual_evidence when Unity omits it", async () => {
  const registry = createRegistry();
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery() {
        return {
          ok: true,
          captured_at: "2026-03-03T00:00:01.000Z",
          data: {
            artifact_uri: "artifact://unity/snapshots/scene_missing_evidence.png",
            mime_type: "image/png",
            width: 960,
            height: 540,
          },
        };
      },
    },
    unitySnapshotService: {},
    nowIso: () => "2026-03-03T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "scene",
      capture_mode: "render_output",
      output_mode: "artifact_uri",
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(
    outcome.body.data.visual_evidence.artifact_uri,
    "artifact://unity/snapshots/scene_missing_evidence.png"
  );
  assert.equal(outcome.body.data.visual_evidence.pixel_hash, "");
});

test("R18-CAPTURE-B-07 capture_scene_screenshot fails closed when Unity reports non-render_output effective mode", async () => {
  const unstableModes = ["final_pixels", "composite"];
  for (const captureModeEffective of unstableModes) {
    const registry = createRegistry();
    const turnService = {
      capabilityStore: {},
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery() {
          return {
            ok: true,
            captured_at: "2026-03-03T00:00:01.000Z",
            data: {
              artifact_uri: "artifact://unity/snapshots/scene_rogue_mode.png",
              mime_type: "image/png",
              width: 960,
              height: 540,
              capture_mode_effective: captureModeEffective,
            },
          };
        },
      },
      unitySnapshotService: {},
      nowIso: () => "2026-03-03T00:00:00.000Z",
    };

    const outcome = await dispatchBodyCommand(
      registry,
      "/mcp/capture_scene_screenshot",
      {
        view_mode: "scene",
        capture_mode: "render_output",
        output_mode: "artifact_uri",
      },
      turnService
    );

    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_CAPTURE_MODE_DISABLED");
    assert.equal(outcome.body.recoverable, true);
  }
});

test("R18-CAPTURE-C-01 capture_scene_screenshot allows composite only when feature flag is enabled", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    captureCompositeEnabled: true,
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-03T00:00:01.000Z",
          data: {
            artifact_uri: "artifact://unity/snapshots/scene_composite.png",
            mime_type: "image/png",
            width: 960,
            height: 540,
            capture_mode_effective: "composite",
            diagnosis_tags: ["COMPOSITE_RENDER", "PLAYMODE_CAPTURE"],
          },
        };
      },
    },
    unitySnapshotService: {},
    nowIso: () => "2026-03-03T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "composite",
      output_mode: "artifact_uri",
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.data.capture_mode_effective, "composite");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.capture_mode, "composite");
});

test("R18-CAPTURE-C-03 composite fuse falls back to render_output after consecutive black frames", async () => {
  const registry = createRegistry();
  const calls = [];
  const runtime = createCaptureCompositeRuntime({
    enabled: true,
    fuseFailureThreshold: 3,
    fuseCooldownMs: 60 * 1000,
  });
  const turnService = {
    captureCompositeEnabled: true,
    captureCompositeRuntime: runtime,
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        const isRenderOutput = request.payload.capture_mode === "render_output";
        if (isRenderOutput) {
          return {
            ok: true,
            captured_at: "2026-03-03T00:01:00.000Z",
            data: {
              artifact_uri: "artifact://unity/snapshots/scene_render_output.png",
              mime_type: "image/png",
              width: 960,
              height: 540,
              capture_mode_effective: "render_output",
              diagnosis_tags: ["FALLBACK"],
            },
          };
        }

        return {
          ok: true,
          captured_at: "2026-03-03T00:00:01.000Z",
          data: {
            artifact_uri: "artifact://unity/snapshots/scene_black.png",
            mime_type: "image/png",
            width: 960,
            height: 540,
            capture_mode_effective: "composite",
            diagnosis_tags: ["ALL_BLACK", "COMPOSITE_RENDER", "PLAYMODE_CAPTURE"],
            pixel_sanity: {
              is_all_black: true,
            },
          },
        };
      },
    },
    unitySnapshotService: {},
    nowIso: () => "2026-03-03T00:00:00.000Z",
  };

  for (let i = 0; i < 3; i += 1) {
    const outcome = await dispatchBodyCommand(
      registry,
      "/mcp/capture_scene_screenshot",
      {
        view_mode: "game",
        capture_mode: "composite",
        output_mode: "artifact_uri",
      },
      turnService
    );
    assert.equal(outcome.statusCode, 200);
    assert.equal(outcome.body.ok, true);
    assert.equal(outcome.body.data.capture_mode_effective, "composite");
  }

  const fusedOutcome = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "composite",
      output_mode: "artifact_uri",
    },
    turnService
  );

  assert.equal(fusedOutcome.statusCode, 200);
  assert.equal(fusedOutcome.body.ok, true);
  assert.equal(fusedOutcome.body.data.capture_mode_effective, "render_output");
  assert.equal(
    String(fusedOutcome.body.data.fallback_reason || "").includes("composite_fused"),
    true
  );
  assert.equal(
    Array.isArray(fusedOutcome.body.data.diagnosis_tags) &&
      fusedOutcome.body.data.diagnosis_tags.includes("COMPOSITE_FUSED"),
    true
  );
  assert.equal(calls.length, 4);
  assert.equal(calls[3].payload.capture_mode, "render_output");
});

test("R18-CAPTURE-C-04 capture_scene_screenshot returns E_COMPOSITE_BUSY on composite reentry", async () => {
  const registry = createRegistry();
  const runtime = createCaptureCompositeRuntime({
    enabled: true,
    fuseFailureThreshold: 3,
    fuseCooldownMs: 60 * 1000,
  });
  const started = runtime.tryStartRequest(Date.now());
  assert.equal(started.ok, true);

  try {
    const turnService = {
      captureCompositeEnabled: true,
      captureCompositeRuntime: runtime,
      capabilityStore: {},
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery() {
          throw new Error("should_not_be_called_when_busy");
        },
      },
      unitySnapshotService: {},
      nowIso: () => "2026-03-03T00:00:00.000Z",
    };

    const outcome = await dispatchBodyCommand(
      registry,
      "/mcp/capture_scene_screenshot",
      {
        view_mode: "game",
        capture_mode: "composite",
        output_mode: "artifact_uri",
      },
      turnService
    );

    assert.equal(outcome.statusCode, 409);
    assert.equal(outcome.body.error_code, "E_COMPOSITE_BUSY");
    assert.equal(outcome.body.recoverable, true);
  } finally {
    runtime.endRequest();
  }
});

test("R18-CAPTURE-C-04 composite runtime lock is released on early internal failure", async () => {
  const registry = createRegistry();
  const runtime = createCaptureCompositeRuntime({
    enabled: true,
    fuseFailureThreshold: 3,
    fuseCooldownMs: 60 * 1000,
  });
  const turnService = {
    captureCompositeEnabled: true,
    captureCompositeRuntime: runtime,
    capabilityStore: {},
    // Intentionally omit queryCoordinator to trigger E_INTERNAL before Unity query dispatch.
    unitySnapshotService: {},
    nowIso: () => "2026-03-03T00:00:00.000Z",
  };

  const first = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "composite",
      output_mode: "artifact_uri",
    },
    turnService
  );
  assert.equal(first.statusCode, 500);
  assert.equal(first.body.error_code, "E_INTERNAL");

  const second = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "composite",
      output_mode: "artifact_uri",
    },
    turnService
  );
  assert.equal(second.statusCode, 500);
  assert.equal(second.body.error_code, "E_INTERNAL");
  assert.equal(runtime.getMetricsSnapshot(Date.now()).in_flight, false);
});

test("R18-CAPTURE-D-03 capture_scene_screenshot accepts Unity composite fallback to render_output when fallback_reason is present", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    captureCompositeEnabled: true,
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-03T00:00:01.000Z",
          data: {
            artifact_uri: "artifact://unity/snapshots/scene_composite_fallback.png",
            mime_type: "image/png",
            width: 960,
            height: 540,
            capture_mode_effective: "render_output",
            fallback_reason: "composite_overlay_absent",
            diagnosis_tags: ["EDITMODE_TEMP_SCENE", "FALLBACK"],
          },
        };
      },
    },
    unitySnapshotService: {},
    nowIso: () => "2026-03-03T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "composite",
      output_mode: "artifact_uri",
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.data.capture_mode_effective, "render_output");
  assert.equal(outcome.body.data.fallback_reason, "composite_overlay_absent");
  assert.equal(
    Array.isArray(outcome.body.data.diagnosis_tags) &&
      outcome.body.data.diagnosis_tags.includes("COMPOSITE_FALLBACK_RENDER_OUTPUT"),
    true
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].payload.capture_mode, "composite");
});

test("R18-CAPTURE-D-03 capture_scene_screenshot keeps fail-closed when Unity downgrades composite without fallback_reason", async () => {
  const registry = createRegistry();
  const turnService = {
    captureCompositeEnabled: true,
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery() {
        return {
          ok: true,
          captured_at: "2026-03-03T00:00:01.000Z",
          data: {
            artifact_uri: "artifact://unity/snapshots/scene_composite_missing_fallback_reason.png",
            mime_type: "image/png",
            width: 960,
            height: 540,
            capture_mode_effective: "render_output",
          },
        };
      },
    },
    unitySnapshotService: {},
    nowIso: () => "2026-03-03T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "composite",
      output_mode: "artifact_uri",
    },
    turnService
  );

  assert.equal(outcome.statusCode, 409);
  assert.equal(outcome.body.error_code, "E_CAPTURE_MODE_DISABLED");
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

test("R18-CAPTURE-A-01 get_ui_overlay_report uses query coordinator and returns read token", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-03T00:00:02.000Z",
          data: {
            overlay_canvases: [
              {
                path: "Scene/Canvas/MainOverlay",
                object_id: "go_overlay_main",
                screen_coverage_percent: 72.5,
                interactable_elements: 12,
              },
            ],
            overlay_total_coverage_percent: 72.5,
            non_overlay_canvases_count: 2,
            diagnosis_codes: ["OVERLAY_PRESENT", "OVERLAY_COVERAGE_HIGH"],
            recommended_capture_mode: "composite",
          },
        };
      },
    },
    unitySnapshotService: {
      issueReadTokenForQueryResult(queryType) {
        assert.equal(queryType, "get_ui_overlay_report");
        return {
          token: "readtok_ui_overlay_001",
          scope: {
            kind: "scene",
            object_id: "go_overlay_main",
            path: "Scene/Canvas/MainOverlay",
          },
        };
      },
    },
    nowIso: () => "2026-03-03T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_ui_overlay_report",
    {
      scope: {
        root_path: "Scene/Canvas",
      },
      max_nodes: 256,
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.read_token.token, "readtok_ui_overlay_001");
  assert.equal(outcome.body.data.overlay_total_coverage_percent, 72.5);
  assert.equal(outcome.body.data.recommended_capture_mode, "composite");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "get_ui_overlay_report");
  assert.equal(calls[0].payload.scope.root_path, "Scene/Canvas");
  assert.equal(calls[0].payload.max_nodes, 256);
  assert.equal(calls[0].timeoutMs, 3000);
});

test("R16-HYBRID-P1-R-02 get_serialized_property_tree uses query coordinator and returns cursor data", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-01T00:00:05.000Z",
          data: {
            returned_count: 2,
            truncated: true,
            truncated_reason: "NODE_BUDGET_EXCEEDED",
            next_cursor: "m_Color",
            nodes: [
              { property_path: "m_Color" },
              { property_path: "m_Material" },
            ],
          },
        };
      },
    },
    unitySnapshotService: {
      issueReadTokenForQueryResult(queryType) {
        assert.equal(queryType, "get_serialized_property_tree");
        return {
          token: "readtok_sp_tree_001",
        };
      },
    },
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_serialized_property_tree",
    {
      target_anchor: {
        object_id: "go_button",
        path: "Scene/Canvas/Button",
      },
      component_selector: {
        component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
        component_index: 0,
      },
      depth: 1,
      page_size: 2,
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.read_token.token, "readtok_sp_tree_001");
  assert.equal(outcome.body.data.truncated, true);
  assert.equal(outcome.body.data.next_cursor, "m_Color");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "get_serialized_property_tree");
  assert.equal(calls[0].payload.depth, 1);
  assert.equal(calls[0].payload.page_size, 2);
  assert.equal(calls[0].timeoutMs, 3000);
});

test("R17-POLISH-R-02 get_serialized_property_tree supports same-target multi-component batch", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery(request) {
        calls.push(request);
        return {
          ok: true,
          captured_at: "2026-03-02T00:00:05.000Z",
          data: {
            returned_count: 1,
            truncated: false,
            truncated_reason: "",
            next_cursor: "",
            nodes: [{ property_path: "m_AnchoredPosition", common_use: true, llm_hint: "hint-a" }],
            components: [
              {
                selector_index: 0,
                component: {
                  type: "UnityEngine.RectTransform, UnityEngine.CoreModule",
                },
                returned_count: 1,
                truncated: false,
                next_cursor: "",
                nodes: [{ property_path: "m_AnchoredPosition", common_use: true, llm_hint: "hint-a" }],
              },
              {
                selector_index: 1,
                component: {
                  type: "UnityEngine.UI.Image, UnityEngine.UI",
                },
                returned_count: 1,
                truncated: false,
                next_cursor: "",
                nodes: [{ property_path: "m_Color", common_use: true, llm_hint: "hint-b" }],
              },
            ],
          },
        };
      },
    },
    unitySnapshotService: {
      issueReadTokenForQueryResult(queryType) {
        assert.equal(queryType, "get_serialized_property_tree");
        return {
          token: "readtok_sp_tree_batch_001",
        };
      },
    },
    nowIso: () => "2026-03-02T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_serialized_property_tree",
    {
      target_anchor: {
        object_id: "go_button",
        path: "Scene/Canvas/Button",
      },
      component_selectors: [
        {
          component_assembly_qualified_name: "UnityEngine.RectTransform, UnityEngine.CoreModule",
          component_index: 0,
        },
        {
          component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
          component_index: 0,
        },
      ],
      depth: 1,
      page_size: 4,
      timeout_ms: 3000,
    },
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.read_token.token, "readtok_sp_tree_batch_001");
  assert.equal(Array.isArray(outcome.body.data.components), true);
  assert.equal(outcome.body.data.components.length, 2);
  assert.equal(outcome.body.data.components[1].nodes[0].property_path, "m_Color");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "get_serialized_property_tree");
  assert.equal(Array.isArray(calls[0].payload.component_selectors), true);
  assert.equal(calls[0].payload.component_selectors.length, 2);
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
      include_repair_plan: true,
      max_repair_suggestions: 2,
      repair_style: "conservative",
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
  assert.equal(Array.isArray(outcome.body.data.repair_plan), true);
  assert.equal(outcome.body.data.repair_plan.length, 2);
  assert.equal(outcome.body.data.repair_plan_generated_by, "sidecar");
  assert.equal(outcome.body.data.specialist_summary.has_repair_plan, true);
  assert.equal(outcome.body.data.specialist_summary.repair_style, "conservative");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].queryType, "validate_ui_layout");
  assert.equal(calls[0].payload.include_repair_plan, true);
  assert.equal(calls[0].payload.max_repair_suggestions, 2);
  assert.equal(calls[0].payload.repair_style, "conservative");
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
            "set_rect_anchored_position",
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
    "set_rect_anchored_position",
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

test("R16-HYBRID-P1-W-02 set_serialized_property routes through apply_visual_actions chain", async () => {
  const registry = createRegistry();
  const calls = [];
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {},
    unitySnapshotService: {},
    nowIso: () => "2026-03-01T00:00:00.000Z",
    applyVisualActionsForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "planned",
          dry_run: true,
        },
      };
    },
  };

  const requestBody = {
    based_on_read_token: "tok_set_serialized_property_1234567890",
    write_anchor: {
      object_id: "go_canvas",
      path: "Scene/Canvas",
    },
    target_anchor: {
      object_id: "go_button",
      path: "Scene/Canvas/Button",
    },
    component_selector: {
      component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
      component_index: 0,
    },
    patches: [
      {
        property_path: "m_Color",
        value_kind: "color",
        color_value: {
          r: 1,
          g: 0.5,
          b: 0.5,
          a: 1,
        },
      },
    ],
    dry_run: true,
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/set_serialized_property",
    requestBody,
    turnService
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actions.length, 1);
  assert.equal(calls[0].actions[0].type, "set_serialized_property");
  assert.deepEqual(calls[0].actions[0].target_anchor, requestBody.target_anchor);
  assert.deepEqual(calls[0].actions[0].action_data.component_selector, requestBody.component_selector);
  assert.deepEqual(calls[0].actions[0].action_data.patches, requestBody.patches);
  assert.equal(calls[0].actions[0].action_data.dry_run, true);
});

test("R16-HYBRID-P1-W-02 set_serialized_property validation fail includes schema compensation", async () => {
  const registry = createRegistry();
  const turnService = {
    capabilityStore: {},
    queryCoordinator: {},
    unitySnapshotService: {},
    nowIso: () => "2026-03-01T00:00:00.000Z",
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/set_serialized_property",
    {
      based_on_read_token: "tok_set_serialized_property_1234567890",
      write_anchor: {
        object_id: "go_canvas",
        path: "Scene/Canvas",
      },
      target_anchor: {
        object_id: "go_button",
        path: "Scene/Canvas/Button",
      },
      component_selector: {
        component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
      },
      patches: [
        {
          property_path: "m_Color",
          value_kind: "color",
        },
      ],
    },
    turnService
  );

  assert.equal(outcome.statusCode, 400);
  assert.equal(outcome.body.error_code, "E_SCHEMA_INVALID");
  assert.equal(outcome.body.schema_source, "get_tool_schema");
  assert.equal(outcome.body.schema_ref.tool, "get_tool_schema");
  assert.equal(outcome.body.schema_ref.params.tool_name, "set_serialized_property");
});

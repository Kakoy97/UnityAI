"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");

const { createRouter } = require("../../src/api/router");

function invokeJsonRoute(route, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = path;
    req.headers = { host: "127.0.0.1:46321" };

    const response = {
      statusCode: 0,
      body: {},
      payload: "",
    };
    const res = {
      writeHead(statusCode) {
        response.statusCode = statusCode;
      },
      end(payload) {
        response.payload = payload ? String(payload) : "";
        try {
          response.body = response.payload ? JSON.parse(response.payload) : {};
        } catch {
          response.body = {};
        }
        resolve(response);
      },
      on() {
        // no-op
      },
    };

    route(req, res).catch(reject);
    process.nextTick(() => {
      if (body !== undefined) {
        req.emit("data", Buffer.from(JSON.stringify(body)));
      }
      req.emit("end");
    });
  });
}

function buildTurnService(overrides) {
  const base = {
    getHealthPayload() {
      return { ok: true };
    },
    getStateSnapshotPayload() {
      return { ok: true };
    },
    validationError(validation) {
      const v = validation && typeof validation === "object" ? validation : {};
      return {
        statusCode: Number.isFinite(Number(v.statusCode))
          ? Math.floor(Number(v.statusCode))
          : 400,
        body: {
          error_code: typeof v.errorCode === "string" ? v.errorCode : "E_SCHEMA_INVALID",
          message: typeof v.message === "string" ? v.message : "Request schema invalid",
        },
      };
    },
    queryCoordinator: {
      async enqueueAndWaitForUnityQuery() {
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
              pixel_hash: "route_hash_001",
              diff_summary: "mode:render_output",
            },
          },
        };
      },
    },
    unitySnapshotService: {
      issueReadTokenForQueryResult() {
        return {
          token: "readtok_capture_route_001",
          scope: {
            kind: "scene",
            object_id: "",
            path: "",
          },
        };
      },
    },
    capabilityStore: {
      getSnapshot() {
        return {
          unity_connection_state: "ready",
          capability_version: "sha256:cap_v1",
          action_count: 0,
          actions: [],
          action_hints: [],
        };
      },
    },
    nowIso() {
      return "2026-03-01T00:00:00.000Z";
    },
  };
  return {
    ...base,
    ...(overrides && typeof overrides === "object" ? overrides : {}),
  };
}

test("R11-QA screenshot route dispatches through registry and returns tokenized payload", async () => {
  const route = createRouter({
    turnService: buildTurnService(),
    port: 46321,
  });

  const response = await invokeJsonRoute(
    route,
    "POST",
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "scene",
      capture_mode: "render_output",
      output_mode: "artifact_uri",
      max_base64_bytes: 280000,
      timeout_ms: 3000,
    }
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.artifact_uri, "artifact://unity/snapshots/scene_001.png");
  assert.equal(response.body.data.capture_mode_effective, "render_output");
  assert.equal(
    response.body.data.visual_evidence.pixel_hash,
    "route_hash_001"
  );
  assert.equal(response.body.read_token.token, "readtok_capture_route_001");
});

test("R11-QA screenshot route keeps LLM-friendly error feedback for view-not-found", async () => {
  const route = createRouter({
    turnService: buildTurnService({
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery() {
          throw {
            error_code: "E_SCREENSHOT_VIEW_NOT_FOUND",
            message: "No Scene/Game view available",
          };
        },
      },
    }),
    port: 46321,
  });

  const response = await invokeJsonRoute(
    route,
    "POST",
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "scene",
      output_mode: "artifact_uri",
    }
  );

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error_code, "E_SCREENSHOT_VIEW_NOT_FOUND");
  assert.equal(response.body.recoverable, true);
  assert.equal(typeof response.body.suggestion, "string");
  assert.equal(
    response.body.suggestion.includes("capture_scene_screenshot"),
    true
  );
});

test("R11-QA get_ui_tree route dispatches through registry", async () => {
  const route = createRouter({
    turnService: buildTurnService({
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          assert.equal(request.queryType, "get_ui_tree");
          return {
            ok: true,
            captured_at: "2026-03-01T00:00:03.000Z",
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
            token: "readtok_ui_tree_route_001",
            scope: {
              kind: "scene",
              object_id: "",
              path: "",
            },
          };
        },
      },
    }),
    port: 46321,
  });

  const response = await invokeJsonRoute(route, "POST", "/mcp/get_ui_tree", {
    ui_system: "ugui",
    max_depth: 2,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.ui_system, "ugui");
  assert.equal(response.body.read_token.token, "readtok_ui_tree_route_001");
});

test("R18-CAPTURE-A-01 get_ui_overlay_report route dispatches through registry", async () => {
  const route = createRouter({
    turnService: buildTurnService({
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          assert.equal(request.queryType, "get_ui_overlay_report");
          return {
            ok: true,
            captured_at: "2026-03-03T00:00:03.000Z",
            data: {
              overlay_canvases: [],
              overlay_total_coverage_percent: 0,
              non_overlay_canvases_count: 1,
              diagnosis_codes: ["OVERLAY_NONE"],
              recommended_capture_mode: "render_output",
            },
          };
        },
      },
      unitySnapshotService: {
        issueReadTokenForQueryResult(queryType) {
          assert.equal(queryType, "get_ui_overlay_report");
          return {
            token: "readtok_overlay_route_001",
          };
        },
      },
    }),
    port: 46321,
  });

  const response = await invokeJsonRoute(
    route,
    "POST",
    "/mcp/get_ui_overlay_report",
    {
      scope: {
        root_path: "Scene/Canvas",
      },
      max_nodes: 200,
    }
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.read_token.token, "readtok_overlay_route_001");
  assert.equal(response.body.data.recommended_capture_mode, "render_output");
});

test("V1-CLOSE route dispatches hit_test_ui_at_viewport_point through registry", async () => {
  const route = createRouter({
    turnService: buildTurnService({
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          assert.equal(request.queryType, "hit_test_ui_at_viewport_point");
          return {
            ok: true,
            captured_at: "2026-03-01T00:00:03.000Z",
            data: {
              runtime_resolution: { width: 1280, height: 720 },
              mapped_point: { x: 640, y: 360 },
              hits: [],
            },
          };
        },
      },
      unitySnapshotService: {
        issueReadTokenForQueryResult(queryType) {
          assert.equal(queryType, "hit_test_ui_at_viewport_point");
          return {
            token: "readtok_hit_test_route_001",
          };
        },
      },
    }),
    port: 46321,
  });

  const response = await invokeJsonRoute(
    route,
    "POST",
    "/mcp/hit_test_ui_at_viewport_point",
    {
      coord_space: "viewport_px",
      x: 640,
      y: 360,
      resolution: { width: 1280, height: 720 },
    }
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.read_token.token, "readtok_hit_test_route_001");
});

test("V1-CLOSE route dispatches validate_ui_layout through registry", async () => {
  const route = createRouter({
    turnService: buildTurnService({
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          assert.equal(request.queryType, "validate_ui_layout");
          return {
            ok: true,
            captured_at: "2026-03-01T00:00:03.000Z",
            data: {
              issues: [],
            },
          };
        },
      },
      unitySnapshotService: {
        issueReadTokenForQueryResult(queryType) {
          assert.equal(queryType, "validate_ui_layout");
          return {
            token: "readtok_validate_route_001",
          };
        },
      },
    }),
    port: 46321,
  });

  const response = await invokeJsonRoute(route, "POST", "/mcp/validate_ui_layout", {
    resolutions: [{ width: 1920, height: 1080 }],
    checks: ["OUT_OF_BOUNDS"],
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.read_token.token, "readtok_validate_route_001");
});

test("R11-CLOSE visual chain keeps tree-first flow and rejects disabled capture modes", async () => {
  const queryCalls = [];
  const route = createRouter({
    turnService: buildTurnService({
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          queryCalls.push({
            queryType: request.queryType,
            payload: request.payload,
          });
          if (request.queryType === "get_ui_tree") {
            return {
              ok: true,
              captured_at: "2026-03-01T00:00:03.000Z",
              data: {
                ui_system: "ugui",
                canvases: [
                  {
                    path: "Scene/Canvas",
                    object_id: "go_canvas",
                  },
                ],
                roots: [
                  {
                    path: "Scene/Canvas/HUD",
                    object_id: "go_hud",
                  },
                ],
              },
            };
          }
          throw new Error(`unexpected query type: ${request.queryType}`);
        },
      },
      unitySnapshotService: {
        issueReadTokenForQueryResult(queryType) {
          return {
            token:
              queryType === "get_ui_tree"
                ? "readtok_ui_tree_chain_001"
                : "readtok_capture_chain_001",
            scope: {
              kind: "scene",
              object_id: queryType === "get_ui_tree" ? "go_hud" : "",
              path: queryType === "get_ui_tree" ? "Scene/Canvas/HUD" : "GameView",
            },
          };
        },
      },
    }),
    port: 46321,
  });

  const treeResponse = await invokeJsonRoute(route, "POST", "/mcp/get_ui_tree", {
    ui_system: "ugui",
    include_components: true,
    include_layout: true,
    max_depth: 4,
  });
  assert.equal(treeResponse.statusCode, 200);
  assert.equal(treeResponse.body.ok, true);
  assert.equal(treeResponse.body.read_token.token, "readtok_ui_tree_chain_001");
  assert.equal(treeResponse.body.data.roots[0].path, "Scene/Canvas/HUD");

  const screenshotResponse = await invokeJsonRoute(
    route,
    "POST",
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "final_pixels",
      include_ui: true,
      output_mode: "artifact_uri",
    }
  );
  assert.equal(screenshotResponse.statusCode, 409);
  assert.equal(screenshotResponse.body.error_code, "E_CAPTURE_MODE_DISABLED");
  assert.equal(screenshotResponse.body.recoverable, true);

  assert.deepEqual(
    queryCalls.map((item) => item.queryType),
    ["get_ui_tree"]
  );
});

test("R11-QA-03 get_ui_tree source-not-found keeps recoverable feedback for tree-first flow", async () => {
  const route = createRouter({
    turnService: buildTurnService({
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          assert.equal(request.queryType, "get_ui_tree");
          throw {
            error_code: "E_UI_TREE_SOURCE_NOT_FOUND",
            message: "UI root_path not found: Scene/Canvas/Missing",
          };
        },
      },
    }),
    port: 46321,
  });

  const response = await invokeJsonRoute(route, "POST", "/mcp/get_ui_tree", {
    ui_system: "ugui",
    root_path: "Scene/Canvas/Missing",
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.body.error_code, "E_UI_TREE_SOURCE_NOT_FOUND");
  assert.equal(response.body.recoverable, true);
  assert.equal(typeof response.body.suggestion, "string");
  assert.equal(response.body.suggestion.includes("get_ui_tree"), true);
});

test("R11-CLOSE disabled capture/hit_test return stable disabled feedback and do not call Unity query", async () => {
  const queryCalls = [];
  const route = createRouter({
    turnService: buildTurnService({
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          queryCalls.push(request.queryType);
          throw new Error(
            `unity query must not be called in disabled mode: ${request.queryType}`
          );
        },
      },
      unitySnapshotService: {},
    }),
    port: 46321,
  });

  const screenshotResponse = await invokeJsonRoute(
    route,
    "POST",
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "final_pixels",
      include_ui: true,
      output_mode: "artifact_uri",
    }
  );
  assert.equal(screenshotResponse.statusCode, 409);
  assert.equal(screenshotResponse.body.error_code, "E_CAPTURE_MODE_DISABLED");
  assert.equal(screenshotResponse.body.recoverable, true);
  assert.equal(
    String(screenshotResponse.body.suggestion || "").includes(
      "get_ui_overlay_report"
    ),
    true
  );
  assert.equal(
    String(screenshotResponse.body.suggestion || "").includes("render_output"),
    true
  );

  const hitResponse = await invokeJsonRoute(
    route,
    "POST",
    "/mcp/hit_test_ui_at_screen_point",
    {
      view_mode: "game",
      x: 612,
      y: 430,
      reference_width: 1280,
      reference_height: 720,
    }
  );
  assert.equal(hitResponse.statusCode, 409);
  assert.equal(hitResponse.body.error_code, "E_COMMAND_DISABLED");
  assert.equal(hitResponse.body.recoverable, true);

  assert.deepEqual(queryCalls, []);
});

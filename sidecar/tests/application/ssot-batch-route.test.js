"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const {
  getActionCatalogView,
  getActionSchemaView,
  getToolSchemaView,
  getWriteContractBundleView,
} = require("../../src/application/ssotRuntime/staticContractViews");

function normalizeToolKey(value) {
  return String(value || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function deriveToolKeyFromMethod(methodName) {
  let base = String(methodName || "").trim();
  if (!base.endsWith("ForMcp")) {
    return "";
  }
  base = base.slice(0, -"ForMcp".length);
  if (base.endsWith("Ssot")) {
    base = base.slice(0, -"Ssot".length);
  }
  return normalizeToolKey(base);
}

function ensureTurnServiceHasSsotDispatcher(turnService) {
  const source = turnService && typeof turnService === "object" ? turnService : {};
  if (typeof source.dispatchSsotToolForMcp === "function") {
    return source;
  }

  const methodByToolKey = new Map();
  for (const key of Object.keys(source)) {
    if (typeof source[key] !== "function") {
      continue;
    }
    const toolKey = deriveToolKeyFromMethod(key);
    if (!toolKey) {
      continue;
    }
    methodByToolKey.set(toolKey, key);
  }

  return {
    ...source,
    async dispatchSsotToolForMcp(toolName, payload) {
      const methodName = methodByToolKey.get(normalizeToolKey(toolName));
      const handler =
        methodName && typeof source[methodName] === "function"
          ? source[methodName]
          : null;
      if (!handler) {
        return {
          statusCode: 500,
          body: {
            error_code: "E_INTERNAL",
            message: `turnService handler not found for command: ${toolName}`,
          },
        };
      }

      const body =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload
          : {};
      const args =
        methodName === "getUnityTaskStatusForMcp" ? body.job_id : body;
      return Promise.resolve(handler.call(source, args));
    },
  };
}

async function dispatchBodyCommand(registry, path, body, turnService) {
  const adaptedTurnService = ensureTurnServiceHasSsotDispatcher(turnService);
  return registry.dispatchHttpCommand({
    method: "POST",
    path,
    url: new URL(`http://127.0.0.1:46321${path}`),
    req: {},
    readJsonBody: async () => body,
    turnService: adaptedTurnService,
  });
}

async function dispatchQueryCommand(registry, path, query, turnService) {
  const adaptedTurnService = ensureTurnServiceHasSsotDispatcher(turnService);
  const url = new URL(`http://127.0.0.1:46321${path}`);
  const source = query && typeof query === "object" ? query : {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return registry.dispatchHttpCommand({
    method: "GET",
    path,
    url,
    req: {},
    readJsonBody: async () => ({}),
    turnService: adaptedTurnService,
  });
}

test("ssot set_component_properties route dispatches to turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async setComponentPropertiesForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_component_properties",
        },
      };
    },
  };
  const body = {
    execution_mode: "EXECUTE",
    idempotency_key: "idem_ssot_component_test",
    based_on_read_token: "tok_ssot_component_test",
    write_anchor_object_id: "go_canvas",
    write_anchor_path: "Scene/Canvas",
    target_object_id: "go_target",
    target_path: "Scene/Canvas/Node",
    component_type: "UnityEngine.Transform, UnityEngine.CoreModule",
    property_path: "m_LocalPosition.x",
    value_kind: "number",
    value_number: 2.5,
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/set_component_properties",
    body,
    turnService
  );
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "set_component_properties");
  assert.equal(calls.length, 1);
  assert.equal(String(calls[0].execution_mode).toUpperCase(), "EXECUTE");
});

test("ssot get_scene_snapshot_for_write route dispatches to turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async getSceneSnapshotForWriteForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "get_scene_snapshot_for_write",
        },
      };
    },
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_scene_snapshot_for_write",
    { scope_path: "Scene/Canvas" },
    turnService
  );
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "get_scene_snapshot_for_write");
  assert.equal(calls.length, 1);
});

test("ssot get_current_selection route dispatches to turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async getCurrentSelectionSsotForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "get_current_selection",
        },
      };
    },
  };

  const outcome = await dispatchBodyCommand(
    registry,
    "/mcp/get_current_selection",
    {},
    turnService
  );
  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.tool_name, "get_current_selection");
  assert.equal(calls.length, 1);
});

test("ssot get_gameobject_components route validates required anchors then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const turnService = {
    async getGameObjectComponentsSsotForMcp() {
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "get_gameobject_components",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_gameobject_components",
    {},
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_gameobject_components",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "get_gameobject_components");
});

test("ssot get_hierarchy_subtree route validates required anchors then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const turnService = {
    async getHierarchySubtreeSsotForMcp(payload) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "get_hierarchy_subtree",
          data: payload,
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_hierarchy_subtree",
    { depth: 2 },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_hierarchy_subtree",
    {
      target_object_id: "go_root",
      target_path: "Scene/Canvas",
      depth: 2,
      node_budget: 100,
      char_budget: 12000,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "get_hierarchy_subtree");
});

test("ssot get_scene_roots route dispatches to turnService after schema validation", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async getSceneRootsForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "get_scene_roots",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_scene_roots",
    { include_inactive: "yes" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_scene_roots",
    { scene_path: "Assets/Scenes/SampleScene.unity", include_inactive: true },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "get_scene_roots");
  assert.equal(calls.length, 1);
});

test("ssot list_assets_in_folder route enforces folder_path then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async listAssetsInFolderForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "list_assets_in_folder",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/list_assets_in_folder",
    {},
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/list_assets_in_folder",
    {
      folder_path: "Assets",
      recursive: true,
      include_meta: false,
      limit: 100,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "list_assets_in_folder");
  assert.equal(calls.length, 1);
});

test("ssot find_objects_by_component route enforces component_query then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async findObjectsByComponentForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "find_objects_by_component",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/find_objects_by_component",
    {},
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/find_objects_by_component",
    {
      component_query: "RectTransform",
      under_path: "Scene/Canvas",
      include_inactive: true,
      limit: 50,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "find_objects_by_component");
  assert.equal(calls.length, 1);
});

test("ssot query_prefab_info route enforces prefab_path/max_depth then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async queryPrefabInfoForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "query_prefab_info",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/query_prefab_info",
    { prefab_path: "Assets/Prefabs/A.prefab" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/query_prefab_info",
    {
      prefab_path: "Assets/Prefabs/A.prefab",
      max_depth: 4,
      node_budget: 300,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "query_prefab_info");
  assert.equal(calls.length, 1);
});

test("ssot get_ui_tree route dispatches through SSOT validator+turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async getUiTreeForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "get_ui_tree",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_ui_tree",
    { max_depth: "3" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_ui_tree",
    {
      ui_system: "ugui",
      root_path: "Scene/Canvas",
      max_depth: 3,
      node_budget: 200,
      char_budget: 12000,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "get_ui_tree");
  assert.equal(calls.length, 1);
});

test("ssot get_ui_overlay_report route dispatches through SSOT validator+turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async getUiOverlayReportForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "get_ui_overlay_report",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_ui_overlay_report",
    { timeout_ms: "3000" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_ui_overlay_report",
    {
      root_path: "Scene/Canvas",
      include_inactive: true,
      include_children_summary: true,
      max_nodes: 400,
      max_children_per_canvas: 20,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "get_ui_overlay_report");
  assert.equal(calls.length, 1);
});

test("ssot hit_test_ui_at_viewport_point route dispatches through SSOT validator+turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async hitTestUiAtViewportPointForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "hit_test_ui_at_viewport_point",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/hit_test_ui_at_viewport_point",
    { x: "100", y: 100 },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/hit_test_ui_at_viewport_point",
    {
      coord_space: "viewport_px",
      coord_origin: "bottom_left",
      x: 100,
      y: 100,
      resolution_width: 1280,
      resolution_height: 720,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "hit_test_ui_at_viewport_point");
  assert.equal(calls.length, 1);
});

test("ssot validate_ui_layout route dispatches through SSOT validator+turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async validateUiLayoutForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "validate_ui_layout",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/validate_ui_layout",
    { resolution_width: "1280" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/validate_ui_layout",
    {
      scope_root_path: "Scene/Canvas",
      resolution_name: "HD",
      resolution_width: 1280,
      resolution_height: 720,
      checks_csv: "OUT_OF_BOUNDS,OVERLAP",
      max_issues: 100,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "validate_ui_layout");
  assert.equal(calls.length, 1);
});

test("ssot get_serialized_property_tree route dispatches through SSOT validator+turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async getSerializedPropertyTreeForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "get_serialized_property_tree",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_serialized_property_tree",
    { target_object_id: "id_only" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_serialized_property_tree",
    {
      target_object_id: "mock_target",
      target_path: "Scene/Canvas/B",
      component_assembly_qualified_name:
        "UnityEngine.RectTransform, UnityEngine.CoreModule",
      depth: 1,
      page_size: 64,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "get_serialized_property_tree");
  assert.equal(calls.length, 1);
});

test("ssot capture_scene_screenshot route dispatches through SSOT validator+turnService", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    async captureSceneScreenshotForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "capture_scene_screenshot",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    { width: "1280" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/capture_scene_screenshot",
    {
      view_mode: "game",
      capture_mode: "render_output",
      output_mode: "artifact_uri",
      image_format: "png",
      width: 1280,
      height: 720,
      timeout_ms: 3000,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.tool_name, "capture_scene_screenshot");
  assert.equal(calls.length, 1);
});

test("ssot get_action_catalog route dispatches through SSOT validator+turnService", async () => {
  const registry = getMcpCommandRegistry();
  const turnService = {
    getActionCatalogForMcp(payload) {
      return getActionCatalogView(payload);
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_action_catalog",
    { cursor: "0" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_action_catalog",
    { domain: "ui", tier: "core", lifecycle: "stable", cursor: 0, limit: 10 },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.deprecated, true);
  assert.equal(valid.body.tool_name, "get_action_catalog");
});

test("ssot get_action_schema route enforces action_type then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const turnService = {
    getActionSchemaForMcp(payload) {
      return getActionSchemaView(payload);
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_action_schema",
    {},
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_action_schema",
    { action_type: "set_ui_text_content" },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.deprecated, true);
  assert.equal(valid.body.tool_name, "get_action_schema");
});

test("ssot get_tool_schema route enforces tool_name then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const turnService = {
    nowIso: () => "2026-03-05T12:00:00.000Z",
    getToolSchemaForMcp(payload) {
      return getToolSchemaView(payload);
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_tool_schema",
    {},
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_tool_schema",
    { tool_name: "modify_ui_layout" },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "modify_ui_layout");
  assert.equal(valid.body.schema_source, "ssot_static_artifact");
  assert.equal(Array.isArray(valid.body.required_fields), true);
});

test("ssot get_write_contract_bundle route validates payload then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const turnService = {
    nowIso: () => "2026-03-05T12:00:00.000Z",
    getWriteContractBundleForMcp(payload) {
      return getWriteContractBundleView(payload);
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    { budget_chars: "3600" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/get_write_contract_bundle",
    {
      tool_name: "modify_ui_layout",
      action_type: "rename_object",
      budget_chars: 3600,
      include_error_fix_map: true,
      include_canonical_examples: true,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "modify_ui_layout");
  assert.equal(valid.body.schema_source, "ssot_static_artifact");
  assert.ok(valid.body.write_envelope_contract);
  assert.ok(valid.body.minimal_valid_payload_template);
});

test("ssot preflight_validate_write_payload route enforces payload then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    preflightValidateWritePayloadForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          tool_name: payload.tool_name,
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/preflight_validate_write_payload",
    { tool_name: "apply_visual_actions" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/preflight_validate_write_payload",
    {
      tool_name: "apply_visual_actions",
      payload: {
        based_on_read_token: "rt_mock",
        write_anchor: {
          object_id: "GlobalObjectId_V1-mock",
          path: "Scene/Canvas",
        },
        actions: [],
      },
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(calls.length, 1);
});

test("ssot setup_cursor_mcp route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    nowIso: () => "2026-03-05T12:00:00.000Z",
    setupCursorMcpForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          data: {
            mode: payload.mode || "native",
            dry_run: payload.dry_run === true,
          },
        },
      };
    },
  };
  const context = {
    mode: "native",
    sidecar_base_url: "http://127.0.0.1:46321",
    dry_run: true,
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/setup_cursor_mcp",
    { mode: "native", sidecar_base_url: "ftp://127.0.0.1:46321", dry_run: true },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/setup_cursor_mcp",
    context,
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.data.mode, "native");
  assert.equal(calls.length, 1);
});

test("ssot verify_mcp_setup route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const turnService = {
    nowIso: () => "2026-03-05T12:00:00.000Z",
    verifyMcpSetupForMcp(payload) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          data: {
            ready: true,
            checks: [],
            mode_requested: payload.mode || "auto",
          },
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/verify_mcp_setup",
    { mode: "invalid" },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/verify_mcp_setup",
    { mode: "auto" },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(typeof valid.body.data.ready, "boolean");
});

test("ssot get_unity_task_status route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    getUnityTaskStatusForMcp(jobId) {
      calls.push(jobId);
      return {
        statusCode: 200,
        body: {
          ok: true,
          job_id: jobId,
          status: "running",
        },
      };
    },
  };

  const invalid = await dispatchQueryCommand(
    registry,
    "/mcp/get_unity_task_status",
    {},
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchQueryCommand(
    registry,
    "/mcp/get_unity_task_status",
    { job_id: "job_abc_123" },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.job_id, "job_abc_123");
  assert.equal(calls.length, 1);
});

test("ssot cancel_unity_task route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    cancelUnityTaskForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "cancelled",
          job_id: payload.job_id,
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/cancel_unity_task",
    {},
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/cancel_unity_task",
    { job_id: "job_cancel_1" },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.job_id, "job_cancel_1");
  assert.equal(calls.length, 1);
});

test("ssot submit_unity_task route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    submitUnityTaskForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          status: "accepted",
          job_id: "job_submit_1",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/submit_unity_task",
    {
      thread_id: "thread_1",
      idempotency_key: "idem_1",
      user_intent: "submit",
      based_on_read_token: "rt_mock",
      write_anchor: { object_id: "go", path: "Scene" },
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/submit_unity_task",
    {
      thread_id: "thread_1",
      idempotency_key: "idem_1",
      user_intent: "submit",
      based_on_read_token: "rt_mock",
      write_anchor: { object_id: "go", path: "Scene" },
      file_actions: [],
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.status, "accepted");
  assert.equal(calls.length, 1);
});

test("ssot apply_script_actions route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    applyScriptActionsForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          status: "accepted",
          job_id: "job_script_1",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/apply_script_actions",
    {
      based_on_read_token: "rt_mock",
      write_anchor: { object_id: "go", path: "Scene" },
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/apply_script_actions",
    {
      based_on_read_token: "rt_mock",
      write_anchor: { object_id: "go", path: "Scene" },
      actions: [],
      dry_run: true,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.status, "accepted");
  assert.equal(calls.length, 1);
});

test("ssot apply_visual_actions route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    applyVisualActionsForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          status: "accepted",
          job_id: "job_visual_1",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/apply_visual_actions",
    {
      based_on_read_token: "rt_mock",
      write_anchor: { object_id: "go", path: "Scene" },
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/apply_visual_actions",
    {
      based_on_read_token: "rt_mock",
      write_anchor: { object_id: "go", path: "Scene" },
      actions: [
        {
          type: "rename_object",
          target_anchor: { object_id: "go_target", path: "Scene/Canvas/B" },
          action_data: { name: "B_Renamed" },
        },
      ],
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.status, "accepted");
  assert.equal(calls.length, 1);
});

test("ssot set_ui_properties route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setUiPropertiesForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          status: "accepted",
          job_id: "job_set_ui_1",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_properties",
    {
      based_on_read_token: "rt_mock",
      write_anchor: { object_id: "go", path: "Scene" },
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_properties",
    {
      based_on_read_token: "rt_mock",
      write_anchor: { object_id: "go", path: "Scene" },
      operations: [
        {
          target_anchor: { object_id: "go_target", path: "Scene/Canvas/B" },
          rect_transform: {
            anchored_position: { x: 100, y: 100 },
            size_delta: { x: 160, y: 48 },
          },
        },
      ],
      dry_run: true,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.status, "accepted");
  assert.equal(calls.length, 1);
});

test("ssot set_serialized_property route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setSerializedPropertyForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_serialized_property",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_serialized_property",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_serialized_property",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_serialized_property_001",
      based_on_read_token: "ssot_rt_mock_set_serialized",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      component_type: "UnityEngine.RectTransform, UnityEngine.CoreModule",
      property_path: "m_AnchoredPosition.x",
      value_kind: "float",
      float_value: 12,
      dry_run: true,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_serialized_property");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].property_path, "m_AnchoredPosition.x");
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot hit_test_ui_at_screen_point route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    hitTestUiAtScreenPointForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "hit_test_ui_at_screen_point",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/hit_test_ui_at_screen_point",
    { x: "100", y: 100 },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/hit_test_ui_at_screen_point",
    {
      view_mode: "game",
      x: 100,
      y: 100,
      reference_width: 1280,
      reference_height: 720,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "hit_test_ui_at_screen_point");
  assert.equal(calls.length, 1);
});

test("ssot rename_object route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    renameObjectForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "rename_object",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/rename_object",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/rename_object",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_rename_object_001",
      based_on_read_token: "ssot_rt_mock_rename",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      new_name: "B_Renamed",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "rename_object");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_active route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setActiveForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_active",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_active",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      active: "false",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_active",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_active_001",
      based_on_read_token: "ssot_rt_mock_active",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      active: false,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_active");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].active, false);
});

test("ssot set_parent route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setParentForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_parent",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_parent",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      parent_object_id: "go_parent",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_parent",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_parent_001",
      based_on_read_token: "ssot_rt_mock_parent",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      parent_object_id: "go_parent",
      parent_path: "Scene/Canvas/Panel",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_parent");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parent_path, "Scene/Canvas/Panel");
});

test("ssot create_object route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    createObjectForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "create_object",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/create_object",
    {
      parent_object_id: "go_parent",
      parent_path: "Scene/Canvas",
      new_object_name: "NodeA",
      object_kind: "empty",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/create_object",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_create_object_001",
      based_on_read_token: "ssot_rt_mock_create",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      parent_object_id: "go_parent",
      parent_path: "Scene/Canvas",
      new_object_name: "NodeA",
      object_kind: "empty",
      set_active: true,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "create_object");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot delete_object route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    deleteObjectForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "delete_object",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/delete_object",
    {
      target_object_id: "go_target",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/delete_object",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_delete_object_001",
      based_on_read_token: "ssot_rt_mock_delete",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/NodeA",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "delete_object");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target_path, "Scene/Canvas/NodeA");
});

test("ssot set_sibling_index route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setSiblingIndexForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_sibling_index",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_sibling_index",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button",
      sibling_index: -1,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_sibling_index",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_sibling_index_001",
      based_on_read_token: "ssot_rt_mock_sibling",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button",
      sibling_index: 0,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_sibling_index");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].sibling_index, 0);
});

test("ssot add_component route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    addComponentForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "add_component",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/add_component",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/add_component",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_add_component_001",
      based_on_read_token: "ssot_rt_mock_add_component",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      component_type: "UnityEngine.CanvasGroup, UnityEngine.UI",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "add_component");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot remove_component route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    removeComponentForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "remove_component",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/remove_component",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/remove_component",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_remove_component_001",
      based_on_read_token: "ssot_rt_mock_remove_component",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      component_type: "UnityEngine.CanvasGroup, UnityEngine.UI",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "remove_component");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target_path, "Scene/Canvas/B");
});

test("ssot duplicate_object route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    duplicateObjectForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "duplicate_object",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/duplicate_object",
    {},
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/duplicate_object",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_duplicate_object_001",
      based_on_read_token: "ssot_rt_mock_duplicate",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      duplicate_name: "B_Copy",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "duplicate_object");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].duplicate_name, "B_Copy");
});

test("ssot replace_component route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    replaceComponentForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "replace_component",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/replace_component",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      source_component_type: "UnityEngine.UI.Text, UnityEngine.UI",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/replace_component",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_replace_component_001",
      based_on_read_token: "ssot_rt_mock_replace_component",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      source_component_type: "UnityEngine.UI.Text, UnityEngine.UI",
      new_component_type: "TMPro.TextMeshProUGUI, Unity.TextMeshPro",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "replace_component");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].new_component_type,
    "TMPro.TextMeshProUGUI, Unity.TextMeshPro"
  );
});

test("ssot set_local_position route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setLocalPositionForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_local_position",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_local_position",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 0,
      y: 0,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_local_position",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_local_position_001",
      based_on_read_token: "ssot_rt_mock_set_local_position",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 12,
      y: 34,
      z: 0,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_local_position");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_local_rotation route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setLocalRotationForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_local_rotation",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_local_rotation",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 0,
      y: 0,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_local_rotation",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_local_rotation_001",
      based_on_read_token: "ssot_rt_mock_set_local_rotation",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 10,
      y: 20,
      z: 30,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_local_rotation");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_local_scale route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setLocalScaleForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_local_scale",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_local_scale",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 1,
      y: 1,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_local_scale",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_local_scale_001",
      based_on_read_token: "ssot_rt_mock_set_local_scale",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 1,
      y: 2,
      z: 1,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_local_scale");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_world_position route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setWorldPositionForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_world_position",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_world_position",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 0,
      y: 0,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_world_position",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_world_position_001",
      based_on_read_token: "ssot_rt_mock_set_world_position",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 5,
      y: 6,
      z: 0,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_world_position");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_world_rotation route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setWorldRotationForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_world_rotation",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_world_rotation",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 0,
      y: 0,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_world_rotation",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_world_rotation_001",
      based_on_read_token: "ssot_rt_mock_set_world_rotation",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 0,
      y: 90,
      z: 0,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_world_rotation");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot reset_transform route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    resetTransformForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "reset_transform",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/reset_transform",
    {
      target_object_id: "go_target",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/reset_transform",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_reset_transform_001",
      based_on_read_token: "ssot_rt_mock_reset_transform",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "reset_transform");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_rect_anchored_position route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setRectAnchoredPositionForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_rect_anchored_position",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_rect_anchored_position",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 100,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_rect_anchored_position",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_rect_anchored_position_001",
      based_on_read_token: "ssot_rt_mock_set_rect_anchored_position",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 120,
      y: 80,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_rect_anchored_position");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_rect_size_delta route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setRectSizeDeltaForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_rect_size_delta",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_rect_size_delta",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 160,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_rect_size_delta",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_rect_size_delta_001",
      based_on_read_token: "ssot_rt_mock_set_rect_size_delta",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 160,
      y: 64,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_rect_size_delta");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_rect_pivot route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setRectPivotForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_rect_pivot",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_rect_pivot",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 0.5,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_rect_pivot",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_rect_pivot_001",
      based_on_read_token: "ssot_rt_mock_set_rect_pivot",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      x: 0.5,
      y: 0.5,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_rect_pivot");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_rect_anchors route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setRectAnchorsForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_rect_anchors",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_rect_anchors",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      min_x: 0,
      min_y: 0,
      max_x: 1,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_rect_anchors",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_rect_anchors_001",
      based_on_read_token: "ssot_rt_mock_set_rect_anchors",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/B",
      min_x: 0,
      min_y: 0,
      max_x: 1,
      max_y: 1,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_rect_anchors");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_canvas_group_alpha route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setCanvasGroupAlphaForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_canvas_group_alpha",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_canvas_group_alpha",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Panel",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_canvas_group_alpha",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_canvas_group_alpha_001",
      based_on_read_token: "ssot_rt_mock_set_canvas_group_alpha",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Panel",
      alpha: 0.5,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_canvas_group_alpha");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_layout_element route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setLayoutElementForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_layout_element",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_layout_element",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button",
      min_width: 100,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_layout_element",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_layout_element_001",
      based_on_read_token: "ssot_rt_mock_set_layout_element",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button",
      min_width: 120,
      min_height: 32,
      preferred_width: 160,
      preferred_height: 48,
      flexible_width: 0,
      flexible_height: 0,
      ignore_layout: false,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_layout_element");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_ui_image_color route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setUiImageColorForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_ui_image_color",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_image_color",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Image",
      r: 1,
      g: 0,
      b: 0,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_image_color",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_ui_image_color_001",
      based_on_read_token: "ssot_rt_mock_set_ui_image_color",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Image",
      r: 1,
      g: 0,
      b: 0,
      a: 1,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_ui_image_color");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_ui_image_raycast_target route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setUiImageRaycastTargetForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_ui_image_raycast_target",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_image_raycast_target",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Image",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_image_raycast_target",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_ui_image_raycast_target_001",
      based_on_read_token: "ssot_rt_mock_set_ui_image_raycast_target",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Image",
      raycast_target: false,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_ui_image_raycast_target");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_ui_text_content route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setUiTextContentForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_ui_text_content",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_text_content",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Label",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_text_content",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_ui_text_content_001",
      based_on_read_token: "ssot_rt_mock_set_ui_text_content",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Label",
      text: "Play",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_ui_text_content");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_ui_text_color route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setUiTextColorForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_ui_text_color",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_text_color",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Label",
      r: 1,
      g: 1,
      b: 1,
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_text_color",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_ui_text_color_001",
      based_on_read_token: "ssot_rt_mock_set_ui_text_color",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Label",
      r: 1,
      g: 1,
      b: 1,
      a: 1,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_ui_text_color");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot set_ui_text_font_size route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    setUiTextFontSizeForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "set_ui_text_font_size",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_text_font_size",
    {
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Label",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/set_ui_text_font_size",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_set_ui_text_font_size_001",
      based_on_read_token: "ssot_rt_mock_set_ui_text_font_size",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      target_object_id: "go_target",
      target_path: "Scene/Canvas/Button/Label",
      font_size: 24,
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "set_ui_text_font_size");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

test("ssot execute_unity_transaction route validates by SSOT schema then dispatches", async () => {
  const registry = getMcpCommandRegistry();
  const calls = [];
  const turnService = {
    executeUnityTransactionForMcp(payload) {
      calls.push(payload);
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: "execute_unity_transaction",
        },
      };
    },
  };

  const invalid = await dispatchBodyCommand(
    registry,
    "/mcp/execute_unity_transaction",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_execute_unity_transaction_001",
      based_on_read_token: "ssot_rt_mock_execute_unity_transaction",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      transaction_id: "txn_demo",
    },
    turnService
  );
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.body.error_code, "E_SSOT_SCHEMA_INVALID");

  const valid = await dispatchBodyCommand(
    registry,
    "/mcp/execute_unity_transaction",
    {
      execution_mode: "EXECUTE",
      idempotency_key: "idem_execute_unity_transaction_001",
      based_on_read_token: "ssot_rt_mock_execute_unity_transaction",
      write_anchor_object_id: "go_canvas",
      write_anchor_path: "Scene/Canvas",
      transaction_id: "txn_demo",
      steps_json:
        "[{\"tool_name\":\"set_active\",\"payload_json\":\"{\\\"target_object_id\\\":\\\"go_target\\\",\\\"target_path\\\":\\\"Scene/Canvas/Button\\\",\\\"active\\\":false}\"}]",
    },
    turnService
  );
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.ok, true);
  assert.equal(valid.body.tool_name, "execute_unity_transaction");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].execution_mode, "execute");
});

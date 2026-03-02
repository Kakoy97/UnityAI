"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { UnityMcpServer } = require("../../src/mcp/mcpServer");

test("tools/list uses minimal visual schema and includes lazy schema tools", async () => {
  const server = Object.create(UnityMcpServer.prototype);
  server.sidecarBaseUrl = "http://127.0.0.1:46321";
  server.httpRequest = async (method, url) => {
    const target = String(url || "");
    if (method === "GET" && target === "http://127.0.0.1:46321/mcp/capabilities") {
      return {
        ok: true,
        unity_connection_state: "ready",
        capability_version: "sha256:capability_v1",
        actions: [
          { type: "set_ui_image_color", description: "Set UI image color" },
          { type: "set_rect_transform", description: "Set rect transform" },
        ],
      };
    }
    return { ok: true };
  };

  const definitions = await server.getToolDefinitions();
  const names = definitions.map((item) => item.name);
  assert.equal(names.includes("get_action_catalog"), true);
  assert.equal(names.includes("get_action_schema"), true);
  assert.equal(names.includes("get_tool_schema"), true);
  assert.equal(names.includes("capture_scene_screenshot"), true);
  assert.equal(names.includes("get_ui_tree"), true);
  assert.equal(names.includes("get_serialized_property_tree"), true);
  assert.equal(names.includes("hit_test_ui_at_viewport_point"), true);
  assert.equal(names.includes("validate_ui_layout"), true);
  assert.equal(names.includes("set_ui_properties"), true);
  assert.equal(names.includes("set_serialized_property"), true);
  assert.equal(names.includes("hit_test_ui_at_screen_point"), false);

  const visual = definitions.find((item) => item.name === "apply_visual_actions");
  assert.ok(visual);
  assert.equal(typeof visual.description, "string");
  assert.equal(visual.description.includes("set_ui_image_color"), true);
  assert.equal(visual.description.includes("set_rect_transform"), true);
  assert.equal(
    visual.description.includes("get_action_catalog/get_action_schema"),
    true
  );
  assert.equal(
    visual.description.includes("get_tool_schema"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      visual.inputSchema.properties.actions.items.properties,
      "action_data"
    ),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      visual.inputSchema.properties.actions.items.properties,
      "action_data_json"
    ),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      visual.inputSchema.properties.actions.items,
      "oneOf"
    ),
    false
  );
  const actionSchema = definitions.find((item) => item.name === "get_action_schema");
  assert.ok(actionSchema);
  assert.equal(
    Object.prototype.hasOwnProperty.call(actionSchema.inputSchema.properties, "catalog_version"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(actionSchema.inputSchema.properties, "if_none_match"),
    true
  );
  const toolSchema = definitions.find((item) => item.name === "get_tool_schema");
  assert.ok(toolSchema);
  assert.equal(
    Array.isArray(toolSchema.inputSchema.required),
    true
  );
  assert.equal(
    toolSchema.inputSchema.required.includes("tool_name"),
    true
  );
  const screenshotSchema = definitions.find(
    (item) => item.name === "capture_scene_screenshot"
  );
  assert.ok(screenshotSchema);
  assert.equal(
    Array.isArray(screenshotSchema.inputSchema.properties.capture_mode.enum),
    true
  );
  assert.deepEqual(
    screenshotSchema.inputSchema.properties.capture_mode.enum,
    ["render_output"]
  );
  assert.equal(
    screenshotSchema.description.includes("render_output only"),
    true
  );
  assert.equal(
    screenshotSchema.description.includes("registry-backed"),
    true
  );
  const uiTreeSchema = definitions.find((item) => item.name === "get_ui_tree");
  assert.ok(uiTreeSchema);
  assert.equal(
    uiTreeSchema.description.includes("registry-backed"),
    true
  );
  const spTreeSchema = definitions.find(
    (item) => item.name === "get_serialized_property_tree"
  );
  assert.ok(spTreeSchema);
  assert.equal(
    Array.isArray(spTreeSchema.inputSchema.required),
    true
  );
  assert.equal(
    spTreeSchema.inputSchema.required.includes("target_anchor"),
    true
  );
  assert.equal(
    spTreeSchema.inputSchema.required.includes("component_selector"),
    true
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      screenshotSchema.inputSchema.properties,
      "capture_mode"
    ),
    true
  );
});

test("get_action_catalog/get_action_schema/get_tool_schema/capture_scene_screenshot/get_ui_tree/get_serialized_property_tree/hit_test_ui_at_viewport_point/validate_ui_layout/set_ui_properties/set_serialized_property tools map to sidecar endpoints", async () => {
  const server = Object.create(UnityMcpServer.prototype);
  server.sidecarBaseUrl = "http://127.0.0.1:46321";
  const calls = [];
  server.httpRequest = async (method, url, body) => {
    calls.push({
      method,
      url: String(url),
      body,
    });
    return { ok: true };
  };

  await server.getActionCatalog({
    domain: "ui",
    cursor: 0,
    limit: 10,
  });
  await server.getActionSchema({
    action_type: "set_ui_image_color",
  });
  await server.getToolSchema({
    tool_name: "apply_visual_actions",
  });
  await server.captureSceneScreenshot({
    view_mode: "scene",
    output_mode: "artifact_uri",
  });
  await server.getUiTree({
    ui_system: "ugui",
    max_depth: 2,
  });
  await server.getSerializedPropertyTree({
    target_anchor: {
      object_id: "go_button",
      path: "Scene/Canvas/Button",
    },
    component_selector: {
      component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
      component_index: 0,
    },
    depth: 1,
    page_size: 32,
  });
  await server.hitTestUiAtViewportPoint({
    coord_space: "viewport_px",
    x: 640,
    y: 360,
    resolution: {
      width: 1280,
      height: 720,
    },
  });
  await server.validateUiLayout({
    resolutions: [{ width: 1920, height: 1080 }],
    checks: ["OUT_OF_BOUNDS"],
  });
  await server.setUiProperties({
    based_on_read_token: "tok_set_ui_properties_123456789012345678",
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
        text: {
          content: "Play",
        },
      },
    ],
    dry_run: true,
  });
  await server.setSerializedProperty({
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
  });

  assert.deepEqual(calls, [
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/get_action_catalog",
      body: {
        domain: "ui",
        cursor: 0,
        limit: 10,
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/get_action_schema",
      body: {
        action_type: "set_ui_image_color",
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/get_tool_schema",
      body: {
        tool_name: "apply_visual_actions",
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/capture_scene_screenshot",
      body: {
        view_mode: "scene",
        output_mode: "artifact_uri",
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/get_ui_tree",
      body: {
        ui_system: "ugui",
        max_depth: 2,
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/get_serialized_property_tree",
      body: {
        target_anchor: {
          object_id: "go_button",
          path: "Scene/Canvas/Button",
        },
        component_selector: {
          component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
          component_index: 0,
        },
        depth: 1,
        page_size: 32,
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/hit_test_ui_at_viewport_point",
      body: {
        coord_space: "viewport_px",
        x: 640,
        y: 360,
        resolution: {
          width: 1280,
          height: 720,
        },
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/validate_ui_layout",
      body: {
        resolutions: [{ width: 1920, height: 1080 }],
        checks: ["OUT_OF_BOUNDS"],
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/set_ui_properties",
      body: {
        based_on_read_token: "tok_set_ui_properties_123456789012345678",
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
            text: {
              content: "Play",
            },
          },
        ],
        dry_run: true,
      },
    },
    {
      method: "POST",
      url: "http://127.0.0.1:46321/mcp/set_serialized_property",
      body: {
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
      },
    },
  ]);
});

test("hit_test_ui_at_screen_point wrapper is blocked by visibility policy", async () => {
  const server = Object.create(UnityMcpServer.prototype);
  server.sidecarBaseUrl = "http://127.0.0.1:46321";

  await assert.rejects(
    () =>
      server.hitTestUiAtScreenPoint({
        view_mode: "game",
        x: 120,
        y: 240,
      }),
    /Tool not enabled by visibility policy/
  );
});

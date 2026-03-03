"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  executeGetSerializedPropertyTree,
} = require("../../src/mcp/commands/get_serialized_property_tree/handler");

const REQUIRED_REQUEST = Object.freeze({
  target_anchor: {
    object_id: "go_button",
    path: "Scene/Canvas/Button",
  },
  component_selector: {
    component_assembly_qualified_name: "UnityEngine.UI.Image, UnityEngine.UI",
    component_index: 0,
  },
});

test("get_serialized_property_tree handler injects defaults and returns read token", async () => {
  let capturedRequest = null;
  const outcome = await executeGetSerializedPropertyTree(
    {
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          capturedRequest = request;
          return {
            ok: true,
            captured_at: "2026-03-02T00:00:02.000Z",
            data: {
              returned_count: 1,
              truncated: true,
              truncated_reason: "NODE_BUDGET_EXCEEDED",
              next_cursor: "m_Script",
              nodes: [{ property_path: "m_Script" }],
            },
          };
        },
      },
      snapshotService: {
        issueReadTokenForQueryResult(queryType, unityResponse, payload) {
          assert.equal(queryType, "get_serialized_property_tree");
          assert.equal(unityResponse.ok, true);
          assert.equal(payload.depth, 1);
          assert.equal(payload.page_size, 64);
          assert.equal(payload.node_budget, 128);
          assert.equal(payload.char_budget, 12000);
          assert.equal(payload.include_value_summary, true);
          assert.equal(payload.include_non_visible, false);
          return { token: "readtok_sp_tree_handler_001" };
        },
      },
      nowIso: () => "2026-03-02T00:00:00.000Z",
    },
    {
      ...REQUIRED_REQUEST,
    }
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.equal(outcome.body.read_token.token, "readtok_sp_tree_handler_001");
  assert.equal(outcome.body.data.truncated, true);
  assert.equal(outcome.body.data.truncated_reason, "NODE_BUDGET_EXCEEDED");
  assert.equal(outcome.body.data.next_cursor, "m_Script");

  assert.ok(capturedRequest);
  assert.equal(capturedRequest.queryType, "get_serialized_property_tree");
  assert.equal(capturedRequest.timeoutMs, undefined);
  assert.equal(capturedRequest.payload.depth, 1);
  assert.equal(capturedRequest.payload.page_size, 64);
  assert.equal(capturedRequest.payload.node_budget, 128);
  assert.equal(capturedRequest.payload.char_budget, 12000);
  assert.equal(capturedRequest.payload.include_value_summary, true);
  assert.equal(capturedRequest.payload.include_non_visible, false);
});

test("get_serialized_property_tree handler maps Unity terminal not-found errors to 404", async () => {
  const outcome = await executeGetSerializedPropertyTree(
    {
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery() {
          return {
            ok: false,
            error_code: "E_PROPERTY_NOT_FOUND",
            error_message: "root_property_path not found: m_Missing",
          };
        },
      },
    },
    {
      ...REQUIRED_REQUEST,
    }
  );

  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.error_code, "E_PROPERTY_NOT_FOUND");
});

test("get_serialized_property_tree handler maps query throw cursor-miss to 404", async () => {
  const outcome = await executeGetSerializedPropertyTree(
    {
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery() {
          throw {
            error_code: "E_CURSOR_NOT_FOUND",
            message: "after_property_path not found",
            recoverable: true,
          };
        },
      },
    },
    {
      ...REQUIRED_REQUEST,
    }
  );

  assert.equal(outcome.statusCode, 404);
  assert.equal(outcome.body.error_code, "E_CURSOR_NOT_FOUND");
  assert.equal(typeof outcome.body.recoverable, "boolean");
});

test("get_serialized_property_tree handler forwards component_selectors and normalizes grouped components", async () => {
  let capturedRequest = null;
  const outcome = await executeGetSerializedPropertyTree(
    {
      queryCoordinator: {
        async enqueueAndWaitForUnityQuery(request) {
          capturedRequest = request;
          return {
            ok: true,
            data: {
              returned_count: 1,
              truncated: false,
              nodes: [{ property_path: "m_Color", llm_hint: "hint-a", common_use: true }],
              components: [
                {
                  selector_index: 0,
                  component: { type: "UnityEngine.RectTransform, UnityEngine.CoreModule" },
                  returned_count: 1,
                  truncated: false,
                  nodes: [{ property_path: "m_AnchoredPosition", llm_hint: "hint-b", common_use: true }],
                },
                {
                  selector_index: 1,
                  component: { type: "UnityEngine.UI.Image, UnityEngine.UI" },
                  nodes: [{ property_path: "m_Color", llm_hint: "hint-c", common_use: true }],
                },
              ],
            },
          };
        },
      },
    },
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
    }
  );

  assert.equal(outcome.statusCode, 200);
  assert.equal(outcome.body.ok, true);
  assert.ok(capturedRequest);
  assert.equal(capturedRequest.queryType, "get_serialized_property_tree");
  assert.equal(Array.isArray(capturedRequest.payload.component_selectors), true);
  assert.equal(capturedRequest.payload.component_selectors.length, 2);
  assert.equal(Array.isArray(outcome.body.data.components), true);
  assert.equal(outcome.body.data.components.length, 2);
  assert.equal(outcome.body.data.components[1].returned_count, 1);
});

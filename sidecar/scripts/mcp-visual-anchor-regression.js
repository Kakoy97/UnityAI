#!/usr/bin/env node
"use strict";

const { TurnStore } = require("../src/domain/turnStore");
const { TurnService } = require("../src/application/turnService");

function nowIso() {
  return new Date().toISOString();
}

function createService() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  return new TurnService({
    turnStore,
    nowIso,
    enableMcpAdapter: true,
    enableMcpEyes: true,
    fileActionExecutor: {
      execute(actions) {
        return {
          ok: true,
          changes: Array.isArray(actions) ? actions : [],
        };
      },
    },
  });
}

function seedSnapshot(service) {
  service.recordLatestSelectionContext(
    {
      scene_revision: "rev_anchor_test_1",
      selection: {
        mode: "selection",
        object_id: "go_root",
        target_object_path: "Scene/Root",
      },
      selection_tree: {
        max_depth: 2,
        truncated_node_count: 0,
        truncated_reason: "",
        root: {
          name: "Root",
          object_id: "go_root",
          path: "Scene/Root",
          depth: 0,
          components: ["Transform"],
          children: [
            {
              name: "Image",
              object_id: "go_image",
              path: "Scene/Root/Image",
              depth: 1,
              components: ["RectTransform", "UnityEngine.UI.Image"],
              children: [],
              children_truncated_count: 0,
            },
          ],
          children_truncated_count: 0,
        },
      },
    },
    {
      source: "mcp-visual-anchor-regression",
      requestId: "req_anchor_seed",
      threadId: "t_anchor_seed",
      turnId: "u_anchor_seed",
    }
  );
}

function issueReadToken(service) {
  const snapshot = service.unitySnapshotService.getLatestSelectionSnapshot();
  if (!snapshot || !snapshot.selection) {
    throw new Error("failed to get latest selection snapshot for read token");
  }
  const issued = service.unitySnapshotService.issueReadTokenForSelection(snapshot, {
    target_object_id: snapshot.selection.object_id || "",
    target_object_path: snapshot.selection.target_object_path || "",
  });
  const token = issued && typeof issued.token === "string" ? issued.token : "";
  if (!token) {
    throw new Error("issueReadTokenForSelection did not return token");
  }
  return token;
}

function assertCase(name, condition, detail) {
  if (!condition) {
    throw new Error(`${name}: ${detail}`);
  }
}

function runCaseObjectIdOnly(service, token) {
  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    dry_run: true,
    actions: [
      {
        type: "add_component",
        target_anchor: {
          object_id: "go_image",
          path: "Scene/Root/Image",
        },
        component_assembly_qualified_name:
          "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
      },
    ],
  });
  assertCase(
    "object_id_only",
    outcome && outcome.statusCode === 200,
    `expected status=200, got ${outcome ? outcome.statusCode : "null"}`
  );
}

function runCaseUnionMismatch(service, token) {
  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    dry_run: true,
    actions: [
      {
        type: "create_gameobject",
        name: "InvalidCreateWithTarget",
        target_anchor: {
          object_id: "go_image",
          path: "Scene/Root",
        },
        primitive_type: "Cube",
      },
    ],
  });
  const statusCode = outcome ? outcome.statusCode : 0;
  const errorCode =
    outcome &&
    outcome.body &&
    typeof outcome.body.error_code === "string" &&
    outcome.body.error_code
      ? outcome.body.error_code
      : "";
  assertCase(
    "anchor_union_mismatch",
    statusCode === 400 && errorCode === "E_ACTION_SCHEMA_INVALID",
    `expected 400/E_ACTION_SCHEMA_INVALID, got ${statusCode}/${errorCode}`
  );
}

function runCaseCreateByParentObjectId(service, token) {
  const outcome = service.applyVisualActionsForMcp({
    based_on_read_token: token,
    write_anchor: {
      object_id: "go_root",
      path: "Scene/Root",
    },
    dry_run: true,
    actions: [
      {
        type: "create_gameobject",
        name: "AnchorCreated",
        parent_anchor: {
          object_id: "go_root",
          path: "Scene/Root",
        },
        primitive_type: "Cube",
      },
    ],
  });
  assertCase(
    "create_parent_object_id",
    outcome && outcome.statusCode === 200,
    `expected status=200, got ${outcome ? outcome.statusCode : "null"}`
  );
}

function main() {
  const service = createService();
  seedSnapshot(service);
  const token = issueReadToken(service);
  runCaseObjectIdOnly(service, token);
  runCaseUnionMismatch(service, token);
  runCaseCreateByParentObjectId(service, token);
  console.log("[mcp-visual-anchor] total=3 pass=3 fail=0");
}

try {
  main();
} catch (err) {
  const message =
    err && typeof err.message === "string" ? err.message : String(err);
  console.error(`[mcp-visual-anchor] fail: ${message}`);
  process.exitCode = 1;
}

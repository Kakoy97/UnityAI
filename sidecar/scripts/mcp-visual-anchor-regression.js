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
  const service = new TurnService({
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
  service.enqueueAndWaitForUnityQuery = async (options) => {
    const source = options && typeof options === "object" ? options : {};
    const payload =
      source.payload && typeof source.payload === "object" ? source.payload : {};
    const toolName =
      typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
    const payloadJson =
      typeof payload.payload_json === "string" ? payload.payload_json : "{}";
    const requestPayload = JSON.parse(payloadJson);

    if (toolName !== "apply_visual_actions") {
      return {
        ok: false,
        error_code: "E_SSOT_TOOL_UNSUPPORTED",
        error_message: `Unsupported tool in visual anchor regression stub: ${toolName}`,
      };
    }

    const actions = Array.isArray(requestPayload.actions)
      ? requestPayload.actions
      : [];
    const hasCreateWithTargetAnchor = actions.some(
      (item) =>
        item &&
        typeof item === "object" &&
        item.type === "create_gameobject" &&
        item.target_anchor &&
        typeof item.target_anchor === "object"
    );
    if (hasCreateWithTargetAnchor) {
      return {
        ok: false,
        error_code: "E_ACTION_SCHEMA_INVALID",
        error_message:
          "create_gameobject requires parent_anchor and must not provide target_anchor",
      };
    }

    return {
      ok: true,
      data: {
        scene_revision: "rev_anchor_test_1",
      },
    };
  };
  return service;
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
  const revisionUpdate = service.ssotRevisionState.updateLatestKnownSceneRevision(
    snapshot.scene_revision || "",
    {
      source_tool_name: "mcp-visual-anchor-regression",
      source_query_type: "ssot.request",
    }
  );
  if (!revisionUpdate || revisionUpdate.ok !== true) {
    throw new Error("failed to prime ssot revision state for read token");
  }

  const issued = service.ssotTokenRegistry.issueToken({
    scene_revision: snapshot.scene_revision || "",
    scope_kind: "scene",
    object_id: snapshot.selection.object_id || "",
    path: snapshot.selection.target_object_path || "",
    source_tool_name: "mcp-visual-anchor-regression",
  });
  const token =
    issued && issued.ok === true && typeof issued.token === "string"
      ? issued.token
      : "";
  if (!token) {
    throw new Error("ssot token registry did not return token");
  }
  return token;
}

function assertCase(name, condition, detail) {
  if (!condition) {
    throw new Error(`${name}: ${detail}`);
  }
}

async function runCaseObjectIdOnly(service, token) {
  const outcome = await service.dispatchSsotToolForMcp("apply_visual_actions", {
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

async function runCaseUnionMismatch(service, token) {
  const outcome = await service.dispatchSsotToolForMcp("apply_visual_actions", {
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
    statusCode === 409 && errorCode === "E_ACTION_SCHEMA_INVALID",
    `expected 409/E_ACTION_SCHEMA_INVALID, got ${statusCode}/${errorCode}`
  );
}

async function runCaseCreateByParentObjectId(service, token) {
  const outcome = await service.dispatchSsotToolForMcp("apply_visual_actions", {
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

async function main() {
  const service = createService();
  seedSnapshot(service);
  const token = issueReadToken(service);
  await runCaseObjectIdOnly(service, token);
  await runCaseUnionMismatch(service, token);
  await runCaseCreateByParentObjectId(service, token);
  console.log("[mcp-visual-anchor] total=3 pass=3 fail=0");
}

try {
  Promise.resolve(main()).catch((err) => {
    const message =
      err && typeof err.message === "string" ? err.message : String(err);
    console.error(`[mcp-visual-anchor] fail: ${message}`);
    process.exitCode = 1;
  });
} catch (err) {
  const message =
    err && typeof err.message === "string" ? err.message : String(err);
  console.error(`[mcp-visual-anchor] fail: ${message}`);
  process.exitCode = 1;
}

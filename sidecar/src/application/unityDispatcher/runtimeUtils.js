"use strict";

const {
  cloneJson,
  normalizeObjectId,
  normalizeApprovalMode,
  normalizeNonEmptyString,
} = require("../../utils/turnUtils");

function normalizeRuntime(job) {
  const item = job && typeof job === "object" ? job : {};
  const task = item.task_allocation && typeof item.task_allocation === "object"
    ? item.task_allocation
    : {};
  const runtime = item.runtime && typeof item.runtime === "object"
    ? cloneJson(item.runtime)
    : {};
  const fileActions = Array.isArray(runtime.file_actions)
    ? runtime.file_actions
    : Array.isArray(task.file_actions)
      ? task.file_actions
      : [];
  const visualActions = Array.isArray(runtime.visual_actions)
    ? runtime.visual_actions
    : Array.isArray(task.visual_layer_actions)
      ? task.visual_layer_actions
      : [];
  const rebootWaitStartedAt =
    Number.isFinite(Number(runtime.reboot_wait_started_at)) &&
    Number(runtime.reboot_wait_started_at) > 0
      ? Math.floor(Number(runtime.reboot_wait_started_at))
      : 0;
  return {
    file_actions: cloneJson(fileActions),
    visual_actions: cloneJson(visualActions),
    file_actions_applied: runtime.file_actions_applied === true,
    files_changed: Array.isArray(runtime.files_changed)
      ? cloneJson(runtime.files_changed)
      : [],
    next_visual_index:
      Number.isFinite(Number(runtime.next_visual_index)) &&
      Number(runtime.next_visual_index) >= 0
        ? Math.floor(Number(runtime.next_visual_index))
        : 0,
    phase:
      typeof runtime.phase === "string" && runtime.phase.trim()
        ? runtime.phase.trim()
        : "accepted",
    compile_success:
      typeof runtime.compile_success === "boolean" ? runtime.compile_success : null,
    last_compile_request:
      runtime.last_compile_request && typeof runtime.last_compile_request === "object"
        ? cloneJson(runtime.last_compile_request)
        : null,
    last_action_request:
      runtime.last_action_request && typeof runtime.last_action_request === "object"
        ? cloneJson(runtime.last_action_request)
        : null,
    last_compile_result:
      runtime.last_compile_result && typeof runtime.last_compile_result === "object"
        ? cloneJson(runtime.last_compile_result)
        : null,
    last_action_result:
      runtime.last_action_result && typeof runtime.last_action_result === "object"
        ? cloneJson(runtime.last_action_result)
        : null,
    last_action_error:
      runtime.last_action_error && typeof runtime.last_action_error === "object"
        ? cloneJson(runtime.last_action_error)
        : null,
    reboot_wait_started_at: rebootWaitStartedAt,
  };
}

function getPendingVisualAction(runtime) {
  const visualActions =
    runtime && Array.isArray(runtime.visual_actions) ? runtime.visual_actions : [];
  const index =
    runtime &&
    Number.isFinite(Number(runtime.next_visual_index)) &&
    Number(runtime.next_visual_index) >= 0
      ? Math.floor(Number(runtime.next_visual_index))
      : 0;
  return visualActions[index] && typeof visualActions[index] === "object"
    ? cloneJson(visualActions[index])
    : null;
}

function buildCompileRequest(job, nowIso, reason) {
  const item = job && typeof job === "object" ? job : {};
  return {
    event: "unity.compile.request",
    request_id: item.request_id || "",
    thread_id: item.thread_id || "",
    turn_id: item.turn_id || "",
    reason: typeof reason === "string" && reason ? reason : "file_actions_applied",
    refresh_assets: true,
    timestamp: nowIso(),
  };
}

function buildUnityActionRequest(job, action, nowIso) {
  const item = action && typeof action === "object" ? action : {};
  const owner = job && typeof job === "object" ? job : {};
  const basedOnReadToken =
    typeof owner.based_on_read_token === "string"
      ? owner.based_on_read_token
      : "";
  const writeAnchor = buildAnchorObject(owner && owner.write_anchor, []);
  return {
    event: "unity.action.request",
    request_id: owner.request_id || "",
    thread_id: owner.thread_id || "",
    turn_id: owner.turn_id || "",
    timestamp: nowIso(),
    payload: {
      based_on_read_token: basedOnReadToken,
      write_anchor: writeAnchor || null,
      requires_confirmation:
        normalizeApprovalMode(owner.approval_mode, "auto") === "require_user",
      action: buildVisualActionPayload(item),
    },
  };
}

function buildAnchorObject(rawAnchor, fallback) {
  const source =
    rawAnchor && typeof rawAnchor === "object" && !Array.isArray(rawAnchor)
      ? rawAnchor
      : {};
  const fallbackList = Array.isArray(fallback) ? fallback : [];
  const objectId = normalizeObjectId(
    source.object_id,
    source.target_object_id,
    source.parent_object_id,
    ...fallbackList
  );
  const path = normalizeNonEmptyString(
    source.path,
    source.target_object_path,
    source.parent_object_path,
    source.target_path,
    source.parent_path
  );
  if (!objectId || !path) {
    return null;
  }
  return {
    object_id: objectId,
    path,
  };
}

function buildVisualActionPayload(action) {
  const item = action && typeof action === "object" ? action : {};
  const payload = {
    type: typeof item.type === "string" ? item.type : "",
  };

  if (typeof item.target === "string") {
    payload.target = item.target;
  }

  const targetAnchor = buildAnchorObject(item.target_anchor, [
    item.target_object_id,
    item.object_id,
  ]);
  if (targetAnchor) {
    payload.target_anchor = targetAnchor;
  }

  const parentAnchor = buildAnchorObject(item.parent_anchor, [
    item.parent_object_id,
    item.target_object_id,
    item.object_id,
  ]);
  if (parentAnchor) {
    payload.parent_anchor = parentAnchor;
  }

  const stringFields = [
    "component_assembly_qualified_name",
    "source_component_assembly_qualified_name",
    "component_name",
    "remove_mode",
    "object_type",
    "primitive_type",
    "ui_type",
    "name",
  ];
  for (const field of stringFields) {
    if (typeof item[field] === "string") {
      payload[field] = item[field];
    }
  }

  if (
    Number.isFinite(Number(item.expected_count)) &&
    Number(item.expected_count) >= 0
  ) {
    payload.expected_count = Math.floor(Number(item.expected_count));
  }

  return payload;
}

function matchActionResult(expectedAction, actualPayload) {
  const expected = expectedAction && typeof expectedAction === "object"
    ? expectedAction
    : {};
  const actual = actualPayload && typeof actualPayload === "object"
    ? actualPayload
    : {};
  const expectedType = typeof expected.type === "string" ? expected.type : "";
  const actualType = typeof actual.action_type === "string" ? actual.action_type : "";
  const expectedTargetPath =
    typeof expected.target_object_path === "string" && expected.target_object_path.trim()
      ? expected.target_object_path.trim()
      : typeof expected.parent_object_path === "string" && expected.parent_object_path.trim()
        ? expected.parent_object_path.trim()
        : "";
  const actualTargetPath =
    typeof actual.target_object_path === "string" && actual.target_object_path.trim()
      ? actual.target_object_path.trim()
      : typeof actual.parent_object_path === "string" && actual.parent_object_path.trim()
        ? actual.parent_object_path.trim()
        : typeof actual.parent_path === "string" && actual.parent_path.trim()
          ? actual.parent_path.trim()
          : typeof actual.target === "string" && actual.target.trim()
            ? actual.target.trim()
            : "";
  const expectedTargetObjectId = normalizeObjectId(
    expected.target_object_id,
    expected.object_id,
    expected.parent_object_id
  );
  const actualTargetObjectId = normalizeObjectId(
    actual.target_object_id,
    actual.object_id,
    actual.parent_object_id
  );
  const diff = [];
  if (expectedType && actualType && expectedType !== actualType) {
    diff.push("/payload/action_type");
  }
  if (expectedTargetPath && actualTargetPath && expectedTargetPath !== actualTargetPath) {
    diff.push("/payload/target_object_path");
  }
  if (
    expectedTargetObjectId &&
    actualTargetObjectId &&
    expectedTargetObjectId !== actualTargetObjectId
  ) {
    diff.push("/payload/target_object_id");
  }
  return {
    ok: diff.length === 0,
    message:
      diff.length === 0
        ? ""
        : "unity.action.result does not match pending visual action",
    expected: {
      action_type: expectedType,
      target_object_path: expectedTargetPath,
      target_object_id: expectedTargetObjectId,
    },
    actual: {
      action_type: actualType,
      target_object_path: actualTargetPath,
      target_object_id: actualTargetObjectId,
    },
    diff,
  };
}

module.exports = {
  normalizeRuntime,
  getPendingVisualAction,
  buildCompileRequest,
  buildUnityActionRequest,
  matchActionResult,
};

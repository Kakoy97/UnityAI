"use strict";

const {
  cloneJson,
  normalizeObjectId,
  normalizeApprovalMode,
  normalizeNonEmptyString,
} = require("../../utils/turnUtils");
const {
  buildVisualActionDataBridge,
} = require("../turnPayloadBuilders");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

const LEGACY_ANCHOR_MODE_WARN = "warn";
const LEGACY_ANCHOR_MODE_DENY = "deny";
const LEGACY_ANCHOR_FIELDS = Object.freeze([
  "target_object_id",
  "parent_object_id",
  "target_object_path",
  "parent_object_path",
  "target_path",
  "parent_path",
]);

function normalizeLegacyAnchorMode(value) {
  if (value === LEGACY_ANCHOR_MODE_DENY) {
    return LEGACY_ANCHOR_MODE_DENY;
  }
  return LEGACY_ANCHOR_MODE_WARN;
}

function collectLegacyAnchorSourceFieldHits(source) {
  const fields = [];
  for (const field of LEGACY_ANCHOR_FIELDS) {
    if (isNonEmptyString(source[field])) {
      fields.push(field);
    }
  }
  return Array.from(new Set(fields));
}

function resolveAnchorCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (const candidate of list) {
    const item = candidate && typeof candidate === "object" ? candidate : {};
    if (!isNonEmptyString(item.value)) {
      continue;
    }
    return {
      value: item.value.trim(),
      field:
        typeof item.field === "string" && item.field.trim()
          ? item.field.trim()
          : "",
      legacy: item.legacy === true,
    };
  }
  return {
    value: "",
    field: "",
    legacy: false,
  };
}

function createLegacyAnchorModeError(details) {
  const item = details && typeof details === "object" ? details : {};
  const anchorKind =
    typeof item.anchorKind === "string" && item.anchorKind.trim()
      ? item.anchorKind.trim()
      : "anchor";
  const actionType =
    typeof item.actionType === "string" && item.actionType.trim()
      ? item.actionType.trim()
      : "";
  const legacyFields = Array.isArray(item.legacyFields)
    ? item.legacyFields.filter((field) => typeof field === "string" && field.trim())
    : [];
  const legacySummary = legacyFields.length > 0 ? legacyFields.join(", ") : "legacy fields";
  const prefix = actionType
    ? `Action "${actionType}" uses ${anchorKind} legacy fields`
    : `${anchorKind} uses legacy fields`;
  const error = new Error(
    `${prefix}: ${legacySummary}. Use ${anchorKind}.object_id and ${anchorKind}.path.`
  );
  error.code = "E_ACTION_SCHEMA_INVALID";
  error.anchor_kind = anchorKind;
  error.action_type = actionType;
  error.legacy_fields = legacyFields;
  return error;
}

function normalizeRuntime(job) {
  const item = job && typeof job === "object" ? job : {};
  const runtime = item.runtime && typeof item.runtime === "object"
    ? cloneJson(item.runtime)
    : {};
  const fileActions = Array.isArray(runtime.file_actions)
    ? runtime.file_actions
    : [];
  const visualActions = Array.isArray(runtime.visual_actions)
    ? runtime.visual_actions
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

function buildUnityActionRequest(job, action, nowIso, options) {
  const item = action && typeof action === "object" ? action : {};
  const owner = job && typeof job === "object" ? job : {};
  const opts = options && typeof options === "object" ? options : {};
  const basedOnReadToken =
    typeof owner.based_on_read_token === "string"
      ? owner.based_on_read_token
      : "";
  const writeAnchorResult = buildAnchorObject(
    owner && owner.write_anchor,
    [],
    {
      legacyAnchorMode: normalizeLegacyAnchorMode(opts.legacyAnchorMode),
      onLegacyAnchorFallback: opts.onLegacyAnchorFallback,
      actionType: typeof item.type === "string" ? item.type : "",
      anchorKind: "write_anchor",
    }
  );
  if (writeAnchorResult.error) {
    throw writeAnchorResult.error;
  }
  const writeAnchor = writeAnchorResult.anchor;
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
      action: buildVisualActionPayload(item, options),
    },
  };
}

function buildAnchorObject(rawAnchor, fallback, options) {
  const source = isObject(rawAnchor) ? rawAnchor : {};
  const fallbackObject =
    fallback && typeof fallback === "object" && !Array.isArray(fallback)
      ? fallback
      : {};
  const fallbackIds = Array.isArray(fallback)
    ? fallback
    : Array.isArray(fallbackObject.objectIds)
      ? fallbackObject.objectIds
      : [];
  const fallbackPaths = Array.isArray(fallbackObject.paths)
    ? fallbackObject.paths
    : [];
  const opts = options && typeof options === "object" ? options : {};
  const legacyAnchorMode = normalizeLegacyAnchorMode(opts.legacyAnchorMode);
  const onLegacyAnchorFallback =
    typeof opts.onLegacyAnchorFallback === "function"
      ? opts.onLegacyAnchorFallback
      : null;
  const actionType =
    typeof opts.actionType === "string" && opts.actionType.trim()
      ? opts.actionType.trim()
      : "";
  const anchorKind =
    typeof opts.anchorKind === "string" && opts.anchorKind.trim()
      ? opts.anchorKind.trim()
      : "anchor";

  const objectCandidate = resolveAnchorCandidate([
    {
      value: source.object_id,
      field: "object_id",
      legacy: false,
    },
    {
      value: source.target_object_id,
      field: "target_object_id",
      legacy: true,
    },
    {
      value: source.parent_object_id,
      field: "parent_object_id",
      legacy: true,
    },
    ...fallbackIds.map((value, index) => ({
      value,
      field: `$fallback.object_ids[${index}]`,
      legacy: true,
    })),
  ]);
  const pathCandidate = resolveAnchorCandidate([
    {
      value: source.path,
      field: "path",
      legacy: false,
    },
    {
      value: source.target_object_path,
      field: "target_object_path",
      legacy: true,
    },
    {
      value: source.parent_object_path,
      field: "parent_object_path",
      legacy: true,
    },
    {
      value: source.target_path,
      field: "target_path",
      legacy: true,
    },
    {
      value: source.parent_path,
      field: "parent_path",
      legacy: true,
    },
    ...fallbackPaths.map((value, index) => ({
      value,
      field: `$fallback.paths[${index}]`,
      legacy: true,
    })),
  ]);
  const objectId = objectCandidate.value;
  const path = pathCandidate.value;
  const hasAnchor = !!objectId && !!path;
  const legacyFieldHits = Array.from(
    new Set([
      ...collectLegacyAnchorSourceFieldHits(source),
      ...(hasAnchor && objectCandidate.legacy && objectCandidate.field
        ? [objectCandidate.field]
        : []),
      ...(hasAnchor && pathCandidate.legacy && pathCandidate.field
        ? [pathCandidate.field]
        : []),
    ])
  );
  if (legacyFieldHits.length > 0) {
    if (legacyAnchorMode === LEGACY_ANCHOR_MODE_DENY) {
      return {
        anchor: null,
        error: createLegacyAnchorModeError({
          anchorKind,
          actionType,
          legacyFields: legacyFieldHits,
        }),
      };
    }
    if (onLegacyAnchorFallback) {
      onLegacyAnchorFallback({
        action_type: actionType,
        anchor_kind: anchorKind,
        legacy_fields: legacyFieldHits,
      });
    }
  }
  if (!objectId || !path) {
    return {
      anchor: null,
      error: null,
    };
  }
  return {
    anchor: {
      object_id: objectId,
      path,
    },
    error: null,
  };
}

function buildVisualActionPayload(action, options) {
  const item = action && typeof action === "object" ? action : {};
  const opts = options && typeof options === "object" ? options : {};
  const payload = {
    type: typeof item.type === "string" ? item.type : "",
  };

  if (typeof item.target === "string") {
    payload.target = item.target;
  }

  const targetAnchorResult = buildAnchorObject(
    item.target_anchor,
    {
      objectIds: [item.target_object_id, item.object_id],
      paths: [item.target_object_path, item.target_path],
    },
    {
      legacyAnchorMode: normalizeLegacyAnchorMode(opts.legacyAnchorMode),
      onLegacyAnchorFallback: opts.onLegacyAnchorFallback,
      actionType: payload.type,
      anchorKind: "target_anchor",
    }
  );
  if (targetAnchorResult.error) {
    throw targetAnchorResult.error;
  }
  if (targetAnchorResult.anchor) {
    payload.target_anchor = targetAnchorResult.anchor;
  }

  const parentAnchorResult = buildAnchorObject(
    item.parent_anchor,
    {
      objectIds: [item.parent_object_id, item.target_object_id, item.object_id],
      paths: [item.parent_object_path, item.parent_path],
    },
    {
      legacyAnchorMode: normalizeLegacyAnchorMode(opts.legacyAnchorMode),
      onLegacyAnchorFallback: opts.onLegacyAnchorFallback,
      actionType: payload.type,
      anchorKind: "parent_anchor",
    }
  );
  if (parentAnchorResult.error) {
    throw parentAnchorResult.error;
  }
  if (parentAnchorResult.anchor) {
    payload.parent_anchor = parentAnchorResult.anchor;
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

  const actionDataBridge = buildVisualActionDataBridge(item);
  payload.action_data = actionDataBridge.action_data;
  payload.action_data_json = actionDataBridge.action_data_json;

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

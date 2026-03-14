"use strict";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function parseVisualActionAsObject(rawAction, index) {
  if (isPlainObject(rawAction)) {
    return {
      ok: true,
      action: { ...rawAction },
    };
  }
  if (typeof rawAction === "string") {
    const trimmed = normalizeString(rawAction);
    if (!trimmed) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        errorMessage: `workflow attach requires non-empty visual_layer_actions[${index}]`,
      };
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!isPlainObject(parsed)) {
        return {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          errorMessage:
            `workflow attach requires visual_layer_actions[${index}] JSON object when resolved_target is present`,
        };
      }
      return {
        ok: true,
        action: { ...parsed },
      };
    } catch (_error) {
      return {
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        errorMessage:
          `workflow attach requires visual_layer_actions[${index}] to be object or JSON object string when resolved_target is present`,
      };
    }
  }
  return {
    ok: false,
    errorCode: "E_SCHEMA_INVALID",
    errorMessage:
      `workflow attach requires visual_layer_actions[${index}] to be object or JSON object string`,
  };
}

function extractActionTarget(action) {
  const source = isPlainObject(action) ? action : {};
  const anchor = isPlainObject(source.target_anchor) ? source.target_anchor : {};
  const objectId =
    normalizeString(anchor.object_id) || normalizeString(source.target_object_id);
  const path = normalizeString(anchor.path) || normalizeString(source.target_path);
  return {
    object_id: objectId,
    path,
  };
}

function checkResolvedTargetConflict({
  explicitObjectId,
  explicitPath,
  resolvedTargetId,
  resolvedTargetPath,
  contextLabel,
}) {
  const normalizedObjectId = normalizeString(explicitObjectId);
  if (normalizedObjectId && normalizedObjectId !== resolvedTargetId) {
    return {
      ok: false,
      errorCode: "E_WORKFLOW_RESOLVED_TARGET_CONFLICT",
      errorMessage:
        `${contextLabel} target_object_id conflicts with resolved_target_id`,
    };
  }
  const normalizedPath = normalizeString(explicitPath);
  if (normalizedPath && normalizedPath !== resolvedTargetPath) {
    return {
      ok: false,
      errorCode: "E_WORKFLOW_RESOLVED_TARGET_CONFLICT",
      errorMessage: `${contextLabel} target_path conflicts with resolved_target_path`,
    };
  }
  return {
    ok: true,
  };
}

function bindResolvedTargetForAttachVisualActions({
  visualLayerActions,
  resolvedTarget,
  blockTargetAnchor,
}) {
  if (!Array.isArray(visualLayerActions)) {
    return {
      ok: false,
      errorCode: "E_SCHEMA_INVALID",
      errorMessage: "workflow attach requires input.visual_layer_actions (array)",
    };
  }
  const resolved = isPlainObject(resolvedTarget) ? resolvedTarget : {};
  const resolvedTargetId = normalizeString(resolved.resolved_target_id);
  const resolvedTargetPath = normalizeString(resolved.resolved_target_path);
  if (!resolvedTargetId || !resolvedTargetPath) {
    return {
      ok: false,
      errorCode: "E_WORKFLOW_RESOLVED_TARGET_MISSING",
      errorMessage:
        "workflow attach requires resolved_target_id/resolved_target_path before binding",
    };
  }

  const blockAnchor = isPlainObject(blockTargetAnchor) ? blockTargetAnchor : {};
  const blockAnchorConflict = checkResolvedTargetConflict({
    explicitObjectId: blockAnchor.object_id,
    explicitPath: blockAnchor.path,
    resolvedTargetId,
    resolvedTargetPath,
    contextLabel: "block_spec.target_anchor",
  });
  if (!blockAnchorConflict.ok) {
    return blockAnchorConflict;
  }

  const boundActions = [];
  for (let index = 0; index < visualLayerActions.length; index += 1) {
    const parseOutcome = parseVisualActionAsObject(visualLayerActions[index], index);
    if (!parseOutcome.ok) {
      return parseOutcome;
    }
    const sourceAction = parseOutcome.action;
    const sourceTarget = extractActionTarget(sourceAction);
    const actionConflict = checkResolvedTargetConflict({
      explicitObjectId: sourceTarget.object_id,
      explicitPath: sourceTarget.path,
      resolvedTargetId,
      resolvedTargetPath,
      contextLabel: `input.visual_layer_actions[${index}]`,
    });
    if (!actionConflict.ok) {
      return actionConflict;
    }

    boundActions.push({
      ...sourceAction,
      target_object_id: resolvedTargetId,
      target_path: resolvedTargetPath,
      target_anchor: {
        object_id: resolvedTargetId,
        path: resolvedTargetPath,
      },
    });
  }

  return {
    ok: true,
    visualLayerActions: boundActions,
    writeAnchor: {
      object_id: resolvedTargetId,
      path: resolvedTargetPath,
    },
  };
}

module.exports = {
  bindResolvedTargetForAttachVisualActions,
};


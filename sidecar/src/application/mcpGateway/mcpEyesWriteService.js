"use strict";

const {
  validateMcpApplyScriptActions,
  validateMcpApplyVisualActions,
  validateMcpSetUiProperties,
} = require("../../domain/validators");
const {
  OCC_STALE_SNAPSHOT_SUGGESTION,
} = require("../unitySnapshotService");
const {
  createSplitWriteIdempotencyKey,
  cloneJson,
} = require("../../utils/turnUtils");

class McpEyesWriteService {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.unitySnapshotService = opts.unitySnapshotService;
    this.preconditionService = opts.preconditionService;
    this.mcpGateway = opts.mcpGateway;
    this.capabilityStore = opts.capabilityStore;
    this.withMcpErrorFeedback = opts.withMcpErrorFeedback;
    this.validationError = opts.validationError;
  }

  applyScriptActions(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return this.validationError({
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "Body must be a JSON object",
        statusCode: 400,
      });
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return readiness.outcome;
    }

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return tokenValidation.outcome;
    }
    const validation = validateMcpApplyScriptActions(body);
    if (!validation.ok) {
      return this.validationError(validation, {
        requestBody: body,
        toolName: "apply_script_actions",
      });
    }
    const precondition = this.evaluatePreconditions(body.preconditions);
    if (!precondition.ok) {
      return precondition.outcome;
    }

    const actions = Array.isArray(body.actions) ? body.actions : [];
    if (body.dry_run === true) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          dry_run: true,
          validated_actions_count: actions.length,
          precondition_report: precondition.report,
        },
      };
    }

    const submitPayload = this.buildSubmitPayload(body, {
      defaultIntent: "Apply script actions",
      fileActions: actions,
      visualActions: [],
    });
    return this.mcpGateway.submitUnityTask(submitPayload);
  }

  applyVisualActions(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return this.validationError({
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "Body must be a JSON object",
        statusCode: 400,
      });
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return readiness.outcome;
    }

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return tokenValidation.outcome;
    }
    const validation = validateMcpApplyVisualActions(body, {
      actionAnchorPolicyByType: this.buildActionAnchorPolicyByType(),
    });
    if (!validation.ok) {
      return this.validationError(validation, {
        requestBody: body,
        toolName: "apply_visual_actions",
      });
    }
    const precondition = this.evaluatePreconditions(body.preconditions);
    if (!precondition.ok) {
      return precondition.outcome;
    }

    if (body.dry_run === true) {
      const actions = Array.isArray(body.actions) ? body.actions : [];
      return {
        statusCode: 200,
        body: {
          ok: true,
          dry_run: true,
          validated_actions_count: actions.length,
          precondition_report: precondition.report,
        },
      };
    }

    const actions = Array.isArray(body.actions) ? body.actions : [];
    const submitPayload = this.buildSubmitPayload(body, {
      defaultIntent: "Apply visual actions",
      fileActions: [],
      visualActions: actions,
    });
    return this.mcpGateway.submitUnityTask(submitPayload);
  }

  setUiProperties(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return this.validationError({
        ok: false,
        errorCode: "E_SCHEMA_INVALID",
        message: "Body must be a JSON object",
        statusCode: 400,
      });
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return readiness.outcome;
    }

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return tokenValidation.outcome;
    }
    const validation = validateMcpSetUiProperties(body);
    if (!validation.ok) {
      return this.validationError(validation, {
        requestBody: body,
        toolName: "set_ui_properties",
      });
    }
    const precondition = this.evaluatePreconditions(body.preconditions);
    if (!precondition.ok) {
      return precondition.outcome;
    }

    const planning = this.mapSetUiPropertiesToVisualActions(body);
    const planningPayload = {
      planned_actions_count: planning.plannedActionCount,
      mapped_actions: planning.mappedActionTypes,
    };

    if (body.dry_run === true) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "planned",
          dry_run: true,
          ...planningPayload,
          precondition_report: precondition.report,
        },
      };
    }

    const submitPayload = this.buildSubmitPayload(body, {
      defaultIntent: "Set UI properties",
      fileActions: [],
      visualActions: planning.visualActions,
    });
    const submitOutcome = this.mcpGateway.submitUnityTask(submitPayload);
    if (submitOutcome && typeof submitOutcome.then === "function") {
      return submitOutcome.then((outcome) =>
        this.attachSetUiPlanningMetadata(outcome, planningPayload)
      );
    }
    return this.attachSetUiPlanningMetadata(submitOutcome, planningPayload);
  }

  mapSetUiPropertiesToVisualActions(body) {
    const payload = body && typeof body === "object" ? body : {};
    const operations = Array.isArray(payload.operations) ? payload.operations : [];
    const mappedActions = [];
    const mappedActionTypes = [];

    for (const operation of operations) {
      if (!operation || typeof operation !== "object") {
        continue;
      }
      const targetAnchor = cloneJson(operation.target_anchor);

      const rect = operation.rect_transform;
      if (rect && typeof rect === "object") {
        if (rect.anchored_position && typeof rect.anchored_position === "object") {
          mappedActions.push({
            type: "set_rect_anchored_position",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              x: Number(rect.anchored_position.x),
              y: Number(rect.anchored_position.y),
            },
          });
          mappedActionTypes.push("set_rect_anchored_position");
        }
        if (rect.size_delta && typeof rect.size_delta === "object") {
          mappedActions.push({
            type: "set_rect_size_delta",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              x: Number(rect.size_delta.x),
              y: Number(rect.size_delta.y),
            },
          });
          mappedActionTypes.push("set_rect_size_delta");
        }
        if (rect.pivot && typeof rect.pivot === "object") {
          mappedActions.push({
            type: "set_rect_pivot",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              x: Number(rect.pivot.x),
              y: Number(rect.pivot.y),
            },
          });
          mappedActionTypes.push("set_rect_pivot");
        }
        if (rect.anchors && typeof rect.anchors === "object") {
          mappedActions.push({
            type: "set_rect_anchors",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              min_x: Number(rect.anchors.min_x),
              min_y: Number(rect.anchors.min_y),
              max_x: Number(rect.anchors.max_x),
              max_y: Number(rect.anchors.max_y),
            },
          });
          mappedActionTypes.push("set_rect_anchors");
        }
      }

      const image = operation.image;
      if (image && typeof image === "object") {
        if (image.color && typeof image.color === "object") {
          mappedActions.push({
            type: "set_ui_image_color",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              r: Number(image.color.r),
              g: Number(image.color.g),
              b: Number(image.color.b),
              a: Number(image.color.a),
            },
          });
          mappedActionTypes.push("set_ui_image_color");
        }
        if (typeof image.raycast_target === "boolean") {
          mappedActions.push({
            type: "set_ui_image_raycast_target",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              raycast_target: image.raycast_target,
            },
          });
          mappedActionTypes.push("set_ui_image_raycast_target");
        }
      }

      const text = operation.text;
      if (text && typeof text === "object") {
        if (typeof text.content === "string") {
          mappedActions.push({
            type: "set_ui_text_content",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              text: text.content,
            },
          });
          mappedActionTypes.push("set_ui_text_content");
        }
        if (text.color && typeof text.color === "object") {
          mappedActions.push({
            type: "set_ui_text_color",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              r: Number(text.color.r),
              g: Number(text.color.g),
              b: Number(text.color.b),
              a: Number(text.color.a),
            },
          });
          mappedActionTypes.push("set_ui_text_color");
        }
        if (text.font_size !== undefined) {
          mappedActions.push({
            type: "set_ui_text_font_size",
            target_anchor: cloneJson(targetAnchor),
            action_data: {
              font_size: Number(text.font_size),
            },
          });
          mappedActionTypes.push("set_ui_text_font_size");
        }
      }

      const layoutElement = operation.layout_element;
      if (layoutElement && typeof layoutElement === "object") {
        mappedActions.push({
          type: "set_layout_element",
          target_anchor: cloneJson(targetAnchor),
          action_data: {
            min_width: Number(layoutElement.min_width),
            min_height: Number(layoutElement.min_height),
            preferred_width: Number(layoutElement.preferred_width),
            preferred_height: Number(layoutElement.preferred_height),
            flexible_width: Number(layoutElement.flexible_width),
            flexible_height: Number(layoutElement.flexible_height),
            ignore_layout: layoutElement.ignore_layout === true,
          },
        });
        mappedActionTypes.push("set_layout_element");
      }
    }

    const visualActions =
      payload.atomic === true && mappedActions.length > 1
        ? [this.buildSetUiCompositeAction(mappedActions, payload.write_anchor)]
        : mappedActions;
    return {
      visualActions,
      mappedActionTypes,
      plannedActionCount: mappedActions.length,
    };
  }

  buildSetUiCompositeAction(actions, writeAnchor) {
    const steps = (Array.isArray(actions) ? actions : []).map((action, index) => ({
      step_id: `sop_${String(index + 1).padStart(4, "0")}`,
      type: action && typeof action.type === "string" ? action.type : "",
      target_anchor:
        action && action.target_anchor && typeof action.target_anchor === "object"
          ? cloneJson(action.target_anchor)
          : undefined,
      parent_anchor:
        action && action.parent_anchor && typeof action.parent_anchor === "object"
          ? cloneJson(action.parent_anchor)
          : undefined,
      action_data:
        action && action.action_data && typeof action.action_data === "object"
          ? cloneJson(action.action_data)
          : {},
    }));
    return {
      type: "composite_visual_action",
      target_anchor:
        writeAnchor && typeof writeAnchor === "object"
          ? cloneJson(writeAnchor)
          : undefined,
      action_data: {
        schema_version: "set_ui_properties.v1",
        transaction_id: `set_ui_properties_${Date.now()}`,
        atomic_mode: "all_or_nothing",
        max_step_ms: 1500,
        steps,
      },
    };
  }

  attachSetUiPlanningMetadata(outcome, planningPayload) {
    const source = outcome && typeof outcome === "object" ? outcome : null;
    if (!source || !source.body || typeof source.body !== "object") {
      return outcome;
    }
    return {
      ...source,
      body: {
        ...source.body,
        planned_actions_count: Number(planningPayload.planned_actions_count) || 0,
        mapped_actions: Array.isArray(planningPayload.mapped_actions)
          ? [...planningPayload.mapped_actions]
          : [],
      },
    };
  }

  buildSubmitPayload(body, options) {
    const payload = body && typeof body === "object" ? body : {};
    const opts = options && typeof options === "object" ? options : {};
    const snapshot =
      this.unitySnapshotService &&
      typeof this.unitySnapshotService.getLatestSelectionSnapshot === "function"
        ? this.unitySnapshotService.getLatestSelectionSnapshot()
        : null;
    const threadId =
      typeof payload.thread_id === "string" && payload.thread_id.trim()
        ? payload.thread_id.trim()
        : snapshot && typeof snapshot.thread_id === "string" && snapshot.thread_id.trim()
          ? snapshot.thread_id.trim()
          : "t_default";
    const idempotencyKey =
      typeof payload.idempotency_key === "string" && payload.idempotency_key.trim()
        ? payload.idempotency_key.trim()
        : createSplitWriteIdempotencyKey();
    const userIntent =
      typeof payload.user_intent === "string" && payload.user_intent.trim()
        ? payload.user_intent.trim()
        : typeof opts.defaultIntent === "string" && opts.defaultIntent.trim()
          ? opts.defaultIntent.trim()
          : "Apply MCP write actions";
    const approvalMode =
      payload.approval_mode === "require_user" ? "require_user" : "auto";
    const fileActions = Array.isArray(opts.fileActions) ? opts.fileActions : [];
    const visualActions = Array.isArray(opts.visualActions) ? opts.visualActions : [];

    return {
      thread_id: threadId,
      idempotency_key: idempotencyKey,
      approval_mode: approvalMode,
      user_intent: userIntent,
      based_on_read_token:
        typeof payload.based_on_read_token === "string"
          ? payload.based_on_read_token.trim()
          : "",
      write_anchor:
        payload.write_anchor && typeof payload.write_anchor === "object"
          ? cloneJson(payload.write_anchor)
          : null,
      file_actions: cloneJson(fileActions),
      visual_layer_actions: cloneJson(visualActions),
      context:
        payload.context && typeof payload.context === "object"
          ? cloneJson(payload.context)
          : undefined,
    };
  }

  validateUnityWriteReady() {
    if (
      !this.mcpGateway ||
      typeof this.mcpGateway.isUnityReadyForWrite !== "function"
    ) {
      return {
        ok: true,
      };
    }
    const readiness = this.mcpGateway.isUnityReadyForWrite();
    if (readiness && readiness.ok === true) {
      return {
        ok: true,
      };
    }
    if (
      this.mcpGateway &&
      typeof this.mcpGateway.buildUnityNotReadyWriteOutcome === "function"
    ) {
      return {
        ok: false,
        outcome: this.mcpGateway.buildUnityNotReadyWriteOutcome(
          readiness && readiness.state
        ),
      };
    }
    return {
      ok: false,
      outcome: {
        statusCode: 503,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_UNITY_NOT_CONNECTED",
          message: "Unity Editor connection is not ready for write operations.",
        }),
      },
    };
  }

  validateWriteReadToken(body) {
    const payload = body && typeof body === "object" ? body : {};
    const tokenValue =
      typeof payload.based_on_read_token === "string"
        ? payload.based_on_read_token
        : "";
    const validation = this.unitySnapshotService.validateReadTokenForWrite(
      tokenValue
    );
    if (validation.ok) {
      return {
        ok: true,
      };
    }
    return {
      ok: false,
      outcome: {
        statusCode:
          Number.isFinite(Number(validation.statusCode)) && Number(validation.statusCode) > 0
            ? Math.floor(Number(validation.statusCode))
            : 409,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: validation.error_code || "E_STALE_SNAPSHOT",
          message: validation.message || "Read token validation failed",
          suggestion:
            validation.suggestion || OCC_STALE_SNAPSHOT_SUGGESTION,
        }),
      },
    };
  }

  evaluatePreconditions(preconditions) {
    const report = this.preconditionService.evaluateWritePreconditions(preconditions);
    if (report.ok) {
      return {
        ok: true,
        report,
      };
    }
    return {
      ok: false,
      outcome: {
        statusCode: 409,
        body: this.withMcpErrorFeedback({
          status: "rejected",
          error_code: "E_PRECONDITION_FAILED",
          message: "One or more preconditions failed",
          precondition_report: report,
        }),
      },
    };
  }

  buildActionAnchorPolicyByType() {
    if (
      !this.capabilityStore ||
      typeof this.capabilityStore.getSnapshot !== "function"
    ) {
      return null;
    }
    const snapshot = this.capabilityStore.getSnapshot();
    const actions =
      snapshot && Array.isArray(snapshot.actions) ? snapshot.actions : [];
    if (actions.length === 0) {
      return null;
    }

    const map = Object.create(null);
    for (const item of actions) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const actionType =
        typeof item.type === "string" ? item.type.trim() : "";
      const anchorPolicy =
        typeof item.anchor_policy === "string" ? item.anchor_policy.trim() : "";
      if (!actionType || !anchorPolicy) {
        continue;
      }
      map[actionType] = anchorPolicy;
    }

    return Object.keys(map).length > 0 ? map : null;
  }
}

module.exports = {
  McpEyesWriteService,
};

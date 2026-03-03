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
const { normalizeWriteToolOutcome } = require("../writeReceiptFormatter");
const {
  WriteRetryFuse,
} = require("../writeRetryFuse");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeActionType(value) {
  return isNonEmptyString(value) ? String(value).trim().toLowerCase() : "";
}

function isCreateLikeActionType(value) {
  const normalized = normalizeActionType(value);
  return normalized === "create_gameobject" || normalized === "create_object";
}

function isValidAnchor(value) {
  if (!isObject(value)) {
    return false;
  }
  return isNonEmptyString(value.object_id) && isNonEmptyString(value.path);
}

function isAnchorEmptyOrInvalidObject(value) {
  if (value === undefined || value === null) {
    return true;
  }
  if (!isObject(value)) {
    return false;
  }
  return !isValidAnchor(value);
}

function normalizeString(value) {
  return isNonEmptyString(value) ? String(value).trim() : "";
}

class McpEyesWriteService {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.unitySnapshotService = opts.unitySnapshotService;
    this.preconditionService = opts.preconditionService;
    this.mcpGateway = opts.mcpGateway;
    this.capabilityStore = opts.capabilityStore;
    this.v1PolishMetricsCollector = opts.v1PolishMetricsCollector;
    this.withMcpErrorFeedback = opts.withMcpErrorFeedback;
    this.validationError = opts.validationError;
    this.writeRetryFuse = new WriteRetryFuse({
      enabled: opts.retryFuseEnabled,
      windowMs: opts.retryFuseWindowMs,
      maxAttempts: opts.retryFuseMaxAttempts,
    });
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
    const retryState = this.beginWriteRetryFuse("apply_script_actions", body);
    if (!retryState.ok) {
      return retryState.outcome;
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, readiness.outcome);
    }

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        tokenValidation.outcome
      );
    }
    const validation = validateMcpApplyScriptActions(body);
    if (!validation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        this.validationError(validation, {
          requestBody: body,
          toolName: "apply_script_actions",
        })
      );
    }
    const precondition = this.evaluatePreconditions(body.preconditions);
    if (!precondition.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        precondition.outcome
      );
    }

    const actions = Array.isArray(body.actions) ? body.actions : [];
    if (body.dry_run === true) {
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, {
        statusCode: 200,
        body: {
          ok: true,
          dry_run: true,
          dry_run_deprecated_alias: "preflight_validate_write_payload",
          validated_actions_count: actions.length,
          precondition_report: precondition.report,
        },
      });
    }

    const submitPayload = this.buildSubmitPayload(body, {
      defaultIntent: "Apply script actions",
      fileActions: actions,
      visualActions: [],
    });
    return this.finalizeWriteOutcomeWithRetryFuse(
      retryState,
      this.normalizeWriteOutcome(this.mcpGateway.submitUnityTask(submitPayload))
    );
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
    const retryState = this.beginWriteRetryFuse("apply_visual_actions", body);
    if (!retryState.ok) {
      return retryState.outcome;
    }

    const normalized = this.normalizeVisualActionsPayload(body);
    const effectiveBody = normalized.payload;

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, readiness.outcome);
    }

    const tokenValidation = this.validateWriteReadToken(effectiveBody);
    if (!tokenValidation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        tokenValidation.outcome
      );
    }
    const validation = validateMcpApplyVisualActions(effectiveBody, {
      actionAnchorPolicyByType: this.buildActionAnchorPolicyByType(),
    });
    if (!validation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        this.validationError(validation, {
          requestBody: body,
          correctedPayload: normalized.applied ? effectiveBody : null,
          toolName: "apply_visual_actions",
        })
      );
    }
    const precondition = this.evaluatePreconditions(effectiveBody.preconditions);
    if (!precondition.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        precondition.outcome
      );
    }

    const actions = Array.isArray(effectiveBody.actions) ? effectiveBody.actions : [];
    if (
      effectiveBody.dry_run === true &&
      !this.shouldDispatchDryRunToUnity(actions)
    ) {
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, {
        statusCode: 200,
        body: {
          ok: true,
          dry_run: true,
          dry_run_deprecated_alias: "preflight_validate_write_payload",
          validated_actions_count: actions.length,
          precondition_report: precondition.report,
          ...(normalized.applied
            ? {
                normalization_applied: true,
                normalized_payload: cloneJson(effectiveBody),
              }
            : {}),
        },
      });
    }

    const submitPayload = this.buildSubmitPayload(effectiveBody, {
      defaultIntent: "Apply visual actions",
      fileActions: [],
      visualActions: actions,
    });
    return this.finalizeWriteOutcomeWithRetryFuse(
      retryState,
      this.normalizeWriteOutcome(this.mcpGateway.submitUnityTask(submitPayload))
    );
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
    const retryState = this.beginWriteRetryFuse("set_ui_properties", body);
    if (!retryState.ok) {
      return retryState.outcome;
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, readiness.outcome);
    }

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        tokenValidation.outcome
      );
    }
    const validation = validateMcpSetUiProperties(body);
    if (!validation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        this.validationError(validation, {
          requestBody: body,
          toolName: "set_ui_properties",
        })
      );
    }
    const precondition = this.evaluatePreconditions(body.preconditions);
    if (!precondition.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        precondition.outcome
      );
    }

    const planning = this.mapSetUiPropertiesToVisualActions(body);
    const planningPayload = {
      planned_actions_count: planning.plannedActionCount,
      mapped_actions: planning.mappedActionTypes,
    };

    if (body.dry_run === true) {
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, {
        statusCode: 200,
        body: {
          ok: true,
          status: "planned",
          dry_run: true,
          dry_run_deprecated_alias: "preflight_validate_write_payload",
          ...planningPayload,
          precondition_report: precondition.report,
        },
      });
    }

    const submitPayload = this.buildSubmitPayload(body, {
      defaultIntent: "Set UI properties",
      fileActions: [],
      visualActions: planning.visualActions,
    });
    const submitOutcome = this.mcpGateway.submitUnityTask(submitPayload);
    if (submitOutcome && typeof submitOutcome.then === "function") {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        submitOutcome.then((outcome) =>
          this.normalizeWriteOutcome(
            this.attachSetUiPlanningMetadata(outcome, planningPayload)
          )
        )
      );
    }
    return this.finalizeWriteOutcomeWithRetryFuse(
      retryState,
      this.normalizeWriteOutcome(
        this.attachSetUiPlanningMetadata(submitOutcome, planningPayload)
      )
    );
  }

  preflightValidateWritePayload(body) {
    if (!isObject(body)) {
      return this.validationError(
        {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: "Body must be a JSON object",
          statusCode: 400,
        },
        {
          requestBody: body,
          toolName: "preflight_validate_write_payload",
        }
      );
    }

    const toolNameRaw =
      body.tool_name === undefined || body.tool_name === null
        ? "apply_visual_actions"
        : body.tool_name;
    const toolName = normalizeString(toolNameRaw);
    if (!toolName) {
      return this.validationError(
        {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: "tool_name must be a non-empty string when provided",
          statusCode: 400,
        },
        {
          requestBody: body,
          toolName: "preflight_validate_write_payload",
        }
      );
    }

    if (!isObject(body.payload)) {
      return this.validationError(
        {
          ok: false,
          errorCode: "E_SCHEMA_INVALID",
          message: "payload must be a JSON object",
          statusCode: 400,
        },
        {
          requestBody: body,
          toolName: "preflight_validate_write_payload",
        }
      );
    }

    const preflight = this.runWritePreflightForTool(toolName, body.payload);
    return {
      statusCode: 200,
      body: {
        ok: true,
        preflight,
      },
    };
  }

  beginWriteRetryFuse(toolName, payload) {
    const state = this.writeRetryFuse.begin({
      toolName,
      payload,
    });
    if (state.ok) {
      return {
        ok: true,
        context: state.context || null,
      };
    }
    return {
      ok: false,
      outcome: this.buildDuplicateRetryBlockedOutcome(state.blocked),
    };
  }

  buildDuplicateRetryBlockedOutcome(blocked) {
    const state = blocked && typeof blocked === "object" ? blocked : {};
    return {
      statusCode: 429,
      body: this.withMcpErrorFeedback({
        status: "rejected",
        error_code: "E_DUPLICATE_RETRY_BLOCKED",
        message:
          "Duplicate retry blocked within short window for same payload and error code.",
        suggestion:
          "Payload is trapped in duplicate retry loop. Refresh read token or modify payload before retrying.",
        retry_policy: {
          allow_auto_retry: false,
          max_attempts: 0,
          strategy: "manual_fix_required",
        },
        retry_fuse: {
          scope: "per_thread",
          thread_id: normalizeString(state.threadId) || "t_default",
          payload_hash: normalizeString(state.payloadHash),
          error_code: normalizeString(state.errorCode),
          attempts:
            Number.isFinite(Number(state.attempts)) && Number(state.attempts) >= 0
              ? Math.floor(Number(state.attempts))
              : 0,
          window_ms:
            Number.isFinite(Number(state.windowMs)) && Number(state.windowMs) > 0
              ? Math.floor(Number(state.windowMs))
              : 0,
          max_attempts:
            Number.isFinite(Number(state.maxAttempts)) && Number(state.maxAttempts) > 0
              ? Math.floor(Number(state.maxAttempts))
              : 0,
          fuse_key: normalizeString(state.fuseKey),
        },
      }),
    };
  }

  finalizeWriteOutcomeWithRetryFuse(retryState, outcome) {
    const state = retryState && typeof retryState === "object" ? retryState : null;
    if (!state || state.ok !== true || !state.context) {
      return outcome;
    }
    if (outcome && typeof outcome.then === "function") {
      return outcome.then((resolved) =>
        this.applyWriteRetryFuseResult(state.context, resolved)
      );
    }
    return this.applyWriteRetryFuseResult(state.context, outcome);
  }

  applyWriteRetryFuseResult(context, outcome) {
    const ctx = context && typeof context === "object" ? context : null;
    if (!ctx) {
      return outcome;
    }
    const source = outcome && typeof outcome === "object" ? outcome : null;
    const body = source && source.body && typeof source.body === "object"
      ? source.body
      : null;
    const errorCode = normalizeString(body && body.error_code).toUpperCase();
    if (!errorCode) {
      this.writeRetryFuse.recordSuccess(ctx);
      return outcome;
    }
    if (errorCode === "E_DUPLICATE_RETRY_BLOCKED") {
      return outcome;
    }
    this.writeRetryFuse.recordFailure(ctx, errorCode);
    return outcome;
  }

  runWritePreflightForTool(toolName, payload) {
    const normalizedToolName = normalizeString(toolName);
    const sourcePayload = isObject(payload) ? cloneJson(payload) : {};

    let effectivePayload = sourcePayload;
    let normalization = {
      applied: false,
      suggested_patch: [],
    };

    if (normalizedToolName === "apply_visual_actions") {
      normalization = this.normalizeVisualActionsPayload(sourcePayload);
      effectivePayload = normalization.payload;
    }

    const result = {
      tool_name: normalizedToolName,
      valid: false,
      dry_run_alias: true,
      normalization_applied: normalization.applied === true,
      blocking_errors: [],
      non_blocking_warnings: [],
      normalized_payload: cloneJson(effectivePayload),
      ...(normalization.applied &&
      Array.isArray(normalization.suggested_patch) &&
      normalization.suggested_patch.length > 0
        ? { suggested_patch: cloneJson(normalization.suggested_patch) }
        : {}),
    };

    const unsupportedTool = ![
      "apply_script_actions",
      "apply_visual_actions",
      "set_ui_properties",
    ].includes(normalizedToolName);
    if (unsupportedTool) {
      result.blocking_errors.push({
        error_code: "E_SCHEMA_INVALID",
        message:
          "tool_name must be one of apply_script_actions/apply_visual_actions/set_ui_properties",
      });
      return result;
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      result.blocking_errors.push(
        this.buildPreflightBlockingError(readiness.outcome)
      );
      return result;
    }

    const tokenValidation = this.validateWriteReadToken(effectivePayload);
    if (!tokenValidation.ok) {
      result.blocking_errors.push(
        this.buildPreflightBlockingError(tokenValidation.outcome)
      );
      return result;
    }

    let validation = null;
    if (normalizedToolName === "apply_script_actions") {
      validation = validateMcpApplyScriptActions(effectivePayload);
    } else if (normalizedToolName === "apply_visual_actions") {
      validation = validateMcpApplyVisualActions(effectivePayload, {
        actionAnchorPolicyByType: this.buildActionAnchorPolicyByType(),
      });
    } else {
      validation = validateMcpSetUiProperties(effectivePayload);
    }

    if (!validation || validation.ok !== true) {
      const validationOutcome = this.validationError(validation || {}, {
        requestBody: sourcePayload,
        correctedPayload: normalization.applied ? effectivePayload : null,
        toolName: normalizedToolName,
      });
      result.blocking_errors.push(
        this.buildPreflightBlockingError(validationOutcome)
      );
      return result;
    }

    const precondition = this.evaluatePreconditions(effectivePayload.preconditions);
    if (!precondition.ok) {
      result.blocking_errors.push(
        this.buildPreflightBlockingError(precondition.outcome)
      );
      return result;
    }

    result.valid = true;
    result.precondition_report = precondition.report;
    if (normalizedToolName === "apply_script_actions") {
      const actions = Array.isArray(effectivePayload.actions)
        ? effectivePayload.actions
        : [];
      result.validated_actions_count = actions.length;
    } else if (normalizedToolName === "apply_visual_actions") {
      const actions = Array.isArray(effectivePayload.actions)
        ? effectivePayload.actions
        : [];
      result.validated_actions_count = actions.length;
    } else if (normalizedToolName === "set_ui_properties") {
      const planning = this.mapSetUiPropertiesToVisualActions(effectivePayload);
      result.planned_actions_count = planning.plannedActionCount;
      result.mapped_actions = Array.isArray(planning.mappedActionTypes)
        ? [...planning.mappedActionTypes]
        : [];
    }
    return result;
  }

  buildPreflightBlockingError(outcome) {
    const source = outcome && typeof outcome === "object" ? outcome : {};
    const body =
      source.body && typeof source.body === "object" ? source.body : source;
    const fallbackMessage = normalizeString(source.message) || "Preflight validation failed";
    const output = {
      error_code: normalizeString(body.error_code) || "E_INTERNAL",
      message:
        normalizeString(body.error_message) ||
        normalizeString(body.message) ||
        fallbackMessage,
      recoverable:
        typeof body.recoverable === "boolean" ? body.recoverable : true,
    };
    if (normalizeString(body.suggestion)) {
      output.suggestion = normalizeString(body.suggestion);
    }
    if (normalizeString(body.field_path)) {
      output.field_path = normalizeString(body.field_path);
    }
    if (normalizeString(body.fix_kind)) {
      output.fix_kind = normalizeString(body.fix_kind);
    }
    if (normalizeString(body.schema_issue_category)) {
      output.schema_issue_category = normalizeString(body.schema_issue_category);
    }
    if (Array.isArray(body.suggested_patch) && body.suggested_patch.length > 0) {
      output.suggested_patch = cloneJson(body.suggested_patch);
    }
    if (isObject(body.corrected_payload)) {
      output.corrected_payload = cloneJson(body.corrected_payload);
    }
    if (normalizeString(body.next_step)) {
      output.next_step = normalizeString(body.next_step);
    }
    if (typeof body.normalization_applied === "boolean") {
      output.normalization_applied = body.normalization_applied;
    }
    if (normalizeString(body.original_payload_hash)) {
      output.original_payload_hash = normalizeString(body.original_payload_hash);
    }
    return output;
  }

  normalizeVisualActionsPayload(body) {
    const payload = isObject(body) ? cloneJson(body) : {};
    const actions = Array.isArray(payload.actions) ? payload.actions : [];
    if (actions.length !== 1) {
      return {
        payload,
        applied: false,
        suggested_patch: [],
      };
    }

    const action = actions[0];
    if (!isObject(action)) {
      return {
        payload,
        applied: false,
        suggested_patch: [],
      };
    }

    // Safety gate: only normalize object-only action_data payloads.
    // Legacy top-level action fields keep hard-fail behavior.
    if (!isObject(action.action_data)) {
      return {
        payload,
        applied: false,
        suggested_patch: [],
      };
    }

    if (isCreateLikeActionType(action.type)) {
      if (isValidAnchor(action.parent_anchor)) {
        return {
          payload,
          applied: false,
          suggested_patch: [],
        };
      }

      if (!isAnchorEmptyOrInvalidObject(action.parent_anchor)) {
        return {
          payload,
          applied: false,
          suggested_patch: [],
        };
      }

      if (!isValidAnchor(payload.write_anchor)) {
        return {
          payload,
          applied: false,
          suggested_patch: [],
        };
      }

      const normalizedParent = {
        object_id: String(payload.write_anchor.object_id).trim(),
        path: String(payload.write_anchor.path).trim(),
      };
      action.parent_anchor = normalizedParent;
      return {
        payload,
        applied: true,
        suggested_patch: [
          {
            op: "replace",
            path: "/actions/0/parent_anchor",
            value: cloneJson(normalizedParent),
          },
        ],
      };
    }

    if (isValidAnchor(action.parent_anchor) || isValidAnchor(action.target_anchor)) {
      return {
        payload,
        applied: false,
        suggested_patch: [],
      };
    }

    if (!isAnchorEmptyOrInvalidObject(action.target_anchor)) {
      return {
        payload,
        applied: false,
        suggested_patch: [],
      };
    }

    if (!isValidAnchor(payload.write_anchor)) {
      return {
        payload,
        applied: false,
        suggested_patch: [],
      };
    }

    const normalizedTarget = {
      object_id: String(payload.write_anchor.object_id).trim(),
      path: String(payload.write_anchor.path).trim(),
    };
    action.target_anchor = normalizedTarget;
    return {
      payload,
      applied: true,
      suggested_patch: [
        {
          op: "replace",
          path: "/actions/0/target_anchor",
          value: cloneJson(normalizedTarget),
        },
      ],
    };
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

  shouldDispatchDryRunToUnity(actions) {
    const list = Array.isArray(actions) ? actions : [];
    if (list.length === 0) {
      return false;
    }
    for (const action of list) {
      const type =
        action && typeof action.type === "string" ? action.type.trim() : "";
      if (type !== "set_serialized_property") {
        return false;
      }
    }
    return true;
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

  normalizeWriteOutcome(outcome) {
    if (outcome && typeof outcome.then === "function") {
      return outcome.then((resolved) => normalizeWriteToolOutcome(resolved));
    }
    return normalizeWriteToolOutcome(outcome);
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
      this.recordReadTokenValidation({
        ok: true,
        error_code: "",
        message: "",
        source: "mcp_eyes_write",
      });
      return {
        ok: true,
      };
    }
    this.recordReadTokenValidation({
      ok: false,
      error_code: validation.error_code || "E_STALE_SNAPSHOT",
      message: validation.message || "Read token validation failed",
      source: "mcp_eyes_write",
    });
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

  recordReadTokenValidation(input) {
    if (
      this.v1PolishMetricsCollector &&
      typeof this.v1PolishMetricsCollector.recordReadTokenValidation === "function"
    ) {
      this.v1PolishMetricsCollector.recordReadTokenValidation(input);
    }
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

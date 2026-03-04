"use strict";

const {
  validateMcpApplyScriptActions,
  validateMcpApplyVisualActions,
  validateMcpSetUiProperties,
} = require("../../domain/validators");
const {
  OCC_STALE_SNAPSHOT_SUGGESTION,
} = require("../unitySnapshotService");
const { resolveSchemaIssueClassification } = require("../turnPolicies");
const {
  createSplitWriteIdempotencyKey,
  cloneJson,
} = require("../../utils/turnUtils");
const { normalizeWriteToolOutcome } = require("../writeReceiptFormatter");
const {
  WriteRetryFuse,
} = require("../writeRetryFuse");
const {
  canonicalizeVisualActionType,
} = require("../../domain/actionTypeCanonicalizer");
const {
  createCapabilityActionContractRegistry,
} = require("../../domain/actionContractRegistry");

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeString(value) {
  return isNonEmptyString(value) ? String(value).trim() : "";
}

function normalizeAnchorSnapshotEntry(anchor) {
  if (!isObject(anchor)) {
    return null;
  }
  const objectId = normalizeString(anchor.object_id);
  const path = normalizeString(anchor.path);
  if (!objectId && !path) {
    return null;
  }
  return {
    object_id: objectId,
    path,
  };
}

function buildAnchorSnapshot(toolName, payload) {
  const source = isObject(payload) ? payload : {};
  const snapshot = {
    write_anchor: normalizeAnchorSnapshotEntry(source.write_anchor),
    target_anchor: null,
    parent_anchor: null,
  };
  const normalizedTool = normalizeString(toolName);
  if (normalizedTool === "apply_visual_actions") {
    const actions = Array.isArray(source.actions) ? source.actions : [];
    const firstAction =
      actions.length > 0 && isObject(actions[0]) ? actions[0] : null;
    if (firstAction) {
      snapshot.target_anchor = normalizeAnchorSnapshotEntry(
        firstAction.target_anchor
      );
      snapshot.parent_anchor = normalizeAnchorSnapshotEntry(
        firstAction.parent_anchor
      );
    }
  } else if (normalizedTool === "set_ui_properties") {
    const operations = Array.isArray(source.operations) ? source.operations : [];
    const firstOperation =
      operations.length > 0 && isObject(operations[0]) ? operations[0] : null;
    if (firstOperation) {
      snapshot.target_anchor = normalizeAnchorSnapshotEntry(
        firstOperation.target_anchor
      );
    }
  }

  if (
    !snapshot.write_anchor &&
    !snapshot.target_anchor &&
    !snapshot.parent_anchor
  ) {
    return null;
  }
  return snapshot;
}

function isFailureWriteOutcome(statusCode, body) {
  const source = isObject(body) ? body : {};
  if (Number.isFinite(Number(statusCode)) && Number(statusCode) >= 400) {
    return true;
  }
  const status = normalizeString(source.status).toLowerCase();
  if (status === "failed" || status === "rejected" || status === "cancelled") {
    return true;
  }
  if (source.ok === false) {
    return true;
  }
  if (normalizeString(source.error_code)) {
    return true;
  }
  return false;
}

const DRY_RUN_ALIAS_DEPRECATION_NOTICE = Object.freeze({
  status: "deprecated_alias_supported",
  preferred_tool: "preflight_validate_write_payload",
  migration_hint:
    "Use preflight_validate_write_payload with { tool_name, payload } for validation-only flows.",
});

function toCounterValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
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
    this.protocolGovernanceMetrics = {
      schema_version: "r20_protocol_governance_metrics.v1",
      updated_at: new Date().toISOString(),
      by_tool: {},
      counters: {
        write_tool_calls_total: 0,
        dry_run_alias_calls_total: 0,
        preflight_calls_total: 0,
        preflight_valid_total: 0,
        preflight_invalid_total: 0,
        preflight_blocking_error_total: 0,
        retry_fuse_blocked_total: 0,
        retry_fuse_failure_recorded_total: 0,
        retry_fuse_success_recorded_total: 0,
      },
    };
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
    this.recordWriteToolInvocation("apply_script_actions");
    const observabilityContext = this.buildFailureObservabilityContext(
      "apply_script_actions",
      body
    );
    const retryState = this.beginWriteRetryFuse("apply_script_actions", body);
    if (!retryState.ok) {
      return retryState.outcome;
    }

    const contractHandshake = this.validateContractVersionHandshake(body);
    if (!contractHandshake.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        contractHandshake.outcome,
        observabilityContext
      );
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        readiness.outcome,
        observabilityContext
      );
    }

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        tokenValidation.outcome,
        observabilityContext
      );
    }
    const validation = validateMcpApplyScriptActions(body);
    if (!validation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        this.validationError(validation, {
          requestBody: body,
          toolName: "apply_script_actions",
        }),
        observabilityContext
      );
    }
    const precondition = this.evaluatePreconditions(body.preconditions);
    if (!precondition.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        precondition.outcome,
        observabilityContext
      );
    }

    const actions = Array.isArray(body.actions) ? body.actions : [];
    if (body.dry_run === true) {
      this.recordDryRunAliasInvocation("apply_script_actions");
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, {
        statusCode: 200,
        body: {
          ok: true,
          dry_run: true,
          dry_run_deprecated_alias: "preflight_validate_write_payload",
          dry_run_deprecation: cloneJson(DRY_RUN_ALIAS_DEPRECATION_NOTICE),
          validated_actions_count: actions.length,
          precondition_report: precondition.report,
        },
      }, observabilityContext);
    }

    const submitPayload = this.buildSubmitPayload(body, {
      defaultIntent: "Apply script actions",
      fileActions: actions,
      visualActions: [],
    });
    return this.finalizeWriteOutcomeWithRetryFuse(
      retryState,
      this.normalizeWriteOutcome(this.mcpGateway.submitUnityTask(submitPayload)),
      observabilityContext
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
    this.recordWriteToolInvocation("apply_visual_actions");
    const observabilityContext = this.buildFailureObservabilityContext(
      "apply_visual_actions",
      body
    );
    const retryState = this.beginWriteRetryFuse("apply_visual_actions", body);
    if (!retryState.ok) {
      return retryState.outcome;
    }

    const actionContractRegistry = this.buildActionContractRegistry();
    const normalized = this.normalizeVisualActionsPayload(
      body,
      actionContractRegistry
    );
    const effectiveBody = normalized.payload;

    const contractHandshake = this.validateContractVersionHandshake(effectiveBody);
    if (!contractHandshake.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        contractHandshake.outcome,
        observabilityContext
      );
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        readiness.outcome,
        observabilityContext
      );
    }

    const tokenValidation = this.validateWriteReadToken(effectiveBody);
    if (!tokenValidation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        tokenValidation.outcome,
        observabilityContext
      );
    }
    const validation = validateMcpApplyVisualActions(effectiveBody, {
      actionContractRegistry,
      actionAnchorPolicyByType: this.buildActionAnchorPolicyByType(),
    });
    if (!validation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        this.validationError(validation, {
          requestBody: body,
          correctedPayload: normalized.applied ? effectiveBody : null,
          toolName: "apply_visual_actions",
        }),
        observabilityContext
      );
    }
    const precondition = this.evaluatePreconditions(effectiveBody.preconditions);
    if (!precondition.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        precondition.outcome,
        observabilityContext
      );
    }

    const actions = Array.isArray(effectiveBody.actions) ? effectiveBody.actions : [];
    if (
      effectiveBody.dry_run === true &&
      !this.shouldDispatchDryRunToUnity(actions)
    ) {
      this.recordDryRunAliasInvocation("apply_visual_actions");
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, {
        statusCode: 200,
        body: {
          ok: true,
          dry_run: true,
          dry_run_deprecated_alias: "preflight_validate_write_payload",
          dry_run_deprecation: cloneJson(DRY_RUN_ALIAS_DEPRECATION_NOTICE),
          validated_actions_count: actions.length,
          precondition_report: precondition.report,
          ...(normalized.applied
            ? {
                normalization_applied: true,
                normalized_payload: cloneJson(effectiveBody),
              }
            : {}),
        },
      }, observabilityContext);
    }

    const submitPayload = this.buildSubmitPayload(effectiveBody, {
      defaultIntent: "Apply visual actions",
      fileActions: [],
      visualActions: actions,
    });
    return this.finalizeWriteOutcomeWithRetryFuse(
      retryState,
      this.normalizeWriteOutcome(this.mcpGateway.submitUnityTask(submitPayload)),
      observabilityContext
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
    this.recordWriteToolInvocation("set_ui_properties");
    const observabilityContext = this.buildFailureObservabilityContext(
      "set_ui_properties",
      body
    );
    const retryState = this.beginWriteRetryFuse("set_ui_properties", body);
    if (!retryState.ok) {
      return retryState.outcome;
    }

    const contractHandshake = this.validateContractVersionHandshake(body);
    if (!contractHandshake.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        contractHandshake.outcome,
        observabilityContext
      );
    }

    const readiness = this.validateUnityWriteReady();
    if (!readiness.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        readiness.outcome,
        observabilityContext
      );
    }

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        tokenValidation.outcome,
        observabilityContext
      );
    }
    const validation = validateMcpSetUiProperties(body);
    if (!validation.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        this.validationError(validation, {
          requestBody: body,
          toolName: "set_ui_properties",
        }),
        observabilityContext
      );
    }
    const precondition = this.evaluatePreconditions(body.preconditions);
    if (!precondition.ok) {
      return this.finalizeWriteOutcomeWithRetryFuse(
        retryState,
        precondition.outcome,
        observabilityContext
      );
    }

    const planning = this.mapSetUiPropertiesToVisualActions(body);
    const planningPayload = {
      planned_actions_count: planning.plannedActionCount,
      mapped_actions: planning.mappedActionTypes,
    };

    if (body.dry_run === true) {
      this.recordDryRunAliasInvocation("set_ui_properties");
      return this.finalizeWriteOutcomeWithRetryFuse(retryState, {
        statusCode: 200,
        body: {
          ok: true,
          status: "planned",
          dry_run: true,
          dry_run_deprecated_alias: "preflight_validate_write_payload",
          dry_run_deprecation: cloneJson(DRY_RUN_ALIAS_DEPRECATION_NOTICE),
          ...planningPayload,
          precondition_report: precondition.report,
        },
      }, observabilityContext);
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
        ),
        observabilityContext
      );
    }
    return this.finalizeWriteOutcomeWithRetryFuse(
      retryState,
      this.normalizeWriteOutcome(
        this.attachSetUiPlanningMetadata(submitOutcome, planningPayload)
      ),
      observabilityContext
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
    this.recordPreflightInvocation(toolName, preflight);
    return {
      statusCode: 200,
      body: {
        ok: true,
        lifecycle: "stable",
        dry_run_compatibility: cloneJson(DRY_RUN_ALIAS_DEPRECATION_NOTICE),
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
    this.recordRetryFuseBlocked(toolName);
    return {
      ok: false,
      outcome: this.buildDuplicateRetryBlockedOutcome(state.blocked, {
        toolName,
        payload,
      }),
    };
  }

  buildDuplicateRetryBlockedOutcome(blocked, options) {
    const state = blocked && typeof blocked === "object" ? blocked : {};
    const opts = options && typeof options === "object" ? options : {};
    const observabilityContext = this.buildFailureObservabilityContext(
      opts.toolName,
      opts.payload
    );
    return {
      statusCode: 429,
      body: this.decorateFailureBody(
        this.withMcpErrorFeedback({
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
        observabilityContext
      ),
    };
  }

  finalizeWriteOutcomeWithRetryFuse(retryState, outcome, observabilityContext) {
    const state = retryState && typeof retryState === "object" ? retryState : null;
    const finalizeWithObservability = (source) =>
      this.applyFailureObservability(source, observabilityContext);
    if (!state || state.ok !== true || !state.context) {
      if (outcome && typeof outcome.then === "function") {
        return outcome.then((resolved) => finalizeWithObservability(resolved));
      }
      return finalizeWithObservability(outcome);
    }
    if (outcome && typeof outcome.then === "function") {
      return outcome.then((resolved) =>
        finalizeWithObservability(this.applyWriteRetryFuseResult(state.context, resolved))
      );
    }
    return finalizeWithObservability(
      this.applyWriteRetryFuseResult(state.context, outcome)
    );
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
      this.recordRetryFuseSuccess();
      return outcome;
    }
    if (errorCode === "E_DUPLICATE_RETRY_BLOCKED") {
      return outcome;
    }
    this.writeRetryFuse.recordFailure(ctx, errorCode);
    this.recordRetryFuseFailure();
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

    const actionContractRegistry = this.buildActionContractRegistry();
    if (normalizedToolName === "apply_visual_actions") {
      normalization = this.normalizeVisualActionsPayload(
        sourcePayload,
        actionContractRegistry
      );
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

    const contractHandshake = this.validateContractVersionHandshake(effectivePayload);
    if (!contractHandshake.ok) {
      result.blocking_errors.push(
        this.buildPreflightBlockingError(contractHandshake.outcome)
      );
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
        actionContractRegistry,
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

  normalizeVisualActionsPayload(body, actionContractRegistry) {
    return {
      payload: isObject(body) ? cloneJson(body) : {},
      applied: false,
      suggested_patch: [],
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

  buildFailureObservabilityContext(toolName, payload) {
    const normalizedToolName = normalizeString(toolName);
    const sourcePayload = isObject(payload) ? cloneJson(payload) : {};
    return {
      tool_name: normalizedToolName,
      request_id: normalizeString(sourcePayload.request_id),
      anchor_snapshot: buildAnchorSnapshot(normalizedToolName, sourcePayload),
    };
  }

  applyFailureObservability(outcome, context) {
    const source = outcome && typeof outcome === "object" ? outcome : null;
    if (!source || !isObject(source.body)) {
      return outcome;
    }
    if (!isFailureWriteOutcome(source.statusCode, source.body)) {
      return outcome;
    }
    const decoratedBody = this.decorateFailureBody(source.body, context);
    if (decoratedBody === source.body) {
      return outcome;
    }
    return {
      ...source,
      body: decoratedBody,
    };
  }

  decorateFailureBody(body, context) {
    const source = isObject(body) ? body : {};
    const ctx = isObject(context) ? context : {};
    const requestId = normalizeString(source.request_id) || normalizeString(ctx.request_id);
    const errorMessage =
      normalizeString(source.error_message) || normalizeString(source.message);
    const fieldPath =
      normalizeString(source.field_path) || this.resolveFailureFieldPath(source);
    const sourceAnchorSnapshot = isObject(source.anchor_snapshot)
      ? cloneJson(source.anchor_snapshot)
      : null;
    const contextAnchorSnapshot = isObject(ctx.anchor_snapshot)
      ? cloneJson(ctx.anchor_snapshot)
      : null;
    const anchorSnapshot = sourceAnchorSnapshot || contextAnchorSnapshot;

    let mutated = false;
    const output = {
      ...source,
    };
    if (
      !Object.prototype.hasOwnProperty.call(source, "request_id") ||
      requestId !== normalizeString(source.request_id)
    ) {
      output.request_id = requestId;
      mutated = true;
    }
    if (errorMessage) {
      if (normalizeString(source.error_message) !== errorMessage) {
        output.error_message = errorMessage;
        mutated = true;
      }
      if (normalizeString(source.message) !== errorMessage) {
        output.message = errorMessage;
        mutated = true;
      }
    }
    if (fieldPath && normalizeString(source.field_path) !== fieldPath) {
      output.field_path = fieldPath;
      mutated = true;
    }
    if (anchorSnapshot && !isObject(source.anchor_snapshot)) {
      output.anchor_snapshot = anchorSnapshot;
      mutated = true;
    }

    return mutated ? output : source;
  }

  resolveFailureFieldPath(errorBody) {
    const source = isObject(errorBody) ? errorBody : {};
    const message =
      normalizeString(source.error_message) || normalizeString(source.message);
    if (!message) {
      return "";
    }
    const classification = resolveSchemaIssueClassification({
      errorCode: normalizeString(source.error_code),
      message,
      field_path: normalizeString(source.field_path),
    });
    return normalizeString(classification && classification.field_path);
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

  validateContractVersionHandshake(body) {
    if (
      !this.capabilityStore ||
      typeof this.capabilityStore.getSnapshot !== "function"
    ) {
      return {
        ok: true,
      };
    }
    const payload = isObject(body) ? body : {};
    const snapshot = this.capabilityStore.getSnapshot();
    const unityConnectionState = normalizeString(
      snapshot && snapshot.unity_connection_state
    ).toLowerCase();
    const capabilityVersion = normalizeString(
      snapshot && snapshot.capability_version
    );
    const requestedCatalogVersion =
      normalizeString(payload.catalog_version) ||
      normalizeString(payload.capability_version);

    if (unityConnectionState === "stale") {
      return {
        ok: false,
        outcome: this.buildContractVersionMismatchOutcome({
          reason:
            "Capability snapshot is stale. Refresh contracts before retrying write operations.",
          unity_connection_state: unityConnectionState,
          capability_version: capabilityVersion,
          requested_catalog_version: requestedCatalogVersion,
        }),
      };
    }
    if (unityConnectionState === "ready" && !capabilityVersion) {
      return {
        ok: false,
        outcome: this.buildContractVersionMismatchOutcome({
          reason:
            "Capability version is missing while Unity connection is ready. Refresh capability snapshot before retrying.",
          unity_connection_state: unityConnectionState,
          requested_catalog_version: requestedCatalogVersion,
        }),
      };
    }
    if (
      requestedCatalogVersion &&
      capabilityVersion &&
      requestedCatalogVersion !== capabilityVersion
    ) {
      return {
        ok: false,
        outcome: this.buildContractVersionMismatchOutcome({
          reason: "catalog_version does not match current capability_version.",
          unity_connection_state: unityConnectionState,
          capability_version: capabilityVersion,
          requested_catalog_version: requestedCatalogVersion,
        }),
      };
    }

    return {
      ok: true,
    };
  }

  buildContractVersionMismatchOutcome(details) {
    const source = isObject(details) ? details : {};
    const unityConnectionState =
      normalizeString(source.unity_connection_state).toLowerCase() || "unknown";
    const capabilityVersion = normalizeString(source.capability_version);
    const requestedCatalogVersion = normalizeString(source.requested_catalog_version);
    const message =
      normalizeString(source.reason) ||
      "Write contract version handshake failed before dispatch.";
    return {
      statusCode: 409,
      body: this.withMcpErrorFeedback({
        status: "rejected",
        error_code: "E_CONTRACT_VERSION_MISMATCH",
        message,
        unity_connection_state: unityConnectionState,
        ...(capabilityVersion ? { capability_version: capabilityVersion } : {}),
        ...(requestedCatalogVersion
          ? { requested_catalog_version: requestedCatalogVersion }
          : {}),
      }),
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

  touchProtocolGovernanceMetrics() {
    this.protocolGovernanceMetrics.updated_at = new Date().toISOString();
  }

  ensureProtocolGovernanceToolMetrics(toolName) {
    const normalizedToolName = normalizeString(toolName);
    if (!normalizedToolName) {
      return null;
    }
    if (!this.protocolGovernanceMetrics.by_tool[normalizedToolName]) {
      this.protocolGovernanceMetrics.by_tool[normalizedToolName] = {
        write_tool_calls_total: 0,
        dry_run_alias_calls_total: 0,
        preflight_calls_total: 0,
        preflight_valid_total: 0,
        preflight_invalid_total: 0,
        preflight_blocking_error_total: 0,
        retry_fuse_blocked_total: 0,
      };
    }
    return this.protocolGovernanceMetrics.by_tool[normalizedToolName];
  }

  recordProtocolGovernanceCounter(counterName, delta) {
    const name = normalizeString(counterName);
    if (!name) {
      return;
    }
    const amount = Number.isFinite(Number(delta)) ? Number(delta) : 1;
    if (amount <= 0) {
      return;
    }
    const current = toCounterValue(this.protocolGovernanceMetrics.counters[name]);
    this.protocolGovernanceMetrics.counters[name] = current + Math.floor(amount);
    this.touchProtocolGovernanceMetrics();
  }

  recordWriteToolInvocation(toolName) {
    const toolMetrics = this.ensureProtocolGovernanceToolMetrics(toolName);
    this.recordProtocolGovernanceCounter("write_tool_calls_total", 1);
    if (toolMetrics) {
      toolMetrics.write_tool_calls_total =
        toCounterValue(toolMetrics.write_tool_calls_total) + 1;
      this.touchProtocolGovernanceMetrics();
    }
  }

  recordDryRunAliasInvocation(toolName) {
    const toolMetrics = this.ensureProtocolGovernanceToolMetrics(toolName);
    this.recordProtocolGovernanceCounter("dry_run_alias_calls_total", 1);
    if (toolMetrics) {
      toolMetrics.dry_run_alias_calls_total =
        toCounterValue(toolMetrics.dry_run_alias_calls_total) + 1;
      this.touchProtocolGovernanceMetrics();
    }
  }

  recordPreflightInvocation(toolName, preflight) {
    const toolMetrics = this.ensureProtocolGovernanceToolMetrics(toolName);
    const source = isObject(preflight) ? preflight : {};
    const valid = source.valid === true;
    const blockingErrors = Array.isArray(source.blocking_errors)
      ? source.blocking_errors.length
      : 0;

    this.recordProtocolGovernanceCounter("preflight_calls_total", 1);
    this.recordProtocolGovernanceCounter(
      valid ? "preflight_valid_total" : "preflight_invalid_total",
      1
    );
    if (blockingErrors > 0) {
      this.recordProtocolGovernanceCounter(
        "preflight_blocking_error_total",
        blockingErrors
      );
    }

    if (toolMetrics) {
      toolMetrics.preflight_calls_total =
        toCounterValue(toolMetrics.preflight_calls_total) + 1;
      if (valid) {
        toolMetrics.preflight_valid_total =
          toCounterValue(toolMetrics.preflight_valid_total) + 1;
      } else {
        toolMetrics.preflight_invalid_total =
          toCounterValue(toolMetrics.preflight_invalid_total) + 1;
      }
      if (blockingErrors > 0) {
        toolMetrics.preflight_blocking_error_total =
          toCounterValue(toolMetrics.preflight_blocking_error_total) +
          blockingErrors;
      }
      this.touchProtocolGovernanceMetrics();
    }
  }

  recordRetryFuseBlocked(toolName) {
    const toolMetrics = this.ensureProtocolGovernanceToolMetrics(toolName);
    this.recordProtocolGovernanceCounter("retry_fuse_blocked_total", 1);
    if (toolMetrics) {
      toolMetrics.retry_fuse_blocked_total =
        toCounterValue(toolMetrics.retry_fuse_blocked_total) + 1;
      this.touchProtocolGovernanceMetrics();
    }
  }

  recordRetryFuseFailure() {
    this.recordProtocolGovernanceCounter("retry_fuse_failure_recorded_total", 1);
  }

  recordRetryFuseSuccess() {
    this.recordProtocolGovernanceCounter("retry_fuse_success_recorded_total", 1);
  }

  getProtocolGovernanceMetricsSnapshot() {
    const counters = {
      ...this.protocolGovernanceMetrics.counters,
    };
    const writeCalls = Math.max(toCounterValue(counters.write_tool_calls_total), 1);
    const preflightCalls = Math.max(toCounterValue(counters.preflight_calls_total), 1);
    const byTool = Object.entries(this.protocolGovernanceMetrics.by_tool)
      .map(([toolName, toolCounters]) => ({
        tool_name: toolName,
        ...toolCounters,
      }))
      .sort((a, b) => a.tool_name.localeCompare(b.tool_name));
    return {
      schema_version: this.protocolGovernanceMetrics.schema_version,
      updated_at: this.protocolGovernanceMetrics.updated_at,
      counters,
      derived: {
        duplicate_retry_block_rate: Number(
          (
            toCounterValue(counters.retry_fuse_blocked_total) / writeCalls
          ).toFixed(6)
        ),
        preflight_invalid_rate: Number(
          (
            toCounterValue(counters.preflight_invalid_total) / preflightCalls
          ).toFixed(6)
        ),
        dry_run_alias_usage_rate: Number(
          (
            toCounterValue(counters.dry_run_alias_calls_total) / writeCalls
          ).toFixed(6)
        ),
      },
      by_tool: byTool,
      lifecycle: {
        preflight_validate_write_payload: "stable",
        dry_run_alias_status: "deprecated_alias_supported",
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

  buildActionContractRegistry() {
    if (
      !this.capabilityStore ||
      typeof this.capabilityStore.getSnapshot !== "function" ||
      typeof this.capabilityStore.getActionSchema !== "function"
    ) {
      return null;
    }
    return createCapabilityActionContractRegistry(this.capabilityStore);
  }

  buildActionAnchorPolicyByType() {
    const contractRegistry = this.buildActionContractRegistry();
    if (
      contractRegistry &&
      typeof contractRegistry.listActionContracts === "function"
    ) {
      const contracts = contractRegistry.listActionContracts();
      if (!Array.isArray(contracts) || contracts.length === 0) {
        return null;
      }
      const dynamicMap = Object.create(null);
      for (const item of contracts) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const canonicalType = normalizeString(item.action_type).toLowerCase();
        const anchorPolicy = normalizeString(item.anchor_policy);
        if (canonicalType && anchorPolicy && !dynamicMap[canonicalType]) {
          dynamicMap[canonicalType] = anchorPolicy;
        }
        const aliases = Array.isArray(item.aliases) ? item.aliases : [];
        for (const alias of aliases) {
          const normalizedAlias = normalizeString(alias).toLowerCase();
          if (normalizedAlias && anchorPolicy && !dynamicMap[normalizedAlias]) {
            dynamicMap[normalizedAlias] = anchorPolicy;
          }
        }
      }
      if (Object.keys(dynamicMap).length > 0) {
        return dynamicMap;
      }
    }

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
      const actionAliasType = actionType.toLowerCase();
      const canonicalActionType = canonicalizeVisualActionType(actionAliasType);
      if (canonicalActionType && !map[canonicalActionType]) {
        map[canonicalActionType] = anchorPolicy;
      }
      if (!map[actionAliasType]) {
        map[actionAliasType] = anchorPolicy;
      }
    }

    return Object.keys(map).length > 0 ? map : null;
  }
}

module.exports = {
  McpEyesWriteService,
};

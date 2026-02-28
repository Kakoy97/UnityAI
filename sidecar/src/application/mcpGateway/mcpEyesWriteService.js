"use strict";

const {
  validateMcpApplyScriptActions,
  validateMcpApplyVisualActions,
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

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return tokenValidation.outcome;
    }
    const validation = validateMcpApplyScriptActions(body);
    if (!validation.ok) {
      return this.validationError(validation);
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

    const tokenValidation = this.validateWriteReadToken(body);
    if (!tokenValidation.ok) {
      return tokenValidation.outcome;
    }
    const validation = validateMcpApplyVisualActions(body);
    if (!validation.ok) {
      return this.validationError(validation);
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
}

module.exports = {
  McpEyesWriteService,
};

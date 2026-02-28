"use strict";

const {
  buildCompileFailureSummary,
  buildActionFailureSummary,
} = require("../turnPayloadBuilders");
const { isUnityRebootWaitErrorCode } = require("../turnPolicies");
const { cloneJson, normalizeErrorCode } = require("../../utils/turnUtils");
const {
  normalizeRuntime,
  getPendingVisualAction,
  buildCompileRequest,
  buildUnityActionRequest,
  matchActionResult,
} = require("./runtimeUtils");
const { buildExecutionReport, failedTransition } = require("./reportBuilder");

class UnityDispatcher {
  constructor(deps) {
    const opts = deps && typeof deps === "object" ? deps : {};
    this.nowIso =
      typeof opts.nowIso === "function"
        ? opts.nowIso
        : () => new Date().toISOString();
    this.fileActionExecutor =
      opts.fileActionExecutor && typeof opts.fileActionExecutor.execute === "function"
        ? opts.fileActionExecutor
        : null;
  }

  start(job) {
    const runtime = normalizeRuntime(job);
    const fileActions = Array.isArray(runtime.file_actions) ? runtime.file_actions : [];
    if (!runtime.file_actions_applied && fileActions.length > 0) {
      if (!this.fileActionExecutor) {
        return failedTransition(
          runtime,
          "E_INTERNAL",
          "fileActionExecutor is not configured",
          { reason: "file_action_executor_unavailable" },
          this.nowIso
        );
      }

      const execution = this.executeFileActions(fileActions);
      if (!execution.ok) {
        return failedTransition(
          runtime,
          execution.errorCode,
          execution.message,
          {
            reason: "file_actions_failed",
            files_changed: execution.changes,
          },
          this.nowIso
        );
      }

      runtime.file_actions_applied = true;
      runtime.files_changed = cloneJson(execution.changes);
      runtime.phase = "compile_pending";
      runtime.compile_success = null;
      runtime.last_compile_request = buildCompileRequest(job, this.nowIso, "file_actions_applied");
      runtime.last_action_request = null;
      return {
        kind: "waiting_compile",
        runtime,
        compile_request: cloneJson(runtime.last_compile_request),
        files_changed: cloneJson(runtime.files_changed),
      };
    }

    return this.advanceAfterCompileOrFile(job, runtime);
  }

  handleCompileResult(job, body) {
    const runtime = normalizeRuntime(job);
    if (runtime.phase !== "compile_pending") {
      return this.invalidPhase("Job is not waiting for compile result");
    }

    const payload = body && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};
    runtime.last_compile_result = {
      success: payload.success === true,
      duration_ms:
        Number.isFinite(Number(payload.duration_ms)) && Number(payload.duration_ms) >= 0
          ? Math.floor(Number(payload.duration_ms))
          : 0,
      errors: Array.isArray(payload.errors) ? cloneJson(payload.errors) : [],
      timestamp:
        body && typeof body.timestamp === "string" && body.timestamp.trim()
          ? body.timestamp
          : this.nowIso(),
    };

    if (payload.success !== true) {
      runtime.phase = "failed";
      runtime.compile_success = false;
      return failedTransition(
        runtime,
        "E_COMPILE_FAILED",
        buildCompileFailureSummary(payload.errors),
        {
          reason: "compile_failed",
          compile_errors: Array.isArray(payload.errors) ? cloneJson(payload.errors) : [],
          compile_success: false,
          action_success: false,
        },
        this.nowIso
      );
    }

    runtime.compile_success = true;
    return this.advanceAfterCompileOrFile(job, runtime, {
      reason: "compile_succeeded_without_visual_actions",
    });
  }

  handleActionResult(job, body) {
    const runtime = normalizeRuntime(job);
    if (runtime.phase !== "action_pending") {
      return this.invalidPhase("Job is not waiting for action result");
    }

    const pendingAction = getPendingVisualAction(runtime);
    if (!pendingAction) {
      return this.completed(runtime, "all_visual_actions_completed");
    }

    const payload = body && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};
    const match = matchActionResult(pendingAction, payload);
    if (!match.ok) {
      return {
        kind: "mismatch",
        statusCode: 409,
        error_code: "E_SCHEMA_INVALID",
        message: match.message,
        expected: match.expected,
        actual: match.actual,
        diff: match.diff,
      };
    }

    if (payload.success !== true) {
      const errorCode = normalizeErrorCode(
        payload.error_code,
        "E_ACTION_EXECUTION_FAILED"
      );
      const summary = buildActionFailureSummary(payload);
      if (isUnityRebootWaitErrorCode(errorCode)) {
        const errorTimestamp =
          body && typeof body.timestamp === "string" && body.timestamp.trim()
            ? body.timestamp.trim()
            : this.nowIso();
        runtime.phase = "waiting_for_unity_reboot";
        runtime.reboot_wait_started_at = this.resolveTimestampMs(errorTimestamp);
        runtime.last_action_error = {
          error_code: errorCode,
          error_message: summary,
          timestamp: errorTimestamp,
        };
        return {
          kind: "suspended",
          runtime,
          error_code: errorCode,
          error_message: summary,
          recoverable: true,
        };
      }

      runtime.phase = "failed";
      runtime.reboot_wait_started_at = 0;
      return failedTransition(
        runtime,
        errorCode,
        summary,
        {
          reason: "action_failed",
          compile_success: runtime.compile_success !== false,
          action_success: false,
          action_error: {
            error_code: errorCode,
            error_message: summary,
            action_type: payload.action_type || "",
            target_object_path: payload.target_object_path || payload.target || "",
          },
        },
        this.nowIso
      );
    }

    runtime.next_visual_index =
      Number.isFinite(Number(runtime.next_visual_index)) &&
      Number(runtime.next_visual_index) >= 0
        ? Math.floor(Number(runtime.next_visual_index)) + 1
        : 1;
    runtime.phase = "action_pending";
    runtime.last_action_result = cloneJson(payload);
    runtime.last_action_error = null;
    runtime.reboot_wait_started_at = 0;

    const nextAction = getPendingVisualAction(runtime);
    if (nextAction) {
      runtime.last_action_request = buildUnityActionRequest(job, nextAction, this.nowIso);
      return {
        kind: "waiting_action",
        runtime,
        unity_action_request: cloneJson(runtime.last_action_request),
      };
    }

    return this.completed(runtime, "all_visual_actions_completed");
  }

  handleRuntimePing(job) {
    const runtime = normalizeRuntime(job);
    if (runtime.phase !== "waiting_for_unity_reboot") {
      return {
        kind: "noop",
        runtime,
      };
    }
    const pendingAction = getPendingVisualAction(runtime);
    if (!pendingAction) {
      return {
        kind: "noop",
        runtime,
      };
    }
    runtime.phase = "action_pending";
    runtime.reboot_wait_started_at = 0;
    runtime.last_action_request = buildUnityActionRequest(job, pendingAction, this.nowIso);
    return {
      kind: "waiting_action",
      runtime,
      unity_action_request: cloneJson(runtime.last_action_request),
      recovered: true,
    };
  }

  advanceAfterCompileOrFile(job, runtime, options) {
    const pendingAction = getPendingVisualAction(runtime);
    if (pendingAction) {
      runtime.phase = "action_pending";
      runtime.last_action_request = buildUnityActionRequest(job, pendingAction, this.nowIso);
      return {
        kind: "waiting_action",
        runtime,
        unity_action_request: cloneJson(runtime.last_action_request),
      };
    }
    if (runtime.compile_success === null) {
      runtime.compile_success =
        Array.isArray(runtime.file_actions) && runtime.file_actions.length > 0
          ? true
          : null;
    }
    return this.completed(
      runtime,
      options && options.reason ? options.reason : "no_visual_actions"
    );
  }

  completed(runtime, reason) {
    runtime.phase = "completed";
    return {
      kind: "completed",
      runtime,
      execution_report: buildExecutionReport(
        runtime,
        {
          outcome: "completed",
          reason,
          compile_success:
            runtime.compile_success === null ? true : runtime.compile_success === true,
          action_success: true,
        },
        this.nowIso
      ),
    };
  }

  invalidPhase(message) {
    return {
      kind: "invalid",
      statusCode: 409,
      error_code: "E_PHASE_INVALID",
      message,
    };
  }

  executeFileActions(fileActions) {
    try {
      const execution = this.fileActionExecutor.execute(fileActions);
      if (!execution || execution.ok !== true) {
        return {
          ok: false,
          errorCode:
            execution && execution.errorCode ? execution.errorCode : "E_FILE_WRITE_FAILED",
          message:
            execution && execution.message
              ? execution.message
              : "File action execution failed",
          changes:
            execution && Array.isArray(execution.changes) ? execution.changes : [],
        };
      }
      return {
        ok: true,
        changes: Array.isArray(execution.changes) ? execution.changes : [],
      };
    } catch (error) {
      return {
        ok: false,
        errorCode: "E_FILE_WRITE_FAILED",
        message: error instanceof Error ? error.message : "File action execution threw",
        changes: [],
      };
    }
  }

  resolveTimestampMs(value) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
    return Date.now();
  }
}

module.exports = {
  UnityDispatcher,
};

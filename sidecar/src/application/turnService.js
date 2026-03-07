"use strict";
/**
 * R11-ARCH-01 Responsibility boundary:
 * - TurnService coordinates shared application services and orchestration primitives.
 * - TurnService must not expose MCP stdio tool catalogs or raw HTTP route branching.
 * - Command-specific schemas/policies belong to validators + command modules, not adapters.
 */

const {
  validateUnitySelectionSnapshot,
  validateUnityCapabilitiesReport,
  validateUnityRuntimePing,
} = require("../domain/validators");
const {
  normalizeSelectionComponentIndex,
} = require("../utils/turnUtils");
const { ResponseCacheService } = require("./responseCacheService");
const { UnitySnapshotService } = require("./unitySnapshotService");
const { QueryStore } = require("./queryRuntime/queryStore");
const { QueryCoordinator } = require("./queryCoordinator");
const { CapabilityStore } = require("./capabilityStore");
const {
  normalizeRequestId,
  buildValidationErrorResponse: buildValidationErrorResponseHelper,
} = require("./turnServiceWriteSupport");
const {
  createCaptureCompositeRuntime,
} = require("./captureCompositeRuntime");
const { dispatchSsotRequest } = require("./ssotRuntime/dispatchSsotRequest");
const {
  getValidatorRegistrySingleton,
} = require("./ssotRuntime/validatorRegistry");
const {
  getSsotTokenRegistrySingleton,
} = require("./ssotRuntime/ssotTokenRegistry");
const {
  getSsotRevisionStateSingleton,
} = require("./ssotRuntime/ssotRevisionState");
const { validateSsotWriteToken } = require("./ssotRuntime/ssotWriteTokenGuard");
const {
  getActionCatalogView,
  getActionSchemaView,
  getToolSchemaView,
  getWriteContractBundleView,
} = require("./ssotRuntime/staticContractViews");
const {
  guardExecuteUnityTransactionSteps,
} = require("./ssotRuntime/transactionPolicyGuard");
const {
  setupCursorMcp,
  verifyCursorMcpSetup,
} = require("./cursorMcpSetupService");
const { withMcpErrorFeedback } = require("./errorFeedback/mcpErrorFeedback");

const SESSION_CACHE_TTL_MS = 15 * 60 * 1000;

function mapSetupCursorMcpErrorToStatusCode(errorCode) {
  const code =
    typeof errorCode === "string" && errorCode.trim()
      ? errorCode.trim().toUpperCase()
      : "";
  if (code === "E_SCHEMA_INVALID" || code === "E_SSOT_SCHEMA_INVALID") {
    return 400;
  }
  if (code === "E_CURSOR_MCP_PATH_NOT_ALLOWED") {
    return 409;
  }
  if (code === "E_CURSOR_MCP_SERVER_NOT_FOUND") {
    return 500;
  }
  return 500;
}

class TurnService {
  constructor(deps) {
    this.turnStore = deps.turnStore;
    this.nowIso = deps.nowIso;
    this.fileActionExecutor = deps.fileActionExecutor;
    this.sessionCacheTtlMs =
      Number(deps.sessionCacheTtlMs) > 0
        ? Number(deps.sessionCacheTtlMs)
        : SESSION_CACHE_TTL_MS;
    this.v1PolishMetricsCollector =
      deps.v1PolishMetricsCollector &&
      typeof deps.v1PolishMetricsCollector === "object"
        ? deps.v1PolishMetricsCollector
        : null;
    this.captureCompositeEnabled = deps.captureCompositeEnabled === true;
    this.captureCompositeRuntime = createCaptureCompositeRuntime({
      enabled: this.captureCompositeEnabled,
      fuseFailureThreshold: deps.captureCompositeFuseFailureThreshold,
      fuseCooldownMs: deps.captureCompositeFuseCooldownMs,
    });
    this.unityQueryContractVersion =
      typeof deps.unityQueryContractVersion === "string" &&
      deps.unityQueryContractVersion.trim()
        ? deps.unityQueryContractVersion.trim()
        : "unity.query.v2";

    this.responseCacheService = new ResponseCacheService({
      sessionCacheTtlMs: this.sessionCacheTtlMs,
    });
    this.unitySnapshotService = new UnitySnapshotService({
      nowIso: this.nowIso,
      readTokenHardMaxAgeMs: deps.readTokenHardMaxAgeMs,
    });
    this.capabilityStore = new CapabilityStore({
      nowIso: this.nowIso,
      capabilityStaleAfterMs: deps.mcpCapabilityStaleAfterMs,
    });
    this.queryStore = new QueryStore({
      terminalRetentionMs: deps.unityQueryTerminalRetentionMs,
      maxEntries: deps.unityQueryMaxEntries,
    });
    this.queryCoordinator = new QueryCoordinator({
      nowIso: this.nowIso,
      queryStore: this.queryStore,
      defaultTimeoutMs: deps.unityQueryTimeoutMs,
      maxTimeoutMs: deps.unityQueryMaxTimeoutMs,
      defaultQueryContractVersion: this.unityQueryContractVersion,
    });
    this.ssotValidatorRegistry = getValidatorRegistrySingleton();
    this.ssotTokenRegistry = getSsotTokenRegistrySingleton({
      nowIso: this.nowIso,
    });
    this.ssotRevisionState = getSsotRevisionStateSingleton({
      nowIso: this.nowIso,
    });
  }

  getHealthPayload() {
    if (this.turnStore && typeof this.turnStore.sweep === "function") {
      this.turnStore.sweep();
    }
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    const queryRuntime = this.getQueryRuntimeSnapshot();
    return {
      ok: true,
      service: "codex-unity-sidecar-mvp",
      timestamp: this.nowIso(),
      active_request_id: "",
      active_state: "",
      active_query_count: Number(queryRuntime.total) || 0,
      unity_connection_state:
        this.capabilityStore.getSnapshot().unity_connection_state,
    };
  }

  getStateSnapshotPayload() {
    if (this.turnStore && typeof this.turnStore.sweep === "function") {
      this.turnStore.sweep();
    }
    this.cleanupSessionCache();
    this.cleanupFileActionCache();
    const queryRuntime = this.getQueryRuntimeSnapshot();
    const turnSnapshot =
      this.turnStore && typeof this.turnStore.getSnapshot === "function"
        ? this.turnStore.getSnapshot()
        : { turns: [] };
    return {
      ...turnSnapshot,
      mcp_runtime: {
        running_job_id: "",
        queued_job_ids: [],
        jobs: [],
        capabilities: this.capabilityStore.getSnapshot(),
        query_runtime: queryRuntime,
      },
    };
  }

  pullUnityQuery(body) {
    return this.queryCoordinator.pullQuery(body);
  }

  reportUnityQuery(body) {
    return this.queryCoordinator.reportQueryResult(body);
  }

  enqueueAndWaitForUnityQuery(options) {
    const input = options && typeof options === "object" ? options : {};
    return this.queryCoordinator.enqueueAndWaitForUnityQuery({
      queryType: input.queryType,
      payload: input.payload && typeof input.payload === "object" ? input.payload : {},
      timeoutMs: input.timeoutMs,
      requestId: input.requestId,
      threadId: input.threadId,
      turnId: input.turnId,
      queryContractVersion: input.queryContractVersion,
      queryPayloadJson: input.queryPayloadJson,
    });
  }

  reportUnitySelectionSnapshot(body) {
    const validation = validateUnitySelectionSnapshot(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }

    const payload = body && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};
    const reason =
      typeof payload.reason === "string" && payload.reason.trim()
        ? payload.reason.trim()
        : "unknown";
    if (payload.selection_empty === true) {
      this.unitySnapshotService.clearLatestSelectionSnapshot();
      return {
        statusCode: 200,
        body: {
          ok: true,
          event: "unity.selection.snapshot.accepted",
          selection_empty: true,
          reason,
          message: "Selection snapshot cleared",
        },
      };
    }

    this.recordLatestSelectionContext(payload.context, {
      source: "unity.selection.snapshot",
      requestId: normalizeRequestId(body.request_id),
      threadId: typeof body.thread_id === "string" ? body.thread_id : "",
      turnId: typeof body.turn_id === "string" ? body.turn_id : "",
    });
    const snapshot = this.unitySnapshotService.getLatestSelectionSnapshot();
    if (!snapshot || !snapshot.selection) {
      return {
        statusCode: 409,
        body: {
          ok: false,
          event: "unity.selection.snapshot.rejected",
          error_code: "E_SELECTION_UNAVAILABLE",
          message: "Selection snapshot payload did not include a valid target path",
        },
      };
    }
    snapshot.component_index = Array.isArray(payload.component_index)
      ? normalizeSelectionComponentIndex(payload.component_index)
      : [];
    return {
      statusCode: 200,
      body: {
        ok: true,
        event: "unity.selection.snapshot.accepted",
        selection_empty: false,
        reason,
        scene_revision: snapshot.scene_revision || "",
        target_object_id: snapshot.selection.object_id || "",
        target_object_path: snapshot.selection.target_object_path || "",
        captured_at: snapshot.captured_at || this.nowIso(),
      },
    };
  }

  reportUnityRuntimePing(body) {
    const validation = validateUnityRuntimePing(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }
    this.capabilityStore.markUnitySignal();
    return {
      statusCode: 200,
      body: {
        ok: true,
        event: "unity.runtime.pong",
        recovered: false,
        message: "No active job to recover",
        stage: "idle",
        state: "idle",
      },
    };
  }

  reportUnityCapabilities(body) {
    const validation = validateUnityCapabilitiesReport(body);
    if (!validation.ok) {
      return this.validationError(validation);
    }
    const payload = body && body.payload && typeof body.payload === "object"
      ? body.payload
      : {};
    const snapshot = this.capabilityStore.reportCapabilities(payload);
    return {
      statusCode: 200,
      body: {
        ok: true,
        event: "unity.capabilities.accepted",
        unity_connection_state: snapshot.unity_connection_state,
        capability_version: snapshot.capability_version,
        capability_updated_at: snapshot.capability_updated_at,
        action_count: snapshot.action_count,
      },
    };
  }

  setupCursorMcpForMcp(body) {
    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};
    try {
      const result = setupCursorMcp({
        mode:
          typeof payload.mode === "string"
            ? payload.mode.trim().toLowerCase()
            : "native",
        sidecarBaseUrl:
          typeof payload.sidecar_base_url === "string"
            ? payload.sidecar_base_url.trim()
            : undefined,
        dryRun: payload.dry_run === true,
      });
      return {
        statusCode: 200,
        body: {
          ok: true,
          data: result,
          captured_at:
            typeof this.nowIso === "function"
              ? this.nowIso()
              : new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorCode =
        error && typeof error.errorCode === "string" && error.errorCode.trim()
          ? error.errorCode.trim()
          : "E_CURSOR_MCP_SETUP_FAILED";
      const message =
        error && typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "setup_cursor_mcp execution failed";
      return {
        statusCode: mapSetupCursorMcpErrorToStatusCode(errorCode),
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode,
          message,
        }),
      };
    }
  }

  verifyMcpSetupForMcp(body) {
    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};
    try {
      const report = verifyCursorMcpSetup({
        mode:
          typeof payload.mode === "string"
            ? payload.mode.trim().toLowerCase()
            : "auto",
      });
      return {
        statusCode: 200,
        body: {
          ok: true,
          data: report,
          captured_at:
            typeof this.nowIso === "function"
              ? this.nowIso()
              : new Date().toISOString(),
        },
      };
    } catch (error) {
      const errorCode =
        error && typeof error.errorCode === "string" && error.errorCode.trim()
          ? error.errorCode.trim()
          : "E_CURSOR_MCP_VERIFY_FAILED";
      const message =
        error && typeof error.message === "string" && error.message.trim()
          ? error.message.trim()
          : "verify_mcp_setup execution failed";
      return {
        statusCode:
          errorCode === "E_SCHEMA_INVALID" ||
          errorCode === "E_SSOT_SCHEMA_INVALID"
            ? 400
            : 500,
        body: withMcpErrorFeedback({
          status: "failed",
          error_code: errorCode,
          message,
        }),
      };
    }
  }

  getActionCatalogForMcp(body) {
    return getActionCatalogView(body);
  }

  getActionSchemaForMcp(body) {
    return getActionSchemaView(body);
  }

  getToolSchemaForMcp(body) {
    return getToolSchemaView(body);
  }

  getWriteContractBundleForMcp(body) {
    return getWriteContractBundleView(body);
  }

  async dispatchSsotToolForMcp(toolName, body) {
    const normalizedToolName =
      typeof toolName === "string" && toolName.trim() ? toolName.trim() : "";
    if (!normalizedToolName) {
      return {
        statusCode: 400,
        body: {
          status: "failed",
          error_code: "E_SSOT_ROUTE_FAILED",
          message: "SSOT tool name is required",
        },
      };
    }

    const payload =
      body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const toolMetadata =
      this.ssotValidatorRegistry &&
      typeof this.ssotValidatorRegistry.getToolMetadata === "function"
        ? this.ssotValidatorRegistry.getToolMetadata(normalizedToolName)
        : null;
    if (toolMetadata && toolMetadata.kind === "write") {
      const tokenValidation = this.validateSsotTokenForMcp(
        payload.based_on_read_token
      );
      if (!tokenValidation.ok) {
        return {
          statusCode: tokenValidation.statusCode,
          body: {
            status: "failed",
            error_code: tokenValidation.error_code,
            message: tokenValidation.message,
            suggestion: tokenValidation.suggestion,
          },
        };
      }
    }
    if (normalizedToolName === "execute_unity_transaction") {
      const policyGuardResult = guardExecuteUnityTransactionSteps(payload);
      if (!policyGuardResult.ok) {
        return {
          statusCode: 409,
          body: {
            status: "failed",
            error_code: policyGuardResult.error_code,
            message: policyGuardResult.message,
            failed_step_index: policyGuardResult.failed_step_index,
            failed_step_id: policyGuardResult.failed_step_id,
            failed_tool_name: policyGuardResult.failed_tool_name,
          },
        };
      }
    }

    try {
      const unityResponse = await dispatchSsotRequest({
        enqueueAndWaitForUnityQuery: this.enqueueAndWaitForUnityQuery.bind(this),
        toolName: normalizedToolName,
        payload,
        threadId: typeof payload.thread_id === "string" ? payload.thread_id : "",
        requestId: normalizeRequestId(payload.request_id || payload.idempotency_key),
        turnId: typeof payload.turn_id === "string" ? payload.turn_id : "",
        validatorRegistry: this.ssotValidatorRegistry,
        tokenRegistry: this.ssotTokenRegistry,
        revisionState: this.ssotRevisionState,
      });

      if (!unityResponse || typeof unityResponse !== "object") {
        return {
          statusCode: 502,
          body: {
            status: "failed",
            error_code: "E_SSOT_ROUTE_FAILED",
            message: "Unity SSOT query response is invalid",
          },
        };
      }

      if (unityResponse.ok !== true) {
        const errorCode =
          typeof unityResponse.error_code === "string" &&
          unityResponse.error_code.trim()
            ? unityResponse.error_code.trim()
            : "E_SSOT_ROUTE_FAILED";
        const errorMessage =
          typeof unityResponse.error_message === "string" &&
          unityResponse.error_message.trim()
            ? unityResponse.error_message.trim()
            : typeof unityResponse.message === "string" &&
                unityResponse.message.trim()
              ? unityResponse.message.trim()
              : "Unity SSOT query failed";
        return {
          statusCode: 409,
          body: {
            status: "failed",
            error_code: errorCode,
            message: errorMessage,
          },
        };
      }

      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "succeeded",
          query_type: "ssot.request",
          tool_name: normalizedToolName,
          data:
            unityResponse.data && typeof unityResponse.data === "object"
              ? unityResponse.data
              : unityResponse,
        },
      };
    } catch (error) {
      const errorCode =
        error &&
        typeof error === "object" &&
        typeof error.error_code === "string" &&
        error.error_code.trim()
          ? error.error_code.trim()
          : "E_SSOT_ROUTE_FAILED";
      return {
        statusCode: 409,
        body: {
          status: "failed",
            error_code: errorCode,
            message:
              error && typeof error.message === "string" && error.message.trim()
                ? error.message.trim()
                : "Unity SSOT dispatch failed",
        },
      };
    }
  }

  preflightValidateWritePayloadForMcp(body) {
    const source = body && typeof body === "object" && !Array.isArray(body) ? body : {};
    const toolName =
      typeof source.tool_name === "string" && source.tool_name.trim()
        ? source.tool_name.trim()
        : "";
    const payload =
      source.payload && typeof source.payload === "object" && !Array.isArray(source.payload)
        ? source.payload
        : {};
    if (!toolName) {
      return {
        statusCode: 400,
        body: {
          ok: false,
          error_code: "E_SSOT_SCHEMA_INVALID",
          message: "tool_name is required for SSOT preflight",
        },
      };
    }

    const ssotRegistry =
      this.ssotValidatorRegistry &&
      typeof this.ssotValidatorRegistry.getToolMetadata === "function" &&
      typeof this.ssotValidatorRegistry.validateToolInput === "function"
        ? this.ssotValidatorRegistry
        : null;
    if (!ssotRegistry) {
      return {
        statusCode: 500,
        body: {
          ok: false,
          error_code: "E_SSOT_SCHEMA_UNAVAILABLE",
          message: "SSOT validator registry is unavailable",
        },
      };
    }

    const toolMetadata = ssotRegistry.getToolMetadata(toolName);
    if (!toolMetadata) {
      return {
        statusCode: 404,
        body: {
          ok: false,
          error_code: "E_TOOL_SCHEMA_NOT_FOUND",
          message: `Tool schema not found for '${toolName}'`,
        },
      };
    }
    if (toolMetadata.kind !== "write") {
      return {
        statusCode: 200,
        body: {
          ok: true,
          lifecycle: "stable",
          preflight: {
            valid: false,
            tool_name: toolName,
            blocking_errors: [
              {
                error_code: "E_SSOT_WRITE_TOOL_REQUIRED",
                message:
                  "preflight_validate_write_payload only supports SSOT write tools",
              },
            ],
            token_validation: {
              ok: false,
              error_code: "E_SSOT_WRITE_TOOL_REQUIRED",
              message:
                "preflight_validate_write_payload only supports SSOT write tools",
            },
          },
        },
      };
    }

    const tokenValidation = this.validateSsotTokenForMcp(
      payload.based_on_read_token
    );
    if (!tokenValidation.ok) {
      return {
        statusCode: 200,
        body: {
          ok: true,
          lifecycle: "stable",
          preflight: {
            valid: false,
            tool_name: toolName,
            blocking_errors: [
              {
                error_code: tokenValidation.error_code,
                message: tokenValidation.message,
              },
            ],
            token_validation: {
              ok: false,
              error_code: tokenValidation.error_code,
              message: tokenValidation.message,
            },
          },
        },
      };
    }

    const schemaValidation = ssotRegistry.validateToolInput(toolName, payload);
    if (!schemaValidation || schemaValidation.ok !== true) {
      const firstError =
        schemaValidation &&
        Array.isArray(schemaValidation.errors) &&
        schemaValidation.errors.length > 0 &&
        schemaValidation.errors[0] &&
        typeof schemaValidation.errors[0] === "object"
          ? schemaValidation.errors[0]
          : null;
      const path =
        firstError && typeof firstError.instancePath === "string" && firstError.instancePath
          ? firstError.instancePath
          : "/";
      const message =
        firstError && typeof firstError.message === "string" && firstError.message
          ? firstError.message
          : "Request schema invalid";
      return {
        statusCode: 200,
        body: {
          ok: true,
          lifecycle: "stable",
          preflight: {
            valid: false,
            tool_name: toolName,
            blocking_errors: [
              {
                error_code: "E_SSOT_SCHEMA_INVALID",
                message: `Request schema invalid at ${path}: ${message}`,
              },
            ],
            token_validation: {
              ok: true,
            },
          },
        },
      };
    }

    return {
      statusCode: 200,
      body: {
        ok: true,
        lifecycle: "stable",
        preflight: {
          valid: true,
          tool_name: toolName,
          blocking_errors: [],
          token_validation: {
            ok: true,
          },
        },
      },
    };
  }

  validateSsotTokenForMcp(tokenValue) {
    return validateSsotWriteToken({
      tokenRegistry: this.ssotTokenRegistry,
      revisionState: this.ssotRevisionState,
      token: tokenValue,
    });
  }

  getCapabilitiesForMcp() {
    return {
      statusCode: 200,
      body: {
        ok: true,
        ...this.capabilityStore.getSnapshot(),
      },
    };
  }

  recordMcpToolInvocation(input) {
    if (
      this.v1PolishMetricsCollector &&
      typeof this.v1PolishMetricsCollector.recordToolInvocation === "function"
    ) {
      this.v1PolishMetricsCollector.recordToolInvocation(input);
    }
  }

  recordLatestSelectionContext(context, metadata) {
    this.unitySnapshotService.recordLatestSelectionContext(context, metadata);
  }

  cleanupSessionCache() {
    this.responseCacheService.cleanupSessionCache();
  }

  cleanupFileActionCache() {
    this.responseCacheService.cleanupFileActionCache();
  }

  getQueryRuntimeSnapshot() {
    return this.queryCoordinator &&
      typeof this.queryCoordinator.getStats === "function"
      ? this.queryCoordinator.getStats()
      : {
          total: 0,
          pending: 0,
          dispatched: 0,
          terminal: 0,
          waiters: 0,
          default_timeout_ms: 0,
          max_timeout_ms: 0,
        };
  }

  validationError(validation) {
    return buildValidationErrorResponseHelper(validation);
  }

}

module.exports = {
  TurnService,
};

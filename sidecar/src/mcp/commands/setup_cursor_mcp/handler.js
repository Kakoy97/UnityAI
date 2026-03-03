"use strict";

const {
  validationError,
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");
const { setupCursorMcp } = require("../../../application/cursorMcpSetupService");
const { validateSetupCursorMcp } = require("./validator");

function mapSetupErrorToStatusCode(errorCode) {
  const code =
    typeof errorCode === "string" && errorCode.trim()
      ? errorCode.trim().toUpperCase()
      : "";
  if (code === "E_SCHEMA_INVALID") {
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

async function executeSetupCursorMcp(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const validation = validateSetupCursorMcp(payload);
  if (!validation.ok) {
    return validationError(validation, {
      requestBody: payload,
      toolName: "setup_cursor_mcp",
    });
  }

  try {
    const result = setupCursorMcp({
      mode: typeof payload.mode === "string" ? payload.mode.trim().toLowerCase() : "native",
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
          typeof ctx.nowIso === "function"
            ? ctx.nowIso()
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
      statusCode: mapSetupErrorToStatusCode(errorCode),
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode,
        message,
      }),
    };
  }
}

module.exports = {
  executeSetupCursorMcp,
};

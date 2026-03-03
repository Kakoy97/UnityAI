"use strict";

const {
  validationError,
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");
const { verifyCursorMcpSetup } = require("../../../application/cursorMcpSetupService");
const { validateVerifyMcpSetup } = require("./validator");

async function executeVerifyMcpSetup(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const validation = validateVerifyMcpSetup(payload);
  if (!validation.ok) {
    return validationError(validation, {
      requestBody: payload,
      toolName: "verify_mcp_setup",
    });
  }

  try {
    const report = verifyCursorMcpSetup({
      mode: typeof payload.mode === "string" ? payload.mode.trim().toLowerCase() : "auto",
    });
    return {
      statusCode: 200,
      body: {
        ok: true,
        data: report,
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
        : "E_CURSOR_MCP_VERIFY_FAILED";
    const message =
      error && typeof error.message === "string" && error.message.trim()
        ? error.message.trim()
        : "verify_mcp_setup execution failed";
    return {
      statusCode: errorCode === "E_SCHEMA_INVALID" ? 400 : 500,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: errorCode,
        message,
      }),
    };
  }
}

module.exports = {
  executeVerifyMcpSetup,
};

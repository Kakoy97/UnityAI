"use strict";

const {
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");

function executePreflightValidateWritePayload(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const turnService =
    ctx.turnService && typeof ctx.turnService === "object"
      ? ctx.turnService
      : null;
  if (
    !turnService ||
    typeof turnService.preflightValidateWritePayloadForMcp !== "function"
  ) {
    return {
      statusCode: 500,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_INTERNAL",
        message: "turnService.preflightValidateWritePayloadForMcp is unavailable",
      }),
    };
  }

  return turnService.preflightValidateWritePayloadForMcp(payload);
}

module.exports = {
  executePreflightValidateWritePayload,
};


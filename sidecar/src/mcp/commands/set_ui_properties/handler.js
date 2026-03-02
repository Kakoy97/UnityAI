"use strict";

const {
  validationError,
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");
const { validateSetUiProperties } = require("./validator");

async function executeSetUiProperties(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const validation = validateSetUiProperties(payload);
  if (!validation.ok) {
    return validationError(validation, {
      requestBody: payload,
      toolName: "set_ui_properties",
    });
  }

  const turnService =
    ctx.turnService && typeof ctx.turnService === "object"
      ? ctx.turnService
      : null;
  if (
    !turnService ||
    typeof turnService.setUiPropertiesForMcp !== "function"
  ) {
    return {
      statusCode: 500,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_INTERNAL",
        message: "turnService.setUiPropertiesForMcp is unavailable",
      }),
    };
  }

  const outcome = await Promise.resolve(turnService.setUiPropertiesForMcp(payload));
  if (
    outcome &&
    typeof outcome === "object" &&
    Number.isFinite(Number(outcome.statusCode))
  ) {
    return outcome;
  }

  return {
    statusCode: 500,
    body: withMcpErrorFeedback({
      status: "failed",
      error_code: "E_INTERNAL",
      message: "Invalid set_ui_properties outcome",
    }),
  };
}

module.exports = {
  executeSetUiProperties,
};

"use strict";

const {
  validationError,
  withMcpErrorFeedback,
} = require("../../../application/mcpGateway/mcpErrorFeedback");
const {
  buildSetSerializedPropertyApplyVisualPayload,
  validateSetSerializedProperty,
} = require("./validator");

async function executeSetSerializedProperty(context, requestBody) {
  const ctx = context && typeof context === "object" ? context : {};
  const payload =
    requestBody && typeof requestBody === "object" ? requestBody : {};
  const validation = validateSetSerializedProperty(payload);
  if (!validation.ok) {
    return validationError(validation, {
      requestBody: payload,
      toolName: "set_serialized_property",
    });
  }

  const turnService =
    ctx.turnService && typeof ctx.turnService === "object"
      ? ctx.turnService
      : null;
  if (
    !turnService ||
    typeof turnService.applyVisualActionsForMcp !== "function"
  ) {
    return {
      statusCode: 500,
      body: withMcpErrorFeedback({
        status: "failed",
        error_code: "E_INTERNAL",
        message: "turnService.applyVisualActionsForMcp is unavailable",
      }),
    };
  }

  const mappedPayload = buildSetSerializedPropertyApplyVisualPayload(payload);
  const outcome = await Promise.resolve(
    turnService.applyVisualActionsForMcp(mappedPayload)
  );
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
      message: "Invalid set_serialized_property outcome",
    }),
  };
}

module.exports = {
  executeSetSerializedProperty,
};

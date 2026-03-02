"use strict";

const { validateMcpSetUiProperties } = require("../../../domain/validators");

function validateSetUiProperties(body) {
  return validateMcpSetUiProperties(body);
}

module.exports = {
  validateSetUiProperties,
};

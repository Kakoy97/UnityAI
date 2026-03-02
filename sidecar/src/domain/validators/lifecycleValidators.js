"use strict";

const legacy = require("./legacyValidators");

module.exports = {
  validateMcpGetUnityTaskStatus: legacy.validateMcpGetUnityTaskStatus,
  validateMcpCancelUnityTask: legacy.validateMcpCancelUnityTask,
  validateMcpHeartbeat: legacy.validateMcpHeartbeat,
};


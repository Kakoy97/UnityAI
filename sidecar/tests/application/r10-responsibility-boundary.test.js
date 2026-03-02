"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readSource(relativePath) {
  const absolutePath = path.resolve(__dirname, "..", "..", relativePath);
  return fs.readFileSync(absolutePath, "utf8");
}

const FILES = Object.freeze({
  validators: "src/domain/validators.js",
  payloadBuilders: "src/application/turnPayloadBuilders.js",
  turnPolicies: "src/application/turnPolicies.js",
  errorFeedback: "src/application/mcpGateway/mcpErrorFeedback.js",
});

test("R10-ARCH-01 boundary docs exist on all target modules", () => {
  const validators = readSource(FILES.validators);
  const payloadBuilders = readSource(FILES.payloadBuilders);
  const turnPolicies = readSource(FILES.turnPolicies);
  const errorFeedback = readSource(FILES.errorFeedback);

  assert.equal(
    validators.includes("R10-ARCH-01 Responsibility boundary"),
    true
  );
  assert.equal(
    payloadBuilders.includes("R10-ARCH-01 Responsibility boundary"),
    true
  );
  assert.equal(
    turnPolicies.includes("R10-ARCH-01 Responsibility boundary"),
    true
  );
  assert.equal(
    errorFeedback.includes("R10-ARCH-01 Responsibility boundary"),
    true
  );
});

test("R10-ARCH-01 modules keep cross-responsibility dependencies isolated", () => {
  const validators = readSource(FILES.validators);
  const payloadBuilders = readSource(FILES.payloadBuilders);
  const turnPolicies = readSource(FILES.turnPolicies);
  const errorFeedback = readSource(FILES.errorFeedback);

  assert.equal(validators.includes("mcpErrorFeedback"), false);
  assert.equal(validators.includes("turnPayloadBuilders"), false);

  assert.equal(payloadBuilders.includes("../domain/validators"), false);
  assert.equal(payloadBuilders.includes("mcpErrorFeedback"), false);
  assert.equal(payloadBuilders.includes("turnPolicies"), false);

  assert.equal(turnPolicies.includes("turnPayloadBuilders"), false);
  assert.equal(turnPolicies.includes("mcpErrorFeedback"), false);

  assert.equal(errorFeedback.includes("turnPayloadBuilders"), false);
});

test("R10-ARCH-01 module intent remains explicit via role-specific entry points", () => {
  const validators = readSource(FILES.validators);
  const payloadBuilders = readSource(FILES.payloadBuilders);
  const turnPolicies = readSource(FILES.turnPolicies);
  const errorFeedback = readSource(FILES.errorFeedback);

  assert.equal(validators.includes("function validateMcpApplyVisualActions"), true);
  assert.equal(
    payloadBuilders.includes("function buildCompileRequestEnvelope"),
    true
  );
  assert.equal(
    turnPolicies.includes("function getMcpErrorFeedbackTemplate"),
    true
  );
  assert.equal(errorFeedback.includes("function withMcpErrorFeedback"), true);
});


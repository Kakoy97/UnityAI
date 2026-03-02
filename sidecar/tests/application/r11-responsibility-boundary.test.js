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
  mcpServer: "src/mcp/mcpServer.js",
  router: "src/api/router.js",
  turnService: "src/application/turnService.js",
  validators: "src/domain/validators.js",
});

test("R11-ARCH-01 boundary docs exist on all target modules", () => {
  const mcpServer = readSource(FILES.mcpServer);
  const router = readSource(FILES.router);
  const turnService = readSource(FILES.turnService);
  const validators = readSource(FILES.validators);

  assert.equal(mcpServer.includes("R11-ARCH-01 Responsibility boundary"), true);
  assert.equal(router.includes("R11-ARCH-01 Responsibility boundary"), true);
  assert.equal(turnService.includes("R11-ARCH-01 Responsibility boundary"), true);
  assert.equal(validators.includes("R11-ARCH-01 Responsibility boundary"), true);
});

test("R11-ARCH-01 modules keep transport and domain responsibilities isolated", () => {
  const mcpServer = readSource(FILES.mcpServer);
  const router = readSource(FILES.router);
  const turnService = readSource(FILES.turnService);
  const validators = readSource(FILES.validators);

  assert.equal(mcpServer.includes("../api/router"), false);
  assert.equal(mcpServer.includes("../domain/validators"), false);

  assert.equal(router.includes("../domain/validators"), false);
  assert.equal(router.includes("../mcp/mcpServer"), false);

  assert.equal(turnService.includes("../mcp/mcpServer"), false);
  assert.equal(turnService.includes("../api/router"), false);

  assert.equal(validators.includes("../application/"), false);
  assert.equal(validators.includes("../mcp/"), false);
});

test("R11-ARCH-01 role-specific entry points remain explicit", () => {
  const mcpServer = readSource(FILES.mcpServer);
  const router = readSource(FILES.router);
  const turnService = readSource(FILES.turnService);
  const validators = readSource(FILES.validators);

  assert.equal(mcpServer.includes("async getToolDefinitions()"), true);
  assert.equal(router.includes("function createRouter(deps)"), true);
  assert.equal(turnService.includes("enqueueAndWaitForUnityQuery("), true);
  assert.equal(turnService.includes("submitUnityQueryAndWait("), true);
  assert.equal(validators.includes("function validateMcpApplyVisualActions"), true);
});

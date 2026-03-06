"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createRouter } = require("../../src/api/router");
const { TurnStore } = require("../../src/domain/turnStore");
const { TurnService } = require("../../src/application/turnService");
const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");

function walkFiles(dir, allowExts, out) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, allowExts, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!allowExts.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    out.push(fullPath);
  }
}

function findTokenHits(rootDir, allowExts, tokens) {
  const files = [];
  walkFiles(rootDir, allowExts, files);
  const hits = [];
  for (const filePath of files) {
    const text = fs.readFileSync(filePath, "utf8");
    for (const token of tokens) {
      if (text.includes(token)) {
        hits.push({ filePath, token });
      }
    }
  }
  return hits;
}

function createTurnServiceHarness() {
  const turnStore = new TurnStore({
    maintenanceIntervalMs: 60000,
  });
  turnStore.stopMaintenance();
  const service = new TurnService({
    turnStore,
    nowIso: () => "2026-03-06T12:00:00.000Z",
    fileActionExecutor: {
      execute(actions) {
        return {
          ok: true,
          changes: Array.isArray(actions) ? actions : [],
        };
      },
    },
  });
  return { service, turnStore };
}

function invokeRoute(route, method, routePath) {
  const req = {
    method,
    url: routePath,
    headers: {
      host: "127.0.0.1:46321",
    },
  };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 0,
      writeHead(code) {
        this.statusCode = Number(code) || 0;
      },
      end(payload) {
        try {
          resolve({
            statusCode: this.statusCode,
            body:
              typeof payload === "string" && payload.trim()
                ? JSON.parse(payload)
                : {},
          });
        } catch (error) {
          reject(error);
        }
      },
    };
    Promise.resolve(route(req, res)).catch(reject);
  });
}

test("legacy mcp/job/dispatcher module paths are absent from runtime source", () => {
  const srcRoot = path.resolve(__dirname, "../../src");
  const allowExts = new Set([".js", ".ts", ".json"]);
  const forbiddenTokens = [
    "application/mcpGateway/",
    "application/jobRuntime/",
    "application/unityDispatcher/",
    "unity_action_request",
    "unity_query_components_request",
    "unity_query_components_result",
    "MCP_SECURITY_ALLOWLIST_TOOL_NAME_SET",
    "security_allowlist:",
    "allowlist_source:",
  ];
  const hits = findTokenHits(srcRoot, allowExts, forbiddenTokens);
  assert.deepEqual(
    hits,
    [],
    `legacy runtime token hits:\n${hits
      .map((hit) => `${hit.filePath} :: ${hit.token}`)
      .join("\n")}`
  );
});

test("legacy command template directories are physically removed", () => {
  const legacyDefinitionsDir = path.resolve(
    __dirname,
    "../../src/mcp/commands/definitions"
  );
  assert.equal(
    fs.existsSync(legacyDefinitionsDir),
    false,
    "legacy command definitions directory should be deleted"
  );
});

test("legacy per-tool validator templates are physically removed", () => {
  const commandsRoot = path.resolve(__dirname, "../../src/mcp/commands");
  const validatorFiles = [];
  walkFiles(commandsRoot, new Set([".js"]), validatorFiles);
  const hits = validatorFiles.filter((filePath) =>
    filePath.replace(/\\/g, "/").endsWith("/validator.js")
  );
  assert.deepEqual(
    hits,
    [],
    `legacy validator template files should be deleted:\n${hits.join("\n")}`
  );
});

test("turnService no longer exposes mcpGateway compatibility surface", () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    assert.equal(
      Object.prototype.hasOwnProperty.call(service, "mcpGateway"),
      false
    );
  } finally {
    turnStore.stopMaintenance();
  }
});

test("legacy mcp routes are not part of active command routing", () => {
  const registry = getMcpCommandRegistry();
  const routes = registry.listHttpRoutes();
  const signatures = new Set(
    routes.map(
      (item) =>
        `${String(item.method || "").trim().toUpperCase()} ${String(
          item.path || ""
        ).trim()}`
    )
  );

  for (const signature of [
    "POST /mcp/heartbeat",
    "GET /mcp/metrics",
    "GET /mcp/stream",
    "GET /mcp/resources/list",
    "GET /mcp/resources/read",
  ]) {
    assert.equal(
      signatures.has(signature),
      false,
      `legacy route still active: ${signature}`
    );
  }
});

test("router hard-rejects removed legacy routes with 410", async () => {
  const { service, turnStore } = createTurnServiceHarness();
  try {
    const route = createRouter({
      turnService: service,
      port: 46321,
    });

    const removedRoutes = [
      { method: "POST", path: "/mcp/heartbeat" },
      { method: "GET", path: "/mcp/metrics" },
      { method: "GET", path: "/mcp/stream" },
      { method: "POST", path: "/unity/compile/result" },
      { method: "POST", path: "/unity/action/result" },
      { method: "GET", path: "/mcp/resources/list" },
      { method: "GET", path: "/mcp/resources/read" },
    ];

    for (const item of removedRoutes) {
      const outcome = await invokeRoute(route, item.method, item.path);
      assert.equal(
        outcome.statusCode,
        410,
        `expected 410 for removed route: ${item.method} ${item.path}`
      );
      assert.equal(outcome.body.error_code, "E_GONE");
    }
  } finally {
    turnStore.stopMaintenance();
  }
});

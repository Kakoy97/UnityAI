#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { ROUTER_PROTOCOL_FREEZE_CONTRACT } = require("../src/ports/contracts");
const { getMcpCommandRegistry } = require("../src/mcp/commandRegistry");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const FILE_RULES = Object.freeze([
  {
    file: "sidecar/src/mcp/mcpServer.js",
    required: [/R11-ARCH-01 Responsibility boundary/, /getMcpCommandRegistry/],
    forbidden: [/require\(["']\.\.\/api\/router["']\)/, /require\(["']\.\.\/domain\/validators["']\)/],
  },
  {
    file: "sidecar/src/api/router.js",
    required: [/R11-ARCH-01 Responsibility boundary/],
    forbidden: [/require\(["']\.\.\/domain\/validators["']\)/, /require\(["']\.\.\/mcp\/mcpServer["']\)/],
  },
  {
    file: "sidecar/src/application/turnService.js",
    required: [/R11-ARCH-01 Responsibility boundary/],
    forbidden: [/require\(["']\.\.\/mcp\/mcpServer["']\)/, /require\(["']\.\.\/api\/router["']\)/],
  },
  {
    file: "sidecar/src/domain/validators.js",
    required: [/R11-ARCH-01 Responsibility boundary/],
    forbidden: [/require\(["']\.\.\/application\//, /require\(["']\.\.\/mcp\//],
  },
]);

const LOC_LIMIT_RULES = Object.freeze([
  { file: "sidecar/src/mcp/commands/index.js", maxLines: 120 },
  { file: "sidecar/src/mcp/commandRegistry.js", maxLines: 700 },
  { file: "sidecar/src/mcp/mcpServer.js", maxLines: 800 },
  { file: "sidecar/src/api/router.js", maxLines: 420 },
  { file: "sidecar/src/application/turnService.js", maxLines: 760 },
  { file: "sidecar/src/application/mcpGateway/mcpGateway.js", maxLines: 950 },
]);

const DIRECTION_RULES = Object.freeze([
  {
    dir: "sidecar/src/mcp/commands",
    forbidden: [
      /require\(["'][^"']*api\/router["']\)/,
      /require\(["'][^"']*mcp\/mcpServer["']\)/,
      /require\(["'][^"']*application\/turnService["']\)/,
    ],
  },
]);

function readSource(relativePath) {
  const absolute = path.resolve(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolute)) {
    return {
      ok: false,
      source: "",
      error: `file missing: ${relativePath}`,
    };
  }
  return {
    ok: true,
    source: fs.readFileSync(absolute, "utf8"),
  };
}

function countLines(source) {
  if (typeof source !== "string" || source.length === 0) {
    return 0;
  }
  return source.split(/\r?\n/).length;
}

function listJsFilesUnder(relativeDir) {
  const absoluteDir = path.resolve(REPO_ROOT, relativeDir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  const files = [];
  const queue = [absoluteDir];
  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".js")) {
        continue;
      }
      files.push(path.relative(REPO_ROOT, entryPath).replace(/\\/g, "/"));
    }
  }

  files.sort();
  return files;
}

function collectQuotedMcpPaths(source) {
  const text = typeof source === "string" ? source : "";
  const matches = text.match(/"\/mcp\/[^"]+"/g) || [];
  return new Set(matches.map((item) => item.slice(1, -1)));
}

function findExtras(foundSet, allowedSet) {
  const extras = [];
  for (const item of foundSet) {
    if (!allowedSet.has(item)) {
      extras.push(item);
    }
  }
  extras.sort();
  return extras;
}

function findMissing(expectedSet, foundSet) {
  const missing = [];
  for (const item of expectedSet) {
    if (!foundSet.has(item)) {
      missing.push(item);
    }
  }
  missing.sort();
  return missing;
}

function runGuard() {
  const failures = [];
  const registry = getMcpCommandRegistry();
  const registryToolNames = new Set(registry.listMcpToolNames());
  const registryRouteSignatures = new Set(
    registry
      .listHttpRoutes()
      .map((item) => `${String(item.method || "").toUpperCase()} ${String(item.path || "")}`)
  );

  for (const rule of FILE_RULES) {
    const loaded = readSource(rule.file);
    if (!loaded.ok) {
      failures.push(`[${rule.file}] ${loaded.error}`);
      continue;
    }
    for (const pattern of rule.required || []) {
      if (pattern instanceof RegExp && !pattern.test(loaded.source)) {
        failures.push(`[${rule.file}] missing required marker: ${String(pattern)}`);
      }
    }
    for (const pattern of rule.forbidden || []) {
      if (pattern instanceof RegExp && pattern.test(loaded.source)) {
        failures.push(
          `[${rule.file}] forbidden cross-responsibility fragment: ${String(pattern)}`
        );
      }
    }
  }

  for (const rule of LOC_LIMIT_RULES) {
    const loaded = readSource(rule.file);
    if (!loaded.ok) {
      failures.push(`[${rule.file}] ${loaded.error}`);
      continue;
    }
    const lineCount = countLines(loaded.source);
    if (lineCount > rule.maxLines) {
      failures.push(
        `[${rule.file}] LOC limit exceeded: ${lineCount} > ${rule.maxLines}`
      );
    }
  }

  for (const scope of DIRECTION_RULES) {
    const files = listJsFilesUnder(scope.dir);
    if (files.length === 0) {
      failures.push(`[${scope.dir}] no JavaScript files found for direction check`);
      continue;
    }

    for (const relFile of files) {
      const loaded = readSource(relFile);
      if (!loaded.ok) {
        failures.push(`[${relFile}] ${loaded.error}`);
        continue;
      }
      for (const pattern of scope.forbidden || []) {
        if (!(pattern instanceof RegExp)) {
          continue;
        }
        if (pattern.test(loaded.source)) {
          failures.push(
            `[${relFile}] forbidden direction fragment: ${String(pattern)}`
          );
        }
      }
    }
  }

  const routerLoaded = readSource("sidecar/src/api/router.js");
  if (routerLoaded.ok) {
    const allowedHardcodedStatusRoutes = new Set([
      "/mcp/heartbeat",
      "/mcp/capabilities",
      "/mcp/metrics",
      "/mcp/stream",
    ]);
    const allowedCommandRoutes = new Set([
      ...(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_write_http_routes || []),
      ...(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_read_http_routes || []),
      "/mcp/get_unity_task_status",
      "/mcp/cancel_unity_task",
    ]);

    const foundRegistryCommandRoutes = new Set(
      [...registryRouteSignatures]
        .filter((item) => item.startsWith("POST /mcp/") || item.startsWith("GET /mcp/"))
        .map((item) => item.split(" ").slice(1).join(" ").trim())
    );
    const commandRouteExtras = findExtras(
      foundRegistryCommandRoutes,
      allowedCommandRoutes
    );
    const commandRouteMissing = findMissing(
      allowedCommandRoutes,
      foundRegistryCommandRoutes
    );
    if (commandRouteExtras.length > 0) {
      failures.push(
        `[registry] command routes outside frozen contract: ${commandRouteExtras.join(", ")}`
      );
    }
    if (commandRouteMissing.length > 0) {
      failures.push(
        `[registry] missing command routes from frozen contract: ${commandRouteMissing.join(", ")}`
      );
    }

    const foundRoutes = collectQuotedMcpPaths(routerLoaded.source);
    const extraRoutes = findExtras(foundRoutes, allowedHardcodedStatusRoutes);
    const missingRoutes = findMissing(allowedHardcodedStatusRoutes, foundRoutes);
    if (extraRoutes.length > 0) {
      failures.push(
        `[router] hardcoded /mcp status routes outside allowed set: ${extraRoutes.join(", ")}`
      );
    }
    if (missingRoutes.length > 0) {
      failures.push(
        `[router] missing required hardcoded /mcp status routes: ${missingRoutes.join(", ")}`
      );
    }
  }

  const allowedToolNames = new Set(ROUTER_PROTOCOL_FREEZE_CONTRACT.mcp_tool_names || []);
  const extraToolNames = findExtras(registryToolNames, allowedToolNames);
  const missingToolNames = findMissing(allowedToolNames, registryToolNames);
  if (extraToolNames.length > 0) {
    failures.push(
      `[registry] MCP tool names outside frozen contract: ${extraToolNames.join(", ")}`
    );
  }
  if (missingToolNames.length > 0) {
    failures.push(
      `[registry] MCP tool names missing from frozen contract: ${missingToolNames.join(", ")}`
    );
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

if (require.main === module) {
  const result = runGuard();
  if (!result.ok) {
    for (const failure of result.failures) {
      // eslint-disable-next-line no-console
      console.error(`[r11-command-boundary-guard] FAIL ${failure}`);
    }
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log("[r11-command-boundary-guard] PASS");
  }
}

module.exports = {
  FILE_RULES,
  LOC_LIMIT_RULES,
  DIRECTION_RULES,
  runGuard,
};

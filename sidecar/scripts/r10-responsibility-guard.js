#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const RULES = Object.freeze([
  {
    file: "sidecar/src/domain/validators.js",
    required: [/R10-ARCH-01 Responsibility boundary/],
    forbidden: [/mcpErrorFeedback/, /turnPayloadBuilders/],
  },
  {
    file: "sidecar/src/application/turnPayloadBuilders.js",
    required: [/R10-ARCH-01 Responsibility boundary/],
    forbidden: [/mcpErrorFeedback/, /turnPolicies/, /\.\.\/domain\/validators/],
  },
  {
    file: "sidecar/src/application/turnPolicies.js",
    required: [/R10-ARCH-01 Responsibility boundary/],
    forbidden: [/turnPayloadBuilders/, /mcpErrorFeedback/],
  },
  {
    file: "sidecar/src/application/mcpGateway/mcpErrorFeedback.js",
    required: [/R10-ARCH-01 Responsibility boundary/],
    forbidden: [/turnPayloadBuilders/],
  },
]);

const LOC_LIMIT_RULES = Object.freeze([
  { file: "sidecar/src/domain/validators.js", maxLines: 260 },
  { file: "sidecar/src/utils/turnUtils.js", maxLines: 120 },
  { file: "sidecar/src/application/turnPayloadBuilders.js", maxLines: 420 },
  { file: "sidecar/src/application/turnPolicies.js", maxLines: 900 },
  { file: "sidecar/src/application/mcpGateway/mcpErrorFeedback.js", maxLines: 260 },
]);

const DIRECTION_RULES = Object.freeze([
  {
    dir: "sidecar/src/domain/validators",
    forbidden: [/require\(["']\.\.\/application\//, /require\(["']\.\.\/mcp\//],
  },
  {
    dir: "sidecar/src/utils/turn",
    forbidden: [/require\(["']\.\.\/\.\.\/application\//, /require\(["']\.\.\/\.\.\/mcp\//],
  },
]);

function readSource(relativePath) {
  const absolute = path.resolve(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolute)) {
    return {
      ok: false,
      error: `file missing: ${relativePath}`,
      source: "",
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

function runGuard() {
  const failures = [];
  for (const rule of RULES) {
    const loaded = readSource(rule.file);
    if (!loaded.ok) {
      failures.push(`[${rule.file}] ${loaded.error}`);
      continue;
    }
    const source = loaded.source;

    for (const pattern of rule.required || []) {
      if (!(pattern instanceof RegExp)) {
        continue;
      }
      if (!pattern.test(source)) {
        failures.push(
          `[${rule.file}] missing required marker: ${String(pattern)}`
        );
      }
    }

    for (const pattern of rule.forbidden || []) {
      if (!(pattern instanceof RegExp)) {
        continue;
      }
      if (pattern.test(source)) {
        failures.push(
          `[${rule.file}] forbidden cross-responsibility fragment: ${String(
            pattern
          )}`
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
      console.error(`[r10-responsibility-guard] FAIL ${failure}`);
    }
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log("[r10-responsibility-guard] PASS");
  }
}

module.exports = {
  RULES,
  LOC_LIMIT_RULES,
  DIRECTION_RULES,
  runGuard,
};

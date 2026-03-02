#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const REQUIRED_DOCS = Object.freeze([
  "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
  "Assets/Docs/Phase8-Action-Governance-Acceptance.md",
  "docs/Codex-Unity-MCP-Extensibility-Decoupling-Execution-Blueprint.md",
  "docs/Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md",
  "docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md",
]);

const MAIN_INDEX_MARKERS = Object.freeze([
  "docs/Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md",
  "docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md",
  "Assets/Docs/Phase8-Action-Governance-Acceptance.md",
]);

const README_RULES = Object.freeze([
  {
    file: "README.zh-CN.md",
    mustContain: [
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/Phase8-Action-Governance-Acceptance.md",
      "docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md",
    ],
  },
  {
    file: "sidecar/README.md",
    mustContain: [
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/Phase8-Action-Governance-Acceptance.md",
      "docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md",
      "npm run gate:r10-docs",
    ],
  },
]);

function resolveRepoFile(relativePath) {
  return path.resolve(REPO_ROOT, String(relativePath || ""));
}

function fileExists(relativePath) {
  return fs.existsSync(resolveRepoFile(relativePath));
}

function readUtf8(relativePath) {
  return fs.readFileSync(resolveRepoFile(relativePath), "utf8");
}

function runGuard() {
  const failures = [];

  for (const rel of REQUIRED_DOCS) {
    if (!fileExists(rel)) {
      failures.push(`missing required doc: ${rel}`);
    }
  }

  if (fileExists("Assets/Docs/Codex-Unity-MCP-Main-Index.md")) {
    const indexSource = readUtf8("Assets/Docs/Codex-Unity-MCP-Main-Index.md");
    for (const marker of MAIN_INDEX_MARKERS) {
      if (!indexSource.includes(marker)) {
        failures.push(
          `Assets/Docs/Codex-Unity-MCP-Main-Index.md missing required marker: ${marker}`
        );
      }
    }
  }

  for (const rule of README_RULES) {
    if (!fileExists(rule.file)) {
      failures.push(`missing README file: ${rule.file}`);
      continue;
    }
    const source = readUtf8(rule.file);
    for (const marker of rule.mustContain || []) {
      if (!source.includes(marker)) {
        failures.push(`${rule.file} missing required marker: ${marker}`);
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
    for (const item of result.failures) {
      // eslint-disable-next-line no-console
      console.error(`[r10-doc-index-guard] FAIL ${item}`);
    }
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log("[r10-doc-index-guard] PASS");
  }
}

module.exports = {
  REQUIRED_DOCS,
  README_RULES,
  MAIN_INDEX_MARKERS,
  runGuard,
};

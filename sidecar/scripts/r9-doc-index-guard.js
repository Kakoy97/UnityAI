#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const REQUIRED_DOCS = Object.freeze([
  "docs/Codex-Unity-MCP-Extensibility-Decoupling-Execution-Blueprint.md",
  "docs/Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md",
  "docs/Codex-Unity-MCP-Add-Action-Single-Path-Guide.md",
  "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
  "Assets/Docs/Phase8-Action-Governance-Acceptance.md",
]);

const README_RULES = Object.freeze([
  {
    file: "README.en.md",
    mustContain: [
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/Phase8-Action-Governance-Acceptance.md",
    ],
  },
  {
    file: "README.zh-CN.md",
    mustContain: [
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/Phase8-Action-Governance-Acceptance.md",
    ],
  },
  {
    file: "sidecar/README.md",
    mustContain: [
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/Phase8-Action-Governance-Acceptance.md",
    ],
  },
]);

const FORBIDDEN_README_AUTHORITY_MARKERS = Object.freeze([
  "Codex-Unity-Refactoring-Blueprint.md",
  "Codex-Unity-Refactor-Phase-Index.md",
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

function listDocsRootMarkdown() {
  const dir = resolveRepoFile("docs");
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((item) => item && item.isFile() && /\.md$/i.test(item.name))
    .map((item) => item.name)
    .sort();
}

function runGuard() {
  const failures = [];

  for (const rel of REQUIRED_DOCS) {
    if (!fileExists(rel)) {
      failures.push(`missing required doc: ${rel}`);
    }
  }

  const docsRootMarkdown = listDocsRootMarkdown();
  const requiredDocsRoot = [
    "Codex-Unity-MCP-Extensibility-Decoupling-Execution-Blueprint.md",
    "Codex-Unity-MCP-Action-Governance-Upgrade-Blueprint.md",
    "Codex-Unity-MCP-Add-Action-Single-Path-Guide.md",
  ];
  for (const docName of requiredDocsRoot) {
    if (!docsRootMarkdown.includes(docName)) {
      failures.push(`docs/ missing required authority markdown: ${docName}`);
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
    for (const bad of FORBIDDEN_README_AUTHORITY_MARKERS) {
      if (source.includes(bad)) {
        failures.push(`${rule.file} still references deprecated authority doc: ${bad}`);
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
      console.error(`[r9-doc-index-guard] FAIL ${item}`);
    }
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log("[r9-doc-index-guard] PASS");
  }
}

module.exports = {
  REQUIRED_DOCS,
  README_RULES,
  FORBIDDEN_README_AUTHORITY_MARKERS,
  runGuard,
};

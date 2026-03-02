#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const REQUIRED_FILES = Object.freeze([
  {
    file: "sidecar/tests/application/r10-contract-snapshot.test.js",
    mustContain: [
      "error feedback payload contract snapshot remains stable",
      "capability snapshot contract remains stable",
    ],
  },
  {
    file: "Assets/Editor/Codex/Tests/EditMode/SidecarContractsSnapshotTests.cs",
    mustContain: [
      "ErrorResponse_FieldSnapshot_RemainsStable",
      "UnityCapabilitiesContracts_FieldSnapshot_RemainsStable",
      "UnityActionResultPayload_FieldSnapshot_RemainsStable",
    ],
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

function runGuard() {
  const failures = [];
  for (const rule of REQUIRED_FILES) {
    const loaded = readSource(rule.file);
    if (!loaded.ok) {
      failures.push(loaded.error);
      continue;
    }
    const source = loaded.source;
    for (const marker of rule.mustContain || []) {
      if (!source.includes(marker)) {
        failures.push(`${rule.file} missing marker: ${marker}`);
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
      console.error(`[r10-contract-snapshot-guard] FAIL ${failure}`);
    }
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log("[r10-contract-snapshot-guard] PASS");
  }
}

module.exports = {
  REQUIRED_FILES,
  runGuard,
};


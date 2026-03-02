"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function assertFilesExist(relPaths, label) {
  const missing = [];
  for (const relPath of relPaths) {
    const fullPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      missing.push(relPath);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `${label} missing required files:\n${missing.join("\n")}`
  );
}

test("ARCH-QA-01 sidecar regression gate has required suites", () => {
  assertFilesExist(
    [
      "sidecar/tests/application/mcp-tool-schema-minimal.test.js",
      "sidecar/tests/application/r12-tool-registry-consistency.test.js",
      "sidecar/tests/application/r12-tool-visibility-freeze.test.js",
      "sidecar/tests/application/runtime-utils-action-data.test.js",
      "sidecar/tests/application/r9-error-feedback-template-coverage.test.js",
      "sidecar/tests/application/r10-token-budget-guard.test.js",
      "sidecar/tests/domain/validators.anchor-hardcut.test.js",
      "sidecar/tests/domain/validators.composite-action.test.js",
    ],
    "ARCH-QA-01"
  );
});

test("ARCH-QA-02 unity regression gate has required EditMode suites", () => {
  assertFilesExist(
    [
      "Assets/Editor/Codex/Tests/EditMode/UnityQueryControllerClosureTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityQueryRegistryDispatchTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SidecarContractsExtensibilityDtoTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SidecarContractsSnapshotTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityVisualActionRegistryExecutorTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityErrorFeedbackReceiptTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityAnchorExecutionTests.cs",
    ],
    "ARCH-QA-02"
  );
});

test("ARCH-ASSET-01 and ARCH-E2E-01 authoritative docs exist", () => {
  assertFilesExist(
    [
      "docs/ARCHITECTURE_AUDIT.md",
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/Phase11-Architecture-Decoupling-Acceptance.md",
    ],
    "ARCH-ASSET-01 / ARCH-E2E-01"
  );
});

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

test("R20-UX-QA-01 sidecar regression gate has required suites", () => {
  assertFilesExist(
    [
      "sidecar/tests/application/turn-policies-schema-compensation.test.js",
      "sidecar/tests/application/get-write-contract-bundle.test.js",
      "sidecar/tests/application/anchor-write-guard.test.js",
      "sidecar/tests/application/anchor-error-feedback.test.js",
      "sidecar/tests/application/r11-command-contract-snapshot.test.js",
      "sidecar/tests/application/mcp-tool-schema-minimal.test.js",
      "sidecar/tests/domain/validators.anchor-hardcut.test.js",
      "sidecar/tests/domain/validators.composite-action.test.js",
    ],
    "R20-UX-QA-01"
  );
});

test("R20-UX-QA-02 unity regression gate has required EditMode suites", () => {
  assertFilesExist(
    [
      "Assets/Editor/Codex/Tests/EditMode/SidecarContractsSnapshotTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityPhase6ClosureTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityVisualActionRegistryExecutorTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityVisualReadChainTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityErrorFeedbackReceiptTests.cs",
    ],
    "R20-UX-QA-02"
  );
});

test("R20-UX-E2E-01 authoritative docs and evidence index exist", () => {
  assertFilesExist(
    [
      "docs/ROADMAP.md",
      "docs/Phase20-Protocol-Usability-Acceptance.md",
      "docs/V2-PROTOCOL-协议可用性缺口修复实施方案.md",
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/evidence/phase20/README.md",
    ],
    "R20-UX-E2E-01"
  );
});

test("R20-UX-HF-01/HF-02 unity hotfix guard suites exist", () => {
  assertFilesExist(
    [
      "Assets/Editor/Codex/Tests/EditMode/UnityAnchorExecutionTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityRuntimeRecoveryTests.cs",
      "Assets/Editor/Codex/Application/Conversation/TurnStateCoordinator.cs",
      "Assets/Editor/Codex/Application/Conversation/PendingActionCoordinator.cs",
    ],
    "R20-UX-HF-01/HF-02"
  );
});

test("R20-UX-HF-03 hotfix evidence scaffolding is archived", () => {
  assertFilesExist(
    [
      "docs/Phase20-Protocol-Usability-Acceptance.md",
      "Assets/Docs/evidence/phase20/README.md",
      "Assets/Docs/evidence/phase20/2026-03-03/case-f-invalid-envelope-fast-fail.json",
      "Assets/Docs/evidence/phase20/2026-03-03/case-f-optional-parent-anchor-compat.json",
      "Assets/Docs/evidence/phase20/2026-03-03/case-f-hotfix-regression-notes.md",
    ],
    "R20-UX-HF-03"
  );
});

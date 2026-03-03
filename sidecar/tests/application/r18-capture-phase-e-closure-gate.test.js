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

test("R18-CAPTURE-QA-01 sidecar regression gate has required suites", () => {
  assertFilesExist(
    [
      "sidecar/tests/application/r11-command-modules-and-screenshot.test.js",
      "sidecar/tests/application/r11-screenshot-route-and-feedback.test.js",
      "sidecar/tests/application/capture-composite-runtime.test.js",
      "sidecar/tests/application/write-receipt-passthrough.test.js",
      "sidecar/tests/application/unity-dispatcher-report-builder.test.js",
      "sidecar/tests/application/ui-v1-tool-schema-validator-parity.test.js",
      "sidecar/tests/domain/validators.capture-scene-screenshot.test.js",
      "sidecar/tests/domain/validators.get-ui-overlay-report.test.js",
      "sidecar/tests/domain/validators.error-feedback-template.test.js",
      "sidecar/tests/domain/validators.unity-action-result.test.js",
    ],
    "R18-CAPTURE-QA-01"
  );
});

test("R18-CAPTURE-QA-02 unity regression gate has required EditMode suites", () => {
  assertFilesExist(
    [
      "Assets/Editor/Codex/Tests/EditMode/UnityRagReadServiceScreenshotTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityRagReadServiceUiOverlayReportTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityVisualReadChainTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityErrorFeedbackReceiptTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityVisualActionRegistryExecutorTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SidecarContractsSnapshotTests.cs",
    ],
    "R18-CAPTURE-QA-02"
  );
});

test("R18-CAPTURE-E2E-01 authoritative docs and evidence index exist", () => {
  assertFilesExist(
    [
      "docs/ROADMAP.md",
      "docs/V1-CAPTURE-截图诊断增强实施方案.md",
      "docs/Phase18-V1-Capture-Acceptance.md",
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/evidence/phase18/README.md",
    ],
    "R18-CAPTURE-E2E-01"
  );
});

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

test("R16-HYBRID-QA-01 sidecar regression gate has required suites", () => {
  assertFilesExist(
    [
      "sidecar/tests/application/mcp-tool-schema-minimal.test.js",
      "sidecar/tests/application/runtime-utils-action-data.test.js",
      "sidecar/tests/application/r16-wire-guard-script.test.js",
      "sidecar/tests/application/set-serialized-property-tool-schema-validator-parity.test.js",
      "sidecar/tests/application/get-serialized-property-tree-handler.test.js",
      "sidecar/tests/application/get-serialized-property-tree-tool-schema-validator-parity.test.js",
      "sidecar/tests/application/r11-command-modules-and-screenshot.test.js",
      "sidecar/tests/application/ui-v1-tool-schema-validator-parity.test.js",
      "sidecar/tests/application/diagnose-ui-specialist-script.test.js",
      "sidecar/tests/domain/validators.anchor-hardcut.test.js",
      "sidecar/tests/domain/validators.composite-action.test.js",
      "sidecar/tests/domain/validators.set-ui-properties.test.js",
      "sidecar/tests/domain/validators.validate-ui-layout.test.js",
    ],
    "R16-HYBRID-QA-01"
  );
});

test("R16-HYBRID-QA-02 unity regression gate has required EditMode suites", () => {
  assertFilesExist(
    [
      "Assets/Editor/Codex/Tests/EditMode/AtomicActionTestBase.cs",
      "Assets/Editor/Codex/Tests/EditMode/AtomicSafeHighPriorityActionTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/PrimitiveActionCoverageTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SerializedPropertyActionHandlerTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SerializedPropertyTreeReadServiceTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/McpVisualActionContextTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnitySetUiPropertiesMappingTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityUiLayoutValidatorTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SidecarContractsSnapshotTests.cs",
    ],
    "R16-HYBRID-QA-02"
  );
});

test("R16-HYBRID-E2E-01 authoritative docs exist", () => {
  assertFilesExist(
    [
      "docs/三层混合架构实施蓝图与技术攻坚方案.md",
      "docs/PROJECT_ARCHITECTURE_GUIDE.md",
      "docs/Phase16-Hybrid-Architecture-Acceptance.md",
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
    ],
    "R16-HYBRID-E2E-01"
  );
});

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

function assertV1PolishDocSet(label) {
  const docsDir = path.join(REPO_ROOT, "docs");
  const v1PolishDocs = fs.existsSync(docsDir)
    ? fs
        .readdirSync(docsDir, { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => name.startsWith("V1-POLISH-") && name.endsWith(".md"))
    : [];

  const requiredV1Docs = [
    "V1-POLISH-Array-Patch-Schema-Mini-Design.md",
    "V1-POLISH-Metrics-Storage-Design.md",
  ];

  for (const docName of requiredV1Docs) {
    assert.ok(
      v1PolishDocs.includes(docName),
      `${label} missing required V1-POLISH doc: docs/${docName}`
    );
  }

  const implementationBlueprintExists = v1PolishDocs.some(
    (docName) => !requiredV1Docs.includes(docName)
  );
  assert.ok(
    implementationBlueprintExists,
    `${label} missing V1-POLISH implementation blueprint document (expected one docs/V1-POLISH-*.md besides array schema and metrics design)`
  );
}

test("R17-POLISH-QA-01 sidecar regression gate has required suites", () => {
  assertFilesExist(
    [
      "sidecar/tests/application/set-serialized-property-tool-schema-validator-parity.test.js",
      "sidecar/tests/application/get-serialized-property-tree-handler.test.js",
      "sidecar/tests/application/get-serialized-property-tree-tool-schema-validator-parity.test.js",
      "sidecar/tests/application/r11-command-modules-and-screenshot.test.js",
      "sidecar/tests/application/v1-polish-metrics-collector.test.js",
      "sidecar/tests/application/v1-polish-metrics-wiring.test.js",
      "sidecar/tests/application/v1-polish-primitive-report-script.test.js",
      "sidecar/tests/application/error-feedback-metrics-wiring.test.js",
      "sidecar/tests/domain/validators.dry-run.test.js",
      "sidecar/tests/domain/validators.composite-action.test.js",
      "sidecar/tests/domain/validators.set-ui-properties.test.js",
    ],
    "R17-POLISH-QA-01"
  );
});

test("R17-POLISH-QA-02 unity regression gate has required EditMode suites", () => {
  assertFilesExist(
    [
      "Assets/Editor/Codex/Tests/EditMode/BuiltInVisualActionHandlersTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/McpActionRegistryTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SerializedPropertyActionHandlerTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SerializedPropertyTreeReadServiceTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SidecarContractsExtensibilityDtoTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/SidecarContractsSnapshotTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/AtomicSafeHighPriorityActionTests.cs",
    ],
    "R17-POLISH-QA-02"
  );
});

test("R17-POLISH-E2E-01 authoritative docs exist", () => {
  assertFilesExist(
    [
      "docs/ROADMAP.md",
      "docs/Phase17-V1-Polish-Acceptance.md",
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
    ],
    "R17-POLISH-E2E-01"
  );

  assertV1PolishDocSet("R17-POLISH-E2E-01");
});

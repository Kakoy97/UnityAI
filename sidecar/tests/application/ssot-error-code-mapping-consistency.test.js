"use strict";

const path = require("node:path");
const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MCP_ERROR_FEEDBACK_TEMPLATES,
} = require("../../src/application/errorFeedback/errorFeedbackTemplateRegistry");
const {
  STRUCTURED_GUIDANCE_ERROR_CODES,
} = require("../../src/application/errorFeedback/errorGuidanceRegistry");
const {
  normalizeSsotErrorCodeForMcp,
} = require("../../src/application/errorFeedback/ssotErrorCodeCanon");

const FIRST_GROUP_EXECUTOR_FILES = Object.freeze([
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/CreateObjectSsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/AddComponentSsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/SetComponentPropertiesSsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/SetSerializedPropertySsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/SetUiImageColorSsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/ModifyUiLayoutSsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/SaveSceneSsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/GetSceneSnapshotForWriteSsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Executors/ExecuteUnityTransactionSsotExecutor.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionExecutionEngine.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/Transaction/TransactionReferenceResolver.cs",
  "Assets/Editor/Codex/Infrastructure/Queries/Handlers/SsotRequestQueryHandler.cs",
  "Assets/Editor/Codex/Infrastructure/Ssot/SsotRequestDispatcher.cs",
]);

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function collectFailureCodesFromCSharpSource(sourceText) {
  const output = new Set();
  const raw = typeof sourceText === "string" ? sourceText : "";
  const matches = raw.matchAll(/Failure\s*\(\s*"([A-Z0-9_]+)"/g);
  for (const match of matches) {
    if (match && typeof match[1] === "string" && match[1].trim()) {
      output.add(match[1].trim());
    }
  }
  return output;
}

function collectFirstGroupCodes(workspaceRoot) {
  const output = new Set();
  for (const relativePath of FIRST_GROUP_EXECUTOR_FILES) {
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    const source = readText(absolutePath);
    const codes = collectFailureCodesFromCSharpSource(source);
    for (const code of codes) {
      output.add(code);
    }
  }
  return output;
}

test("ssot first-group L3 error codes are canonicalized and mappable in L2", () => {
  const workspaceRoot = path.resolve(__dirname, "../../..");
  const firstGroupCodes = collectFirstGroupCodes(workspaceRoot);
  assert.equal(firstGroupCodes.size > 0, true);

  const templateCodes = new Set(Object.keys(MCP_ERROR_FEEDBACK_TEMPLATES));
  const structuredCodes = new Set(STRUCTURED_GUIDANCE_ERROR_CODES);
  const unresolved = [];

  for (const code of firstGroupCodes) {
    const canonicalCode = normalizeSsotErrorCodeForMcp(code);
    const isMapped =
      templateCodes.has(canonicalCode) || structuredCodes.has(canonicalCode);
    if (!isMapped) {
      unresolved.push({
        source_code: code,
        canonical_code: canonicalCode,
      });
    }
  }

  assert.deepEqual(
    unresolved,
    [],
    `Unmapped first-group L3 error codes found: ${JSON.stringify(unresolved)}`
  );
});

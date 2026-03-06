"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  assertSsotArtifactsAvailable,
  DEFAULT_SSOT_AJV_SCHEMAS_PATH,
} = require("../../src/application/ssotRuntime/startupArtifactsGuard");

test("startup guard accepts existing SSOT compiled artifacts", () => {
  const result = assertSsotArtifactsAvailable();
  assert.ok(result && typeof result === "object");
  assert.ok(result.toolCount > 0);
  assert.ok(result.schemaCount > 0);
});

test("startup guard fails fast when tool catalog artifact is missing", () => {
  const missingCatalogPath = path.join(
    os.tmpdir(),
    `missing-tools-${Date.now()}.json`
  );
  assert.throws(
    () =>
      assertSsotArtifactsAvailable({
        toolCatalogPath: missingCatalogPath,
        ajvSchemasPath: DEFAULT_SSOT_AJV_SCHEMAS_PATH,
      }),
    /missing mcp-tools artifact/
  );
});

test("startup guard fails fast when ajv schema artifact shape is invalid", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssot-startup-guard-"));
  try {
    const toolCatalogPath = path.join(tempDir, "mcp-tools.generated.json");
    const ajvSchemasPath = path.join(tempDir, "ajv-schemas.generated.json");
    fs.writeFileSync(
      toolCatalogPath,
      JSON.stringify({
        version: 1,
        tools: [{ name: "dummy_tool", kind: "read", inputSchema: {} }],
      }),
      "utf8"
    );
    fs.writeFileSync(
      ajvSchemasPath,
      JSON.stringify({ version: 1, schemas: [] }),
      "utf8"
    );

    assert.throws(
      () =>
        assertSsotArtifactsAvailable({
          toolCatalogPath,
          ajvSchemasPath,
        }),
      /invalid ajv-schemas artifact/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});


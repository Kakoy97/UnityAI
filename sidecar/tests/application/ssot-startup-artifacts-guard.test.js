"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  assertSsotArtifactsAvailable,
  DEFAULT_SSOT_AJV_SCHEMAS_PATH,
  DEFAULT_SIDECAR_COMMAND_MANIFEST_PATH,
  DEFAULT_TOKEN_POLICY_PATH,
  DEFAULT_VISIBILITY_POLICY_PATH,
} = require("../../src/application/ssotRuntime/startupArtifactsGuard");

test("startup guard accepts existing SSOT compiled artifacts", () => {
  const result = assertSsotArtifactsAvailable();
  assert.ok(result && typeof result === "object");
  assert.ok(result.toolCount > 0);
  assert.ok(result.schemaCount > 0);
  assert.equal(result.visibilityPolicyPath, DEFAULT_VISIBILITY_POLICY_PATH);
  assert.equal(
    result.sidecarCommandManifestPath,
    DEFAULT_SIDECAR_COMMAND_MANIFEST_PATH
  );
  assert.equal(result.tokenPolicyPath, DEFAULT_TOKEN_POLICY_PATH);
  assert.ok(result.sidecarCommandCount > 0);
  assert.ok(result.tokenPolicyToolCount > 0);
  assert.ok(result.visibilityPolicyActiveToolCount > 0);
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

test("startup guard fails fast when visibility policy artifact is missing", () => {
  const missingVisibilityPath = path.join(
    os.tmpdir(),
    `missing-visibility-policy-${Date.now()}.json`
  );
  assert.throws(
    () =>
      assertSsotArtifactsAvailable({
        visibilityPolicyPath: missingVisibilityPath,
      }),
    /missing visibility-policy artifact/
  );
});

test("startup guard fails fast when sidecar command manifest artifact is missing", () => {
  const missingSidecarManifestPath = path.join(
    os.tmpdir(),
    `missing-sidecar-command-manifest-${Date.now()}.json`
  );
  assert.throws(
    () =>
      assertSsotArtifactsAvailable({
        sidecarCommandManifestPath: missingSidecarManifestPath,
      }),
    /missing sidecar-command-manifest artifact/
  );
});

test("startup guard fails fast when token policy artifact is missing", () => {
  const missingTokenPolicyPath = path.join(
    os.tmpdir(),
    `missing-token-policy-${Date.now()}.json`
  );
  assert.throws(
    () =>
      assertSsotArtifactsAvailable({
        tokenPolicyPath: missingTokenPolicyPath,
      }),
    /missing token-policy artifact/
  );
});

test("startup guard fails fast when visibility policy artifact shape is invalid", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssot-startup-guard-"));
  try {
    const toolCatalogPath = path.join(tempDir, "mcp-tools.generated.json");
    const ajvSchemasPath = path.join(tempDir, "ajv-schemas.generated.json");
    const visibilityPolicyPath = path.join(
      tempDir,
      "visibility-policy.generated.json"
    );

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
      JSON.stringify({ version: 1, schemas: [{ $id: "dummy", type: "object" }] }),
      "utf8"
    );
    fs.writeFileSync(
      visibilityPolicyPath,
      JSON.stringify({
        version: 1,
        exposed_tool_names: ["dummy_tool"],
        deprecated_tool_names: [],
        removed_tool_names: [],
        active_tool_names: "dummy_tool",
        local_static_tool_names: [],
      }),
      "utf8"
    );

    assert.throws(
      () =>
        assertSsotArtifactsAvailable({
          toolCatalogPath,
          ajvSchemasPath,
          visibilityPolicyPath,
        }),
      /invalid visibility-policy artifact/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

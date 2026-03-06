"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SSOT_TOOL_CATALOG_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/mcp-tools.generated.json"
);

const DEFAULT_SSOT_AJV_SCHEMAS_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/ajv-schemas.generated.json"
);

function readJsonFileStrict(filePath, label) {
  let rawText = "";
  try {
    rawText = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `[ssot.startup.guard] missing ${label} artifact: ${filePath} (${error.message})`
    );
  }
  if (!rawText.trim()) {
    throw new Error(
      `[ssot.startup.guard] empty ${label} artifact: ${filePath}`
    );
  }
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `[ssot.startup.guard] invalid JSON for ${label} artifact: ${filePath} (${error.message})`
    );
  }
}

function assertSsotArtifactsAvailable(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const toolCatalogPath = path.resolve(
    String(opts.toolCatalogPath || DEFAULT_SSOT_TOOL_CATALOG_PATH)
  );
  const ajvSchemasPath = path.resolve(
    String(opts.ajvSchemasPath || DEFAULT_SSOT_AJV_SCHEMAS_PATH)
  );

  const toolCatalog = readJsonFileStrict(toolCatalogPath, "mcp-tools");
  const tools = Array.isArray(toolCatalog && toolCatalog.tools)
    ? toolCatalog.tools
    : [];
  if (tools.length <= 0) {
    throw new Error(
      `[ssot.startup.guard] invalid mcp-tools artifact: "tools" must be a non-empty array (${toolCatalogPath})`
    );
  }

  const compiledSchemas = readJsonFileStrict(ajvSchemasPath, "ajv-schemas");
  const schemas = Array.isArray(compiledSchemas && compiledSchemas.schemas)
    ? compiledSchemas.schemas
    : [];
  if (schemas.length <= 0) {
    throw new Error(
      `[ssot.startup.guard] invalid ajv-schemas artifact: "schemas" must be a non-empty array (${ajvSchemasPath})`
    );
  }

  return {
    toolCatalogPath,
    ajvSchemasPath,
    toolCount: tools.length,
    schemaCount: schemas.length,
  };
}

module.exports = {
  DEFAULT_SSOT_TOOL_CATALOG_PATH,
  DEFAULT_SSOT_AJV_SCHEMAS_PATH,
  assertSsotArtifactsAvailable,
};


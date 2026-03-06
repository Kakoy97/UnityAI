"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_COMPILED_SCHEMAS_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/ajv-schemas.generated.json"
);

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSchemaRecord(record, index, sourceLabel) {
  const entry = record && typeof record === "object" ? record : {};
  const toolName = typeof entry.toolName === "string" ? entry.toolName : entry.tool_name;
  const inputSchema = entry.inputSchema || entry.input_schema;
  if (typeof toolName !== "string" || !toolName.trim()) {
    throw new Error(
      `Invalid compiled schema record at ${sourceLabel} schemas[${index}]: missing toolName/tool_name`
    );
  }
  if (!inputSchema || typeof inputSchema !== "object" || Array.isArray(inputSchema)) {
    throw new Error(
      `Invalid compiled schema record at ${sourceLabel} schemas[${index}]: missing inputSchema/input_schema`
    );
  }
  return {
    toolName: toolName.trim(),
    inputSchema: cloneJson(inputSchema),
  };
}

function normalizeCompiledSchemas(payload, sourceLabel = "<memory>") {
  const source = payload && typeof payload === "object" ? payload : {};
  const schemas = Array.isArray(source.schemas) ? source.schemas : null;
  if (!schemas) {
    throw new Error(`Invalid compiled schema bundle at ${sourceLabel}: "schemas" must be an array`);
  }
  return {
    version: source.version,
    schemas: schemas.map((record, index) => normalizeSchemaRecord(record, index, sourceLabel)),
  };
}

function loadCompiledSchemas(options = {}) {
  const artifactPath = options.artifactPath
    ? path.resolve(String(options.artifactPath))
    : DEFAULT_COMPILED_SCHEMAS_PATH;
  let rawText = "";
  try {
    rawText = fs.readFileSync(artifactPath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read compiled schema artifact at ${artifactPath}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(`Invalid JSON in compiled schema artifact ${artifactPath}: ${error.message}`);
  }
  const normalized = normalizeCompiledSchemas(parsed, artifactPath);
  return {
    artifactPath,
    version: normalized.version,
    schemas: normalized.schemas,
  };
}

module.exports = {
  DEFAULT_COMPILED_SCHEMAS_PATH,
  loadCompiledSchemas,
  normalizeCompiledSchemas,
};


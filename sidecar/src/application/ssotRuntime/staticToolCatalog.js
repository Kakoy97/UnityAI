"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SSOT_MCP_TOOLS_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/mcp-tools.generated.json"
);

let staticToolCatalogSingleton = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeToolRecord(entry, index, sourceLabel) {
  const record = entry && typeof entry === "object" ? entry : {};
  const toolName =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : "";
  if (!toolName) {
    throw new Error(
      `Invalid static tool record at ${sourceLabel} tools[${index}]: missing name`
    );
  }
  const inputSchema =
    record.inputSchema && typeof record.inputSchema === "object"
      ? cloneJson(record.inputSchema)
      : { type: "object", additionalProperties: false, properties: {} };
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((item) => typeof item === "string")
    : [];
  return {
    name: toolName,
    kind:
      typeof record.kind === "string" && record.kind.trim()
        ? record.kind.trim()
        : "read",
    lifecycle:
      typeof record.lifecycle === "string" && record.lifecycle.trim()
        ? record.lifecycle.trim()
        : "stable",
    description:
      typeof record.description === "string" ? record.description : "",
    inputSchema,
    required,
    examples: Array.isArray(record.examples) ? cloneJson(record.examples) : [],
  };
}

function normalizeStaticToolCatalog(payload, sourceLabel = "<memory>") {
  const source = payload && typeof payload === "object" ? payload : {};
  const tools = Array.isArray(source.tools) ? source.tools : null;
  if (!tools) {
    throw new Error(
      `Invalid static tool catalog at ${sourceLabel}: "tools" must be an array`
    );
  }
  const byName = new Map();
  for (let index = 0; index < tools.length; index += 1) {
    const normalized = normalizeToolRecord(tools[index], index, sourceLabel);
    byName.set(normalized.name, normalized);
  }
  return {
    version: source.version,
    tools: Array.from(byName.values()),
    byName,
  };
}

function loadStaticToolCatalog(options = {}) {
  const artifactPath = options.artifactPath
    ? path.resolve(String(options.artifactPath))
    : DEFAULT_SSOT_MCP_TOOLS_PATH;
  let rawText = "";
  try {
    rawText = fs.readFileSync(artifactPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read static tool catalog artifact at ${artifactPath}: ${error.message}`
    );
  }
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `Invalid JSON in static tool catalog artifact ${artifactPath}: ${error.message}`
    );
  }
  const normalized = normalizeStaticToolCatalog(parsed, artifactPath);
  return {
    artifactPath,
    version: normalized.version,
    tools: normalized.tools,
    byName: normalized.byName,
  };
}

function getStaticToolCatalogSingleton(options = {}) {
  const hasCustomOptions =
    options &&
    typeof options === "object" &&
    Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return loadStaticToolCatalog(options);
  }
  if (!staticToolCatalogSingleton) {
    staticToolCatalogSingleton = loadStaticToolCatalog();
  }
  return staticToolCatalogSingleton;
}

function resetStaticToolCatalogSingletonForTests() {
  staticToolCatalogSingleton = null;
}

module.exports = {
  DEFAULT_SSOT_MCP_TOOLS_PATH,
  normalizeStaticToolCatalog,
  loadStaticToolCatalog,
  getStaticToolCatalogSingleton,
  resetStaticToolCatalogSingletonForTests,
};


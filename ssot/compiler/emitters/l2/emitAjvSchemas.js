"use strict";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function rewriteDefinitionRef(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (!value.startsWith("#/_definitions/")) {
    return value;
  }
  return "#/$defs/" + value.slice("#/_definitions/".length);
}

function rewriteSchemaForAjv(node) {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteSchemaForAjv(item));
  }
  if (!node || typeof node !== "object") {
    return node;
  }

  const output = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref") {
      output[key] = rewriteDefinitionRef(value);
      continue;
    }
    output[key] = rewriteSchemaForAjv(value);
  }
  return output;
}

function attachSharedDefinitions(inputSchema, sharedDefinitions) {
  const baseSchema =
    inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)
      ? cloneJson(inputSchema)
      : { type: "object", properties: {} };
  const schema = rewriteSchemaForAjv(baseSchema);
  delete schema._definitions;

  const defs =
    sharedDefinitions &&
    typeof sharedDefinitions === "object" &&
    !Array.isArray(sharedDefinitions)
      ? sharedDefinitions
      : null;
  if (!defs) {
    return schema;
  }
  schema.$defs = rewriteSchemaForAjv(cloneJson(defs));
  return schema;
}

function emitAjvSchemas(dictionary) {
  const tools = Array.isArray(dictionary.tools) ? dictionary.tools : [];
  const sharedDefinitions =
    dictionary &&
    dictionary._definitions &&
    typeof dictionary._definitions === "object" &&
    !Array.isArray(dictionary._definitions)
      ? dictionary._definitions
      : null;
  return {
    version: dictionary.version,
    schemas: tools.map((tool) => ({
      tool_name: tool.name,
      input_schema: attachSharedDefinitions(tool.input, sharedDefinitions),
    })),
  };
}

module.exports = {
  emitAjvSchemas,
};

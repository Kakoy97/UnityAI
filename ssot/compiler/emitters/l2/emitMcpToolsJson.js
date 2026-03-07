"use strict";

function projectExample(example) {
  const source = example && typeof example === "object" ? example : {};
  const projected = {};
  if (Object.prototype.hasOwnProperty.call(source, "request")) {
    projected.request = source.request;
  }
  if (Object.prototype.hasOwnProperty.call(source, "user_intent")) {
    projected.user_intent = source.user_intent;
  }
  return projected;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDefinitionRef(value) {
  if (typeof value !== "string") {
    return value;
  }
  if (!value.startsWith("#/_definitions/")) {
    return value;
  }
  return "#/$defs/" + value.slice("#/_definitions/".length);
}

function collectDefinitionRefKeys(node, outputSet) {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectDefinitionRefKeys(item, outputSet);
    }
    return;
  }
  if (!node || typeof node !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") {
      if (value.startsWith("#/_definitions/")) {
        outputSet.add(value.slice("#/_definitions/".length));
      }
      continue;
    }
    collectDefinitionRefKeys(value, outputSet);
  }
}

function rewriteSchemaRefsToDefs(node) {
  if (Array.isArray(node)) {
    return node.map((item) => rewriteSchemaRefsToDefs(item));
  }
  if (!node || typeof node !== "object") {
    return node;
  }

  const output = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref") {
      output[key] = normalizeDefinitionRef(value);
      continue;
    }
    output[key] = rewriteSchemaRefsToDefs(value);
  }
  return output;
}

function buildReferencedDefinitions(baseSchema, rawDefinitions) {
  const definitions =
    rawDefinitions &&
    typeof rawDefinitions === "object" &&
    !Array.isArray(rawDefinitions)
      ? rawDefinitions
      : {};
  const pendingKeys = [];
  const queuedKeys = new Set();
  const resolvedDefs = {};

  const initialRefKeys = new Set();
  collectDefinitionRefKeys(baseSchema, initialRefKeys);
  for (const key of initialRefKeys) {
    if (!queuedKeys.has(key)) {
      queuedKeys.add(key);
      pendingKeys.push(key);
    }
  }

  while (pendingKeys.length > 0) {
    const definitionKey = pendingKeys.shift();
    const rawDefinition = definitions[definitionKey];
    if (
      !rawDefinition ||
      typeof rawDefinition !== "object" ||
      Array.isArray(rawDefinition)
    ) {
      throw new Error(
        `Missing or invalid _definitions entry '${definitionKey}' required by MCP schema`
      );
    }
    const cloned = cloneJson(rawDefinition);
    resolvedDefs[definitionKey] = rewriteSchemaRefsToDefs(cloned);

    const nestedRefKeys = new Set();
    collectDefinitionRefKeys(cloned, nestedRefKeys);
    for (const nestedKey of nestedRefKeys) {
      if (!queuedKeys.has(nestedKey)) {
        queuedKeys.add(nestedKey);
        pendingKeys.push(nestedKey);
      }
    }
  }

  return resolvedDefs;
}

function buildToolInputSchema(toolInput, rawDefinitions) {
  const baseSchema =
    toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)
      ? cloneJson(toolInput)
      : { type: "object", properties: {} };
  delete baseSchema._definitions;

  const outputSchema = rewriteSchemaRefsToDefs(baseSchema);
  const referencedDefinitions = buildReferencedDefinitions(baseSchema, rawDefinitions);
  if (Object.keys(referencedDefinitions).length > 0) {
    outputSchema.$defs = referencedDefinitions;
  }
  return outputSchema;
}

function emitMcpToolsJson(dictionary) {
  const tools = Array.isArray(dictionary.tools) ? dictionary.tools : [];
  const definitions =
    dictionary &&
    dictionary._definitions &&
    typeof dictionary._definitions === "object" &&
    !Array.isArray(dictionary._definitions)
      ? dictionary._definitions
      : {};

  return {
    version: dictionary.version,
    tools: tools.map((tool) => ({
      name: tool.name,
      lifecycle: tool.lifecycle || "stable",
      kind: tool.kind || "write",
      description: tool.description || "",
      inputSchema: buildToolInputSchema(
        tool && typeof tool === "object" ? tool.input : null,
        definitions
      ),
      examples: Array.isArray(tool.examples) ? tool.examples.map(projectExample) : [],
    })),
  };
}

module.exports = {
  emitMcpToolsJson,
};

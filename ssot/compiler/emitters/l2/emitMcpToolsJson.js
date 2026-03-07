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

function projectContractExample(example) {
  const source = example && typeof example === "object" ? example : {};
  const projected = {};
  if (Object.prototype.hasOwnProperty.call(source, "scenario")) {
    projected.scenario = source.scenario;
  }
  if (Object.prototype.hasOwnProperty.call(source, "example_revision")) {
    projected.example_revision = source.example_revision;
  }
  if (Object.prototype.hasOwnProperty.call(source, "context_tags")) {
    projected.context_tags = source.context_tags;
  }
  if (Object.prototype.hasOwnProperty.call(source, "request")) {
    projected.request = source.request;
  }
  return projected;
}

function projectNegativeExample(example) {
  const source = example && typeof example === "object" ? example : {};
  const projected = {};
  if (Object.prototype.hasOwnProperty.call(source, "error_code")) {
    projected.error_code = source.error_code;
  }
  if (Object.prototype.hasOwnProperty.call(source, "fix_hint")) {
    projected.fix_hint = source.fix_hint;
  }
  if (Object.prototype.hasOwnProperty.call(source, "wrong_payload_fragment")) {
    projected.wrong_payload_fragment = source.wrong_payload_fragment;
  }
  if (Object.prototype.hasOwnProperty.call(source, "category")) {
    projected.category = source.category;
  }
  return projected;
}

function normalizeToolPriority(value) {
  const token = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (token === "P0" || token === "P1" || token === "P2") {
    return token;
  }
  return "P2";
}

function normalizeTokenFamily(value, kind) {
  const token = typeof value === "string" ? value.trim() : "";
  if (token) {
    return token;
  }
  return String(kind || "").trim().toLowerCase() === "read"
    ? "read_issues_token"
    : "write_requires_token";
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

function projectGlobalContracts(definitions) {
  const source =
    definitions && typeof definitions === "object" && !Array.isArray(definitions)
      ? definitions
      : {};
  const projected = {};
  for (const key of [
    "error_context_contract",
    "recovery_action_contract",
    "ambiguity_resolution_policy_contract",
    "transaction_write_family",
    "anchor_write_family",
    "create_family",
    "error_feedback_contract",
    "token_automation_contract",
  ]) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }
    const value = source[key];
    if (value && typeof value === "object") {
      projected[key] = cloneJson(value);
    }
  }
  return projected;
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
    global_contracts: projectGlobalContracts(definitions),
    tools: tools.map((tool) => ({
      kind: tool.kind || "write",
      name: tool.name,
      lifecycle: tool.lifecycle || "stable",
      token_family: normalizeTokenFamily(tool.token_family, tool.kind || "write"),
      scene_revision_capable:
        typeof tool.scene_revision_capable === "boolean"
          ? tool.scene_revision_capable
          : normalizeTokenFamily(tool.token_family, tool.kind || "write") !==
            "local_static_no_token",
      description: tool.description || "",
      inputSchema: buildToolInputSchema(
        tool && typeof tool === "object" ? tool.input : null,
        definitions
      ),
      examples: Array.isArray(tool.examples) ? tool.examples.map(projectExample) : [],
      tool_priority: normalizeToolPriority(tool.tool_priority),
      must_configure: tool.must_configure === true,
      priority_score: Number(tool.priority_score) || 0,
      usage_notes: typeof tool.usage_notes === "string" ? tool.usage_notes : "",
      examples_positive: Array.isArray(tool.examples_positive)
        ? tool.examples_positive.map(projectContractExample)
        : [],
      examples_negative: Array.isArray(tool.examples_negative)
        ? tool.examples_negative.map(projectNegativeExample)
        : [],
      common_error_fixes:
        tool.common_error_fixes &&
        typeof tool.common_error_fixes === "object" &&
        !Array.isArray(tool.common_error_fixes)
          ? cloneJson(tool.common_error_fixes)
          : {},
      related_tools: Array.isArray(tool.related_tools)
        ? tool.related_tools.filter((item) => typeof item === "string")
        : [],
      tool_combinations: Array.isArray(tool.tool_combinations)
        ? cloneJson(tool.tool_combinations)
        : [],
      property_path_rules:
        tool.property_path_rules &&
        typeof tool.property_path_rules === "object" &&
        !Array.isArray(tool.property_path_rules)
          ? cloneJson(tool.property_path_rules)
          : null,
      high_frequency_properties:
        tool.high_frequency_properties &&
        typeof tool.high_frequency_properties === "object" &&
        !Array.isArray(tool.high_frequency_properties)
          ? cloneJson(tool.high_frequency_properties)
          : {},
    })),
  };
}

module.exports = {
  emitMcpToolsJson,
};

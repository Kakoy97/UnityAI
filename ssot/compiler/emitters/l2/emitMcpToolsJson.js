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

function emitMcpToolsJson(dictionary) {
  const tools = Array.isArray(dictionary.tools) ? dictionary.tools : [];
  return {
    version: dictionary.version,
    tools: tools.map((tool) => ({
      name: tool.name,
      lifecycle: tool.lifecycle || "stable",
      kind: tool.kind || "write",
      description: tool.description || "",
      inputSchema: tool.input || { type: "object", properties: {} },
      examples: Array.isArray(tool.examples) ? tool.examples.map(projectExample) : [],
    })),
  };
}

module.exports = {
  emitMcpToolsJson,
};

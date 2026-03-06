"use strict";

function emitAjvSchemas(dictionary) {
  const tools = Array.isArray(dictionary.tools) ? dictionary.tools : [];
  return {
    version: dictionary.version,
    schemas: tools.map((tool) => ({
      tool_name: tool.name,
      input_schema: tool.input || { type: "object", properties: {} },
    })),
  };
}

module.exports = {
  emitAjvSchemas,
};


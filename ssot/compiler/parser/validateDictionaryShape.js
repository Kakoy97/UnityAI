"use strict";

function validateDictionaryShape(dictionary) {
  if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) {
    throw new Error("Dictionary root must be an object");
  }
  if (!Object.prototype.hasOwnProperty.call(dictionary, "version")) {
    throw new Error("Dictionary missing required field: version");
  }
  if (!Array.isArray(dictionary.tools)) {
    throw new Error("Dictionary missing required field: tools (array)");
  }
  for (const [index, tool] of dictionary.tools.entries()) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      throw new Error(`tools[${index}] must be an object`);
    }
    if (typeof tool.name !== "string" || !tool.name.trim()) {
      throw new Error(`tools[${index}].name must be a non-empty string`);
    }
    if (!tool.input || typeof tool.input !== "object" || Array.isArray(tool.input)) {
      throw new Error(`tools[${index}].input must be an object`);
    }
  }
  return true;
}

module.exports = {
  validateDictionaryShape,
};


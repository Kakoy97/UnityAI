"use strict";

function normalizeKind(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return normalized || "write";
}

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

    const kind = normalizeKind(tool.kind);
    if (kind === "write") {
      const transaction =
        tool.transaction && typeof tool.transaction === "object" && !Array.isArray(tool.transaction)
          ? tool.transaction
          : null;
      if (!transaction) {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).transaction is required for write tools`
        );
      }
      if (typeof transaction.enabled !== "boolean") {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).transaction.enabled must be boolean`
        );
      }
      if (typeof transaction.undo_safe !== "boolean") {
        throw new Error(
          `tools[${index}](${tool.name.trim()}).transaction.undo_safe must be boolean`
        );
      }
    }
  }
  return true;
}

module.exports = {
  validateDictionaryShape,
};

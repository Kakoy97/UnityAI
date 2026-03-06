"use strict";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function findCaseInsensitiveEnumMatch(enumValues, rawValue) {
  if (!Array.isArray(enumValues) || typeof rawValue !== "string") {
    return null;
  }
  const normalizedRaw = rawValue.toLowerCase();
  for (const candidate of enumValues) {
    if (typeof candidate !== "string") {
      continue;
    }
    if (candidate.toLowerCase() === normalizedRaw) {
      return candidate;
    }
  }
  return null;
}

function normalizeNode(schemaNode, dataNode) {
  if (!schemaNode || typeof schemaNode !== "object" || dataNode === null || dataNode === undefined) {
    return;
  }

  if (
    schemaNode.type === "object" &&
    schemaNode.properties &&
    typeof dataNode === "object" &&
    !Array.isArray(dataNode)
  ) {
    for (const [propertyName, propertySchema] of Object.entries(schemaNode.properties)) {
      if (!Object.prototype.hasOwnProperty.call(dataNode, propertyName)) {
        continue;
      }
      const currentValue = dataNode[propertyName];
      if (propertySchema && propertySchema.case_insensitive === true) {
        const normalized = findCaseInsensitiveEnumMatch(propertySchema.enum, currentValue);
        if (normalized !== null) {
          dataNode[propertyName] = normalized;
        }
      }
      normalizeNode(propertySchema, dataNode[propertyName]);
    }
  }

  if (schemaNode.type === "array" && schemaNode.items && Array.isArray(dataNode)) {
    for (const item of dataNode) {
      normalizeNode(schemaNode.items, item);
    }
  }
}

function normalizeCaseInsensitiveEnums(schema, inputPayload) {
  const normalized = cloneJson(inputPayload === undefined ? {} : inputPayload);
  normalizeNode(schema, normalized);
  return normalized;
}

module.exports = {
  normalizeCaseInsensitiveEnums,
};


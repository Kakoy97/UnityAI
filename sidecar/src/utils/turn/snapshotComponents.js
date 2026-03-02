"use strict";

function normalizeSnapshotComponents(components) {
  if (!Array.isArray(components)) {
    return [];
  }
  const normalized = [];
  for (const item of components) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const shortName =
      typeof item.short_name === "string" && item.short_name.trim()
        ? item.short_name.trim()
        : "";
    if (!shortName) {
      continue;
    }
    const assemblyQualifiedName =
      typeof item.assembly_qualified_name === "string" &&
      item.assembly_qualified_name.trim()
        ? item.assembly_qualified_name.trim()
        : shortName;
    normalized.push({
      short_name: shortName,
      assembly_qualified_name: assemblyQualifiedName,
    });
  }
  return normalized;
}

module.exports = {
  normalizeSnapshotComponents,
};


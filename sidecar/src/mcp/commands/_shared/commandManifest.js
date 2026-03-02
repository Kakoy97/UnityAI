"use strict";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

function materializeCommandManifest(manifestItems) {
  const source = Array.isArray(manifestItems) ? manifestItems : [];
  const normalized = source
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }));
  return deepFreeze(normalized);
}

module.exports = {
  materializeCommandManifest,
};


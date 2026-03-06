"use strict";

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeArrays(left, right) {
  const merged = [];
  const seen = new Set();
  for (const value of [...left, ...right]) {
    const key = JSON.stringify(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(cloneJson(value));
  }
  return merged;
}

function deepMerge(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return mergeArrays(left, right);
  }
  if (isObject(left) && isObject(right)) {
    const output = {};
    for (const key of Object.keys(left)) {
      output[key] = cloneJson(left[key]);
    }
    for (const key of Object.keys(right)) {
      if (Object.prototype.hasOwnProperty.call(output, key)) {
        output[key] = deepMerge(output[key], right[key]);
      } else {
        output[key] = cloneJson(right[key]);
      }
    }
    return output;
  }
  return cloneJson(right);
}

module.exports = {
  deepMerge,
};


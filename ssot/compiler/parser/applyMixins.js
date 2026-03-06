"use strict";

const { deepMerge } = require("../shared/deepMerge");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getMixins(dictionary) {
  const defs = dictionary && dictionary._definitions && dictionary._definitions.mixins;
  return defs && typeof defs === "object" ? defs : {};
}

function applyToolMixins(tool, mixins) {
  const names = Array.isArray(tool.mixins) ? tool.mixins : [];
  let output = cloneJson(tool);
  for (const mixinName of names) {
    if (!Object.prototype.hasOwnProperty.call(mixins, mixinName)) {
      throw new Error(`Unknown mixin "${mixinName}" for tool "${tool.name}"`);
    }
    output = deepMerge(mixins[mixinName], output);
  }
  return output;
}

function applyMixins(dictionary) {
  const source = cloneJson(dictionary);
  const mixins = getMixins(source);
  source.tools = (source.tools || []).map((tool) => applyToolMixins(tool, mixins));
  return source;
}

module.exports = {
  applyMixins,
};


"use strict";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeEnums(dictionary) {
  // Step-1/2 placeholder: runtime normalization rules will be extended in Step-3+.
  return cloneJson(dictionary);
}

module.exports = {
  normalizeEnums,
};


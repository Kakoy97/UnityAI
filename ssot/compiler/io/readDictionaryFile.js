"use strict";

const fs = require("node:fs");
const path = require("node:path");

function readDictionaryFile(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Dictionary file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  const ext = path.extname(absolutePath).toLowerCase();
  return {
    absolutePath,
    ext,
    raw,
  };
}

module.exports = {
  readDictionaryFile,
};


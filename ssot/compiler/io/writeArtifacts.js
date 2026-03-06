"use strict";

const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeArtifacts(outDir, artifactsByRelativePath) {
  const outputRoot = path.resolve(outDir);
  ensureDir(outputRoot);
  for (const [relativePath, content] of Object.entries(artifactsByRelativePath)) {
    const targetPath = path.resolve(outputRoot, relativePath);
    ensureDir(path.dirname(targetPath));
    fs.writeFileSync(targetPath, content, "utf8");
  }
}

module.exports = {
  writeArtifacts,
};


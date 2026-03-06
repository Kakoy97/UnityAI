"use strict";

function getArgValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return fallback;
  }
  return argv[index + 1];
}

function parsePort(argv, fallbackPort) {
  const raw = getArgValue(argv, "--port", String(fallbackPort));
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }
  return port;
}

function findDeprecatedOccFlag(argv) {
  const flags = Array.isArray(argv) ? argv : [];
  const deprecated = new Set([
    "--enable-strict-read-token",
    "--mcp-submit-require-read-token",
  ]);
  for (const token of flags) {
    if (deprecated.has(token)) {
      return token;
    }
  }
  return "";
}

function assertNoDeprecatedOccFlags(argv) {
  const hit = findDeprecatedOccFlag(argv);
  if (!hit) {
    return;
  }
  throw new Error(
    `Deprecated OCC flag is not supported: ${hit}. Token guard is now always enforced.`
  );
}

module.exports = {
  parsePort,
  assertNoDeprecatedOccFlags,
};

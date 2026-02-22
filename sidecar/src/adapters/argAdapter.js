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

module.exports = {
  parsePort,
};


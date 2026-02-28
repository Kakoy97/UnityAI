#!/usr/bin/env node
"use strict";

const { bootstrap } = require("./src");
const {
  parsePort,
  assertNoDeprecatedOccFlags,
  parseMcpLeaseStartupConfig,
  assertNoDeprecatedAutoCleanupSettings,
} = require("./src/adapters/argAdapter");

try {
  assertNoDeprecatedOccFlags(process.argv);
  assertNoDeprecatedAutoCleanupSettings(process.argv, process.env);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
}

const port = parsePort(process.argv, 46321);
if (!port) {
  // eslint-disable-next-line no-console
  console.error("Invalid --port value");
  process.exit(1);
}

const server = bootstrap(port, {
  argv: process.argv,
  mcpLeaseConfig: parseMcpLeaseStartupConfig(process.env),
});
server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[sidecar] listening on http://127.0.0.1:${port}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});

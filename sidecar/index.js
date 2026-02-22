#!/usr/bin/env node
"use strict";

const { bootstrap } = require("./src");
const { parsePort } = require("./src/adapters/argAdapter");

const port = parsePort(process.argv, 46321);
if (!port) {
  // eslint-disable-next-line no-console
  console.error("Invalid --port value");
  process.exit(1);
}

const server = bootstrap(port);
server.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[sidecar] listening on http://127.0.0.1:${port}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});


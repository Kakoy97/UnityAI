"use strict";

const http = require("http");
const { createRouter } = require("../api/router");

/**
 * @param {{
 *  port: number,
 *  turnService: import("../application/turnService").TurnService
 * }} deps
 */
function createServer(deps) {
  /** @type {import("http").Server | null} */
  let server = null;
  let shutdownRequested = false;

  const requestShutdown = () => {
    if (shutdownRequested || !server) {
      return;
    }
    shutdownRequested = true;
    setTimeout(() => {
      server.close(() => {
        process.exit(0);
      });
    }, 25);
  };

  const route = createRouter({
    turnService: deps.turnService,
    port: deps.port,
    requestShutdown,
  });

  server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      sendInternalError(res, error);
    });
  });

  return server;
}

function sendInternalError(res, error) {
  const payload = JSON.stringify({
    error_code: "E_INTERNAL",
    message: error instanceof Error ? error.message : String(error),
  });

  res.writeHead(500, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

module.exports = {
  createServer,
};

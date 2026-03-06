"use strict";
/**
 * R11-ARCH-01 Responsibility boundary:
 * - Router only maps HTTP method/path to TurnService entry points.
 * - Router must not own business validation rules or MCP tool schema assembly.
 * - Command expansion must obey command contract gates and avoid cross-layer logic leaks.
 */

const { URL } = require("url");
const { readJsonBody, sendJson } = require("../infrastructure/httpIO");
const { getMcpCommandRegistry } = require("../mcp/commandRegistry");
const { ROUTER_PROTOCOL_FREEZE_CONTRACT } = require("../ports/contracts");

const DEPRECATED_HTTP_ROUTES = new Set(
  ROUTER_PROTOCOL_FREEZE_CONTRACT &&
  Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_http_routes)
    ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_http_routes
    : []
);

/**
 * @param {{
 *  turnService: import("../application/turnService").TurnService,
 *  port: number,
 *  requestShutdown?: () => void
 * }} deps
 */
function createRouter(deps) {
  const { turnService, port, requestShutdown } = deps;
  const commandRegistry = getMcpCommandRegistry();

  return async function route(req, res) {
    const origin = `http://${req.headers.host || `127.0.0.1:${port}`}`;
    const url = new URL(req.url || "/", origin);
    const method = req.method || "GET";

    if (method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, turnService.getHealthPayload());
      return;
    }

    if (method === "GET" && url.pathname === "/state/snapshot") {
      sendJson(res, 200, turnService.getStateSnapshotPayload());
      return;
    }

    if (method === "POST" && url.pathname === "/session/start") {
      sendJson(res, 410, {
        error_code: "E_GONE",
        message: "session/turn endpoints are removed; use MCP APIs",
      });
      return;
    }

    if (method === "POST" && url.pathname === "/turn/send") {
      sendJson(res, 410, {
        error_code: "E_GONE",
        message: "session/turn endpoints are removed; use MCP APIs",
      });
      return;
    }

    if (DEPRECATED_HTTP_ROUTES.has(url.pathname)) {
      sendJson(res, 410, {
        error_code: "E_GONE",
        message: `Route removed in phase6: ${url.pathname}`,
      });
      return;
    }

    const commandOutcome = await commandRegistry.dispatchHttpCommand({
      method,
      path: url.pathname,
      url,
      req,
      readJsonBody,
      turnService,
    });
    if (commandOutcome) {
      sendJson(res, commandOutcome.statusCode, commandOutcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/runtime/ping") {
      const body = await readJsonBody(req);
      const outcome = turnService.reportUnityRuntimePing(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/selection/snapshot") {
      const body = await readJsonBody(req);
      const outcome = turnService.reportUnitySelectionSnapshot(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/capabilities/report") {
      const body = await readJsonBody(req);
      const outcome = turnService.reportUnityCapabilities(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/query/pull") {
      const body = await readJsonBody(req);
      const outcome = turnService.pullUnityQuery(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/query/report") {
      const body = await readJsonBody(req);
      const outcome = turnService.reportUnityQuery(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "GET" && url.pathname === "/turn/status") {
      sendJson(res, 410, {
        error_code: "E_GONE",
        message: "session/turn endpoints are removed; use MCP APIs",
      });
      return;
    }

    if (method === "POST" && url.pathname === "/turn/cancel") {
      sendJson(res, 410, {
        error_code: "E_GONE",
        message: "session/turn endpoints are removed; use MCP APIs",
      });
      return;
    }

    if (method === "GET" && url.pathname === "/mcp/capabilities") {
      const outcome = turnService.getCapabilitiesForMcp();
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/admin/shutdown") {
      sendJson(res, 200, {
        ok: true,
        event: "sidecar.shutdown.accepted",
      });
      if (typeof requestShutdown === "function") {
        requestShutdown();
      }
      return;
    }

    sendJson(res, 404, {
      error_code: "E_NOT_FOUND",
      message: "Route not found",
      method,
      path: url.pathname,
    });
  };
}

module.exports = {
  createRouter,
};

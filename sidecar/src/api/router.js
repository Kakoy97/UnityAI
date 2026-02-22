"use strict";

const { URL } = require("url");
const { readJsonBody, sendJson } = require("../infrastructure/httpIO");
const ENABLE_QUERY_RESULT_DIAG_LOG = parseBoolEnv(
  process.env.SIDECAR_DIAG_QUERY_RESULT,
  false
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
      const body = await readJsonBody(req);
      const outcome = turnService.startSession(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/turn/send") {
      const body = await readJsonBody(req);
      const outcome = turnService.sendTurn(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/file-actions/apply") {
      const body = await readJsonBody(req);
      const outcome = turnService.applyFileActions(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/compile/result") {
      const body = await readJsonBody(req);
      const outcome = turnService.reportCompileResult(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/action/result") {
      const body = await readJsonBody(req);
      const outcome = turnService.reportUnityActionResult(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/query/components/result") {
      const body = await readJsonBody(req);
      if (ENABLE_QUERY_RESULT_DIAG_LOG) {
        try {
          // Optional diagnostic breadcrumb for query roundtrip verification.
          console.log(
            "[sidecar] Got result from Unity: /unity/query/components/result",
            JSON.stringify({
              request_id: body && body.request_id,
              query_id: body && body.payload ? body.payload.query_id : "",
              target_path: body && body.payload ? body.payload.target_path : "",
              components_count:
                body &&
                body.payload &&
                Array.isArray(body.payload.components)
                  ? body.payload.components.length
                  : 0,
            })
          );
        } catch {
          // keep route robust even if log serialization fails
        }
      }
      const outcome = turnService.reportUnityQueryComponentsResult(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/unity/runtime/ping") {
      const body = await readJsonBody(req);
      const outcome = turnService.reportUnityRuntimePing(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "GET" && url.pathname === "/turn/status") {
      const outcome = turnService.getTurnStatus(
        url.searchParams.get("request_id"),
        url.searchParams.get("cursor")
      );
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/turn/cancel") {
      const body = await readJsonBody(req);
      const outcome = turnService.cancelTurn(body);
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

function parseBoolEnv(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") {
    return !!fallback;
  }
  const value = String(raw).trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return !!fallback;
}

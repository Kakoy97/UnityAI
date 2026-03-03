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
const {
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  OBSERVABILITY_FREEZE_CONTRACT,
} = require("../ports/contracts");

const DEPRECATED_HTTP_ROUTES = new Set(
  ROUTER_PROTOCOL_FREEZE_CONTRACT &&
  Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_http_routes)
    ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_http_routes
    : []
);
const METRICS_CONTRACT_VERSION =
  OBSERVABILITY_FREEZE_CONTRACT &&
  typeof OBSERVABILITY_FREEZE_CONTRACT.metrics_contract_version === "string"
    ? OBSERVABILITY_FREEZE_CONTRACT.metrics_contract_version
    : "mcp.metrics.v1";
const STREAM_EVENT_CONTRACT_VERSION =
  OBSERVABILITY_FREEZE_CONTRACT &&
  typeof OBSERVABILITY_FREEZE_CONTRACT.stream_event_contract_version === "string"
    ? OBSERVABILITY_FREEZE_CONTRACT.stream_event_contract_version
    : "mcp.stream.event.v1";
const STREAM_READY_CONTRACT_VERSION =
  OBSERVABILITY_FREEZE_CONTRACT &&
  typeof OBSERVABILITY_FREEZE_CONTRACT.stream_ready_contract_version === "string"
    ? OBSERVABILITY_FREEZE_CONTRACT.stream_ready_contract_version
    : "mcp.stream.ready.v1";

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

    if (method === "POST" && url.pathname === "/mcp/heartbeat") {
      const body = await readJsonBody(req);
      const outcome = turnService.heartbeatMcp(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "GET" && url.pathname === "/mcp/capabilities") {
      const outcome = turnService.getCapabilitiesForMcp();
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "GET" && url.pathname === "/mcp/metrics") {
      const outcome = turnService.getMcpMetrics();
      sendJson(res, outcome.statusCode, outcome.body, {
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "X-Codex-Metrics-Contract-Version": METRICS_CONTRACT_VERSION,
      });
      return;
    }

    if (method === "GET" && url.pathname === "/mcp/stream") {
      const streamCursor = resolveStreamCursor(url, req.headers || {});
      const registration = turnService.registerMcpStreamSubscriber({
        thread_id: url.searchParams.get("thread_id"),
        cursor: streamCursor.cursor,
        onEvent: (eventPayload) => {
          writeSseEvent(res, eventPayload);
        },
      });
      if (!registration.ok) {
        sendJson(res, registration.statusCode, registration.body);
        return;
      }

      if (req.socket && typeof req.socket.setKeepAlive === "function") {
        req.socket.setKeepAlive(true);
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Codex-Stream-Contract-Version": STREAM_EVENT_CONTRACT_VERSION,
        "X-Codex-Stream-Ready-Contract-Version": STREAM_READY_CONTRACT_VERSION,
      });
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }
      res.write(": connected\n\n");

      writeSseEvent(res, {
        stream_ready_contract_version: STREAM_READY_CONTRACT_VERSION,
        seq: registration.latest_event_seq || 0,
        event: "stream.ready",
        timestamp: new Date().toISOString(),
        cursor_source: streamCursor.source,
        requested_cursor:
          Number.isFinite(Number(registration.requested_cursor)) &&
          Number(registration.requested_cursor) >= 0
            ? Math.floor(Number(registration.requested_cursor))
            : 0,
        oldest_event_seq:
          Number.isFinite(Number(registration.oldest_event_seq)) &&
          Number(registration.oldest_event_seq) > 0
            ? Math.floor(Number(registration.oldest_event_seq))
            : 0,
        latest_event_seq:
          Number.isFinite(Number(registration.latest_event_seq)) &&
          Number(registration.latest_event_seq) > 0
            ? Math.floor(Number(registration.latest_event_seq))
            : 0,
        replay_from_seq:
          Number.isFinite(Number(registration.replay_from_seq)) &&
          Number(registration.replay_from_seq) > 0
            ? Math.floor(Number(registration.replay_from_seq))
            : 0,
        replay_truncated: registration.replay_truncated === true,
        fallback_query_suggested: registration.replay_truncated === true,
        recovery_jobs_count:
          Number.isFinite(Number(registration.recovery_jobs_count)) &&
          Number(registration.recovery_jobs_count) >= 0
            ? Math.floor(Number(registration.recovery_jobs_count))
            : 0,
        recovery_jobs: Array.isArray(registration.recovery_jobs)
          ? registration.recovery_jobs
          : [],
        replay_count: Array.isArray(registration.replay_events)
          ? registration.replay_events.length
          : 0,
      });
      if (Array.isArray(registration.replay_events)) {
        for (const eventPayload of registration.replay_events) {
          writeSseEvent(res, eventPayload);
        }
      }

      const heartbeatTimer = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          // write failure is handled by close event cleanup
        }
      }, 15000);

      const cleanup = () => {
        clearInterval(heartbeatTimer);
        turnService.unregisterMcpStreamSubscriber(registration.subscriber_id);
      };
      req.on("close", cleanup);
      req.on("error", cleanup);
      res.on("close", cleanup);
      res.on("error", cleanup);
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

function writeSseEvent(res, payload) {
  if (!res || typeof res.write !== "function") {
    return;
  }
  const body = payload && typeof payload === "object" ? payload : {};
  const seq = Number.isFinite(Number(body.seq)) ? Math.floor(Number(body.seq)) : 0;
  const eventName =
    typeof body.event === "string" && body.event.trim()
      ? body.event.trim()
      : "message";
  if (seq > 0) {
    res.write(`id: ${seq}\n`);
  }
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(body)}\n\n`);
}

function parseCursor(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function resolveStreamCursor(url, headers) {
  const searchParams = url && url.searchParams ? url.searchParams : null;
  if (searchParams && searchParams.has("cursor")) {
    return {
      cursor: parseCursor(searchParams.get("cursor")),
      source: "query",
    };
  }
  const lastEventIdRaw = readHeaderValue(headers, "last-event-id");
  if (lastEventIdRaw !== "") {
    return {
      cursor: parseCursor(lastEventIdRaw),
      source: "last_event_id",
    };
  }
  return {
    cursor: 0,
    source: "default",
  };
}

function readHeaderValue(headers, key) {
  if (!headers || typeof headers !== "object") {
    return "";
  }
  const raw = headers[key];
  if (Array.isArray(raw)) {
    return typeof raw[0] === "string" ? raw[0] : "";
  }
  return typeof raw === "string" ? raw : "";
}

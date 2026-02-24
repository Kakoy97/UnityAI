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

    if (method === "POST" && url.pathname === "/mcp/submit_unity_task") {
      const body = await readJsonBody(req);
      const outcome = turnService.submitUnityTask(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "GET" && url.pathname === "/mcp/get_unity_task_status") {
      const outcome = turnService.getUnityTaskStatus(
        url.searchParams.get("job_id")
      );
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "POST" && url.pathname === "/mcp/cancel_unity_task") {
      const body = await readJsonBody(req);
      const outcome = turnService.cancelUnityTask(body);
      sendJson(res, outcome.statusCode, outcome.body);
      return;
    }

    if (method === "GET" && url.pathname === "/mcp/metrics") {
      const outcome = turnService.getMcpMetrics();
      sendJson(res, outcome.statusCode, outcome.body);
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
      });
      if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
      }
      res.write(": connected\n\n");

      writeSseEvent(res, {
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

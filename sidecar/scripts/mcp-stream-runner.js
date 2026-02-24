#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { spawn } = require("child_process");

const DEFAULT_BASE_URL = "http://127.0.0.1:46326";
const DEFAULT_WAIT_TIMEOUT_MS = 12000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  const report = {
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: "",
    base_url: args.baseUrl,
    config: {
      spawn_sidecar: args.spawnSidecar,
      mcp_max_queue: args.mcpMaxQueue,
      mcp_stream_max_events: args.mcpStreamMaxEvents,
      mcp_stream_max_subscribers: args.mcpStreamMaxSubscribers,
      mcp_stream_recovery_jobs_max: args.mcpStreamRecoveryJobsMax,
      wait_timeout_ms: args.waitTimeoutMs,
    },
    cases: [],
    summary: {
      passed: 0,
      failed: 0,
      warned: 0,
      total: 0,
    },
  };

  /** @type {null | { child: import("child_process").ChildProcess, startedByRunner: boolean }} */
  let spawned = null;
  let stream = null;
  let streamReconnected = null;
  let metricsBefore = null;
  try {
    try {
      await ensureSidecarAvailability(args.baseUrl);
    } catch {
      if (!args.spawnSidecar) {
        throw new Error(
          `Sidecar is not reachable at ${args.baseUrl}. Start sidecar first or use --spawn-sidecar.`
        );
      }
      spawned = await startSidecarIfNeeded(args.baseUrl, runId, {
        mcpMaxQueue: args.mcpMaxQueue,
        mcpStreamMaxEvents: args.mcpStreamMaxEvents,
        mcpStreamMaxSubscribers: args.mcpStreamMaxSubscribers,
        mcpStreamRecoveryJobsMax: args.mcpStreamRecoveryJobsMax,
      });
    }
    await ensureSidecarAvailability(args.baseUrl);

    await runCase(report, "health_check", async () => {
      const res = await requestJson({
        method: "GET",
        url: `${args.baseUrl}/health`,
        timeoutMs: 4000,
      });
      assertStatus(res, 200, "health_check");
      if (!res.body || res.body.ok !== true) {
        throw new Error("health response missing ok=true");
      }
      return {
        active_request_id: res.body.active_request_id || "",
      };
    });

    metricsBefore = await getMcpMetrics(args.baseUrl);

    stream = await openSseClient({
      baseUrl: args.baseUrl,
      cursor: 0,
      threadId: "",
    });

    await runCase(report, "stream_ready", async () => {
      const ready = await stream.waitFor(
        (eventItem) => eventItem.event === "stream.ready",
        args.waitTimeoutMs
      );
      return {
        seq: ready.seq || 0,
        replay_count:
          Number.isFinite(Number(ready.replay_count)) &&
          Number(ready.replay_count) >= 0
            ? Math.floor(Number(ready.replay_count))
            : 0,
      };
    });

    const threadId = `t_mcp_stream_${runId}`;
    const idemFirst = `idem_stream_a_${runId}`;
    const idemSecond = `idem_stream_b_${runId}`;
    const idemThird = `idem_stream_c_${runId}`;
    const idemFourth = `idem_stream_d_${runId}`;

    const submitFirst = await runCase(report, "submit_first_emit_pending", async () => {
      const res = await postJson(args.baseUrl, "/mcp/submit_unity_task", {
        thread_id: threadId,
        idempotency_key: idemFirst,
        approval_mode: "auto",
        user_intent: "stream first running job",
      });
      assertStatus(res, 202, "submit_first_emit_pending");
      if (!res.body || res.body.status !== "accepted") {
        throw new Error(`expected accepted, got ${safeJson(res.body)}`);
      }
      const jobId = res.body.job_id || "";
      if (!jobId) {
        throw new Error("submit_first_emit_pending expected non-empty job_id");
      }
      const progress = await stream.waitFor(
        (eventItem) =>
          eventItem.event === "job.progress" &&
          eventItem.thread_id === threadId &&
          eventItem.job_id === jobId &&
          eventItem.status === "pending",
        args.waitTimeoutMs
      );
      return {
        job_id: jobId,
        event_seq: progress.seq || 0,
        status: progress.status || "",
      };
    });
    const firstJobId =
      submitFirst && submitFirst.status === "pass" && submitFirst.details
        ? submitFirst.details.job_id
        : "";

    const submitSecond = await runCase(report, "submit_second_emit_queued", async () => {
      const res = await postJson(args.baseUrl, "/mcp/submit_unity_task", {
        thread_id: threadId,
        idempotency_key: idemSecond,
        approval_mode: "require_user",
        user_intent: "stream queued job",
      });
      assertStatus(res, 202, "submit_second_emit_queued");
      if (!res.body || res.body.status !== "queued") {
        throw new Error(`expected queued, got ${safeJson(res.body)}`);
      }
      const jobId = res.body.job_id || "";
      if (!jobId) {
        throw new Error("submit_second_emit_queued expected non-empty job_id");
      }
      const queued = await stream.waitFor(
        (eventItem) =>
          eventItem.event === "job.progress" &&
          eventItem.thread_id === threadId &&
          eventItem.job_id === jobId &&
          eventItem.status === "queued",
        args.waitTimeoutMs
      );
      return {
        job_id: jobId,
        event_seq: queued.seq || 0,
        status: queued.status || "",
      };
    });
    const secondJobId =
      submitSecond && submitSecond.status === "pass" && submitSecond.details
        ? submitSecond.details.job_id
        : "";

    await runCase(
      report,
      "cancel_first_emit_completed_then_second_pending",
      async () => {
        const res = await postJson(args.baseUrl, "/mcp/cancel_unity_task", {
          job_id: firstJobId,
        });
        assertStatus(res, 200, "cancel_first_emit_completed_then_second_pending");
        const completed = await stream.waitFor(
          (eventItem) =>
            eventItem.event === "job.completed" &&
            eventItem.thread_id === threadId &&
            eventItem.job_id === firstJobId &&
            eventItem.status === "cancelled",
          args.waitTimeoutMs
        );
        const secondPending = await stream.waitFor(
          (eventItem) =>
            eventItem.event === "job.progress" &&
            eventItem.thread_id === threadId &&
            eventItem.job_id === secondJobId &&
            eventItem.status === "pending",
          args.waitTimeoutMs
        );
        return {
          first_completed_seq: completed.seq || 0,
          second_pending_seq: secondPending.seq || 0,
        };
      }
    );

    await runCase(report, "reconnect_cursor_receives_new_events", async () => {
      const lastSeq = stream.getLastSeq();
      stream.close();
      stream = null;

      streamReconnected = await openSseClient({
        baseUrl: args.baseUrl,
        cursor: lastSeq,
        threadId,
      });
      const ready = await streamReconnected.waitFor(
        (eventItem) => eventItem.event === "stream.ready",
        args.waitTimeoutMs
      );
      const replayCount =
        Number.isFinite(Number(ready.replay_count)) &&
        Number(ready.replay_count) >= 0
          ? Math.floor(Number(ready.replay_count))
          : 0;
      if (replayCount !== 0) {
        throw new Error(
          `expected reconnect replay_count=0 when cursor=${lastSeq}, got ${replayCount}`
        );
      }

      const submitThirdRes = await postJson(args.baseUrl, "/mcp/submit_unity_task", {
        thread_id: threadId,
        idempotency_key: idemThird,
        approval_mode: "auto",
        user_intent: "stream third queued job",
      });
      assertStatus(submitThirdRes, 202, "submit_third_after_reconnect");
      if (!submitThirdRes.body || submitThirdRes.body.status !== "queued") {
        throw new Error(`expected queued after reconnect, got ${safeJson(submitThirdRes.body)}`);
      }
      const thirdJobId = submitThirdRes.body.job_id || "";
      if (!thirdJobId) {
        throw new Error("submit_third_after_reconnect expected non-empty job_id");
      }

      const thirdQueued = await streamReconnected.waitFor(
        (eventItem) =>
          eventItem.event === "job.progress" &&
          eventItem.thread_id === threadId &&
          eventItem.job_id === thirdJobId &&
          eventItem.status === "queued" &&
          Number.isFinite(eventItem.seq) &&
          eventItem.seq > lastSeq,
        args.waitTimeoutMs
      );

      const cancelSecondRes = await postJson(args.baseUrl, "/mcp/cancel_unity_task", {
        job_id: secondJobId,
      });
      assertStatus(cancelSecondRes, 200, "cancel_second_after_reconnect");
      const secondCompleted = await streamReconnected.waitFor(
        (eventItem) =>
          eventItem.event === "job.completed" &&
          eventItem.thread_id === threadId &&
          eventItem.job_id === secondJobId &&
          eventItem.status === "cancelled",
        args.waitTimeoutMs
      );
      const thirdPending = await streamReconnected.waitFor(
        (eventItem) =>
          eventItem.event === "job.progress" &&
          eventItem.thread_id === threadId &&
          eventItem.job_id === thirdJobId &&
          eventItem.status === "pending",
        args.waitTimeoutMs
      );

      const cancelThirdRes = await postJson(args.baseUrl, "/mcp/cancel_unity_task", {
        job_id: thirdJobId,
      });
      assertStatus(cancelThirdRes, 200, "cancel_third_after_reconnect");
      const thirdCompleted = await streamReconnected.waitFor(
        (eventItem) =>
          eventItem.event === "job.completed" &&
          eventItem.thread_id === threadId &&
          eventItem.job_id === thirdJobId &&
          eventItem.status === "cancelled",
        args.waitTimeoutMs
      );

      return {
        reconnect_cursor: lastSeq,
        third_queued_seq: thirdQueued.seq || 0,
        second_completed_seq: secondCompleted.seq || 0,
        third_pending_seq: thirdPending.seq || 0,
        third_completed_seq: thirdCompleted.seq || 0,
      };
    });

    await runCase(report, "reconnect_last_event_id_header_with_window_meta", async () => {
      if (streamReconnected) {
        streamReconnected.close();
        streamReconnected = null;
      }
      const cursorFromHeader = 0;
      let streamByHeader = null;
      try {
        streamByHeader = await openSseClient({
          baseUrl: args.baseUrl,
          cursor: 0,
          threadId,
          lastEventId: cursorFromHeader,
        });
        const ready = await streamByHeader.waitFor(
          (eventItem) => eventItem.event === "stream.ready",
          args.waitTimeoutMs
        );
        if (ready.cursor_source !== "last_event_id") {
          throw new Error(
            `expected cursor_source=last_event_id, got ${String(ready.cursor_source || "")}`
          );
        }
        const requestedCursor =
          Number.isFinite(Number(ready.requested_cursor)) &&
          Number(ready.requested_cursor) >= 0
            ? Math.floor(Number(ready.requested_cursor))
            : 0;
        if (requestedCursor !== cursorFromHeader) {
          throw new Error(
            `expected requested_cursor=${cursorFromHeader}, got ${requestedCursor}`
          );
        }
        const replayCount =
          Number.isFinite(Number(ready.replay_count)) && Number(ready.replay_count) >= 0
            ? Math.floor(Number(ready.replay_count))
            : 0;
        const oldestSeq =
          Number.isFinite(Number(ready.oldest_event_seq)) && Number(ready.oldest_event_seq) > 0
            ? Math.floor(Number(ready.oldest_event_seq))
            : 0;
        const latestSeq =
          Number.isFinite(Number(ready.latest_event_seq)) && Number(ready.latest_event_seq) > 0
            ? Math.floor(Number(ready.latest_event_seq))
            : 0;
        const replayFromSeq =
          Number.isFinite(Number(ready.replay_from_seq)) && Number(ready.replay_from_seq) > 0
            ? Math.floor(Number(ready.replay_from_seq))
            : 0;
        const replayTruncated = ready.replay_truncated === true;
        const recoveryJobs = Array.isArray(ready.recovery_jobs) ? ready.recovery_jobs : [];
        const recoveryJobsCount =
          Number.isFinite(Number(ready.recovery_jobs_count)) &&
          Number(ready.recovery_jobs_count) >= 0
            ? Math.floor(Number(ready.recovery_jobs_count))
            : 0;

        if (latestSeq < oldestSeq && oldestSeq > 0) {
          throw new Error(`invalid replay window oldest=${oldestSeq} latest=${latestSeq}`);
        }
        if (replayCount > 0 && replayFromSeq < oldestSeq && oldestSeq > 0) {
          throw new Error(
            `invalid replay_from_seq=${replayFromSeq} with oldest_event_seq=${oldestSeq}`
          );
        }
        if (recoveryJobsCount !== recoveryJobs.length) {
          throw new Error(
            `expected recovery_jobs_count=${recoveryJobs.length}, got ${recoveryJobsCount}`
          );
        }
        if (recoveryJobsCount > args.mcpStreamRecoveryJobsMax) {
          throw new Error(
            `recovery_jobs_count=${recoveryJobsCount} exceeds max=${args.mcpStreamRecoveryJobsMax}`
          );
        }
        if (replayTruncated && recoveryJobsCount <= 0) {
          throw new Error("expected recovery_jobs_count>0 when replay_truncated=true");
        }
        if (replayTruncated) {
          for (const recoveryJob of recoveryJobs) {
            const jobId =
              recoveryJob && typeof recoveryJob.job_id === "string"
                ? recoveryJob.job_id
                : "";
            const jobStatus =
              recoveryJob && typeof recoveryJob.status === "string"
                ? recoveryJob.status
                : "";
            if (!jobId || !jobStatus) {
              throw new Error(
                `invalid recovery job payload: ${safeJson(recoveryJob)}`
              );
            }
          }
        }

        const submitFourthRes = await postJson(args.baseUrl, "/mcp/submit_unity_task", {
          thread_id: threadId,
          idempotency_key: idemFourth,
          approval_mode: "auto",
          user_intent: "stream fourth running job",
        });
        assertStatus(submitFourthRes, 202, "submit_fourth_after_last_event_id_reconnect");
        if (!submitFourthRes.body || submitFourthRes.body.status !== "accepted") {
          throw new Error(
            `expected accepted after header reconnect, got ${safeJson(submitFourthRes.body)}`
          );
        }
        const fourthJobId = submitFourthRes.body.job_id || "";
        if (!fourthJobId) {
          throw new Error(
            "submit_fourth_after_last_event_id_reconnect expected non-empty job_id"
          );
        }
        const fourthPending = await streamByHeader.waitFor(
          (eventItem) =>
            eventItem.event === "job.progress" &&
            eventItem.thread_id === threadId &&
            eventItem.job_id === fourthJobId &&
            eventItem.status === "pending",
          args.waitTimeoutMs
        );

        const cancelFourthRes = await postJson(args.baseUrl, "/mcp/cancel_unity_task", {
          job_id: fourthJobId,
        });
        assertStatus(cancelFourthRes, 200, "cancel_fourth_after_last_event_id_reconnect");
        const fourthCompleted = await streamByHeader.waitFor(
          (eventItem) =>
            eventItem.event === "job.completed" &&
            eventItem.thread_id === threadId &&
            eventItem.job_id === fourthJobId &&
            eventItem.status === "cancelled",
          args.waitTimeoutMs
        );

        const details = {
          cursor_source: ready.cursor_source || "",
          requested_cursor: requestedCursor,
          replay_count: replayCount,
          replay_truncated: replayTruncated,
          oldest_event_seq: oldestSeq,
          latest_event_seq: latestSeq,
          replay_from_seq: replayFromSeq,
          recovery_jobs_count: recoveryJobsCount,
          fourth_pending_seq: fourthPending.seq || 0,
          fourth_completed_seq: fourthCompleted.seq || 0,
        };

        if (!replayTruncated && args.spawnSidecar) {
          return {
            ...details,
            warnings: [
              "replay_truncated not observed; verify MCP_STREAM_MAX_EVENTS window is small enough for truncation scenario",
            ],
          };
        }
        return details;
      } finally {
        if (streamByHeader) {
          streamByHeader.close();
        }
      }
    });

    await runCase(report, "push_first_query_ratio_metrics", async () => {
      if (!firstJobId) {
        throw new Error("push_first_query_ratio_metrics requires first job id");
      }
      const statusRes = await requestJson({
        method: "GET",
        url: `${args.baseUrl}/mcp/get_unity_task_status?job_id=${encodeURIComponent(firstJobId)}`,
        timeoutMs: 5000,
      });
      assertStatus(statusRes, 200, "push_first_query_ratio_metrics_status");

      const metricsAfter = await getMcpMetrics(args.baseUrl);
      const before = metricsBefore || {};
      const deltaStatusQueries = Math.max(
        0,
        toNonNegativeInt(metricsAfter.status_query_calls) -
          toNonNegativeInt(before.status_query_calls)
      );
      const deltaPushEvents = Math.max(
        0,
        toNonNegativeInt(metricsAfter.push_events_total) -
          toNonNegativeInt(before.push_events_total)
      );
      const deltaPublishedEvents = Math.max(
        0,
        toNonNegativeInt(metricsAfter.stream_events_published) -
          toNonNegativeInt(before.stream_events_published)
      );
      if (deltaStatusQueries < 1) {
        throw new Error("expected at least one fallback status query in metrics delta");
      }
      if (deltaPushEvents < 1 || deltaPublishedEvents < 1) {
        throw new Error("expected push events to be emitted before evaluating query ratio");
      }
      const ratio = deltaStatusQueries / deltaPushEvents;
      if (ratio >= 0.35) {
        throw new Error(
          `expected query_to_push_ratio<0.35, got ${ratio.toFixed(4)} (status=${deltaStatusQueries}, push=${deltaPushEvents})`
        );
      }
      return {
        status_query_calls_delta: deltaStatusQueries,
        push_events_total_delta: deltaPushEvents,
        stream_events_published_delta: deltaPublishedEvents,
        query_to_push_ratio_delta: Number(ratio.toFixed(4)),
      };
    });

    await runCase(report, "stream_subscriber_limit_guard", async () => {
      const subA = await openSseClient({
        baseUrl: args.baseUrl,
        cursor: 0,
        threadId,
      });
      const subB = await openSseClient({
        baseUrl: args.baseUrl,
        cursor: 0,
        threadId,
      });
      try {
        await subA.waitFor((eventItem) => eventItem.event === "stream.ready", args.waitTimeoutMs);
        await subB.waitFor((eventItem) => eventItem.event === "stream.ready", args.waitTimeoutMs);

        const overLimitRes = await requestJson({
          method: "GET",
          url: `${args.baseUrl}/mcp/stream?thread_id=${encodeURIComponent(threadId)}`,
          timeoutMs: 4000,
        });
        assertStatus(overLimitRes, 429, "stream_subscriber_limit_guard_over_limit");
        const errorCode =
          overLimitRes && overLimitRes.body && typeof overLimitRes.body.error_code === "string"
            ? overLimitRes.body.error_code
            : "";
        if (errorCode !== "E_STREAM_SUBSCRIBERS_EXCEEDED") {
          throw new Error(
            `expected E_STREAM_SUBSCRIBERS_EXCEEDED, got ${String(errorCode || "(empty)")}`
          );
        }
      } finally {
        subA.close();
        subB.close();
      }
      await sleep(50);

      const recoveryClient = await openSseClient({
        baseUrl: args.baseUrl,
        cursor: 0,
        threadId,
      });
      try {
        const ready = await recoveryClient.waitFor(
          (eventItem) => eventItem.event === "stream.ready",
          args.waitTimeoutMs
        );
        const metricsAfter = await getMcpMetrics(args.baseUrl);
        return {
          recovery_ready_seq: ready.seq || 0,
          stream_subscriber_rejects: toNonNegativeInt(metricsAfter.stream_subscriber_rejects),
          stream_subscriber_drops: toNonNegativeInt(metricsAfter.stream_subscriber_drops),
          stream_max_subscribers: toNonNegativeInt(metricsAfter.stream_max_subscribers),
        };
      } finally {
        recoveryClient.close();
      }
    });
  } finally {
    if (stream) {
      stream.close();
    }
    if (streamReconnected) {
      streamReconnected.close();
    }
    if (spawned && spawned.startedByRunner) {
      await shutdownSpawnedSidecar(args.baseUrl, spawned.child);
    }
    report.finished_at = new Date().toISOString();
    report.summary.total = report.cases.length;
    const reportPath = writeReport(report);
    printSummary(report, reportPath);
    process.exitCode = report.summary.failed > 0 ? 1 : 0;
  }
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    spawnSidecar: true,
    mcpMaxQueue: 1,
    mcpStreamMaxEvents: 6,
    mcpStreamMaxSubscribers: 2,
    mcpStreamRecoveryJobsMax: 2,
    waitTimeoutMs: DEFAULT_WAIT_TIMEOUT_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--base-url" && i + 1 < argv.length) {
      args.baseUrl = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--spawn-sidecar") {
      args.spawnSidecar = true;
      continue;
    }
    if (token === "--no-spawn-sidecar") {
      args.spawnSidecar = false;
      continue;
    }
    if (token === "--mcp-max-queue" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) {
        args.mcpMaxQueue = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--wait-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.waitTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--mcp-stream-max-events" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.mcpStreamMaxEvents = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--mcp-stream-max-subscribers" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.mcpStreamMaxSubscribers = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--mcp-stream-recovery-jobs-max" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.mcpStreamRecoveryJobsMax = Math.floor(value);
      }
      i += 1;
      continue;
    }
  }
  return args;
}

async function runCase(report, name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    const warnings = Array.isArray(details && details.warnings)
      ? details.warnings
      : [];
    report.cases.push({
      name,
      status: warnings.length > 0 ? "warn" : "pass",
      duration_ms: Date.now() - started,
      details,
    });
    if (warnings.length > 0) {
      report.summary.warned += 1;
    } else {
      report.summary.passed += 1;
    }
    return report.cases[report.cases.length - 1];
  } catch (error) {
    report.cases.push({
      name,
      status: "fail",
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    report.summary.failed += 1;
    return report.cases[report.cases.length - 1];
  }
}

function openSseClient(options) {
  const baseUrl = options.baseUrl;
  const cursor =
    Number.isFinite(Number(options.cursor)) && Number(options.cursor) >= 0
      ? Math.floor(Number(options.cursor))
      : 0;
  const threadId =
    typeof options.threadId === "string" ? options.threadId.trim() : "";
  const lastEventId =
    options && options.lastEventId !== undefined && options.lastEventId !== null
      ? String(options.lastEventId).trim()
      : "";
  const url = new URL(`${baseUrl}/mcp/stream`);
  if (cursor > 0) {
    url.searchParams.set("cursor", String(cursor));
  }
  if (threadId) {
    url.searchParams.set("thread_id", threadId);
  }
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const state = {
      buffer: "",
      events: [],
      waiters: [],
      closed: false,
      lastSeq: 0,
    };

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        headers: {
          Accept: "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          ...(lastEventId ? { "Last-Event-ID": lastEventId } : {}),
        },
      },
      (res) => {
        if ((res.statusCode || 0) !== 200) {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          res.on("end", () => {
            reject(
              new Error(
                `stream http ${res.statusCode || 0}: ${Buffer.concat(chunks).toString("utf8")}`
              )
            );
          });
          return;
        }

        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (state.closed) {
            return;
          }
          state.buffer += String(chunk || "").replace(/\r/g, "");
          flushSseBuffer(state);
        });
        res.on("error", (error) => {
          if (state.closed) {
            return;
          }
          closeWithError(state, error);
        });
        res.on("close", () => {
          if (state.closed) {
            return;
          }
          closeWithError(state, new Error("sse stream closed"));
        });

        resolve({
          waitFor: (predicate, timeoutMs) =>
            waitForSseEvent(state, predicate, timeoutMs),
          getLastSeq: () => state.lastSeq,
          close: () => {
            if (state.closed) {
              return;
            }
            state.closed = true;
            closeAllWaiters(state.waiters, new Error("sse client closed"));
            try {
              req.destroy();
            } catch {
              // ignore destroy errors
            }
          },
        });
      }
    );

    req.on("error", (error) => {
      if (state.closed) {
        return;
      }
      reject(error);
    });
    req.end();
  });
}

function flushSseBuffer(state) {
  if (!state || typeof state !== "object") {
    return;
  }
  while (true) {
    const marker = state.buffer.indexOf("\n\n");
    if (marker < 0) {
      break;
    }
    const block = state.buffer.slice(0, marker);
    state.buffer = state.buffer.slice(marker + 2);
    const parsed = parseSseBlock(block);
    if (!parsed) {
      continue;
    }
    const payload =
      parsed.payload && typeof parsed.payload === "object"
        ? parsed.payload
        : {};
    if (!payload.event && parsed.event) {
      payload.event = parsed.event;
    }
    const seq =
      Number.isFinite(Number(payload.seq)) && Number(payload.seq) > 0
        ? Math.floor(Number(payload.seq))
        : Number.isFinite(Number(parsed.id)) && Number(parsed.id) > 0
          ? Math.floor(Number(parsed.id))
          : 0;
    if (seq > 0) {
      payload.seq = seq;
      state.lastSeq = seq;
    }
    state.events.push(payload);
    triggerSseWaiters(state.waiters, payload);
  }
}

function parseSseBlock(block) {
  if (typeof block !== "string") {
    return null;
  }
  const lines = block.split("\n");
  let id = "";
  let event = "";
  const dataLines = [];
  for (const line of lines) {
    if (!line) {
      continue;
    }
    if (line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("id:")) {
      id = line.slice(3).trim();
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
      continue;
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const dataText = dataLines.join("\n");
  let payload = null;
  try {
    payload = JSON.parse(dataText);
  } catch {
    payload = {
      event: event || "message",
      text: dataText,
    };
  }
  return {
    id,
    event,
    payload,
  };
}

function waitForSseEvent(state, predicate, timeoutMs) {
  const fn = typeof predicate === "function" ? predicate : () => false;
  for (const eventItem of state.events) {
    if (fn(eventItem)) {
      return Promise.resolve(eventItem);
    }
  }
  const waitMs =
    Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
      ? Math.floor(Number(timeoutMs))
      : DEFAULT_WAIT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const waiter = {
      predicate: fn,
      resolve,
      reject,
      timer: setTimeout(() => {
        removeWaiter(state.waiters, waiter);
        reject(new Error(`stream event wait timeout after ${waitMs}ms`));
      }, waitMs),
    };
    state.waiters.push(waiter);
  });
}

function triggerSseWaiters(waiters, eventItem) {
  if (!Array.isArray(waiters) || waiters.length === 0) {
    return;
  }
  const pending = waiters.slice();
  for (const waiter of pending) {
    try {
      if (!waiter.predicate(eventItem)) {
        continue;
      }
      clearTimeout(waiter.timer);
      removeWaiter(waiters, waiter);
      waiter.resolve(eventItem);
    } catch (error) {
      clearTimeout(waiter.timer);
      removeWaiter(waiters, waiter);
      waiter.reject(error);
    }
  }
}

function removeWaiter(waiters, target) {
  const idx = waiters.indexOf(target);
  if (idx >= 0) {
    waiters.splice(idx, 1);
  }
}

function closeAllWaiters(waiters, reason) {
  const pending = Array.isArray(waiters) ? waiters.splice(0, waiters.length) : [];
  for (const waiter of pending) {
    clearTimeout(waiter.timer);
    waiter.reject(reason);
  }
}

function closeWithError(state, error) {
  state.closed = true;
  closeAllWaiters(state.waiters, error);
}

async function ensureSidecarAvailability(baseUrl) {
  const res = await requestJson({
    method: "GET",
    url: `${baseUrl}/health`,
    timeoutMs: 3000,
  });
  if (res.statusCode !== 200 || !res.body || res.body.ok !== true) {
    throw new Error("health check failed");
  }
}

async function startSidecarIfNeeded(baseUrl, runId, options) {
  const url = new URL(baseUrl);
  const port = Number(url.port || 46326);
  const opts = options && typeof options === "object" ? options : {};
  const mcpMaxQueue =
    Number.isFinite(opts.mcpMaxQueue) && opts.mcpMaxQueue >= 0
      ? String(Math.floor(opts.mcpMaxQueue))
      : "1";
  const mcpStreamMaxEvents =
    Number.isFinite(opts.mcpStreamMaxEvents) && opts.mcpStreamMaxEvents > 0
      ? String(Math.floor(opts.mcpStreamMaxEvents))
      : "6";
  const mcpStreamMaxSubscribers =
    Number.isFinite(opts.mcpStreamMaxSubscribers) && opts.mcpStreamMaxSubscribers > 0
      ? String(Math.floor(opts.mcpStreamMaxSubscribers))
      : "2";
  const mcpStreamRecoveryJobsMax =
    Number.isFinite(opts.mcpStreamRecoveryJobsMax) && opts.mcpStreamRecoveryJobsMax > 0
      ? String(Math.floor(opts.mcpStreamRecoveryJobsMax))
      : "2";
  const sidecarRoot = path.resolve(__dirname, "..");
  const child = spawn(process.execPath, ["index.js", "--port", String(port)], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      USE_CODEX_APP_SERVER: "false",
      USE_FAKE_CODEX_TIMEOUT_PLANNER: "true",
      ENABLE_MCP_ADAPTER: "true",
      MCP_MAX_QUEUE: mcpMaxQueue,
      MCP_STREAM_MAX_EVENTS: mcpStreamMaxEvents,
      MCP_STREAM_MAX_SUBSCRIBERS: mcpStreamMaxSubscribers,
      MCP_STREAM_RECOVERY_JOBS_MAX: mcpStreamRecoveryJobsMax,
      CODEX_SOFT_TIMEOUT_MS: "60000",
      CODEX_HARD_TIMEOUT_MS: "200000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const lines = [];
  const collect = (chunk) => {
    const text = String(chunk || "").trim();
    if (!text) {
      return;
    }
    lines.push(text);
    if (lines.length > 40) {
      lines.shift();
    }
  };
  if (child.stdout) {
    child.stdout.on("data", collect);
  }
  if (child.stderr) {
    child.stderr.on("data", collect);
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await sleep(250);
    try {
      await ensureSidecarAvailability(baseUrl);
      return { child, startedByRunner: true };
    } catch {
      // keep waiting
    }
    if (child.exitCode !== null) {
      break;
    }
  }

  try {
    child.kill("SIGTERM");
  } catch {
    // ignore
  }
  throw new Error(
    `failed to start sidecar (run=${runId}). logs=${lines.slice(-8).join(" | ")}`
  );
}

async function shutdownSpawnedSidecar(baseUrl, child) {
  try {
    await postJson(baseUrl, "/admin/shutdown", {});
  } catch {
    // ignore shutdown endpoint errors
  }
  await sleep(250);
  if (child && child.exitCode === null) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

async function postJson(baseUrl, pathname, body) {
  return requestJson({
    method: "POST",
    url: `${baseUrl}${pathname}`,
    body,
    timeoutMs: 10000,
  });
}

async function getMcpMetrics(baseUrl) {
  const res = await requestJson({
    method: "GET",
    url: `${baseUrl}/mcp/metrics`,
    timeoutMs: 5000,
  });
  assertStatus(res, 200, "get_mcp_metrics");
  if (!res.body || typeof res.body !== "object") {
    throw new Error("get_mcp_metrics expected JSON body");
  }
  return res.body;
}

function toNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function assertStatus(res, expectedStatusCode, label) {
  if (res.statusCode !== expectedStatusCode) {
    throw new Error(
      `${label} expected status=${expectedStatusCode}, got ${res.statusCode} body=${safeJson(
        res.body
      )}`
    );
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function requestJson(input) {
  const method = input.method || "GET";
  const timeoutMs =
    Number.isFinite(input.timeoutMs) && input.timeoutMs > 0
      ? Number(input.timeoutMs)
      : 10000;
  const url = new URL(input.url);
  const isHttps = url.protocol === "https:";
  const payload =
    input.body !== undefined ? Buffer.from(JSON.stringify(input.body), "utf8") : null;
  const transport = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: payload
          ? {
              "Content-Type": "application/json; charset=utf-8",
              "Content-Length": String(payload.length),
            }
          : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = null;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              body = { raw: text };
            }
          }
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body,
          });
        });
      }
    );

    const timer = setTimeout(() => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    if (timer && typeof timer.unref === "function") {
      timer.unref();
    }

    req.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    req.on("close", () => {
      clearTimeout(timer);
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function writeReport(report) {
  const stateDir = path.resolve(__dirname, "..", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, `mcp-stream-report-${report.run_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const elapsedMs =
    Date.parse(report.finished_at || new Date().toISOString()) -
    Date.parse(report.started_at);
  // eslint-disable-next-line no-console
  console.log(`[mcp-stream] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(`[mcp-stream] base_url=${report.base_url}`);
  // eslint-disable-next-line no-console
  console.log(
    `[mcp-stream] total=${report.summary.total} pass=${report.summary.passed} warn=${report.summary.warned} fail=${report.summary.failed}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[mcp-stream] elapsed_ms=${Number.isFinite(elapsedMs) ? elapsedMs : 0}`
  );
  // eslint-disable-next-line no-console
  console.log(`[mcp-stream] report=${reportPath}`);
  if (report.summary.failed > 0) {
    // eslint-disable-next-line no-console
    console.error("[mcp-stream] failing cases:");
    for (const item of report.cases) {
      if (item.status === "fail") {
        // eslint-disable-next-line no-console
        console.error(`  - ${item.name}: ${item.error}`);
      }
    }
  }
}

function buildRunId(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  const pid = String(process.pid || 0).padStart(5, "0");
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    "_",
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
    ms,
    "_",
    pid,
    "_",
    rand,
  ].join("");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    `[mcp-stream] fatal: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { spawn } = require("child_process");

const TERMINAL_STATES = new Set(["completed", "error", "cancelled"]);
const DEFAULT_BASE_URL = "http://127.0.0.1:46321";
const DEFAULT_POLL_INTERVAL_MS = 200;
const DEFAULT_POLL_TIMEOUT_MS = 12000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  let baseUrl = args.baseUrl;
  const iterations = args.iterations;
  const includeTurnSend = args.includeTurnSend;
  const includeTimeoutCase = args.includeTimeoutCase;
  const includeCodexTimeoutCase = args.includeCodexTimeoutCase;
  const spawnSidecar = args.spawnSidecar;
  const pollTimeoutMs = args.pollTimeoutMs;
  const pollIntervalMs = args.pollIntervalMs;

  const report = {
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: "",
    base_url: baseUrl,
    config: {
      iterations,
      include_turn_send: includeTurnSend,
      include_timeout_case: includeTimeoutCase,
      include_codex_timeout_case: includeCodexTimeoutCase,
      spawn_sidecar: spawnSidecar,
      poll_timeout_ms: pollTimeoutMs,
      poll_interval_ms: pollIntervalMs,
      compile_timeout_ms: args.compileTimeoutMs || null,
      codex_soft_timeout_ms: args.codexSoftTimeoutMs || null,
      codex_hard_timeout_ms: args.codexHardTimeoutMs || null,
    },
    cases: [],
    summary: {
      passed: 0,
      failed: 0,
      warned: 0,
      total: 0,
    },
    metrics: {},
  };

  /** @type {null | { child: import("child_process").ChildProcess, startedByRunner: boolean }} */
  let spawned = null;
  const requiresIsolatedSpawn =
    spawnSidecar &&
    (includeTimeoutCase ||
      includeCodexTimeoutCase ||
      args.useFakeCodexTimeoutPlanner ||
      (Number.isFinite(args.compileTimeoutMs) && args.compileTimeoutMs > 0) ||
      (Number.isFinite(args.codexSoftTimeoutMs) && args.codexSoftTimeoutMs > 0) ||
      (Number.isFinite(args.codexHardTimeoutMs) && args.codexHardTimeoutMs > 0));

  let baseReachable = false;
  try {
    await ensureSidecarAvailability(baseUrl);
    baseReachable = true;
  } catch (error) {
    if (!spawnSidecar) {
      throw new Error(
        `Sidecar is not reachable at ${baseUrl}. Start sidecar first or use --spawn-sidecar.`
      );
    }
    spawned = await startSidecarIfNeeded(baseUrl, runId, {
      compileTimeoutMs: args.compileTimeoutMs,
      codexSoftTimeoutMs: args.codexSoftTimeoutMs,
      codexHardTimeoutMs: args.codexHardTimeoutMs,
      useFakeCodexTimeoutPlanner:
        args.useFakeCodexTimeoutPlanner || includeCodexTimeoutCase,
    });
  }

  if (requiresIsolatedSpawn && baseReachable) {
    const isolated = await startIsolatedSidecar(baseUrl, runId, {
      compileTimeoutMs: args.compileTimeoutMs,
      codexSoftTimeoutMs: args.codexSoftTimeoutMs,
      codexHardTimeoutMs: args.codexHardTimeoutMs,
      useFakeCodexTimeoutPlanner:
        args.useFakeCodexTimeoutPlanner || includeCodexTimeoutCase,
    });
    baseUrl = isolated.baseUrl;
    report.base_url = baseUrl;
    spawned = isolated.spawned;
  }

  await ensureSidecarAvailability(baseUrl);

  await runCase(report, "health_check", async () => {
    const res = await requestJson({
      method: "GET",
      url: `${baseUrl}/health`,
      timeoutMs: 6000,
    });
    assertStatus(res, 200, "health_check");
    if (!res.body || res.body.ok !== true) {
      throw new Error("health response missing ok=true");
    }
    return { active_request_id: res.body.active_request_id || "" };
  });

  await runCase(report, "session_start_replay", async () => {
    const requestId = `sess_${runId}`;
    const envelope = buildEnvelope({
      event: "session.start",
      requestId,
      threadId: `t_${runId}`,
      turnId: "u_000",
      payload: {
        workspace_root: process.cwd(),
        model: "codex",
      },
    });
    const first = await postJson(baseUrl, "/session/start", envelope);
    assertStatus(first, 200, "session_start(first)");
    if (first.body && first.body.replay !== false) {
      throw new Error("session_start(first) expected replay=false");
    }
    const second = await postJson(baseUrl, "/session/start", envelope);
    assertStatus(second, 200, "session_start(second)");
    if (second.body && second.body.replay !== true) {
      throw new Error("session_start(second) expected replay=true");
    }
    return {
      request_id: requestId,
      first_replay: first.body ? first.body.replay : undefined,
      second_replay: second.body ? second.body.replay : undefined,
    };
  });

  if (includeTurnSend) {
    await runCase(report, "turn_send_cancel_smoke", async () => {
      const requestId = `turn_${runId}`;
      const threadId = `t_turn_${runId}`;
      const turnId = "u_turn_smoke";
      const sendEnvelope = buildEnvelope({
        event: "turn.send",
        requestId,
        threadId,
        turnId,
        payload: {
          user_message: "smoke check",
          context: buildMinimalContext(),
        },
      });
      const sendRes = await postJson(baseUrl, "/turn/send", sendEnvelope);
      if (sendRes.statusCode === 429) {
        return {
          warning: "turn.send throttled by active request",
          active_request_id:
            sendRes.body && sendRes.body.active_request_id
              ? sendRes.body.active_request_id
              : "",
        };
      }
      if (sendRes.statusCode !== 200 && sendRes.statusCode !== 202) {
        throw new Error(
          `turn.send unexpected status=${sendRes.statusCode} body=${safeJson(
            sendRes.body
          )}`
        );
      }

      const accepted =
        sendRes.body && typeof sendRes.body.accepted === "boolean"
          ? sendRes.body.accepted
          : false;
      const warnings = [];
      if (!accepted) {
        warnings.push("turn.send accepted=false (planner likely unavailable)");
      } else {
        const cancelEnvelope = buildEnvelope({
          event: "turn.cancel",
          requestId,
          threadId,
          turnId,
          payload: {
            reason: "smoke_runner_cancel",
          },
        });
        const cancelRes = await postJson(baseUrl, "/turn/cancel", cancelEnvelope);
        if (cancelRes.statusCode !== 200) {
          warnings.push(
            `turn.cancel non-200 (status=${cancelRes.statusCode}, likely already terminal)`
          );
        }
      }

      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: pollTimeoutMs,
        pollIntervalMs,
      });
      if (!TERMINAL_STATES.has(finalStatus.state || "")) {
        throw new Error(
          `turn_send_cancel_smoke did not reach terminal state: ${safeJson(
            finalStatus
          )}`
        );
      }
      return {
        request_id: requestId,
        final_state: finalStatus.state,
        error_code: finalStatus.error_code || "",
        warnings,
      };
    });
  }

  for (let i = 1; i <= iterations; i += 1) {
    const caseName = `file_compile_round_${String(i).padStart(2, "0")}`;
    await runCase(report, caseName, async () => {
      const requestId = `smoke_file_${runId}_${i}`;
      const threadId = `t_file_${runId}`;
      const turnId = `u_file_${i}`;
      const scriptPath =
        "Assets/Scripts/AIGenerated/SmokeRunner/SmokeRunnerTemp.cs";
      const content = buildSmokeScriptContent(i, "SmokeRunnerTemp");
      const applyEnvelope = buildEnvelope({
        event: "file_actions.apply",
        requestId,
        threadId,
        turnId,
        payload: {
          file_actions: [
            {
              type: "create_file",
              path: scriptPath,
              content,
              overwrite_if_exists: true,
            },
          ],
          visual_layer_actions: [],
        },
      });

      const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
      assertStatus(applyRes, 200, "file_actions.apply");
      if (!applyRes.body || applyRes.body.event !== "files.changed") {
        throw new Error("file_actions.apply expected event=files.changed");
      }

      const compileEnvelope = buildEnvelope({
        event: "unity.compile.result",
        requestId,
        threadId,
        turnId,
        payload: {
          success: true,
          duration_ms: 1,
          errors: [],
        },
      });
      const compileRes = await postJson(
        baseUrl,
        "/unity/compile/result",
        compileEnvelope
      );
      assertStatus(compileRes, 200, "unity.compile.result");

      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: pollTimeoutMs,
        pollIntervalMs,
      });
      if (finalStatus.state !== "completed") {
        throw new Error(
          `expected completed, got state=${finalStatus.state} error=${finalStatus.error_code || ""}`
        );
      }

      return {
        request_id: requestId,
        state: finalStatus.state,
        latest_event_seq: finalStatus.latest_event_seq || 0,
      };
    });
  }

  await runCase(report, "file_guard_forbidden_path", async () => {
    const requestId = `forbidden_${runId}`;
    const threadId = `t_forbidden_${runId}`;
    const turnId = "u_forbidden";
    const envelope = buildEnvelope({
      event: "file_actions.apply",
      requestId,
      threadId,
      turnId,
      payload: {
        file_actions: [
          {
            type: "create_file",
            path: "Assets/Scenes/NotAllowed.cs",
            content: "public class NotAllowed {}",
            overwrite_if_exists: true,
          },
        ],
      },
    });
    const res = await postJson(baseUrl, "/file-actions/apply", envelope);
    if (res.statusCode !== 403) {
      throw new Error(`expected 403, got ${res.statusCode}`);
    }
    const errorCode = res.body && res.body.error_code ? res.body.error_code : "";
    if (errorCode !== "E_FILE_PATH_FORBIDDEN") {
      throw new Error(
        `expected error_code=E_FILE_PATH_FORBIDDEN, got ${errorCode || "(empty)"}`
      );
    }
    return {
      status_code: res.statusCode,
      error_code: errorCode,
    };
  });

  await runCase(report, "cancel_flow_compile_pending", async () => {
    const requestId = `cancel_${runId}`;
    const threadId = `t_cancel_${runId}`;
    const turnId = "u_cancel";
    const applyEnvelope = buildEnvelope({
      event: "file_actions.apply",
      requestId,
      threadId,
      turnId,
      payload: {
        file_actions: [
          {
            type: "create_file",
            path: "Assets/Scripts/AIGenerated/SmokeRunner/CancelTemp.cs",
            content: buildSmokeScriptContent(0, "CancelTemp"),
            overwrite_if_exists: true,
          },
        ],
      },
    });
    const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
    assertStatus(applyRes, 200, "file_actions.apply(cancel_flow)");

    const cancelEnvelope = buildEnvelope({
      event: "turn.cancel",
      requestId,
      threadId,
      turnId,
      payload: {
        reason: "smoke_cancel_compile_pending",
      },
    });
    const cancelRes = await postJson(baseUrl, "/turn/cancel", cancelEnvelope);
    assertStatus(cancelRes, 200, "turn.cancel(cancel_flow)");

    const finalStatus = await waitForTurnTerminal({
      baseUrl,
      requestId,
      timeoutMs: pollTimeoutMs,
      pollIntervalMs,
    });
    if (finalStatus.state !== "cancelled") {
      throw new Error(`expected cancelled, got ${finalStatus.state}`);
    }
    return {
      request_id: requestId,
      state: finalStatus.state,
    };
  });

  if (includeTimeoutCase) {
    await runCase(report, "compile_timeout_sweep", async () => {
      const configuredCompileTimeoutMs =
        Number.isFinite(args.compileTimeoutMs) && args.compileTimeoutMs > 0
          ? Number(args.compileTimeoutMs)
          : 0;
      if (configuredCompileTimeoutMs <= 0) {
        return {
          warnings: [
            "compile_timeout_sweep skipped: compile timeout override is not configured",
          ],
        };
      }

      const requestId = `timeout_${runId}`;
      const threadId = `t_timeout_${runId}`;
      const turnId = "u_timeout";
      const applyEnvelope = buildEnvelope({
        event: "file_actions.apply",
        requestId,
        threadId,
        turnId,
        payload: {
          file_actions: [
            {
              type: "create_file",
              path: "Assets/Scripts/AIGenerated/SmokeRunner/TimeoutTemp.cs",
              content: buildSmokeScriptContent(999, "TimeoutTemp"),
              overwrite_if_exists: true,
            },
          ],
          visual_layer_actions: [],
        },
      });
      const applyRes = await postJson(baseUrl, "/file-actions/apply", applyEnvelope);
      assertStatus(applyRes, 200, "file_actions.apply(compile_timeout_sweep)");

      const waitTimeoutMs = Math.max(
        pollTimeoutMs,
        configuredCompileTimeoutMs + 3000
      );
      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: waitTimeoutMs,
        pollIntervalMs,
      });

      if (finalStatus.state !== "error") {
        throw new Error(
          `compile_timeout_sweep expected error state, got ${finalStatus.state}`
        );
      }
      if (finalStatus.error_code !== "E_COMPILE_TIMEOUT") {
        throw new Error(
          `compile_timeout_sweep expected E_COMPILE_TIMEOUT, got ${finalStatus.error_code || ""}`
        );
      }

      return {
        request_id: requestId,
        state: finalStatus.state,
        error_code: finalStatus.error_code,
        configured_compile_timeout_ms: configuredCompileTimeoutMs,
      };
    });
  }

  if (includeCodexTimeoutCase) {
    await runCase(report, "codex_timeout_sweep", async () => {
      const configuredSoftTimeoutMs =
        Number.isFinite(args.codexSoftTimeoutMs) && args.codexSoftTimeoutMs > 0
          ? Number(args.codexSoftTimeoutMs)
          : 0;
      const usingFakePlanner =
        args.useFakeCodexTimeoutPlanner || includeCodexTimeoutCase;
      if (configuredSoftTimeoutMs <= 0 || !usingFakePlanner) {
        return {
          warnings: [
            "codex_timeout_sweep skipped: requires fake timeout planner + codex soft timeout override",
          ],
        };
      }

      const requestId = `codex_timeout_${runId}`;
      const threadId = `t_codex_timeout_${runId}`;
      const turnId = "u_codex_timeout";
      const sendEnvelope = buildEnvelope({
        event: "turn.send",
        requestId,
        threadId,
        turnId,
        payload: {
          user_message: "timeout sweep request",
          context: buildMinimalContext(),
        },
      });
      const sendRes = await postJson(baseUrl, "/turn/send", sendEnvelope);
      if (sendRes.statusCode !== 200 && sendRes.statusCode !== 202) {
        throw new Error(
          `codex_timeout_sweep turn.send unexpected status=${sendRes.statusCode} body=${safeJson(
            sendRes.body
          )}`
        );
      }

      const waitTimeoutMs = Math.max(
        pollTimeoutMs,
        configuredSoftTimeoutMs + 5000
      );
      const finalStatus = await waitForTurnTerminal({
        baseUrl,
        requestId,
        timeoutMs: waitTimeoutMs,
        pollIntervalMs,
      });
      if (finalStatus.state !== "error") {
        throw new Error(
          `codex_timeout_sweep expected error state, got ${finalStatus.state}`
        );
      }
      if (finalStatus.error_code !== "E_CODEX_TIMEOUT") {
        throw new Error(
          `codex_timeout_sweep expected E_CODEX_TIMEOUT, got ${finalStatus.error_code || ""}`
        );
      }
      const events = Array.isArray(finalStatus.events) ? finalStatus.events : [];
      const hasAbortDiag = events.some(
        (item) => item && item.event === "diag.timeout.abort"
      );
      if (!hasAbortDiag) {
        throw new Error(
          "codex_timeout_sweep expected diag.timeout.abort event in terminal status events"
        );
      }

      return {
        request_id: requestId,
        state: finalStatus.state,
        error_code: finalStatus.error_code,
        has_abort_diagnostic: hasAbortDiag,
        configured_codex_soft_timeout_ms: configuredSoftTimeoutMs,
      };
    });
  }

  report.finished_at = new Date().toISOString();
  report.summary.total = report.cases.length;
  report.metrics = buildMetrics(report.cases);
  const reportPath = writeReport(report);
  printSummary(report, reportPath);
  process.exitCode = report.summary.failed > 0 ? 1 : 0;

  if (spawned && spawned.startedByRunner) {
    await shutdownSpawnedSidecar(baseUrl, spawned.child);
  }
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    iterations: 20,
    includeTurnSend: true,
    includeTimeoutCase: false,
    includeCodexTimeoutCase: false,
    spawnSidecar: false,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    compileTimeoutMs: 0,
    codexSoftTimeoutMs: 0,
    codexHardTimeoutMs: 0,
    useFakeCodexTimeoutPlanner: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--base-url" && i + 1 < argv.length) {
      args.baseUrl = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--iterations" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.iterations = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--poll-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.pollTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--poll-interval-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.pollIntervalMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--include-turn-send") {
      args.includeTurnSend = true;
      continue;
    }
    if (token === "--skip-turn-send") {
      args.includeTurnSend = false;
      continue;
    }
    if (token === "--include-timeout-case") {
      args.includeTimeoutCase = true;
      continue;
    }
    if (token === "--skip-timeout-case") {
      args.includeTimeoutCase = false;
      continue;
    }
    if (token === "--spawn-sidecar") {
      args.spawnSidecar = true;
      continue;
    }
    if (token === "--include-codex-timeout-case") {
      args.includeCodexTimeoutCase = true;
      continue;
    }
    if (token === "--skip-codex-timeout-case") {
      args.includeCodexTimeoutCase = false;
      continue;
    }
    if (token === "--fake-codex-timeout-planner") {
      args.useFakeCodexTimeoutPlanner = true;
      continue;
    }
    if (token === "--compile-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.compileTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--codex-soft-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.codexSoftTimeoutMs = Math.floor(value);
      }
      i += 1;
      continue;
    }
    if (token === "--codex-hard-timeout-ms" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        args.codexHardTimeoutMs = Math.floor(value);
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
  } catch (error) {
    report.cases.push({
      name,
      status: "fail",
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    report.summary.failed += 1;
  }
}

async function waitForTurnTerminal(options) {
  const baseUrl = options.baseUrl;
  const requestId = options.requestId;
  const timeoutMs = options.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const statusUrl = `${baseUrl}/turn/status?request_id=${encodeURIComponent(
      requestId
    )}`;
    const res = await requestJson({
      method: "GET",
      url: statusUrl,
      timeoutMs: Math.min(5000, pollIntervalMs + 2000),
    });
    if (res.statusCode === 200 && res.body && TERMINAL_STATES.has(res.body.state)) {
      return res.body;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `turn did not reach terminal state within ${timeoutMs}ms (request_id=${requestId})`
  );
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
  const port = Number(url.port || 46321);
  const opts = options && typeof options === "object" ? options : {};
  const compileTimeoutMs =
    Number.isFinite(opts.compileTimeoutMs) && opts.compileTimeoutMs > 0
      ? String(Math.floor(opts.compileTimeoutMs))
      : "120000";
  const codexSoftTimeoutMs =
    Number.isFinite(opts.codexSoftTimeoutMs) && opts.codexSoftTimeoutMs > 0
      ? String(Math.floor(opts.codexSoftTimeoutMs))
      : "60000";
  const codexHardTimeoutMs =
    Number.isFinite(opts.codexHardTimeoutMs) && opts.codexHardTimeoutMs > 0
      ? String(Math.floor(opts.codexHardTimeoutMs))
      : "200000";
  const useFakeCodexTimeoutPlanner = !!opts.useFakeCodexTimeoutPlanner;
  const sidecarRoot = path.resolve(__dirname, "..");
  const child = spawn(process.execPath, ["index.js", "--port", String(port)], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      USE_CODEX_APP_SERVER: "false",
      USE_FAKE_CODEX_TIMEOUT_PLANNER: useFakeCodexTimeoutPlanner
        ? "true"
        : "false",
      CODEX_SOFT_TIMEOUT_MS: codexSoftTimeoutMs,
      CODEX_HARD_TIMEOUT_MS: codexHardTimeoutMs,
      COMPILE_TIMEOUT_MS: compileTimeoutMs,
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

  const bootDeadline = Date.now() + 15000;
  while (Date.now() < bootDeadline) {
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

async function startIsolatedSidecar(baseUrl, runId, options) {
  const seed = new URL(baseUrl);
  const seedPort = Number(seed.port || (seed.protocol === "https:" ? 443 : 80));
  const maxAttempts = 20;
  let lastError = null;

  for (let offset = 1; offset <= maxAttempts; offset += 1) {
    const candidatePort = seedPort + offset;
    const candidateBaseUrl = buildUrlWithPort(seed, candidatePort);
    try {
      await ensureSidecarAvailability(candidateBaseUrl);
      continue;
    } catch {
      // candidate looks free for sidecar startup attempt
    }

    try {
      const spawned = await startSidecarIfNeeded(candidateBaseUrl, runId, options);
      return {
        baseUrl: candidateBaseUrl,
        spawned,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `failed to start isolated sidecar after ${maxAttempts} ports: ${
      lastError instanceof Error ? lastError.message : String(lastError || "unknown")
    }`
  );
}

function buildUrlWithPort(seedUrl, port) {
  const clone = new URL(seedUrl.toString());
  clone.port = String(port);
  return clone.toString().replace(/\/$/, "");
}

async function shutdownSpawnedSidecar(baseUrl, child) {
  try {
    await postJson(baseUrl, "/admin/shutdown", {});
  } catch {
    // ignore shutdown endpoint errors
  }
  await sleep(300);
  if (child && child.exitCode === null) {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

function buildMinimalContext() {
  return {
    selection: {
      mode: "selection",
      target_object_path: "Scene/Canvas/Image",
      prefab_path: "",
    },
    selection_tree: {
      max_depth: 2,
      root: {
        name: "Image",
        path: "Scene/Canvas/Image",
        depth: 0,
        components: ["Transform", "Image"],
        children: [],
      },
      truncated_node_count: 0,
      truncated_reason: "",
    },
  };
}

function buildEnvelope(input) {
  return {
    event: input.event,
    request_id: input.requestId,
    thread_id: input.threadId,
    turn_id: input.turnId,
    timestamp: new Date().toISOString(),
    payload: input.payload || {},
  };
}

function buildSmokeScriptContent(index, className) {
  const normalizedClassName =
    typeof className === "string" && className.trim()
      ? className.trim()
      : "SmokeRunnerTemp";
  return [
    "using UnityEngine;",
    "",
    `public class ${normalizedClassName} : MonoBehaviour`,
    "{",
    "    private void Start()",
    "    {",
    `        Debug.Log(\"[SmokeRunner] round ${index}\");`,
    "    }",
    "}",
    "",
  ].join("\n");
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

function writeReport(report) {
  const stateDir = path.resolve(__dirname, "..", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, `smoke-turn-report-${report.run_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const elapsedMs =
    Date.parse(report.finished_at || new Date().toISOString()) -
    Date.parse(report.started_at);
  const lines = [
    `[smoke] run_id=${report.run_id}`,
    `[smoke] base_url=${report.base_url}`,
    `[smoke] total=${report.summary.total} pass=${report.summary.passed} warn=${report.summary.warned} fail=${report.summary.failed}`,
    `[smoke] elapsed_ms=${Number.isFinite(elapsedMs) ? elapsedMs : 0}`,
    `[smoke] report=${reportPath}`,
  ];
  for (const line of lines) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
  if (report.summary.failed > 0) {
    // eslint-disable-next-line no-console
    console.error("[smoke] failing cases:");
    for (const item of report.cases) {
      if (item.status === "fail") {
        // eslint-disable-next-line no-console
        console.error(`  - ${item.name}: ${item.error}`);
      }
    }
  }
}

function buildMetrics(cases) {
  const items = Array.isArray(cases) ? cases : [];
  const allDurations = items
    .map((item) => Number(item && item.duration_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const compileRoundDurations = items
    .filter(
      (item) =>
        item &&
        typeof item.name === "string" &&
        item.name.startsWith("file_compile_round_")
    )
    .map((item) => Number(item.duration_ms))
    .filter((value) => Number.isFinite(value) && value >= 0);

  return {
    case_duration_ms: quantiles(allDurations),
    file_compile_round_duration_ms: quantiles(compileRoundDurations),
  };
}

function quantiles(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      p50: 0,
      p95: 0,
      avg: 0,
    };
  }
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    avg: Math.round((sum / sorted.length) * 100) / 100,
  };
}

function percentile(sortedValues, p) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) {
    return 0;
  }
  const ratio = Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
  const rank = Math.ceil(ratio * sortedValues.length) - 1;
  const index = rank < 0 ? 0 : rank;
  return sortedValues[index];
}

async function postJson(baseUrl, pathname, body) {
  return requestJson({
    method: "POST",
    url: `${baseUrl}${pathname}`,
    body,
    timeoutMs: 10000,
  });
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

async function requestJson(input) {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    `[smoke] fatal: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});

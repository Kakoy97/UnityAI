#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { spawn } = require("child_process");
const { TurnService } = require("../src/application/turnService");

const DEFAULT_BASE_URL = "http://127.0.0.1:46327";
const DEFAULT_POLL_INTERVAL_MS = 200;
const DEFAULT_POLL_TIMEOUT_MS = 12000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  let baseUrl = args.baseUrl;

  const report = {
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: "",
    base_url: baseUrl,
    config: {
      spawn_sidecar: args.spawnSidecar,
      poll_timeout_ms: args.pollTimeoutMs,
      poll_interval_ms: args.pollIntervalMs,
      mcp_max_queue: args.mcpMaxQueue,
      include_restart_recovery_case: true,
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
  try {
    await ensureSidecarAvailability(baseUrl);
  } catch {
    if (!args.spawnSidecar) {
      throw new Error(
        `Sidecar is not reachable at ${baseUrl}. Start sidecar first or use --spawn-sidecar.`
      );
    }
    spawned = await startSidecarIfNeeded(baseUrl, runId, {
      mcpMaxQueue: args.mcpMaxQueue,
    });
  }

  await ensureSidecarAvailability(baseUrl);

  await runCase(report, "health_check", async () => {
    const res = await requestJson({
      method: "GET",
      url: `${baseUrl}/health`,
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

  await runCase(report, "get_status_not_found_structured_error", async () => {
    const res = await requestJson({
      method: "GET",
      url: `${baseUrl}/mcp/get_unity_task_status?job_id=${encodeURIComponent(
        `job_missing_${runId}`
      )}`,
      timeoutMs: 5000,
    });
    assertStatus(res, 404, "get_status_not_found_structured_error");
    assertMcpErrorFeedback(
      res.body,
      "E_JOB_NOT_FOUND",
      "get_status_not_found_structured_error",
      {
        recoverable: false,
      }
    );
    return {
      error_code: res.body.error_code,
      recoverable: !!res.body.recoverable,
    };
  });

  const threadId = `t_mcp_${runId}`;
  const retryIdempotencyKey = `idem_retry_${runId}`;
  await runCase(report, "submit_schema_invalid_then_retryable", async () => {
    const res = await postJson(baseUrl, "/mcp/submit_unity_task", {
      thread_id: threadId,
      idempotency_key: retryIdempotencyKey,
      approval_mode: "auto",
      user_intent: "Schema invalid then fixed",
      context: buildTestContext(3),
    });
    assertStatus(res, 400, "submit_schema_invalid_then_retryable");
    assertMcpErrorFeedback(
      res.body,
      "E_CONTEXT_DEPTH_VIOLATION",
      "submit_schema_invalid_then_retryable",
      {
        recoverable: true,
        suggestionIncludes: "max_depth",
      }
    );
    return {
      error_code: res.body.error_code,
      recoverable: !!res.body.recoverable,
      suggestion: res.body.suggestion || "",
    };
  });

  const submitFirst = await runCase(report, "submit_job_pending", async () => {
    const res = await postJson(baseUrl, "/mcp/submit_unity_task", {
      thread_id: threadId,
      idempotency_key: retryIdempotencyKey,
      approval_mode: "auto",
      user_intent: "MCP first running job",
    });
    assertStatus(res, 202, "submit_job_pending");
    if (!res.body || res.body.status !== "accepted") {
      throw new Error(
        `submit_job_pending expected status=accepted, got ${safeJson(
          res.body
        )}`
      );
    }
    const jobId = res.body.job_id || "";
    if (!jobId) {
      throw new Error("submit_job_pending expected non-empty job_id");
    }
    return {
      job_id: jobId,
      status: res.body.status,
      approval_mode: res.body.approval_mode || "",
    };
  });
  const firstJobId =
    submitFirst && submitFirst.status === "pass" && submitFirst.details
      ? submitFirst.details.job_id
      : "";

  await runCase(report, "submit_job_idempotent_replay", async () => {
    const res = await postJson(baseUrl, "/mcp/submit_unity_task", {
      thread_id: threadId,
      idempotency_key: retryIdempotencyKey,
      approval_mode: "auto",
      user_intent: "MCP first running job",
    });
    assertStatus(res, 200, "submit_job_idempotent_replay");
    if (!res.body || res.body.idempotent_replay !== true) {
      throw new Error(
        `submit_job_idempotent_replay expected idempotent_replay=true, got ${safeJson(
          res.body
        )}`
      );
    }
    if (res.body.job_id !== firstJobId) {
      throw new Error(
        `submit_job_idempotent_replay expected job_id=${firstJobId}, got ${res.body.job_id || ""}`
      );
    }
    return {
      job_id: res.body.job_id,
      idempotent_replay: true,
    };
  });

  await runCase(report, "get_status_pending_auto_approval_mode", async () => {
    const status = await getJobStatus(baseUrl, firstJobId);
    if (status.status !== "pending") {
      throw new Error(
        `get_status_pending_auto_approval_mode expected pending, got ${status.status || ""}`
      );
    }
    if (status.approval_mode !== "auto") {
      throw new Error(
        `get_status_pending_auto_approval_mode expected approval_mode=auto, got ${
          status.approval_mode || ""
        }`
      );
    }
    return {
      job_id: firstJobId,
      status: status.status,
      approval_mode: status.approval_mode,
    };
  });

  const submitSecond = await runCase(report, "submit_job_queued", async () => {
    const res = await postJson(baseUrl, "/mcp/submit_unity_task", {
      thread_id: threadId,
      idempotency_key: `idem_b_${runId}`,
      approval_mode: "require_user",
      user_intent: "MCP queued job",
    });
    assertStatus(res, 202, "submit_job_queued");
    if (!res.body || res.body.status !== "queued") {
      throw new Error(
        `submit_job_queued expected status=queued, got ${safeJson(res.body)}`
      );
    }
    const jobId = res.body.job_id || "";
    if (!jobId) {
      throw new Error("submit_job_queued expected non-empty job_id");
    }
    return {
      job_id: jobId,
      status: res.body.status,
      approval_mode: res.body.approval_mode || "",
      running_job_id: res.body.running_job_id || "",
    };
  });
  const secondJobId =
    submitSecond && submitSecond.status === "pass" && submitSecond.details
      ? submitSecond.details.job_id
      : "";

  await runCase(report, "submit_job_rejected_conflict", async () => {
    const res = await postJson(baseUrl, "/mcp/submit_unity_task", {
      thread_id: threadId,
      idempotency_key: `idem_c_${runId}`,
      approval_mode: "auto",
      user_intent: "MCP conflict job",
    });
    if (res.statusCode !== 409) {
      throw new Error(
        `submit_job_rejected_conflict expected 409, got ${res.statusCode}`
      );
    }
    if (!res.body || res.body.status !== "rejected") {
      throw new Error(
        `submit_job_rejected_conflict expected status=rejected, got ${safeJson(
          res.body
        )}`
      );
    }
    if ((res.body.reason_code || "") !== "E_JOB_CONFLICT") {
      throw new Error(
        `submit_job_rejected_conflict expected reason_code=E_JOB_CONFLICT, got ${
          res.body.reason_code || ""
        }`
      );
    }
    assertMcpErrorFeedback(
      res.body,
      "E_JOB_CONFLICT",
      "submit_job_rejected_conflict",
      {
        recoverable: true,
        suggestionIncludes: "running_job_id",
      }
    );
    return {
      status: res.body.status,
      reason_code: res.body.reason_code,
      recoverable: !!res.body.recoverable,
      running_job_id: res.body.running_job_id || "",
    };
  });

  await runCase(report, "get_status_queued", async () => {
    const status = await getJobStatus(baseUrl, secondJobId);
    if (status.status !== "queued") {
      throw new Error(
        `get_status_queued expected queued, got ${status.status || ""}`
      );
    }
    if (status.approval_mode !== "require_user") {
      throw new Error(
        `get_status_queued expected approval_mode=require_user, got ${
          status.approval_mode || ""
        }`
      );
    }
    return {
      job_id: secondJobId,
      status: status.status,
      approval_mode: status.approval_mode,
      running_job_id: status.running_job_id || "",
    };
  });

  await runCase(
    report,
    "approval_mode_requires_confirmation_mapping",
    async () => {
      const service = createApprovalMappingHarness();
      service.mcpJobsById.set("job_auto", {
        request_id: "req_auto",
        approval_mode: "auto",
      });
      service.mcpJobsById.set("job_require", {
        request_id: "req_require",
        approval_mode: "require_user",
      });

      const action = {
        type: "remove_component",
        target: "selection",
        target_object_path: "Scene/Canvas/Image",
        component_assembly_qualified_name: "SmokeComponent, Assembly-CSharp",
      };
      const autoEnvelope = service.buildUnityActionRequestEnvelopeWithIds(
        "req_auto",
        "t_auto",
        "u_auto",
        action
      );
      const requireEnvelope = service.buildUnityActionRequestEnvelopeWithIds(
        "req_require",
        "t_require",
        "u_require",
        action
      );

      if (
        !autoEnvelope ||
        !autoEnvelope.payload ||
        autoEnvelope.payload.requires_confirmation !== false
      ) {
        throw new Error(
          `approval_mode auto expected requires_confirmation=false, got ${safeJson(
            autoEnvelope
          )}`
        );
      }
      if (
        !requireEnvelope ||
        !requireEnvelope.payload ||
        requireEnvelope.payload.requires_confirmation !== true
      ) {
        throw new Error(
          `approval_mode require_user expected requires_confirmation=true, got ${safeJson(
            requireEnvelope
          )}`
        );
      }

      return {
        auto_requires_confirmation: autoEnvelope.payload.requires_confirmation,
        require_user_requires_confirmation:
          requireEnvelope.payload.requires_confirmation,
      };
    }
  );

  await runCase(report, "restart_recover_running_and_queued", async () => {
    const restart = await restartManagedSidecar(
      baseUrl,
      runId,
      spawned,
      {
        mcpMaxQueue: args.mcpMaxQueue,
      }
    );
    if (!restart.restarted) {
      return {
        warnings: [
          "restart recovery case skipped because sidecar was not started by runner",
        ],
      };
    }
    spawned = restart.spawned;

    const firstStatus = await getJobStatus(baseUrl, firstJobId);
    if (firstStatus.status !== "pending") {
      throw new Error(
        `restart_recover_running_and_queued expected first status=pending, got ${
          firstStatus.status || ""
        }`
      );
    }
    const secondStatus = await getJobStatus(baseUrl, secondJobId);
    if (secondStatus.status !== "queued") {
      throw new Error(
        `restart_recover_running_and_queued expected second status=queued, got ${
          secondStatus.status || ""
        }`
      );
    }
    if (
      (secondStatus.running_job_id || "") &&
      secondStatus.running_job_id !== firstJobId
    ) {
      throw new Error(
        `restart_recover_running_and_queued expected running_job_id=${firstJobId}, got ${
          secondStatus.running_job_id || ""
        }`
      );
    }
    return {
      first_job_status: firstStatus.status,
      second_job_status: secondStatus.status,
      running_job_id: secondStatus.running_job_id || "",
    };
  });

  await runCase(report, "cancel_first_job", async () => {
    const res = await postJson(baseUrl, "/mcp/cancel_unity_task", {
      job_id: firstJobId,
    });
    assertStatus(res, 200, "cancel_first_job");
    if (!res.body || res.body.status !== "cancelled") {
      throw new Error(
        `cancel_first_job expected cancelled, got ${safeJson(res.body)}`
      );
    }
    return {
      job_id: firstJobId,
      status: res.body.status,
    };
  });

  await runCase(report, "queued_job_drains_to_pending", async () => {
    const status = await waitForJobStatus({
      baseUrl,
      jobId: secondJobId,
      targetStatus: "pending",
      timeoutMs: args.pollTimeoutMs,
      pollIntervalMs: args.pollIntervalMs,
    });
    return {
      job_id: secondJobId,
      status: status.status,
      stage: status.stage || "",
    };
  });

  await runCase(report, "cancel_second_job", async () => {
    const res = await postJson(baseUrl, "/mcp/cancel_unity_task", {
      job_id: secondJobId,
    });
    assertStatus(res, 200, "cancel_second_job");
    if (!res.body || res.body.status !== "cancelled") {
      throw new Error(
        `cancel_second_job expected cancelled, got ${safeJson(res.body)}`
      );
    }
    return {
      job_id: secondJobId,
      status: res.body.status,
    };
  });

  report.finished_at = new Date().toISOString();
  report.summary.total = report.cases.length;
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
    spawnSidecar: true,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    mcpMaxQueue: 1,
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
    if (token === "--mcp-max-queue" && i + 1 < argv.length) {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value >= 0) {
        args.mcpMaxQueue = Math.floor(value);
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

async function getJobStatus(baseUrl, jobId) {
  const res = await requestJson({
    method: "GET",
    url: `${baseUrl}/mcp/get_unity_task_status?job_id=${encodeURIComponent(
      jobId
    )}`,
    timeoutMs: 5000,
  });
  assertStatus(res, 200, "get_job_status");
  return res.body || {};
}

async function waitForJobStatus(options) {
  const baseUrl = options.baseUrl;
  const jobId = options.jobId;
  const targetStatus = options.targetStatus;
  const timeoutMs = options.timeoutMs;
  const pollIntervalMs = options.pollIntervalMs;
  const start = Date.now();
  let last = null;

  while (Date.now() - start < timeoutMs) {
    const status = await getJobStatus(baseUrl, jobId);
    last = status;
    if (status && status.status === targetStatus) {
      return status;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(
    `job did not reach status=${targetStatus} within ${timeoutMs}ms (last=${safeJson(
      last
    )})`
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
  const port = Number(url.port || 46327);
  const opts = options && typeof options === "object" ? options : {};
  const mcpMaxQueue =
    Number.isFinite(opts.mcpMaxQueue) && opts.mcpMaxQueue >= 0
      ? String(Math.floor(opts.mcpMaxQueue))
      : "1";
  const sidecarRoot = path.resolve(__dirname, "..");
  const child = spawn(process.execPath, ["index.js", "--port", String(port)], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      USE_CODEX_APP_SERVER: "false",
      USE_FAKE_CODEX_TIMEOUT_PLANNER: "true",
      ENABLE_MCP_ADAPTER: "true",
      MCP_MAX_QUEUE: mcpMaxQueue,
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

async function restartManagedSidecar(baseUrl, runId, spawned, options) {
  if (!spawned || !spawned.startedByRunner) {
    return {
      restarted: false,
      spawned,
    };
  }
  await shutdownSpawnedSidecar(baseUrl, spawned.child);
  const restarted = await startSidecarIfNeeded(baseUrl, `${runId}_restart`, options);
  await ensureSidecarAvailability(baseUrl);
  return {
    restarted: true,
    spawned: restarted,
  };
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

function createApprovalMappingHarness() {
  const noop = () => {};
  const turnStoreStub = {
    setTimeoutAbortHandler: noop,
    getActiveRequestId: () => "",
    getTurn: () => null,
  };
  return new TurnService({
    turnStore: turnStoreStub,
    nowIso: () => new Date().toISOString(),
    enableMcpAdapter: true,
    enableTimeoutAbortCleanup: false,
    fileActionExecutor: {
      execute: () => ({ ok: true, changes: [] }),
    },
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

function assertMcpErrorFeedback(body, expectedCode, label, options) {
  const payload = body && typeof body === "object" ? body : null;
  if (!payload) {
    throw new Error(`${label} expected JSON error payload`);
  }
  if ((payload.error_code || "") !== expectedCode) {
    throw new Error(
      `${label} expected error_code=${expectedCode}, got ${payload.error_code || ""}`
    );
  }
  if (
    typeof payload.error_message !== "string" ||
    payload.error_message.trim().length === 0
  ) {
    throw new Error(`${label} expected non-empty error_message`);
  }
  if (
    typeof payload.suggestion !== "string" ||
    payload.suggestion.trim().length === 0
  ) {
    throw new Error(`${label} expected non-empty suggestion`);
  }
  const opts = options && typeof options === "object" ? options : {};
  if (
    Object.prototype.hasOwnProperty.call(opts, "recoverable") &&
    payload.recoverable !== opts.recoverable
  ) {
    throw new Error(
      `${label} expected recoverable=${opts.recoverable}, got ${payload.recoverable}`
    );
  }
  if (
    typeof opts.suggestionIncludes === "string" &&
    opts.suggestionIncludes &&
    !payload.suggestion
      .toLowerCase()
      .includes(String(opts.suggestionIncludes).toLowerCase())
  ) {
    throw new Error(
      `${label} expected suggestion to include "${opts.suggestionIncludes}", got ${payload.suggestion}`
    );
  }
}

function buildTestContext(maxDepth) {
  return {
    selection: {
      mode: "selection",
      target_object_path: "Scene/Canvas/Image",
      prefab_path: "",
    },
    selection_tree: {
      max_depth: Number.isFinite(maxDepth) ? Number(maxDepth) : 2,
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

function writeReport(report) {
  const stateDir = path.resolve(__dirname, "..", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, `mcp-job-report-${report.run_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const elapsedMs =
    Date.parse(report.finished_at || new Date().toISOString()) -
    Date.parse(report.started_at);
  // eslint-disable-next-line no-console
  console.log(`[mcp] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(`[mcp] base_url=${report.base_url}`);
  // eslint-disable-next-line no-console
  console.log(
    `[mcp] total=${report.summary.total} pass=${report.summary.passed} warn=${report.summary.warned} fail=${report.summary.failed}`
  );
  // eslint-disable-next-line no-console
  console.log(`[mcp] elapsed_ms=${Number.isFinite(elapsedMs) ? elapsedMs : 0}`);
  // eslint-disable-next-line no-console
  console.log(`[mcp] report=${reportPath}`);
  if (report.summary.failed > 0) {
    // eslint-disable-next-line no-console
    console.error("[mcp] failing cases:");
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
  console.error(`[mcp] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

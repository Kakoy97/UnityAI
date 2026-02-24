#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(SIDECAR_ROOT, ".state");
const DEFAULT_STATE_FILE = path.join(STATE_DIR, "sidecar-state.json");
const DEFAULT_MIN_PASS_RATE_PCT = 95;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  const matrix = buildMatrix(args);
  const matrixResults = [];
  const matrixReportPaths = [];

  if (!args.skipMatrix) {
    for (const item of matrix) {
      const result = await runMatrixItem(item);
      matrixResults.push(result);
      if (result.report_path) {
        matrixReportPaths.push(result.report_path);
      }
    }
  }

  const uniqueReportPaths = uniqueStrings(
    matrixReportPaths.map((item) => normalizePath(item, SIDECAR_ROOT)).filter(Boolean)
  );
  const reportSummaries = uniqueReportPaths
    .map((filePath) => readJsonIfExists(filePath))
    .filter((item) => item && typeof item === "object")
    .map((report) => buildReportSummary(report));

  const regression = buildRegressionSummary(reportSummaries);
  const observability = buildObservabilitySummary(args.stateFile);

  const fallbackMetricsAvailable = hasFallbackMetrics(reportSummaries);
  const requirements = {
    matrix_commands_exit_zero: matrixResults.every((item) => item.exit_code === 0),
    machine_readable_reports_available: reportSummaries.length > 0,
    regression_pass_rate_ge_threshold:
      Number.isFinite(regression.pass_rate_pct) &&
      regression.pass_rate_pct >= args.minPassRatePct,
    observability_metrics_available:
      (observability.stage_duration_ms.text_turn.count > 0 &&
        observability.stage_duration_ms.extraction_turn.count > 0) ||
      fallbackMetricsAvailable,
    replay_script_present: fs.existsSync(
      path.join(SIDECAR_ROOT, "scripts", "replay-failed-report.js")
    ),
  };

  const gatePassed = Object.values(requirements).every((value) => value === true);

  const report = {
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    config: {
      skip_matrix: args.skipMatrix,
      min_pass_rate_pct: args.minPassRatePct,
      state_file: args.stateFile,
      matrix_size: matrix.length,
    },
    matrix_results: matrixResults,
    reports: reportSummaries,
    regression_summary: regression,
      observability_summary: observability,
    fallback_metrics_available: fallbackMetricsAvailable,
    requirements,
    go_no_go: gatePassed ? "Go" : "No-Go",
  };

  const outputPath = args.outPath
    ? normalizePath(args.outPath, SIDECAR_ROOT)
    : path.join(STATE_DIR, `step8-quality-gate-${runId}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  printSummary(report, outputPath);
  process.exitCode = gatePassed ? 0 : 1;
}

function parseArgs(argv) {
  const args = {
    skipMatrix: false,
    stateFile: DEFAULT_STATE_FILE,
    outPath: "",
    minPassRatePct: DEFAULT_MIN_PASS_RATE_PCT,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (token === "--skip-matrix") {
      args.skipMatrix = true;
      continue;
    }
    if (token === "--state-file" && i + 1 < argv.length) {
      args.stateFile = normalizePath(argv[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if (token === "--out" && i + 1 < argv.length) {
      args.outPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--min-pass-rate-pct" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n >= 0 && n <= 100) {
        args.minPassRatePct = n;
      }
      i += 1;
      continue;
    }
  }
  return args;
}

function buildMatrix() {
  return [
    {
      id: "smoke_fast",
      label: "smoke:fast",
      command: process.execPath,
      args: [
        "scripts/smoke-turn-runner.js",
        "--base-url",
        "http://127.0.0.1:46331",
        "--iterations",
        "3",
        "--skip-turn-send",
        "--include-timeout-case",
        "--spawn-sidecar",
        "--compile-timeout-ms",
        "1200",
      ],
      cwd: SIDECAR_ROOT,
    },
    {
      id: "smoke_codex_timeout",
      label: "smoke:codex-timeout",
      command: process.execPath,
      args: [
        "scripts/smoke-turn-runner.js",
        "--base-url",
        "http://127.0.0.1:46330",
        "--iterations",
        "1",
        "--skip-turn-send",
        "--include-codex-timeout-case",
        "--spawn-sidecar",
        "--fake-codex-timeout-planner",
        "--codex-soft-timeout-ms",
        "1200",
        "--codex-hard-timeout-ms",
        "2400",
      ],
      cwd: SIDECAR_ROOT,
    },
    {
      id: "smoke_query_timeout",
      label: "smoke:query-timeout",
      command: process.execPath,
      args: [
        "scripts/smoke-turn-runner.js",
        "--base-url",
        "http://127.0.0.1:46329",
        "--iterations",
        "1",
        "--skip-turn-send",
        "--include-query-timeout-case",
        "--spawn-sidecar",
        "--unity-query-timeout-ms",
        "1200",
      ],
      cwd: SIDECAR_ROOT,
    },
    {
      id: "smoke_query_probe",
      label: "smoke:query-probe",
      command: process.execPath,
      args: [
        "scripts/smoke-turn-runner.js",
        "--base-url",
        "http://127.0.0.1:46328",
        "--iterations",
        "1",
        "--skip-turn-send",
        "--include-query-probe-case",
        "--spawn-sidecar",
        "--fake-unity-query-mode",
        "remove_except_keep",
        "--fake-unity-query-keep-component",
        "KeepComponent",
        "--unity-query-timeout-ms",
        "5000",
      ],
      cwd: SIDECAR_ROOT,
    },
    {
      id: "mcp_job",
      label: "smoke:mcp-job",
      command: process.execPath,
      args: [
        "scripts/mcp-job-runner.js",
        "--base-url",
        "http://127.0.0.1:46327",
        "--spawn-sidecar",
        "--mcp-max-queue",
        "1",
      ],
      cwd: SIDECAR_ROOT,
    },
    {
      id: "mcp_stream",
      label: "smoke:mcp-stream",
      command: process.execPath,
      args: [
        "scripts/mcp-stream-runner.js",
        "--base-url",
        "http://127.0.0.1:46326",
        "--spawn-sidecar",
        "--mcp-max-queue",
        "1",
        "--mcp-stream-max-events",
        "6",
        "--mcp-stream-max-subscribers",
        "2",
        "--mcp-stream-recovery-jobs-max",
        "2",
      ],
      cwd: SIDECAR_ROOT,
    },
    {
      id: "planner_probe",
      label: "smoke:planner-probe",
      command: process.execPath,
      args: ["scripts/planner-probe-regression.js"],
      cwd: SIDECAR_ROOT,
    },
    {
      id: "planner_memory",
      label: "smoke:planner-memory",
      command: process.execPath,
      args: ["scripts/planner-memory-regression.js"],
      cwd: SIDECAR_ROOT,
    },
  ];
}

async function runMatrixItem(item) {
  const startedAt = Date.now();
  const execResult = await runCommand(item.command, item.args, {
    cwd: item.cwd,
    env: process.env,
  });
  const reportPath = extractReportPath(execResult.stdout, execResult.stderr);
  const summary = reportPath
    ? extractSummaryFromReport(normalizePath(reportPath, item.cwd))
    : null;
  return {
    id: item.id,
    label: item.label,
    command: [item.command].concat(item.args || []).join(" "),
    cwd: item.cwd,
    duration_ms: Date.now() - startedAt,
    exit_code: execResult.exitCode,
    report_path: reportPath ? normalizePath(reportPath, item.cwd) : "",
    summary,
    stdout_tail: tailLines(execResult.stdout, 12),
    stderr_tail: tailLines(execResult.stderr, 8),
  };
}

function runCommand(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, Array.isArray(args) ? args : [], {
      cwd: options && options.cwd ? options.cwd : process.cwd(),
      env: options && options.env ? options.env : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk || "");
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk || "");
      });
    }
    child.on("close", (code) => {
      resolve({
        exitCode: Number.isFinite(Number(code)) ? Number(code) : 1,
        stdout,
        stderr,
      });
    });
    child.on("error", (error) => {
      stderr += error && error.message ? `\n${error.message}` : "\nspawn failed";
      resolve({
        exitCode: 1,
        stdout,
        stderr,
      });
    });
  });
}

function extractReportPath(stdout, stderr) {
  const merged = `${stdout || ""}\n${stderr || ""}`;
  const regex = /\[[^\]]+\]\s+report=(.+)/g;
  let match = null;
  let last = "";
  while (true) {
    match = regex.exec(merged);
    if (!match) {
      break;
    }
    last = String(match[1] || "").trim();
  }
  return last;
}

function extractSummaryFromReport(filePath) {
  const report = readJsonIfExists(filePath);
  if (!report || typeof report !== "object") {
    return null;
  }
  const summary = report.summary && typeof report.summary === "object" ? report.summary : {};
  return {
    total: toInt(summary.total),
    passed: toInt(summary.passed),
    warned: toInt(summary.warned),
    failed: toInt(summary.failed),
  };
}

function buildReportSummary(report) {
  const summary = report && report.summary && typeof report.summary === "object"
    ? report.summary
    : {};
  const metrics = report && report.metrics && typeof report.metrics === "object"
    ? report.metrics
    : {};
  const cases = Array.isArray(report && report.cases) ? report.cases : [];
  const type = detectReportType(report);
  return {
    report_type: type,
    report_path:
      typeof report.__source_path === "string" ? report.__source_path : "",
    run_id: typeof report.run_id === "string" ? report.run_id : "",
    started_at:
      typeof report.started_at === "string" ? report.started_at : "",
    finished_at:
      typeof report.finished_at === "string" ? report.finished_at : "",
    summary: {
      total: toInt(summary.total),
      passed: toInt(summary.passed),
      warned: toInt(summary.warned),
      failed: toInt(summary.failed),
    },
    metrics: {
      case_duration_ms: normalizeQuantiles(metrics.case_duration_ms),
      file_compile_round_duration_ms: normalizeQuantiles(
        metrics.file_compile_round_duration_ms
      ),
    },
    cancel_cases: summarizeCancelCases(cases),
    failed_cases: cases
      .filter((item) => item && item.status === "fail")
      .map((item) => ({
        name: item.name || "",
        error: item.error || "",
      })),
  };
}

function hasFallbackMetrics(reportSummaries) {
  const items = Array.isArray(reportSummaries) ? reportSummaries : [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const caseCount = toInt(
      item.metrics && item.metrics.case_duration_ms && item.metrics.case_duration_ms.count
    );
    const compileCount = toInt(
      item.metrics &&
        item.metrics.file_compile_round_duration_ms &&
        item.metrics.file_compile_round_duration_ms.count
    );
    if (caseCount > 0 || compileCount > 0) {
      return true;
    }
  }
  return false;
}

function detectReportType(report) {
  const filePath =
    report && typeof report.__source_path === "string" ? report.__source_path : "";
  const fileName = filePath ? path.basename(filePath).toLowerCase() : "";
  if (fileName.startsWith("smoke-turn-report-")) {
    return "smoke_turn";
  }
  if (fileName.startsWith("mcp-job-report-")) {
    return "mcp_job";
  }
  if (fileName.startsWith("mcp-stream-report-")) {
    return "mcp_stream";
  }
  if (fileName.startsWith("planner-probe-regression-")) {
    return "planner_probe";
  }
  if (fileName.startsWith("planner-memory-regression-")) {
    return "planner_memory";
  }
  return "unknown";
}

function summarizeCancelCases(cases) {
  const items = Array.isArray(cases) ? cases : [];
  const cancelCases = items.filter((item) =>
    item &&
    typeof item.name === "string" &&
    /cancel/i.test(item.name)
  );
  let successful = 0;
  for (const item of cancelCases) {
    const status = item && typeof item.status === "string" ? item.status : "";
    if (status === "pass" || status === "warn") {
      successful += 1;
    }
  }
  return {
    total: cancelCases.length,
    successful,
    success_rate_pct: safePercent(successful, cancelCases.length),
  };
}

function buildRegressionSummary(reportSummaries) {
  const items = Array.isArray(reportSummaries) ? reportSummaries : [];
  let total = 0;
  let passed = 0;
  let warned = 0;
  let failed = 0;
  let cancelTotal = 0;
  let cancelSuccessful = 0;

  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    total += toInt(item.summary && item.summary.total);
    passed += toInt(item.summary && item.summary.passed);
    warned += toInt(item.summary && item.summary.warned);
    failed += toInt(item.summary && item.summary.failed);
    cancelTotal += toInt(item.cancel_cases && item.cancel_cases.total);
    cancelSuccessful += toInt(item.cancel_cases && item.cancel_cases.successful);
  }

  return {
    report_count: items.length,
    total_cases: total,
    passed_cases: passed,
    warned_cases: warned,
    failed_cases: failed,
    effective_pass_cases: passed + warned,
    pass_rate_pct: safePercent(passed + warned, total),
    cancel_cases_total: cancelTotal,
    cancel_cases_successful: cancelSuccessful,
    cancel_success_rate_pct: safePercent(cancelSuccessful, cancelTotal),
  };
}

function buildObservabilitySummary(stateFilePath) {
  const payload = {
    state_file: stateFilePath,
    turns_total: 0,
    terminal_turns: 0,
    timeout_turns: 0,
    timeout_rate_pct: 0,
    cancelled_turns: 0,
    stage_duration_ms: {
      text_turn: emptyQuantiles(),
      extraction_turn: emptyQuantiles(),
    },
    extraction_started_count: 0,
    extraction_failed_count: 0,
    extraction_failure_rate_pct: 0,
    action_attempt_turns: 0,
    action_success_turns: 0,
    action_success_rate_pct: 0,
    error_code_histogram: {},
  };
  const snapshot = readJsonIfExists(stateFilePath);
  if (!snapshot || typeof snapshot !== "object") {
    return payload;
  }
  const turns = Array.isArray(snapshot.turns) ? snapshot.turns : [];
  payload.turns_total = turns.length;

  const textDurations = [];
  const extractionDurations = [];
  const timeoutCodes = new Set(["E_CODEX_TIMEOUT", "E_COMPILE_TIMEOUT"]);
  const errorHistogram = new Map();
  let extractionStartedCount = 0;
  let extractionFailedCount = 0;
  let actionAttemptTurns = 0;
  let actionSuccessTurns = 0;
  let terminalTurns = 0;
  let timeoutTurns = 0;
  let cancelledTurns = 0;

  for (const turn of turns) {
    if (!turn || typeof turn !== "object") {
      continue;
    }
    const state = typeof turn.state === "string" ? turn.state : "";
    const errorCode = typeof turn.error_code === "string" ? turn.error_code : "";
    if (state === "completed" || state === "error" || state === "cancelled") {
      terminalTurns += 1;
    }
    if (state === "cancelled") {
      cancelledTurns += 1;
    }
    if (timeoutCodes.has(errorCode)) {
      timeoutTurns += 1;
    }
    if (errorCode) {
      errorHistogram.set(errorCode, (errorHistogram.get(errorCode) || 0) + 1);
    }

    const events = Array.isArray(turn.events) ? turn.events : [];
    const textDuration = pickStageDuration(events, "text_turn_started", "text_turn_completed");
    if (textDuration >= 0) {
      textDurations.push(textDuration);
    }
    const extractionDuration = pickStageDuration(
      events,
      "extraction_started",
      "extraction_completed"
    );
    if (extractionDuration >= 0) {
      extractionDurations.push(extractionDuration);
    }
    extractionStartedCount += countEvents(events, "extraction_started");
    extractionFailedCount += countEvents(events, "extraction_turn_failed");

    const hasActionRequest = events.some(
      (event) => event && typeof event.event === "string" && event.event === "unity.action.request"
    );
    if (hasActionRequest) {
      actionAttemptTurns += 1;
      const report =
        turn.execution_report && typeof turn.execution_report === "object"
          ? turn.execution_report
          : null;
      if (report && report.action_success === true) {
        actionSuccessTurns += 1;
      }
    }
  }

  payload.terminal_turns = terminalTurns;
  payload.timeout_turns = timeoutTurns;
  payload.timeout_rate_pct = safePercent(timeoutTurns, terminalTurns);
  payload.cancelled_turns = cancelledTurns;
  payload.stage_duration_ms.text_turn = quantiles(textDurations);
  payload.stage_duration_ms.extraction_turn = quantiles(extractionDurations);
  payload.extraction_started_count = extractionStartedCount;
  payload.extraction_failed_count = extractionFailedCount;
  payload.extraction_failure_rate_pct = safePercent(
    extractionFailedCount,
    extractionStartedCount
  );
  payload.action_attempt_turns = actionAttemptTurns;
  payload.action_success_turns = actionSuccessTurns;
  payload.action_success_rate_pct = safePercent(actionSuccessTurns, actionAttemptTurns);
  payload.error_code_histogram = Object.fromEntries(Array.from(errorHistogram.entries()));

  return payload;
}

function pickStageDuration(events, startedName, completedName) {
  const items = Array.isArray(events) ? events : [];
  let startedAt = 0;
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const eventName = typeof item.event === "string" ? item.event : "";
    const ts = Date.parse(String(item.timestamp || ""));
    if (!Number.isFinite(ts)) {
      continue;
    }
    if (eventName === startedName) {
      startedAt = ts;
      continue;
    }
    if (eventName === completedName && startedAt > 0 && ts >= startedAt) {
      return ts - startedAt;
    }
  }
  return -1;
}

function countEvents(events, eventName) {
  const items = Array.isArray(events) ? events : [];
  let total = 0;
  for (const item of items) {
    if (
      item &&
      typeof item === "object" &&
      typeof item.event === "string" &&
      item.event === eventName
    ) {
      total += 1;
    }
  }
  return total;
}

function quantiles(values) {
  const list = Array.isArray(values)
    ? values
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
    : [];
  if (list.length === 0) {
    return emptyQuantiles();
  }
  const sorted = list.slice().sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    avg: Number((sum / sorted.length).toFixed(3)),
  };
}

function normalizeQuantiles(value) {
  const item = value && typeof value === "object" ? value : {};
  return {
    count: toInt(item.count),
    min: toNumberOrZero(item.min),
    max: toNumberOrZero(item.max),
    p50: toNumberOrZero(item.p50),
    p95: toNumberOrZero(item.p95),
    avg: toNumberOrZero(item.avg),
  };
}

function emptyQuantiles() {
  return {
    count: 0,
    min: 0,
    max: 0,
    p50: 0,
    p95: 0,
    avg: 0,
  };
}

function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) {
    return 0;
  }
  const rank = (sorted.length - 1) * p;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = rank - lower;
  return Number((sorted[lower] * (1 - weight) + sorted[upper] * weight).toFixed(3));
}

function safePercent(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number(((n / d) * 100).toFixed(3));
}

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

function toNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function readJsonIfExists(filePath) {
  const normalized = normalizePath(filePath, process.cwd());
  if (!normalized || !fs.existsSync(normalized)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(normalized, "utf8"));
    if (data && typeof data === "object") {
      data.__source_path = normalized;
    }
    return data;
  } catch {
    return null;
  }
}

function normalizePath(value, baseDir) {
  if (!value) {
    return "";
  }
  const raw = String(value).trim().replace(/^["']|["']$/g, "");
  if (!raw) {
    return "";
  }
  return path.isAbsolute(raw) ? raw : path.resolve(baseDir || process.cwd(), raw);
}

function uniqueStrings(values) {
  const list = Array.isArray(values) ? values : [];
  return Array.from(new Set(list.filter((item) => typeof item === "string" && item)));
}

function tailLines(text, count) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  return lines.slice(Math.max(0, lines.length - Math.max(0, count || 0)));
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

function printSummary(report, outputPath) {
  const summary = report && report.regression_summary ? report.regression_summary : {};
  const observability =
    report && report.observability_summary ? report.observability_summary : {};
  // eslint-disable-next-line no-console
  console.log(`[step8] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(`[step8] go_no_go=${report.go_no_go}`);
  // eslint-disable-next-line no-console
  console.log(
    `[step8] regression cases=${summary.total_cases || 0} pass_rate_pct=${summary.pass_rate_pct || 0}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[step8] timeout_rate_pct=${observability.timeout_rate_pct || 0} extraction_failure_rate_pct=${observability.extraction_failure_rate_pct || 0} action_success_rate_pct=${observability.action_success_rate_pct || 0}`
  );
  // eslint-disable-next-line no-console
  console.log(`[step8] report=${outputPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[step8] fatal: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});


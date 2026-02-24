#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const STATE_DIR = path.join(SIDECAR_ROOT, ".state");

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);
  const sourcePath = resolveSourceReport(args.reportPath);
  if (!sourcePath) {
    throw new Error(
      "No replay source report found. Provide --report <path> or keep at least one report in sidecar/.state."
    );
  }

  const source = readJson(sourcePath);
  const command = buildReplayCommand(sourcePath, source, args);
  const execResult = await runCommand(command.command, command.args, {
    cwd: command.cwd,
    env: process.env,
  });
  const replayReportPathRaw = extractReportPath(execResult.stdout, execResult.stderr);
  const replayReportPath = replayReportPathRaw
    ? normalizePath(replayReportPathRaw, command.cwd)
    : "";
  const replay = replayReportPath && fs.existsSync(replayReportPath)
    ? readJson(replayReportPath)
    : null;

  const sourceFailedCases = listFailingCaseNames(source);
  const replayFailedCases = listFailingCaseNames(replay);
  const replayFailedSet = new Set(replayFailedCases);

  const reproducedFailingCases = sourceFailedCases.filter((name) => replayFailedSet.has(name));
  const missingFailedCases = sourceFailedCases.filter((name) => !replayFailedSet.has(name));
  const unexpectedNewFailedCases = replayFailedCases.filter(
    (name) => !sourceFailedCases.includes(name)
  );

  const verdict = resolveVerdict({
    sourceFailCount: sourceFailedCases.length,
    commandExitCode: execResult.exitCode,
    missingFailedCasesCount: missingFailedCases.length,
  });

  const report = {
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    source_report_path: sourcePath,
    replay_report_path: replayReportPath,
    source_report_run_id: source && source.run_id ? source.run_id : "",
    replay_report_run_id: replay && replay.run_id ? replay.run_id : "",
    replay_command: [command.command].concat(command.args).join(" "),
    replay_command_exit_code: execResult.exitCode,
    source_failed_cases: sourceFailedCases,
    replay_failed_cases: replayFailedCases,
    reproduced_failed_cases: reproducedFailingCases,
    missing_failed_cases: missingFailedCases,
    unexpected_new_failed_cases: unexpectedNewFailedCases,
    reproduction_rate_pct: safePercent(
      reproducedFailingCases.length,
      sourceFailedCases.length
    ),
    verdict,
    stdout_tail: tailLines(execResult.stdout, 20),
    stderr_tail: tailLines(execResult.stderr, 10),
  };

  const outputPath = args.outPath
    ? normalizePath(args.outPath, SIDECAR_ROOT)
    : path.join(STATE_DIR, `failure-replay-report-${runId}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");

  printSummary(report, outputPath);
  process.exitCode = verdict === "replayed_all_failures" || verdict === "no_failures_in_source"
    ? 0
    : 1;
}

function parseArgs(argv) {
  const args = {
    reportPath: "",
    outPath: "",
    baseUrlOverride: "",
    spawnSidecarOverride: "",
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (token === "--report" && i + 1 < argv.length) {
      args.reportPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--out" && i + 1 < argv.length) {
      args.outPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--base-url" && i + 1 < argv.length) {
      args.baseUrlOverride = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--spawn-sidecar") {
      args.spawnSidecarOverride = "true";
      continue;
    }
    if (token === "--no-spawn-sidecar") {
      args.spawnSidecarOverride = "false";
      continue;
    }
  }
  return args;
}

function resolveSourceReport(reportPath) {
  if (reportPath) {
    const normalized = normalizePath(reportPath, SIDECAR_ROOT);
    if (normalized && fs.existsSync(normalized)) {
      return normalized;
    }
    throw new Error(`Replay source report does not exist: ${normalized}`);
  }

  if (!fs.existsSync(STATE_DIR)) {
    return "";
  }
  const candidates = fs
    .readdirSync(STATE_DIR, { withFileTypes: true })
    .filter((item) => item && item.isFile())
    .map((item) => path.join(STATE_DIR, item.name))
    .filter((filePath) => isReplaySupportedReport(path.basename(filePath)))
    .sort((a, b) => statMs(b) - statMs(a));

  for (const filePath of candidates) {
    const json = readJson(filePath);
    const failed = toInt(json && json.summary && json.summary.failed);
    if (failed > 0) {
      return filePath;
    }
  }
  return candidates.length > 0 ? candidates[0] : "";
}

function isReplaySupportedReport(fileName) {
  const lower = String(fileName || "").toLowerCase();
  return (
    lower.startsWith("smoke-turn-report-") ||
    lower.startsWith("mcp-job-report-") ||
    lower.startsWith("mcp-stream-report-") ||
    lower.startsWith("planner-probe-regression-") ||
    lower.startsWith("planner-memory-regression-")
  );
}

function buildReplayCommand(sourcePath, sourceReport, args) {
  const fileName = path.basename(sourcePath).toLowerCase();
  if (fileName.startsWith("smoke-turn-report-")) {
    return buildSmokeReplayCommand(sourceReport, args);
  }
  if (fileName.startsWith("mcp-job-report-")) {
    return buildMcpJobReplayCommand(sourceReport, args);
  }
  if (fileName.startsWith("mcp-stream-report-")) {
    return buildMcpStreamReplayCommand(sourceReport, args);
  }
  if (fileName.startsWith("planner-probe-regression-")) {
    return {
      command: process.execPath,
      args: ["scripts/planner-probe-regression.js"],
      cwd: SIDECAR_ROOT,
    };
  }
  if (fileName.startsWith("planner-memory-regression-")) {
    return {
      command: process.execPath,
      args: ["scripts/planner-memory-regression.js"],
      cwd: SIDECAR_ROOT,
    };
  }
  throw new Error(`Unsupported source report type: ${fileName}`);
}

function buildSmokeReplayCommand(sourceReport, args) {
  const cfg = sourceReport && typeof sourceReport.config === "object"
    ? sourceReport.config
    : {};
  const replayArgs = ["scripts/smoke-turn-runner.js"];
  appendBaseUrl(replayArgs, args.baseUrlOverride || sourceReport.base_url);
  appendNumberArg(replayArgs, "--iterations", cfg.iterations);
  appendBooleanFlag(
    replayArgs,
    cfg.include_turn_send !== false,
    "--include-turn-send",
    "--skip-turn-send"
  );
  appendBooleanFlag(
    replayArgs,
    cfg.include_timeout_case === true,
    "--include-timeout-case",
    "--skip-timeout-case"
  );
  appendBooleanFlag(
    replayArgs,
    cfg.include_codex_timeout_case === true,
    "--include-codex-timeout-case",
    "--skip-codex-timeout-case"
  );
  appendBooleanFlag(
    replayArgs,
    cfg.include_query_timeout_case === true,
    "--include-query-timeout-case",
    "--skip-query-timeout-case"
  );
  appendBooleanFlag(
    replayArgs,
    cfg.include_query_probe_case === true,
    "--include-query-probe-case",
    "--skip-query-probe-case"
  );
  appendSpawnFlag(replayArgs, cfg.spawn_sidecar, args.spawnSidecarOverride);
  appendNumberArg(replayArgs, "--poll-timeout-ms", cfg.poll_timeout_ms);
  appendNumberArg(replayArgs, "--poll-interval-ms", cfg.poll_interval_ms);
  appendNumberArg(replayArgs, "--compile-timeout-ms", cfg.compile_timeout_ms);
  appendNumberArg(replayArgs, "--codex-soft-timeout-ms", cfg.codex_soft_timeout_ms);
  appendNumberArg(replayArgs, "--codex-hard-timeout-ms", cfg.codex_hard_timeout_ms);
  appendNumberArg(
    replayArgs,
    "--unity-query-timeout-ms",
    cfg.unity_component_query_timeout_ms
  );
  if (cfg.use_fake_codex_timeout_planner === true) {
    replayArgs.push("--fake-codex-timeout-planner");
  }
  if (cfg.use_fake_unity_query_planner === true) {
    replayArgs.push("--fake-unity-query-planner");
  }
  if (isNonEmptyString(cfg.fake_unity_query_mode)) {
    replayArgs.push("--fake-unity-query-mode", String(cfg.fake_unity_query_mode));
  }
  if (isNonEmptyString(cfg.fake_unity_query_keep_component)) {
    replayArgs.push(
      "--fake-unity-query-keep-component",
      String(cfg.fake_unity_query_keep_component)
    );
  }

  return {
    command: process.execPath,
    args: replayArgs,
    cwd: SIDECAR_ROOT,
  };
}

function buildMcpJobReplayCommand(sourceReport, args) {
  const cfg = sourceReport && typeof sourceReport.config === "object"
    ? sourceReport.config
    : {};
  const replayArgs = ["scripts/mcp-job-runner.js"];
  appendBaseUrl(replayArgs, args.baseUrlOverride || sourceReport.base_url);
  appendSpawnFlag(replayArgs, cfg.spawn_sidecar, args.spawnSidecarOverride);
  appendNumberArg(replayArgs, "--poll-timeout-ms", cfg.poll_timeout_ms);
  appendNumberArg(replayArgs, "--poll-interval-ms", cfg.poll_interval_ms);
  appendNonNegativeNumberArg(replayArgs, "--mcp-max-queue", cfg.mcp_max_queue);
  return {
    command: process.execPath,
    args: replayArgs,
    cwd: SIDECAR_ROOT,
  };
}

function buildMcpStreamReplayCommand(sourceReport, args) {
  const cfg = sourceReport && typeof sourceReport.config === "object"
    ? sourceReport.config
    : {};
  const replayArgs = ["scripts/mcp-stream-runner.js"];
  appendBaseUrl(replayArgs, args.baseUrlOverride || sourceReport.base_url);
  appendSpawnFlag(replayArgs, cfg.spawn_sidecar, args.spawnSidecarOverride);
  appendNonNegativeNumberArg(replayArgs, "--mcp-max-queue", cfg.mcp_max_queue);
  appendNumberArg(replayArgs, "--wait-timeout-ms", cfg.wait_timeout_ms);
  appendNumberArg(replayArgs, "--mcp-stream-max-events", cfg.mcp_stream_max_events);
  appendNumberArg(
    replayArgs,
    "--mcp-stream-max-subscribers",
    cfg.mcp_stream_max_subscribers
  );
  appendNumberArg(
    replayArgs,
    "--mcp-stream-recovery-jobs-max",
    cfg.mcp_stream_recovery_jobs_max
  );
  return {
    command: process.execPath,
    args: replayArgs,
    cwd: SIDECAR_ROOT,
  };
}

function appendBaseUrl(args, value) {
  if (!isNonEmptyString(value)) {
    return;
  }
  args.push("--base-url", String(value).trim());
}

function appendNumberArg(args, flag, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return;
  }
  args.push(flag, String(Math.floor(n)));
}

function appendNonNegativeNumberArg(args, flag, value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return;
  }
  args.push(flag, String(Math.floor(n)));
}

function appendBooleanFlag(args, condition, yesFlag, noFlag) {
  if (condition) {
    args.push(yesFlag);
    return;
  }
  if (isNonEmptyString(noFlag)) {
    args.push(noFlag);
  }
}

function appendSpawnFlag(args, sourceSpawnSidecar, override) {
  if (override === "true") {
    args.push("--spawn-sidecar");
    return;
  }
  if (override === "false") {
    args.push("--no-spawn-sidecar");
    return;
  }
  if (sourceSpawnSidecar === true) {
    args.push("--spawn-sidecar");
  }
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

function resolveVerdict(input) {
  const sourceFailCount = toInt(input && input.sourceFailCount);
  const commandExitCode = Number(input && input.commandExitCode);
  const missingCount = toInt(input && input.missingFailedCasesCount);
  if (sourceFailCount === 0) {
    return commandExitCode === 0 ? "no_failures_in_source" : "replay_command_failed";
  }
  if (missingCount === 0) {
    return "replayed_all_failures";
  }
  if (commandExitCode !== 0) {
    return "replayed_partial_failures";
  }
  return "replayed_partial_failures";
}

function listFailingCaseNames(report) {
  const cases = Array.isArray(report && report.cases) ? report.cases : [];
  return cases
    .filter((item) => item && item.status === "fail" && isNonEmptyString(item.name))
    .map((item) => String(item.name).trim());
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.floor(n));
}

function safePercent(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number(((n / d) * 100).toFixed(3));
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

function statMs(filePath) {
  try {
    const st = fs.statSync(filePath);
    return Number(st.mtimeMs || 0);
  } catch {
    return 0;
  }
}

function printSummary(report, outputPath) {
  // eslint-disable-next-line no-console
  console.log(`[replay] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(`[replay] source=${report.source_report_path}`);
  // eslint-disable-next-line no-console
  console.log(`[replay] replay=${report.replay_report_path || "<none>"}`);
  // eslint-disable-next-line no-console
  console.log(
    `[replay] source_failed=${report.source_failed_cases.length} reproduced=${report.reproduced_failed_cases.length} verdict=${report.verdict}`
  );
  // eslint-disable-next-line no-console
  console.log(`[replay] report=${outputPath}`);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[replay] fatal: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});

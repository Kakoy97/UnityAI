#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { spawn } = require("child_process");

const TERMINAL_STATES = new Set(["completed", "error", "cancelled"]);
const DEFAULT_BASE_URL = "http://127.0.0.1:46340";
const DEFAULT_ROUNDS = 12;
const DEFAULT_POLL_TIMEOUT_MS = 90000;
const DEFAULT_POLL_INTERVAL_MS = 350;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);

  const templates = [args.promptTemplateA, args.promptTemplateB];
  const suites = [];
  for (let i = 0; i < templates.length; i += 1) {
    const template = templates[i];
    const suite = await runTemplateSuite({
      runId,
      suiteIndex: i + 1,
      template,
      rounds: args.rounds,
      baseUrl: args.baseUrl,
      pollTimeoutMs: args.pollTimeoutMs,
      pollIntervalMs: args.pollIntervalMs,
      spawnSidecar: args.spawnSidecar,
    });
    suites.push(suite);
  }

  const baseline = suites[0] || null;
  const candidate = suites[1] || null;
  const comparison = buildComparison(baseline, candidate);

  const report = {
    version: 1,
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    config: {
      rounds: args.rounds,
      base_url_seed: args.baseUrl,
      poll_timeout_ms: args.pollTimeoutMs,
      poll_interval_ms: args.pollIntervalMs,
      spawn_sidecar: args.spawnSidecar,
      baseline_template: args.promptTemplateA,
      candidate_template: args.promptTemplateB,
    },
    baseline,
    candidate,
    comparison,
  };

  const reportPath = writeReport(report, "step2-metrics-compare");
  printSummary(report, reportPath);

  const comparable = !!(
    comparison &&
    comparison.summary &&
    comparison.summary.comparable === true
  );
  process.exitCode = comparable ? 0 : 2;
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    rounds: DEFAULT_ROUNDS,
    pollTimeoutMs: DEFAULT_POLL_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    promptTemplateA: "v1",
    promptTemplateB: "v2",
    spawnSidecar: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (token === "--base-url" && i + 1 < argv.length) {
      args.baseUrl = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--rounds" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.rounds = Math.floor(n);
      }
      i += 1;
      continue;
    }
    if (token === "--poll-timeout-ms" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.pollTimeoutMs = Math.floor(n);
      }
      i += 1;
      continue;
    }
    if (token === "--poll-interval-ms" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.pollIntervalMs = Math.floor(n);
      }
      i += 1;
      continue;
    }
    if (token === "--template-a" && i + 1 < argv.length) {
      args.promptTemplateA = normalizePromptTemplateArg(argv[i + 1]);
      i += 1;
      continue;
    }
    if (token === "--template-b" && i + 1 < argv.length) {
      args.promptTemplateB = normalizePromptTemplateArg(argv[i + 1]);
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
  }

  return args;
}

function normalizePromptTemplateArg(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "v1" || raw === "v2" ? raw : "v2";
}

async function runTemplateSuite(options) {
  const {
    runId,
    suiteIndex,
    template,
    rounds,
    baseUrl,
    pollTimeoutMs,
    pollIntervalMs,
    spawnSidecar,
  } = options;

  const suiteStartedAt = new Date();
  const suiteRunId = `${runId}_${template}_${String(suiteIndex).padStart(2, "0")}`;
  let activeBaseUrl = baseUrl;
  /** @type {null | { child: import("child_process").ChildProcess, startedByRunner: boolean }} */
  let spawned = null;

  try {
    if (spawnSidecar) {
      const isolated = await startIsolatedSidecar(baseUrl, suiteRunId, {
        env: {
          USE_CODEX_APP_SERVER: "true",
          USE_FAKE_CODEX_TIMEOUT_PLANNER: "false",
          PLANNER_PROMPT_TEMPLATE: template,
        },
      });
      activeBaseUrl = isolated.baseUrl;
      spawned = isolated.spawned;
    } else {
      await ensureSidecarAvailability(activeBaseUrl);
    }
    await clearRecoveredActiveTurn(activeBaseUrl);

    const roundsOutput = [];
    for (let i = 1; i <= rounds; i += 1) {
      const round = await runSingleRound({
        roundIndex: i,
        runId: suiteRunId,
        baseUrl: activeBaseUrl,
        pollTimeoutMs,
        pollIntervalMs,
      });
      roundsOutput.push(round);
    }

    const suiteReport = buildSuiteReport({
      template,
      runId: suiteRunId,
      baseUrl: activeBaseUrl,
      rounds: roundsOutput,
      startedAt: suiteStartedAt,
      finishedAt: new Date(),
    });
    const suiteReportPath = writeReport(
      suiteReport,
      `planner-metrics-${template}`
    );

    return {
      ...suiteReport,
      report_path: suiteReportPath,
    };
  } finally {
    if (spawned && spawned.startedByRunner) {
      await shutdownSpawnedSidecar(activeBaseUrl, spawned.child);
    }
  }
}

async function clearRecoveredActiveTurn(baseUrl) {
  for (let i = 0; i < 3; i += 1) {
    const health = await requestJson({
      method: "GET",
      url: `${baseUrl}/health`,
      timeoutMs: 5000,
    });
    const activeRequestId =
      health &&
      health.body &&
      typeof health.body.active_request_id === "string"
        ? health.body.active_request_id
        : "";
    if (!activeRequestId) {
      return;
    }
    await safeCancelTurn({
      baseUrl,
      requestId: activeRequestId,
      threadId: "step2_metrics_cleanup_thread",
      turnId: "step2_metrics_cleanup_turn",
      reason: "step2_metrics_cleanup_active_turn",
    });
    await sleep(200);
  }
}

async function runSingleRound(options) {
  const { roundIndex, runId, baseUrl, pollTimeoutMs, pollIntervalMs } = options;
  const requestId = `planner_metric_${runId}_${String(roundIndex).padStart(3, "0")}`;
  const threadId = `planner_thread_${runId}`;
  const turnId = `planner_turn_${String(roundIndex).padStart(3, "0")}`;
  const userMessage = buildRoundMessage(roundIndex);

  const envelope = buildEnvelope({
    event: "turn.send",
    requestId,
    threadId,
    turnId,
    payload: {
      user_message: userMessage,
      context: buildMinimalContext(),
    },
  });

  const sendRes = await postJson(baseUrl, "/turn/send", envelope);
  const accepted =
    sendRes.body && typeof sendRes.body.accepted === "boolean"
      ? sendRes.body.accepted
      : false;

  if (sendRes.statusCode === 429) {
    return {
      name: `planner_round_${String(roundIndex).padStart(3, "0")}`,
      status: "warn",
      request_id: requestId,
      warning: "turn.send throttled by active turn",
      active_request_id:
        sendRes.body && typeof sendRes.body.active_request_id === "string"
          ? sendRes.body.active_request_id
          : "",
    };
  }

  if (sendRes.statusCode !== 200 && sendRes.statusCode !== 202) {
    return {
      name: `planner_round_${String(roundIndex).padStart(3, "0")}`,
      status: "fail",
      request_id: requestId,
      error: `turn.send unexpected status=${sendRes.statusCode}`,
    };
  }

  if (!accepted) {
    return {
      name: `planner_round_${String(roundIndex).padStart(3, "0")}`,
      status: "warn",
      request_id: requestId,
      warning: "turn.send accepted=false (planner unavailable or rejected)",
      error_code:
        sendRes.body && typeof sendRes.body.error_code === "string"
          ? sendRes.body.error_code
          : "",
    };
  }

  let finalStatus = null;
  try {
    finalStatus = await waitForTurnTerminal({
      baseUrl,
      requestId,
      threadId,
      turnId,
      timeoutMs: pollTimeoutMs,
      pollIntervalMs,
    });
  } catch (error) {
    await safeCancelTurn({
      baseUrl,
      requestId,
      threadId,
      turnId,
      reason: "step2_metrics_round_timeout",
    });
    return {
      name: `planner_round_${String(roundIndex).padStart(3, "0")}`,
      status: "fail",
      request_id: requestId,
      error:
        error instanceof Error ? error.message : String(error || "unknown"),
    };
  }

  const roundMetrics = extractRoundMetrics(finalStatus, userMessage);
  const terminalState = typeof finalStatus.state === "string" ? finalStatus.state : "";
  const terminalErrorCode =
    typeof finalStatus.error_code === "string" ? finalStatus.error_code : "";

  if (!TERMINAL_STATES.has(terminalState)) {
    return {
      name: `planner_round_${String(roundIndex).padStart(3, "0")}`,
      status: "fail",
      request_id: requestId,
      error: "turn did not reach terminal state",
    };
  }

  return {
    name: `planner_round_${String(roundIndex).padStart(3, "0")}`,
    status: terminalState === "error" ? "warn" : "pass",
    request_id: requestId,
    state: terminalState,
    error_code: terminalErrorCode,
    metrics: roundMetrics,
  };
}

async function safeCancelTurn(input) {
  const payload = {
    reason:
      input && typeof input.reason === "string"
        ? input.reason
        : "step2_metrics_cancel",
  };
  try {
    await postJson(
      input.baseUrl,
      "/turn/cancel",
      buildEnvelope({
        event: "turn.cancel",
        requestId: input.requestId,
        threadId: input.threadId,
        turnId: input.turnId,
        payload,
      })
    );
  } catch {
    // best-effort cleanup only
  }
}

async function waitForTurnTerminal(options) {
  const {
    baseUrl,
    requestId,
    threadId,
    turnId,
    timeoutMs,
    pollIntervalMs,
  } = options;
  const start = Date.now();
  let compileResultSent = false;
  let cancelledByRunner = false;

  while (Date.now() - start < timeoutMs) {
    const statusUrl = `${baseUrl}/turn/status?request_id=${encodeURIComponent(
      requestId
    )}`;
    const statusRes = await requestJson({
      method: "GET",
      url: statusUrl,
      timeoutMs: Math.min(8000, pollIntervalMs + 3000),
    });
    if (statusRes.statusCode !== 200 || !statusRes.body) {
      await sleep(pollIntervalMs);
      continue;
    }
    const body = statusRes.body;
    const stage = typeof body.stage === "string" ? body.stage : "";
    if (TERMINAL_STATES.has(body.state || "")) {
      return body;
    }

    if (stage === "compile_pending" && !compileResultSent) {
      compileResultSent = true;
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
      await postJson(baseUrl, "/unity/compile/result", compileEnvelope);
    } else if (stage === "action_confirm_pending" && !cancelledByRunner) {
      cancelledByRunner = true;
      const cancelEnvelope = buildEnvelope({
        event: "turn.cancel",
        requestId,
        threadId,
        turnId,
        payload: {
          reason: "step2_metrics_unexpected_action",
        },
      });
      await postJson(baseUrl, "/turn/cancel", cancelEnvelope);
    }

    await sleep(pollIntervalMs);
  }

  throw new Error(
    `turn did not reach terminal state within ${timeoutMs}ms (request_id=${requestId})`
  );
}

function buildRoundMessage(roundIndex) {
  const prompts = [
    "请解释 Unity 中 MonoBehaviour 和 ScriptableObject 的差异，只讨论，不执行修改。",
    "Give a concise plan for reducing UI overdraw in Unity. Discussion only, no code edits.",
    "先分析如何优化资源加载与内存管理，不要执行任何文件或场景修改。",
    "Explain tradeoffs between Update polling and event-driven patterns in Unity. No execution.",
  ];
  const idx = (Math.max(1, roundIndex) - 1) % prompts.length;
  return prompts[idx];
}

function extractRoundMetrics(turnStatus, userMessage) {
  const events = Array.isArray(turnStatus && turnStatus.events)
    ? turnStatus.events
    : [];
  const textStartedAt = findEventTimestamp(events, "text_turn_started");
  const firstTokenEvent = events.find(
    (item) => item && item.event === "text_turn_first_token"
  );
  let ttftMs =
    firstTokenEvent &&
    firstTokenEvent.planner_metrics &&
    Number.isFinite(firstTokenEvent.planner_metrics.ttft_ms)
      ? Math.max(0, Number(firstTokenEvent.planner_metrics.ttft_ms))
      : 0;

  if (ttftMs <= 0 && textStartedAt > 0) {
    const firstDeltaAt = findFirstPlanningTextTimestamp(events);
    if (firstDeltaAt > 0) {
      ttftMs = Math.max(0, firstDeltaAt - textStartedAt);
    }
  }

  const textUsage = findUsageMetric(events, "text_turn_usage");
  const extractionUsage = findUsageMetric(events, "extraction_turn_usage");
  const usageTotal = textUsage.total_tokens + extractionUsage.total_tokens;

  let totalTokens = usageTotal;
  let tokenSource = usageTotal > 0 ? "app_server_usage" : "estimated_char_div4";
  if (totalTokens <= 0) {
    totalTokens = estimateTokenCountFromTurn(events, userMessage);
  }
  if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
    totalTokens = 0;
    tokenSource = "unavailable";
  }

  const extractionFailed =
    hasEvent(events, "extraction_turn_failed") ||
    inferExtractionFailureFromTerminal(turnStatus, events);
  const extractionFailureIndicator = extractionFailed ? 100 : 0;

  return {
    ttft_ms: ttftMs,
    total_tokens: totalTokens,
    token_source: tokenSource,
    extraction_failed: extractionFailed,
    extraction_failure_indicator_pct: extractionFailureIndicator,
    text_usage: textUsage,
    extraction_usage: extractionUsage,
  };
}

function findEventTimestamp(events, eventName) {
  if (!Array.isArray(events) || !eventName) {
    return 0;
  }
  for (const item of events) {
    if (!item || item.event !== eventName) {
      continue;
    }
    const ts = Date.parse(item.timestamp || "");
    if (Number.isFinite(ts) && ts > 0) {
      return ts;
    }
  }
  return 0;
}

function findFirstPlanningTextTimestamp(events) {
  if (!Array.isArray(events)) {
    return 0;
  }
  for (const item of events) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.phase !== "planning") {
      continue;
    }
    if (item.event !== "chat.delta" && item.event !== "chat.message") {
      continue;
    }
    const ts = Date.parse(item.timestamp || "");
    if (Number.isFinite(ts) && ts > 0) {
      return ts;
    }
  }
  return 0;
}

function findUsageMetric(events, eventName) {
  if (!Array.isArray(events)) {
    return {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };
  }
  for (const item of events) {
    if (!item || item.event !== eventName) {
      continue;
    }
    const metrics =
      item.planner_metrics && typeof item.planner_metrics === "object"
        ? item.planner_metrics
        : {};
    const inputTokens = toPositiveInt(metrics.input_tokens);
    const outputTokens = toPositiveInt(metrics.output_tokens);
    const totalTokens = toPositiveInt(metrics.total_tokens);
    const normalizedTotal = Math.max(totalTokens, inputTokens + outputTokens);
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: normalizedTotal,
    };
  }
  return {
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
  };
}

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return 0;
  }
  return Math.floor(n);
}

function hasEvent(events, eventName) {
  if (!Array.isArray(events) || !eventName) {
    return false;
  }
  return events.some((item) => item && item.event === eventName);
}

function inferExtractionFailureFromTerminal(turnStatus, events) {
  const state = turnStatus && typeof turnStatus.state === "string"
    ? turnStatus.state
    : "";
  const errorCode = turnStatus && typeof turnStatus.error_code === "string"
    ? turnStatus.error_code
    : "";
  if (state !== "error") {
    return false;
  }
  if (errorCode === "E_PLANNING_FAILED") {
    const text = collectPlannerEventText(events).toLowerCase();
    return (
      text.includes("extraction") ||
      text.includes("task_allocation") ||
      text.includes("json parse")
    );
  }
  return false;
}

function collectPlannerEventText(events) {
  if (!Array.isArray(events)) {
    return "";
  }
  return events
    .filter((item) => item && typeof item.message === "string")
    .map((item) => item.message)
    .join("\n");
}

function estimateTokenCountFromTurn(events, userMessage) {
  const userChars = typeof userMessage === "string" ? userMessage.length : 0;
  const assistantText = Array.isArray(events)
    ? events
        .filter(
          (item) =>
            item &&
            item.event === "chat.message" &&
            item.phase === "planning" &&
            item.role === "assistant" &&
            typeof item.message === "string"
        )
        .map((item) => item.message)
        .join("\n")
    : "";
  const assistantChars = assistantText.length;
  const totalChars = userChars + assistantChars;
  if (totalChars <= 0) {
    return 0;
  }
  return Math.ceil(totalChars / 4);
}

function buildSuiteReport(input) {
  const rounds = Array.isArray(input.rounds) ? input.rounds : [];
  const validRounds = rounds.filter(
    (item) =>
      item &&
      item.metrics &&
      (item.status === "pass" || item.status === "warn")
  );
  const ttftValues = validRounds
    .map((item) => Number(item.metrics.ttft_ms))
    .filter((n) => Number.isFinite(n) && n > 0);
  const tokenValues = validRounds
    .map((item) => Number(item.metrics.total_tokens))
    .filter((n) => Number.isFinite(n) && n > 0);
  const extractionIndicatorValues = validRounds
    .map((item) => Number(item.metrics.extraction_failure_indicator_pct))
    .filter((n) => Number.isFinite(n));
  const extractionFailures = validRounds.filter(
    (item) => item.metrics.extraction_failed === true
  ).length;
  const extractionRatePct =
    validRounds.length > 0
      ? round2((extractionFailures / validRounds.length) * 100)
      : 0;

  return {
    version: 1,
    run_id: input.runId,
    template: input.template,
    started_at: input.startedAt.toISOString(),
    finished_at: input.finishedAt.toISOString(),
    base_url: input.baseUrl,
    rounds,
    summary: {
      total_rounds: rounds.length,
      passed: rounds.filter((item) => item && item.status === "pass").length,
      warned: rounds.filter((item) => item && item.status === "warn").length,
      failed: rounds.filter((item) => item && item.status === "fail").length,
      valid_for_metrics: validRounds.length,
    },
    metrics: {
      ttft_ms: quantiles(ttftValues),
      total_tokens: quantiles(tokenValues),
      extraction_failure_indicator_pct: quantiles(extractionIndicatorValues),
      extraction_failure_rate_pct: {
        count: validRounds.length,
        failures: extractionFailures,
        rate_pct: extractionRatePct,
      },
    },
  };
}

function buildComparison(baseline, candidate) {
  if (!baseline || !candidate) {
    return {
      summary: {
        comparable: false,
        reason: "missing baseline or candidate suite",
      },
    };
  }

  const baselineValid = Number(
    baseline &&
      baseline.summary &&
      Number.isFinite(baseline.summary.valid_for_metrics)
      ? baseline.summary.valid_for_metrics
      : 0
  );
  const candidateValid = Number(
    candidate &&
      candidate.summary &&
      Number.isFinite(candidate.summary.valid_for_metrics)
      ? candidate.summary.valid_for_metrics
      : 0
  );
  if (baselineValid <= 0 || candidateValid <= 0) {
    return {
      summary: {
        comparable: false,
        reason: "insufficient valid rounds for metrics",
        baseline_valid_rounds: baselineValid,
        candidate_valid_rounds: candidateValid,
      },
    };
  }

  const ttft = compareQuantileMetric(
    baseline.metrics.ttft_ms,
    candidate.metrics.ttft_ms
  );
  const totalTokens = compareQuantileMetric(
    baseline.metrics.total_tokens,
    candidate.metrics.total_tokens
  );
  const extractionIndicator = compareQuantileMetric(
    baseline.metrics.extraction_failure_indicator_pct,
    candidate.metrics.extraction_failure_indicator_pct
  );
  const baselineRate =
    baseline.metrics &&
    baseline.metrics.extraction_failure_rate_pct &&
    Number.isFinite(baseline.metrics.extraction_failure_rate_pct.rate_pct)
      ? Number(baseline.metrics.extraction_failure_rate_pct.rate_pct)
      : 0;
  const candidateRate =
    candidate.metrics &&
    candidate.metrics.extraction_failure_rate_pct &&
    Number.isFinite(candidate.metrics.extraction_failure_rate_pct.rate_pct)
      ? Number(candidate.metrics.extraction_failure_rate_pct.rate_pct)
      : 0;
  const extractionRateDelta = round2(candidateRate - baselineRate);
  const extractionRateImprovement = baselineRate > 0
    ? round2(((baselineRate - candidateRate) / baselineRate) * 100)
    : 0;

  return {
    summary: {
      comparable: true,
      baseline_template: baseline.template,
      candidate_template: candidate.template,
      baseline_valid_rounds: baselineValid,
      candidate_valid_rounds: candidateValid,
    },
    ttft_ms: ttft,
    total_tokens: totalTokens,
    extraction_failure_indicator_pct: extractionIndicator,
    extraction_failure_rate_pct: {
      baseline: round2(baselineRate),
      candidate: round2(candidateRate),
      delta: extractionRateDelta,
      improvement_pct: extractionRateImprovement,
    },
  };
}

function compareQuantileMetric(baseline, candidate) {
  const baseP50 = getNumberOrZero(baseline && baseline.p50);
  const baseP95 = getNumberOrZero(baseline && baseline.p95);
  const candP50 = getNumberOrZero(candidate && candidate.p50);
  const candP95 = getNumberOrZero(candidate && candidate.p95);
  return {
    baseline: {
      p50: round2(baseP50),
      p95: round2(baseP95),
      count: Number(
        baseline && Number.isFinite(baseline.count) ? baseline.count : 0
      ),
    },
    candidate: {
      p50: round2(candP50),
      p95: round2(candP95),
      count: Number(
        candidate && Number.isFinite(candidate.count) ? candidate.count : 0
      ),
    },
    delta: {
      p50: round2(candP50 - baseP50),
      p95: round2(candP95 - baseP95),
    },
    improvement_pct: {
      p50: baseP50 > 0 ? round2(((baseP50 - candP50) / baseP50) * 100) : 0,
      p95: baseP95 > 0 ? round2(((baseP95 - candP95) / baseP95) * 100) : 0,
    },
  };
}

function getNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.round(n * 100) / 100;
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
    avg: round2(sum / sorted.length),
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

async function startIsolatedSidecar(baseUrl, runId, options) {
  const seed = new URL(baseUrl);
  const seedPort = Number(seed.port || (seed.protocol === "https:" ? 443 : 80));
  const maxAttempts = 25;
  let lastError = null;
  const envOverrides =
    options && options.env && typeof options.env === "object"
      ? options.env
      : {};

  for (let offset = 1; offset <= maxAttempts; offset += 1) {
    const candidatePort = seedPort + offset;
    const candidateBaseUrl = buildUrlWithPort(seed, candidatePort);
    try {
      await ensureSidecarAvailability(candidateBaseUrl);
      continue;
    } catch {
      // candidate port is probably free for startup attempt
    }

    try {
      const spawned = await startSidecarIfNeeded(candidateBaseUrl, runId, {
        env: envOverrides,
      });
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

async function startSidecarIfNeeded(baseUrl, runId, options) {
  const url = new URL(baseUrl);
  const port = Number(url.port || 46321);
  const sidecarRoot = path.resolve(__dirname, "..");
  const envOverrides =
    options && options.env && typeof options.env === "object"
      ? options.env
      : {};

  const child = spawn(process.execPath, ["index.js", "--port", String(port)], {
    cwd: sidecarRoot,
    env: {
      ...process.env,
      USE_CODEX_APP_SERVER: "true",
      USE_FAKE_CODEX_TIMEOUT_PLANNER: "false",
      CODEX_SOFT_TIMEOUT_MS: "90000",
      CODEX_HARD_TIMEOUT_MS: "240000",
      COMPILE_TIMEOUT_MS: "120000",
      ...envOverrides,
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
    if (lines.length > 60) {
      lines.shift();
    }
  };
  if (child.stdout) {
    child.stdout.on("data", collect);
  }
  if (child.stderr) {
    child.stderr.on("data", collect);
  }

  const bootDeadline = Date.now() + 20000;
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
    `failed to start sidecar (run=${runId}). logs=${lines.slice(-10).join(" | ")}`
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

function writeReport(report, prefix) {
  const stateDir = path.resolve(__dirname, "..", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(
    stateDir,
    `${prefix}-${report.run_id || buildRunId(new Date())}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const comparable = !!(
    report &&
    report.comparison &&
    report.comparison.summary &&
    report.comparison.summary.comparable
  );
  const lines = [
    `[step2-metrics] run_id=${report.run_id}`,
    `[step2-metrics] comparable=${comparable ? "yes" : "no"}`,
    `[step2-metrics] report=${reportPath}`,
  ];
  if (comparable) {
    const ttft = report.comparison.ttft_ms || {};
    const token = report.comparison.total_tokens || {};
    const extraction = report.comparison.extraction_failure_rate_pct || {};
    lines.push(
      `[step2-metrics] ttft_p50 baseline=${ttft.baseline ? ttft.baseline.p50 : 0} candidate=${ttft.candidate ? ttft.candidate.p50 : 0} improvement_pct=${ttft.improvement_pct ? ttft.improvement_pct.p50 : 0}`
    );
    lines.push(
      `[step2-metrics] token_p50 baseline=${token.baseline ? token.baseline.p50 : 0} candidate=${token.candidate ? token.candidate.p50 : 0} improvement_pct=${token.improvement_pct ? token.improvement_pct.p50 : 0}`
    );
    lines.push(
      `[step2-metrics] extraction_rate baseline=${Number.isFinite(extraction.baseline) ? extraction.baseline : 0}% candidate=${Number.isFinite(extraction.candidate) ? extraction.candidate : 0}%`
    );
  } else {
    const reason =
      report &&
      report.comparison &&
      report.comparison.summary &&
      typeof report.comparison.summary.reason === "string"
        ? report.comparison.summary.reason
        : "unknown";
    lines.push(`[step2-metrics] reason=${reason}`);
  }
  for (const line of lines) {
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

async function postJson(baseUrl, pathname, body) {
  return requestJson({
    method: "POST",
    url: `${baseUrl}${pathname}`,
    body,
    timeoutMs: 12000,
  });
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
            statusCode: Number(res.statusCode) || 0,
            body,
          });
        });
      }
    );

    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
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

if (require.main === module) {
  main().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(
      `[step2-metrics] fatal: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exitCode = 1;
  });
}

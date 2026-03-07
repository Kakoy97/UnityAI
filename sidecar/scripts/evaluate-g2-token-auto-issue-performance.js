#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { monitorEventLoopDelay } = require("node:perf_hooks");

const {
  createTokenLifecycleOrchestrator,
} = require("../src/application/ssotRuntime/tokenLifecycleOrchestrator");
const {
  createTokenPolicyRuntime,
} = require("../src/application/ssotRuntime/tokenPolicyRuntime");
const {
  SsotTokenRegistry,
} = require("../src/application/ssotRuntime/ssotTokenRegistry");
const {
  SsotRevisionState,
} = require("../src/application/ssotRuntime/ssotRevisionState");
const {
  TokenLifecycleMetricsCollector,
} = require("../src/application/ssotRuntime/tokenLifecycleMetricsCollector");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g2-token-auto-issue-performance-report.json"
);

function resolvePath(rawValue, baseDir) {
  const normalized = String(rawValue || "")
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!normalized) {
    return "";
  }
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(baseDir || process.cwd(), normalized);
}

function toPositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return Math.floor(Number(fallback) || 1);
  }
  return Math.floor(n);
}

function safeRatio(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) {
    return 0;
  }
  return Number((n / d).toFixed(6));
}

function normalizeFiniteNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return Number(fallback) || 0;
  }
  return n;
}

function percentile(values, ratio) {
  const items = Array.isArray(values)
    ? values
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
        .sort((a, b) => a - b)
    : [];
  if (items.length <= 0) {
    return 0;
  }
  const p = Math.min(1, Math.max(0, Number(ratio)));
  const index = Math.min(items.length - 1, Math.floor((items.length - 1) * p));
  return Number(items[index].toFixed(6));
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const input = {
    outputPath: DEFAULT_OUTPUT_PATH,
    iterations: 3000,
    warmupIterations: 200,
    latencyRegressionThreshold: 0.1,
    cpuRegressionThreshold: 0.2,
    heapRegressionThreshold: 0.2,
    minLatencyBaselineMs: 0.2,
    cpuDeltaThresholdMs: 40,
    heapAbsThresholdBytes: 8 * 1024 * 1024,
    eventLoopP95ThresholdMs: 20,
    ci: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "").trim();
    if ((token === "--output" || token === "-o") && index + 1 < args.length) {
      input.outputPath = resolvePath(args[index + 1], SIDECAR_ROOT);
      index += 1;
      continue;
    }
    if (token === "--iterations" && index + 1 < args.length) {
      input.iterations = toPositiveInteger(args[index + 1], input.iterations);
      index += 1;
      continue;
    }
    if (token === "--warmup-iterations" && index + 1 < args.length) {
      input.warmupIterations = toPositiveInteger(
        args[index + 1],
        input.warmupIterations
      );
      index += 1;
      continue;
    }
    if (token === "--latency-threshold" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n >= 0) {
        input.latencyRegressionThreshold = n;
      }
      index += 1;
      continue;
    }
    if (token === "--cpu-threshold" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n >= 0) {
        input.cpuRegressionThreshold = n;
      }
      index += 1;
      continue;
    }
    if (token === "--heap-threshold" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n >= 0) {
        input.heapRegressionThreshold = n;
      }
      index += 1;
      continue;
    }
    if (token === "--event-loop-p95-threshold-ms" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n >= 0) {
        input.eventLoopP95ThresholdMs = n;
      }
      index += 1;
      continue;
    }
    if (token === "--cpu-delta-threshold-ms" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n >= 0) {
        input.cpuDeltaThresholdMs = n;
      }
      index += 1;
      continue;
    }
    if (token === "--min-latency-baseline-ms" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n > 0) {
        input.minLatencyBaselineMs = n;
      }
      index += 1;
      continue;
    }
    if (token === "--heap-abs-threshold-bytes" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n >= 0) {
        input.heapAbsThresholdBytes = Math.floor(n);
      }
      index += 1;
      continue;
    }
    if (token === "--ci") {
      input.ci = true;
      continue;
    }
  }
  return input;
}

function buildWriteSuccessResult(iteration) {
  return {
    ok: true,
    data: {
      scene_revision: `ssot_rev_perf_${iteration + 1}`,
      target_object_id: `go_target_${iteration + 1}`,
      target_path: `Scene/Canvas/Target_${iteration + 1}`,
      read_token_candidate: `legacy_candidate_${iteration + 1}`,
    },
  };
}

function createBenchmarkOrchestrator(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const metricsCollector = new TokenLifecycleMetricsCollector();
  return {
    metricsCollector,
    orchestrator: createTokenLifecycleOrchestrator({
      tokenPolicyRuntime: createTokenPolicyRuntime(),
      tokenRegistry: new SsotTokenRegistry(),
      revisionState: new SsotRevisionState(),
      metricsCollector,
      tokenAutoIssueEnabled: opts.tokenAutoIssueEnabled !== false,
    }),
  };
}

function runModeBenchmark(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const iterations = toPositiveInteger(opts.iterations, 1000);
  const warmupIterations = toPositiveInteger(opts.warmupIterations, 100);
  const modeName = opts.modeName || "mode";
  const tokenAutoIssueEnabled = opts.tokenAutoIssueEnabled !== false;
  const benchmark = createBenchmarkOrchestrator({
    tokenAutoIssueEnabled,
  });

  for (let i = 0; i < warmupIterations; i += 1) {
    benchmark.orchestrator.finalizeDispatchResult({
      toolName: "modify_ui_layout",
      result: buildWriteSuccessResult(i),
    });
  }
  benchmark.metricsCollector.resetForTests();

  const loopDelayMonitor = monitorEventLoopDelay({ resolution: 20 });
  loopDelayMonitor.enable();
  const cpuStart = process.cpuUsage();
  const heapStart = process.memoryUsage().heapUsed;
  const startedAtNs = process.hrtime.bigint();
  const perCallLatencyMs = [];

  for (let i = 0; i < iterations; i += 1) {
    const callStartedAtNs = process.hrtime.bigint();
    benchmark.orchestrator.finalizeDispatchResult({
      toolName: "modify_ui_layout",
      result: buildWriteSuccessResult(i + warmupIterations),
    });
    const callEndedAtNs = process.hrtime.bigint();
    perCallLatencyMs.push(Number(callEndedAtNs - callStartedAtNs) / 1e6);
  }

  const endedAtNs = process.hrtime.bigint();
  loopDelayMonitor.disable();
  const cpuUsed = process.cpuUsage(cpuStart);
  const heapEnd = process.memoryUsage().heapUsed;
  const elapsedMs = Number(endedAtNs - startedAtNs) / 1e6;

  return {
    mode: modeName,
    token_auto_issue_enabled: tokenAutoIssueEnabled,
    iterations,
    warmup_iterations: warmupIterations,
    elapsed_ms: Number(elapsedMs.toFixed(6)),
    avg_latency_ms: Number((elapsedMs / iterations).toFixed(6)),
    p95_latency_ms: percentile(perCallLatencyMs, 0.95),
    cpu_user_ms: Number((cpuUsed.user / 1000).toFixed(6)),
    cpu_system_ms: Number((cpuUsed.system / 1000).toFixed(6)),
    cpu_total_ms: Number(((cpuUsed.user + cpuUsed.system) / 1000).toFixed(6)),
    heap_delta_bytes: heapEnd - heapStart,
    event_loop_p95_ms: Number((loopDelayMonitor.percentile(95) / 1e6).toFixed(6)),
    event_loop_max_ms: Number((loopDelayMonitor.max / 1e6).toFixed(6)),
    lifecycle_metrics: benchmark.metricsCollector.getSnapshot(),
  };
}

function buildPerformanceReport(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const baseline = runModeBenchmark({
    modeName: "baseline_auto_issue_disabled",
    tokenAutoIssueEnabled: false,
    iterations: opts.iterations,
    warmupIterations: opts.warmupIterations,
  });
  const candidate = runModeBenchmark({
    modeName: "candidate_auto_issue_enabled",
    tokenAutoIssueEnabled: true,
    iterations: opts.iterations,
    warmupIterations: opts.warmupIterations,
  });

  const latencyBaselineForRatio = Math.max(
    normalizeFiniteNumber(baseline.avg_latency_ms, 0),
    normalizeFiniteNumber(opts.minLatencyBaselineMs, 0.2)
  );
  const latencyRegression = safeRatio(
    candidate.avg_latency_ms - baseline.avg_latency_ms,
    latencyBaselineForRatio
  );
  const cpuRegression = safeRatio(
    candidate.cpu_total_ms - baseline.cpu_total_ms,
    baseline.cpu_total_ms || 1
  );
  const cpuDeltaMs = Number(
    Math.max(0, candidate.cpu_total_ms - baseline.cpu_total_ms).toFixed(6)
  );
  const cpuDeltaThresholdMs = Math.max(
    0,
    normalizeFiniteNumber(opts.cpuDeltaThresholdMs, 40)
  );
  const baselineHeapAbs = Math.abs(normalizeFiniteNumber(baseline.heap_delta_bytes, 0));
  const candidateHeapAbs = Math.abs(
    normalizeFiniteNumber(candidate.heap_delta_bytes, 0)
  );
  const heapRegression = safeRatio(
    Math.abs(candidateHeapAbs - baselineHeapAbs),
    Math.max(baselineHeapAbs, 1)
  );
  const heapAbsThresholdBytes = Math.max(
    0,
    Math.floor(normalizeFiniteNumber(opts.heapAbsThresholdBytes, 0))
  );

  const checks = [
    {
      id: "latency_regression",
      pass: latencyRegression <= Number(opts.latencyRegressionThreshold),
      threshold: Number(opts.latencyRegressionThreshold),
      current: latencyRegression,
      details: `avg_latency_ms baseline=${baseline.avg_latency_ms} candidate=${candidate.avg_latency_ms}`,
    },
    {
      id: "cpu_regression",
      pass:
        cpuRegression <= Number(opts.cpuRegressionThreshold) ||
        cpuDeltaMs <= cpuDeltaThresholdMs,
      threshold: {
        ratio: Number(opts.cpuRegressionThreshold),
        delta_ms: cpuDeltaThresholdMs,
      },
      current: cpuRegression,
      details: `cpu_total_ms baseline=${baseline.cpu_total_ms} candidate=${candidate.cpu_total_ms} delta_ms=${cpuDeltaMs}`,
    },
    {
      id: "heap_regression",
      pass:
        heapRegression <= Number(opts.heapRegressionThreshold) ||
        candidateHeapAbs <= heapAbsThresholdBytes,
      threshold: {
        ratio: Number(opts.heapRegressionThreshold),
        abs_bytes: heapAbsThresholdBytes,
      },
      current: heapRegression,
      details: `heap_abs baseline=${baselineHeapAbs} candidate=${candidateHeapAbs}`,
    },
    {
      id: "event_loop_p95",
      pass:
        candidate.event_loop_p95_ms <= Number(opts.eventLoopP95ThresholdMs),
      threshold: Number(opts.eventLoopP95ThresholdMs),
      current: candidate.event_loop_p95_ms,
      details: `event_loop_p95_ms candidate=${candidate.event_loop_p95_ms}`,
    },
  ];

  return {
    schema_version: "g2_token_auto_issue_performance_report.v1",
    generated_at: new Date().toISOString(),
    benchmark: {
      iterations: toPositiveInteger(opts.iterations, 3000),
      warmup_iterations: toPositiveInteger(opts.warmupIterations, 200),
      baseline,
      candidate,
    },
    regression: {
      latency_regression_ratio: latencyRegression,
      cpu_regression_ratio: cpuRegression,
      heap_regression_ratio: heapRegression,
    },
    thresholds: {
      latency_regression_threshold: Number(opts.latencyRegressionThreshold),
      cpu_regression_threshold: Number(opts.cpuRegressionThreshold),
      cpu_delta_threshold_ms: cpuDeltaThresholdMs,
      heap_regression_threshold: Number(opts.heapRegressionThreshold),
      min_latency_baseline_ms: latencyBaselineForRatio,
      heap_abs_threshold_bytes: heapAbsThresholdBytes,
      event_loop_p95_threshold_ms: Number(opts.eventLoopP95ThresholdMs),
    },
    checks,
    all_passed: checks.every((item) => item.pass === true),
  };
}

function writeReport(report, outputPath) {
  const filePath = resolvePath(outputPath, SIDECAR_ROOT);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function runCli(argv) {
  const options = parseArgs(argv);
  const report = buildPerformanceReport(options);
  const outputPath = writeReport(report, options.outputPath);
  // eslint-disable-next-line no-console
  console.log(`[g2-token-auto-issue-perf] output=${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-auto-issue-perf] latency_regression=${report.regression.latency_regression_ratio} cpu_regression=${report.regression.cpu_regression_ratio} heap_regression=${report.regression.heap_regression_ratio}`
  );

  if (options.ci && report.all_passed !== true) {
    const failedChecks = report.checks
      .filter((item) => item.pass !== true)
      .map((item) => item.id)
      .join(", ");
    throw new Error(
      `G2 auto-issue performance checks failed: ${failedChecks || "unknown"}`
    );
  }

  return {
    report,
    outputPath,
  };
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error || "");
    // eslint-disable-next-line no-console
    console.error(`[g2-token-auto-issue-perf] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  runModeBenchmark,
  buildPerformanceReport,
  runCli,
};

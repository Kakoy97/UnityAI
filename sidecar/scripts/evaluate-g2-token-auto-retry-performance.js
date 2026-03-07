"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  "scripts",
  "g2-token-auto-retry-performance-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g2-token-auto-retry-performance-report.json"
);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

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

function toNonNegativeNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Number(fallback) || 0;
  }
  return n;
}

function toUnitNumber(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return Number(fallback) || 0;
  }
  return n;
}

function safeRatio(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number((n / d).toFixed(6));
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const input = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    maxLatencyDegradationRatio: 0.1,
    maxThroughputDropRatio: 0.05,
    maxRecoveryDurationP95Ms: 3000,
    minBaselineLatencyMs: 1,
    minBaselineThroughputRps: 1,
    ci: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "").trim();
    if ((token === "--input" || token === "-i") && index + 1 < args.length) {
      input.inputPath = resolvePath(args[index + 1], SIDECAR_ROOT);
      index += 1;
      continue;
    }
    if ((token === "--output" || token === "-o") && index + 1 < args.length) {
      input.outputPath = resolvePath(args[index + 1], SIDECAR_ROOT);
      index += 1;
      continue;
    }
    if (token === "--max-latency-degradation-ratio" && index + 1 < args.length) {
      input.maxLatencyDegradationRatio = toUnitNumber(
        args[index + 1],
        input.maxLatencyDegradationRatio
      );
      index += 1;
      continue;
    }
    if (token === "--max-throughput-drop-ratio" && index + 1 < args.length) {
      input.maxThroughputDropRatio = toUnitNumber(
        args[index + 1],
        input.maxThroughputDropRatio
      );
      index += 1;
      continue;
    }
    if (token === "--max-recovery-duration-p95-ms" && index + 1 < args.length) {
      input.maxRecoveryDurationP95Ms = toNonNegativeNumber(
        args[index + 1],
        input.maxRecoveryDurationP95Ms
      );
      index += 1;
      continue;
    }
    if (token === "--min-baseline-latency-ms" && index + 1 < args.length) {
      input.minBaselineLatencyMs = toNonNegativeNumber(
        args[index + 1],
        input.minBaselineLatencyMs
      );
      index += 1;
      continue;
    }
    if (token === "--min-baseline-throughput-rps" && index + 1 < args.length) {
      input.minBaselineThroughputRps = toNonNegativeNumber(
        args[index + 1],
        input.minBaselineThroughputRps
      );
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

function readJsonOrThrow(filePath) {
  const absolutePath = resolvePath(filePath, SIDECAR_ROOT);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error(`auto-retry performance input file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`auto-retry performance input file is empty: ${absolutePath}`);
  }
  const normalizedRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalizedRaw);
}

function normalizePerformanceBucket(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    request_p95_ms: toNonNegativeNumber(source.request_p95_ms, 0),
    request_avg_ms: toNonNegativeNumber(source.request_avg_ms, 0),
    throughput_rps: toNonNegativeNumber(source.throughput_rps, 0),
  };
}

function buildChecks(report, options) {
  const checks = [];
  checks.push({
    id: "baseline_signal_available",
    pass:
      report.baseline.request_p95_ms > 0 && report.baseline.throughput_rps > 0,
    threshold: "baseline_p95_ms>0 && baseline_throughput_rps>0",
    current: {
      request_p95_ms: report.baseline.request_p95_ms,
      throughput_rps: report.baseline.throughput_rps,
    },
    details: "baseline metrics are required for fuse decision",
  });
  checks.push({
    id: "latency_degradation_ratio",
    pass:
      report.regression.latency_degradation_ratio <=
      Number(options.maxLatencyDegradationRatio),
    threshold: Number(options.maxLatencyDegradationRatio),
    current: report.regression.latency_degradation_ratio,
    details: `latency_degradation_ratio=${report.regression.latency_degradation_ratio}`,
  });
  checks.push({
    id: "throughput_drop_ratio",
    pass:
      report.regression.throughput_drop_ratio <=
      Number(options.maxThroughputDropRatio),
    threshold: Number(options.maxThroughputDropRatio),
    current: report.regression.throughput_drop_ratio,
    details: `throughput_drop_ratio=${report.regression.throughput_drop_ratio}`,
  });
  checks.push({
    id: "recovery_duration_p95_ms",
    pass:
      report.recovery.duration_p95_ms <= Number(options.maxRecoveryDurationP95Ms),
    threshold: Number(options.maxRecoveryDurationP95Ms),
    current: report.recovery.duration_p95_ms,
    details: `recovery_duration_p95_ms=${report.recovery.duration_p95_ms}`,
  });
  return checks;
}

function buildPerformanceReport(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const snapshot = source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};

  const baseline = normalizePerformanceBucket(snapshot.baseline);
  const candidate = normalizePerformanceBucket(snapshot.candidate);
  const recoveryDuration =
    snapshot.recovery &&
    snapshot.recovery.duration_ms &&
    typeof snapshot.recovery.duration_ms === "object"
      ? snapshot.recovery.duration_ms
      : {};

  const baselineLatencyBase = Math.max(
    baseline.request_p95_ms,
    toNonNegativeNumber(source.minBaselineLatencyMs, 1)
  );
  const baselineThroughputBase = Math.max(
    baseline.throughput_rps,
    toNonNegativeNumber(source.minBaselineThroughputRps, 1)
  );

  const latencyDegradationRatio = safeRatio(
    candidate.request_p95_ms - baseline.request_p95_ms,
    baselineLatencyBase
  );
  const throughputDropRatio = safeRatio(
    baseline.throughput_rps - candidate.throughput_rps,
    baselineThroughputBase
  );

  const report = {
    schema_version: "g2_token_auto_retry_performance_report.v1",
    generated_at: new Date().toISOString(),
    source: {
      input_path: resolvePath(source.inputPath, SIDECAR_ROOT),
      source_schema_version: normalizeString(snapshot.schema_version),
      generated_at: normalizeString(snapshot.generated_at),
    },
    baseline,
    candidate,
    recovery: {
      attempt_total: toNonNegativeNumber(
        snapshot.recovery && snapshot.recovery.attempt_total,
        0
      ),
      duration_p50_ms: toNonNegativeNumber(recoveryDuration.p50, 0),
      duration_p95_ms: toNonNegativeNumber(recoveryDuration.p95, 0),
    },
    regression: {
      latency_degradation_ratio: latencyDegradationRatio,
      throughput_drop_ratio: throughputDropRatio,
      avg_latency_delta_ms: Number(
        (candidate.request_avg_ms - baseline.request_avg_ms).toFixed(6)
      ),
      p95_latency_delta_ms: Number(
        (candidate.request_p95_ms - baseline.request_p95_ms).toFixed(6)
      ),
      throughput_delta_rps: Number(
        (candidate.throughput_rps - baseline.throughput_rps).toFixed(6)
      ),
    },
    thresholds: {
      max_latency_degradation_ratio: Number(source.maxLatencyDegradationRatio),
      max_throughput_drop_ratio: Number(source.maxThroughputDropRatio),
      max_recovery_duration_p95_ms: Number(source.maxRecoveryDurationP95Ms),
      min_baseline_latency_ms: Number(source.minBaselineLatencyMs),
      min_baseline_throughput_rps: Number(source.minBaselineThroughputRps),
    },
    checks: [],
    all_passed: false,
    fuse_recommendation: {
      fuse_required: false,
      reason_codes: [],
      action: "keep_auto_retry_execute",
      mode_after_fuse: "auto_retry_execute",
      one_click_switch: {
        env_name: "TOKEN_AUTO_RETRY_ENABLED",
        target_value: "false",
      },
      recovery_suggestion: "continue_observability_gate",
    },
  };

  report.checks = buildChecks(report, source);
  report.all_passed = report.checks.every((item) => item.pass === true);

  if (report.all_passed !== true) {
    report.fuse_recommendation = {
      fuse_required: true,
      reason_codes: report.checks
        .filter((item) => item.pass !== true)
        .map((item) => item.id),
      action: "disable_token_auto_retry_execute",
      mode_after_fuse: "guidance_only",
      one_click_switch: {
        env_name: "TOKEN_AUTO_RETRY_ENABLED",
        target_value: "false",
      },
      recovery_suggestion:
        "keep TOKEN_AUTO_RETRY_SHADOW_ENABLED=true and inspect observability report",
    };
  }

  return report;
}

function writeReport(report, outputPath) {
  const filePath = resolvePath(outputPath, SIDECAR_ROOT);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function runCli(argv) {
  const options = parseArgs(argv);
  const snapshot = readJsonOrThrow(options.inputPath);
  const report = buildPerformanceReport({
    ...options,
    snapshot,
  });
  const outputPath = writeReport(report, options.outputPath);

  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-auto-retry-perf] input=${resolvePath(options.inputPath, SIDECAR_ROOT)}`
  );
  // eslint-disable-next-line no-console
  console.log(`[g2-token-auto-retry-perf] output=${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-auto-retry-perf] latency_degradation_ratio=${report.regression.latency_degradation_ratio} throughput_drop_ratio=${report.regression.throughput_drop_ratio} recovery_duration_p95_ms=${report.recovery.duration_p95_ms} all_passed=${report.all_passed}`
  );

  if (options.ci && report.all_passed !== true) {
    const failedChecks = report.checks
      .filter((item) => item.pass !== true)
      .map((item) => item.id)
      .join(", ");
    throw new Error(
      `G2 auto-retry performance checks failed: ${failedChecks || "unknown"}`
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
    console.error(`[g2-token-auto-retry-perf] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  buildPerformanceReport,
  runCli,
};

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  "scripts",
  "g2-token-auto-retry-observability-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g2-token-auto-retry-observability-report.json"
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

function toNonNegativeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Math.floor(Number(fallback) || 0);
  }
  return Math.floor(n);
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
    minSuccessRate: 0.85,
    maxFailRate: 0.2,
    maxBlockedRate: 0.35,
    maxDurationP95Ms: 3000,
    maxMisfireTotal: 0,
    maxDuplicateReplayTotal: 0,
    topBlockedReasons: 5,
    gitCommit: "",
    timestamp: "",
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
    if (token === "--min-success-rate" && index + 1 < args.length) {
      input.minSuccessRate = toUnitNumber(args[index + 1], input.minSuccessRate);
      index += 1;
      continue;
    }
    if (token === "--max-fail-rate" && index + 1 < args.length) {
      input.maxFailRate = toUnitNumber(args[index + 1], input.maxFailRate);
      index += 1;
      continue;
    }
    if (token === "--max-blocked-rate" && index + 1 < args.length) {
      input.maxBlockedRate = toUnitNumber(args[index + 1], input.maxBlockedRate);
      index += 1;
      continue;
    }
    if (token === "--max-duration-p95-ms" && index + 1 < args.length) {
      input.maxDurationP95Ms = toNonNegativeInteger(
        args[index + 1],
        input.maxDurationP95Ms
      );
      index += 1;
      continue;
    }
    if (token === "--max-misfire-total" && index + 1 < args.length) {
      input.maxMisfireTotal = toNonNegativeInteger(
        args[index + 1],
        input.maxMisfireTotal
      );
      index += 1;
      continue;
    }
    if (token === "--max-duplicate-replay-total" && index + 1 < args.length) {
      input.maxDuplicateReplayTotal = toNonNegativeInteger(
        args[index + 1],
        input.maxDuplicateReplayTotal
      );
      index += 1;
      continue;
    }
    if (token === "--top-blocked-reasons" && index + 1 < args.length) {
      input.topBlockedReasons = Math.max(
        1,
        toNonNegativeInteger(args[index + 1], input.topBlockedReasons)
      );
      index += 1;
      continue;
    }
    if (token === "--git-commit" && index + 1 < args.length) {
      input.gitCommit = normalizeString(args[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--timestamp" && index + 1 < args.length) {
      input.timestamp = normalizeString(args[index + 1]);
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

function detectGitCommit() {
  try {
    return childProcess
      .execSync("git rev-parse HEAD", {
        cwd: path.resolve(SIDECAR_ROOT, ".."),
        stdio: ["ignore", "pipe", "ignore"],
      })
      .toString("utf8")
      .trim();
  } catch (_error) {
    return "";
  }
}

function readJsonOrThrow(filePath) {
  const absolutePath = resolvePath(filePath, SIDECAR_ROOT);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error(`auto-retry observability input file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`auto-retry observability input file is empty: ${absolutePath}`);
  }
  const normalizedRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalizedRaw);
}

function normalizeCounterMap(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const output = {};
  for (const [key, total] of Object.entries(source)) {
    const normalizedKey = normalizeString(key) || "unknown";
    output[normalizedKey] = toNonNegativeInteger(total, 0);
  }
  return output;
}

function rankingFromCounterMap(mapValue, topN) {
  return Object.entries(normalizeCounterMap(mapValue))
    .map(([name, total]) => ({ name, total }))
    .filter((item) => item.total > 0)
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return String(a.name).localeCompare(String(b.name));
    })
    .slice(0, Math.max(1, toNonNegativeInteger(topN, 5)));
}

function buildChecks(report, options) {
  const checks = [];
  checks.push({
    id: "recovery_attempt_exists",
    pass: report.metrics.attempt_total > 0,
    threshold: ">0",
    current: report.metrics.attempt_total,
    details: `attempt_total=${report.metrics.attempt_total}`,
  });
  checks.push({
    id: "success_rate",
    pass: report.metrics.success_rate >= Number(options.minSuccessRate),
    threshold: Number(options.minSuccessRate),
    current: report.metrics.success_rate,
    details: `success_rate=${report.metrics.success_rate}`,
  });
  checks.push({
    id: "fail_rate",
    pass: report.metrics.fail_rate <= Number(options.maxFailRate),
    threshold: Number(options.maxFailRate),
    current: report.metrics.fail_rate,
    details: `fail_rate=${report.metrics.fail_rate}`,
  });
  checks.push({
    id: "blocked_rate",
    pass: report.metrics.blocked_rate <= Number(options.maxBlockedRate),
    threshold: Number(options.maxBlockedRate),
    current: report.metrics.blocked_rate,
    details: `blocked_rate=${report.metrics.blocked_rate}`,
  });
  checks.push({
    id: "duration_p95_ms",
    pass: report.metrics.duration_p95_ms <= Number(options.maxDurationP95Ms),
    threshold: Number(options.maxDurationP95Ms),
    current: report.metrics.duration_p95_ms,
    details: `duration_p95_ms=${report.metrics.duration_p95_ms}`,
  });
  checks.push({
    id: "misfire_total",
    pass: report.metrics.misfire_total <= toNonNegativeInteger(options.maxMisfireTotal, 0),
    threshold: toNonNegativeInteger(options.maxMisfireTotal, 0),
    current: report.metrics.misfire_total,
    details: `misfire_total=${report.metrics.misfire_total}`,
  });
  checks.push({
    id: "duplicate_replay_total",
    pass:
      report.metrics.duplicate_replay_total <=
      toNonNegativeInteger(options.maxDuplicateReplayTotal, 0),
    threshold: toNonNegativeInteger(options.maxDuplicateReplayTotal, 0),
    current: report.metrics.duplicate_replay_total,
    details: `duplicate_replay_total=${report.metrics.duplicate_replay_total}`,
  });
  return checks;
}

function buildObservabilityReport(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const snapshot = source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
  const totals = snapshot.totals && typeof snapshot.totals === "object" ? snapshot.totals : {};
  const rates = snapshot.rates && typeof snapshot.rates === "object" ? snapshot.rates : {};
  const duration = snapshot.duration_ms && typeof snapshot.duration_ms === "object" ? snapshot.duration_ms : {};

  const attemptTotal = toNonNegativeInteger(totals.attempt_total, 0);
  const successTotal = toNonNegativeInteger(totals.success_total, 0);
  const failTotal = toNonNegativeInteger(totals.fail_total, 0);
  const blockedTotal = toNonNegativeInteger(totals.blocked_total, 0);
  const decisionTotal = attemptTotal + blockedTotal;

  const blockedByReason = normalizeCounterMap(snapshot.blocked_by_reason);
  const failByReason = normalizeCounterMap(snapshot.fail_by_reason);
  const triggeredByTool = normalizeCounterMap(snapshot.triggered_by_tool);

  const misfireTotal =
    toNonNegativeInteger(blockedByReason.error_code_not_drift, 0) +
    toNonNegativeInteger(blockedByReason.drift_recovery_disabled, 0);
  const duplicateReplayTotal = toNonNegativeInteger(
    blockedByReason.idempotency_conflict,
    0
  );

  const report = {
    schema_version: "g2_token_auto_retry_observability_report.v1",
    generated_at: new Date().toISOString(),
    source: {
      input_path: resolvePath(source.inputPath, SIDECAR_ROOT),
      source_schema_version: normalizeString(snapshot.schema_version),
      git_commit:
        normalizeString(source.gitCommit) ||
        normalizeString(snapshot.git_commit) ||
        process.env.GIT_COMMIT ||
        detectGitCommit(),
      timestamp:
        normalizeString(source.timestamp) ||
        normalizeString(snapshot.generated_at) ||
        new Date().toISOString(),
      auto_retry_enabled: snapshot.auto_retry_enabled === true,
    },
    metrics: {
      attempt_total: attemptTotal,
      success_total: successTotal,
      fail_total: failTotal,
      blocked_total: blockedTotal,
      decision_total: decisionTotal,
      success_rate:
        Number.isFinite(Number(rates.success_rate)) && Number(rates.success_rate) >= 0
          ? Number(rates.success_rate)
          : safeRatio(successTotal, attemptTotal),
      fail_rate:
        Number.isFinite(Number(rates.fail_rate)) && Number(rates.fail_rate) >= 0
          ? Number(rates.fail_rate)
          : safeRatio(failTotal, attemptTotal),
      blocked_rate: safeRatio(blockedTotal, decisionTotal),
      duration_p50_ms: toNonNegativeInteger(duration.p50, 0),
      duration_p95_ms: toNonNegativeInteger(duration.p95, 0),
      misfire_total: misfireTotal,
      duplicate_replay_total: duplicateReplayTotal,
    },
    blocked_reasons_topn: rankingFromCounterMap(blockedByReason, source.topBlockedReasons),
    fail_reasons_topn: rankingFromCounterMap(failByReason, source.topBlockedReasons),
    triggered_tools_topn: rankingFromCounterMap(triggeredByTool, source.topBlockedReasons),
    checks: [],
    all_passed: false,
    fallback_recommendation: {
      fallback_required: false,
      fallback_mode: "auto_retry_execute",
      reason_codes: [],
      one_click_switch: {
        env_name: "TOKEN_AUTO_RETRY_ENABLED",
        target_value: "false",
      },
      suggested_action: "keep_auto_retry_execute",
    },
  };

  report.checks = buildChecks(report, source);
  report.all_passed = report.checks.every((item) => item.pass === true);

  if (report.all_passed !== true) {
    report.fallback_recommendation = {
      fallback_required: true,
      fallback_mode: "guidance_only",
      reason_codes: report.checks
        .filter((item) => item.pass !== true)
        .map((item) => item.id),
      one_click_switch: {
        env_name: "TOKEN_AUTO_RETRY_ENABLED",
        target_value: "false",
      },
      suggested_action:
        "disable_token_auto_retry_execute_and_keep_structured_guidance",
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
  const report = buildObservabilityReport({
    ...options,
    snapshot,
  });
  const outputPath = writeReport(report, options.outputPath);

  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-auto-retry-observability] input=${resolvePath(options.inputPath, SIDECAR_ROOT)}`
  );
  // eslint-disable-next-line no-console
  console.log(`[g2-token-auto-retry-observability] output=${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-auto-retry-observability] success_rate=${report.metrics.success_rate} blocked_rate=${report.metrics.blocked_rate} duration_p95_ms=${report.metrics.duration_p95_ms} all_passed=${report.all_passed}`
  );

  if (options.ci && report.all_passed !== true) {
    const failedChecks = report.checks
      .filter((item) => item.pass !== true)
      .map((item) => item.id)
      .join(", ");
    throw new Error(
      `G2 auto-retry observability checks failed: ${failedChecks || "unknown"}`
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
    console.error(`[g2-token-auto-retry-observability] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  buildObservabilityReport,
  runCli,
};

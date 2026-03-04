#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "r20-ux-governance-baseline-report.json"
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

function parseArgs(argv) {
  const options = {
    beforePath: "",
    afterPath: "",
    outputPath: DEFAULT_OUTPUT_PATH,
  };
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if ((token === "--before" || token === "-b") && i + 1 < args.length) {
      options.beforePath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if ((token === "--after" || token === "-a") && i + 1 < args.length) {
      options.afterPath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if ((token === "--output" || token === "-o") && i + 1 < args.length) {
      options.outputPath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
  }
  return options;
}

function toCounter(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function toRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Number(n.toFixed(6));
}

function safeDivide(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number((n / d).toFixed(6));
}

function readJsonFileOrThrow(filePath) {
  const absolutePath = resolvePath(filePath, SIDECAR_ROOT);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error(`Metrics snapshot file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`Metrics snapshot file is empty: ${absolutePath}`);
  }
  return JSON.parse(raw);
}

function summarizeGovernanceSnapshot(snapshot, sourcePath) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  const governance =
    source.r20_protocol_governance && typeof source.r20_protocol_governance === "object"
      ? source.r20_protocol_governance
      : {};
  const governanceCounters =
    governance.counters && typeof governance.counters === "object"
      ? governance.counters
      : {};
  const governanceDerived =
    governance.derived && typeof governance.derived === "object"
      ? governance.derived
      : {};
  const v1Polish =
    source.v1_polish_metrics && typeof source.v1_polish_metrics === "object"
      ? source.v1_polish_metrics
      : {};
  const v1Counters =
    v1Polish.counters && typeof v1Polish.counters === "object"
      ? v1Polish.counters
      : {};

  const retryFuseBlockedTotal = toCounter(
    governanceCounters.retry_fuse_blocked_total
  );
  const retryFuseFailuresTotal = toCounter(
    governanceCounters.retry_fuse_failure_recorded_total
  );
  const retryFuseSuccessTotal = toCounter(
    governanceCounters.retry_fuse_success_recorded_total
  );
  const writeToolCallsTotal = toCounter(governanceCounters.write_tool_calls_total);

  const statusQueryCalls = toCounter(source.status_query_calls);
  const lockReleaseTotal = toCounter(source.lock_release_total);
  const autoCancelTotal = toCounter(source.auto_cancel_total);
  const autoCancelMaxRuntimeTotal = toCounter(
    source.auto_cancel_max_runtime_total
  );

  const readTokenChecksTotal = toCounter(v1Counters.read_token_checks_total);
  const readTokenExpiryTotal = toCounter(v1Counters.read_token_expiry_total);

  return {
    source_file: sourcePath,
    captured_at:
      (source && typeof source.timestamp === "string" && source.timestamp) ||
      new Date().toISOString(),
    retry: {
      write_tool_calls_total: writeToolCallsTotal,
      retry_fuse_blocked_total: retryFuseBlockedTotal,
      retry_fuse_failure_recorded_total: retryFuseFailuresTotal,
      retry_fuse_success_recorded_total: retryFuseSuccessTotal,
      duplicate_retry_block_rate:
        governanceDerived.duplicate_retry_block_rate !== undefined
          ? toRatio(governanceDerived.duplicate_retry_block_rate)
          : safeDivide(retryFuseBlockedTotal, Math.max(writeToolCallsTotal, 1)),
    },
    convergence: {
      status_query_calls: statusQueryCalls,
      lock_release_total: lockReleaseTotal,
      avg_status_queries_per_terminal_job:
        governanceDerived.avg_status_queries_per_terminal_job !== undefined
          ? toRatio(governanceDerived.avg_status_queries_per_terminal_job)
          : safeDivide(statusQueryCalls, Math.max(lockReleaseTotal, 1)),
    },
    timeout: {
      auto_cancel_total: autoCancelTotal,
      auto_cancel_max_runtime_total: autoCancelMaxRuntimeTotal,
      max_runtime_timeout_rate:
        governanceDerived.max_runtime_timeout_rate !== undefined
          ? toRatio(governanceDerived.max_runtime_timeout_rate)
          : safeDivide(autoCancelMaxRuntimeTotal, Math.max(autoCancelTotal, 1)),
    },
    token: {
      read_token_checks_total: readTokenChecksTotal,
      read_token_expiry_total: readTokenExpiryTotal,
      read_token_expiry_rate:
        governanceDerived.read_token_expiry_rate !== undefined
          ? toRatio(governanceDerived.read_token_expiry_rate)
          : safeDivide(readTokenExpiryTotal, Math.max(readTokenChecksTotal, 1)),
    },
    preflight: {
      preflight_calls_total: toCounter(governanceCounters.preflight_calls_total),
      preflight_valid_total: toCounter(governanceCounters.preflight_valid_total),
      preflight_invalid_total: toCounter(
        governanceCounters.preflight_invalid_total
      ),
      preflight_blocking_error_total: toCounter(
        governanceCounters.preflight_blocking_error_total
      ),
      preflight_invalid_rate:
        governanceDerived.preflight_invalid_rate !== undefined
          ? toRatio(governanceDerived.preflight_invalid_rate)
          : safeDivide(
              toCounter(governanceCounters.preflight_invalid_total),
              Math.max(toCounter(governanceCounters.preflight_calls_total), 1)
            ),
      dry_run_alias_calls_total: toCounter(
        governanceCounters.dry_run_alias_calls_total
      ),
      dry_run_alias_usage_rate:
        governanceDerived.dry_run_alias_usage_rate !== undefined
          ? toRatio(governanceDerived.dry_run_alias_usage_rate)
          : safeDivide(
              toCounter(governanceCounters.dry_run_alias_calls_total),
              Math.max(writeToolCallsTotal, 1)
            ),
    },
  };
}

function buildNumericComparison(beforeValue, afterValue) {
  const beforeNumber = Number(beforeValue);
  const afterNumber = Number(afterValue);
  if (!Number.isFinite(beforeNumber) || !Number.isFinite(afterNumber)) {
    return null;
  }
  const delta = Number((afterNumber - beforeNumber).toFixed(6));
  const deltaPct =
    beforeNumber !== 0
      ? Number((((afterNumber - beforeNumber) / Math.abs(beforeNumber)) * 100).toFixed(3))
      : null;
  return {
    before: Number(beforeNumber.toFixed(6)),
    after: Number(afterNumber.toFixed(6)),
    delta,
    delta_pct: deltaPct,
  };
}

function buildBeforeAfterComparison(beforeSummary, afterSummary) {
  if (!afterSummary) {
    return null;
  }
  return {
    retry_fuse_blocked_total: buildNumericComparison(
      beforeSummary.retry.retry_fuse_blocked_total,
      afterSummary.retry.retry_fuse_blocked_total
    ),
    duplicate_retry_block_rate: buildNumericComparison(
      beforeSummary.retry.duplicate_retry_block_rate,
      afterSummary.retry.duplicate_retry_block_rate
    ),
    avg_status_queries_per_terminal_job: buildNumericComparison(
      beforeSummary.convergence.avg_status_queries_per_terminal_job,
      afterSummary.convergence.avg_status_queries_per_terminal_job
    ),
    max_runtime_timeout_rate: buildNumericComparison(
      beforeSummary.timeout.max_runtime_timeout_rate,
      afterSummary.timeout.max_runtime_timeout_rate
    ),
    read_token_expiry_rate: buildNumericComparison(
      beforeSummary.token.read_token_expiry_rate,
      afterSummary.token.read_token_expiry_rate
    ),
    preflight_invalid_rate: buildNumericComparison(
      beforeSummary.preflight.preflight_invalid_rate,
      afterSummary.preflight.preflight_invalid_rate
    ),
    dry_run_alias_usage_rate: buildNumericComparison(
      beforeSummary.preflight.dry_run_alias_usage_rate,
      afterSummary.preflight.dry_run_alias_usage_rate
    ),
  };
}

function buildGovernanceBaselineReport(input) {
  const opts = input && typeof input === "object" ? input : {};
  const beforeSnapshot = opts.beforeSnapshot || {};
  const afterSnapshot = opts.afterSnapshot || null;
  const beforePath = resolvePath(opts.beforePath, SIDECAR_ROOT);
  const afterPath = resolvePath(opts.afterPath, SIDECAR_ROOT);
  const beforeSummary = summarizeGovernanceSnapshot(beforeSnapshot, beforePath);
  const afterSummary = afterSnapshot
    ? summarizeGovernanceSnapshot(afterSnapshot, afterPath)
    : null;

  return {
    schema_version: "r20_ux_governance_baseline_report.v1",
    generated_at: new Date().toISOString(),
    source: {
      before_metrics_path: beforePath,
      after_metrics_path: afterSummary ? afterPath : "",
    },
    before: beforeSummary,
    after: afterSummary,
    comparison: buildBeforeAfterComparison(beforeSummary, afterSummary),
  };
}

function writeJsonReport(report, outputPath) {
  const target = resolvePath(outputPath, SIDECAR_ROOT);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(report, null, 2), "utf8");
  return target;
}

function runCli(argv) {
  const options = parseArgs(argv);
  if (!options.beforePath) {
    throw new Error("Missing required --before <metrics.json> argument");
  }
  const beforeSnapshot = readJsonFileOrThrow(options.beforePath);
  const afterSnapshot = options.afterPath
    ? readJsonFileOrThrow(options.afterPath)
    : null;
  const report = buildGovernanceBaselineReport({
    beforeSnapshot,
    afterSnapshot,
    beforePath: options.beforePath,
    afterPath: options.afterPath,
  });
  const outputPath = writeJsonReport(report, options.outputPath);
  // eslint-disable-next-line no-console
  console.log(`[r20-governance] before=${resolvePath(options.beforePath, SIDECAR_ROOT)}`);
  if (options.afterPath) {
    // eslint-disable-next-line no-console
    console.log(`[r20-governance] after=${resolvePath(options.afterPath, SIDECAR_ROOT)}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[r20-governance] report=${outputPath}`);
  return { report, outputPath };
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error || "");
    // eslint-disable-next-line no-console
    console.error(`[r20-governance] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  summarizeGovernanceSnapshot,
  buildGovernanceBaselineReport,
  runCli,
  resolvePath,
};

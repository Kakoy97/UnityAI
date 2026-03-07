#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");

const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  "scripts",
  "g2-token-auto-issue-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g2-token-auto-issue-observability-report.json"
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

function safeRatio(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number((n / d).toFixed(6));
}

function toNonNegativeInteger(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return Math.floor(Number(fallback) || 0);
  }
  return Math.floor(n);
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const input = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    minContinuationHitRate: 0.9,
    minRedactionHitRate: 0.95,
    maxAnomalyCount: 0,
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
    if (token === "--min-continuation-hit-rate" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n >= 0 && n <= 1) {
        input.minContinuationHitRate = n;
      }
      index += 1;
      continue;
    }
    if (token === "--min-redaction-hit-rate" && index + 1 < args.length) {
      const n = Number(args[index + 1]);
      if (Number.isFinite(n) && n >= 0 && n <= 1) {
        input.minRedactionHitRate = n;
      }
      index += 1;
      continue;
    }
    if (token === "--max-anomaly-count" && index + 1 < args.length) {
      input.maxAnomalyCount = toNonNegativeInteger(args[index + 1], 0);
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
    throw new Error(`Auto-issue samples file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`Auto-issue samples file is empty: ${absolutePath}`);
  }
  const normalizedRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalizedRaw);
}

function normalizeEvent(rawEvent, index) {
  const source = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
  return {
    sample_id:
      normalizeString(source.sample_id) || `event_${String(index + 1).padStart(4, "0")}`,
    tool_name: normalizeString(source.tool_name) || "unknown_tool",
    token_family: normalizeString(source.token_family),
    result_ok: source.result_ok === true,
    continuation_eligible_success: source.continuation_eligible_success === true,
    continuation_issued: source.continuation_issued === true,
    skipped_missing_scene_revision: source.skipped_missing_scene_revision === true,
    skipped_ineligible_policy: source.skipped_ineligible_policy === true,
    redaction_candidate: source.redaction_candidate === true,
    redaction_applied: source.redaction_applied === true,
    anomaly_code: normalizeString(source.anomaly_code),
    decision_reason: normalizeString(source.decision_reason),
    finalize_duration_ms: Number.isFinite(Number(source.finalize_duration_ms))
      ? Number(source.finalize_duration_ms)
      : null,
  };
}

function buildChecks(report, options) {
  const checks = [];
  const minContinuationHitRate = Number(options.minContinuationHitRate);
  const minRedactionHitRate = Number(options.minRedactionHitRate);
  const maxAnomalyCount = toNonNegativeInteger(options.maxAnomalyCount, 0);

  checks.push({
    id: "continuation_hit_rate",
    pass:
      report.metrics.continuation_issueable_hit_rate >= minContinuationHitRate,
    threshold: minContinuationHitRate,
    current: report.metrics.continuation_issueable_hit_rate,
    details: `continuation_issueable_hit_rate=${report.metrics.continuation_issueable_hit_rate}`,
  });
  checks.push({
    id: "redaction_hit_rate",
    pass: report.metrics.redaction_hit_rate >= minRedactionHitRate,
    threshold: minRedactionHitRate,
    current: report.metrics.redaction_hit_rate,
    details: `redaction_hit_rate=${report.metrics.redaction_hit_rate}`,
  });
  checks.push({
    id: "anomaly_count",
    pass: report.metrics.anomaly_total <= maxAnomalyCount,
    threshold: maxAnomalyCount,
    current: report.metrics.anomaly_total,
    details: `anomaly_total=${report.metrics.anomaly_total}`,
  });
  return checks;
}

function buildObservabilityReport(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const snapshot = source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
  const rawEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
  const events = rawEvents.map((event, index) => normalizeEvent(event, index));

  let continuationEligibleSuccessTotal = 0;
  let continuationIssuedTotal = 0;
  let continuationSkippedMissingSceneRevisionTotal = 0;
  let redactionCandidatesTotal = 0;
  let redactionAppliedTotal = 0;
  let anomalyTotal = 0;
  let finalizeDurationTotal = 0;
  let finalizeDurationCount = 0;
  const anomalySamples = [];
  const byTool = {};

  for (const event of events) {
    if (!byTool[event.tool_name]) {
      byTool[event.tool_name] = {
        tool_name: event.tool_name,
        events_total: 0,
        continuation_eligible_success_total: 0,
        continuation_issued_total: 0,
        redaction_candidates_total: 0,
        redaction_applied_total: 0,
        anomaly_total: 0,
      };
    }
    const tool = byTool[event.tool_name];
    tool.events_total += 1;

    if (event.continuation_eligible_success) {
      continuationEligibleSuccessTotal += 1;
      tool.continuation_eligible_success_total += 1;
    }
    if (event.continuation_issued) {
      continuationIssuedTotal += 1;
      tool.continuation_issued_total += 1;
    }
    if (event.skipped_missing_scene_revision) {
      continuationSkippedMissingSceneRevisionTotal += 1;
    }
    if (event.redaction_candidate) {
      redactionCandidatesTotal += 1;
      tool.redaction_candidates_total += 1;
    }
    if (event.redaction_applied) {
      redactionAppliedTotal += 1;
      tool.redaction_applied_total += 1;
    }
    if (event.anomaly_code) {
      anomalyTotal += 1;
      tool.anomaly_total += 1;
      if (anomalySamples.length < 32) {
        anomalySamples.push({
          sample_id: event.sample_id,
          tool_name: event.tool_name,
          anomaly_code: event.anomaly_code,
          decision_reason: event.decision_reason,
          token_family: event.token_family,
        });
      }
    }
    if (
      Number.isFinite(Number(event.finalize_duration_ms)) &&
      Number(event.finalize_duration_ms) >= 0
    ) {
      finalizeDurationTotal += Number(event.finalize_duration_ms);
      finalizeDurationCount += 1;
    }
  }

  const report = {
    schema_version: "g2_token_auto_issue_observability_report.v1",
    generated_at: new Date().toISOString(),
    source: {
      input_path: resolvePath(source.inputPath, SIDECAR_ROOT),
      source_schema_version:
        typeof snapshot.schema_version === "string" ? snapshot.schema_version : "",
      git_commit:
        source.gitCommit ||
        snapshot.git_commit ||
        process.env.GIT_COMMIT ||
        detectGitCommit(),
      timestamp:
        source.timestamp ||
        snapshot.timestamp ||
        snapshot.generated_at ||
        new Date().toISOString(),
      sample_total: events.length,
    },
    metrics: {
      continuation_eligible_success_total: continuationEligibleSuccessTotal,
      continuation_issued_total: continuationIssuedTotal,
      continuation_skipped_missing_scene_revision_total:
        continuationSkippedMissingSceneRevisionTotal,
      continuation_hit_rate: safeRatio(
        continuationIssuedTotal,
        continuationEligibleSuccessTotal
      ),
      continuation_issueable_total: Math.max(
        0,
        continuationEligibleSuccessTotal - continuationSkippedMissingSceneRevisionTotal
      ),
      continuation_issueable_hit_rate: safeRatio(
        continuationIssuedTotal,
        Math.max(
          0,
          continuationEligibleSuccessTotal -
            continuationSkippedMissingSceneRevisionTotal
        )
      ),
      redaction_candidates_total: redactionCandidatesTotal,
      redaction_applied_total: redactionAppliedTotal,
      redaction_hit_rate: safeRatio(redactionAppliedTotal, redactionCandidatesTotal),
      anomaly_total: anomalyTotal,
      finalize_duration_avg_ms: safeRatio(
        finalizeDurationTotal,
        finalizeDurationCount
      ),
      finalize_duration_samples: finalizeDurationCount,
    },
    by_tool: Object.values(byTool)
      .map((item) => ({
        ...item,
        continuation_hit_rate: safeRatio(
          item.continuation_issued_total,
          item.continuation_eligible_success_total
        ),
        redaction_hit_rate: safeRatio(
          item.redaction_applied_total,
          item.redaction_candidates_total
        ),
      }))
      .sort((a, b) => {
        if (b.events_total !== a.events_total) {
          return b.events_total - a.events_total;
        }
        return String(a.tool_name).localeCompare(String(b.tool_name));
      }),
    anomaly_samples: anomalySamples,
    checks: [],
  };

  report.checks = buildChecks(report, source);
  report.all_passed = report.checks.every((item) => item.pass === true);
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
    `[g2-token-auto-issue-observability] input=${resolvePath(options.inputPath, SIDECAR_ROOT)}`
  );
  // eslint-disable-next-line no-console
  console.log(`[g2-token-auto-issue-observability] output=${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-auto-issue-observability] continuation_hit_rate=${report.metrics.continuation_hit_rate} redaction_hit_rate=${report.metrics.redaction_hit_rate} anomalies=${report.metrics.anomaly_total}`
  );

  if (options.ci && report.all_passed !== true) {
    const failedChecks = report.checks
      .filter((item) => item.pass !== true)
      .map((item) => item.id)
      .join(", ");
    throw new Error(
      `G2 auto-issue observability checks failed: ${failedChecks || "unknown"}`
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
    console.error(`[g2-token-auto-issue-observability] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  buildObservabilityReport,
  runCli,
};

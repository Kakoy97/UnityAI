#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  "scripts",
  "g2-token-shadow-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g2-token-shadow-analysis-report.json"
);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
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
  const args = Array.isArray(argv) ? argv : [];
  const input = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    topN: 5,
    minRecoverableRate: 0.55,
    maxBlockedRate: 0.5,
    maxBlockedTotalForSafe: 20,
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
    if (token === "--top" && index + 1 < args.length) {
      input.topN = toNonNegativeInteger(args[index + 1], input.topN);
      index += 1;
      continue;
    }
    if (token === "--min-recoverable-rate" && index + 1 < args.length) {
      input.minRecoverableRate = toUnitNumber(
        args[index + 1],
        input.minRecoverableRate
      );
      index += 1;
      continue;
    }
    if (token === "--max-blocked-rate" && index + 1 < args.length) {
      input.maxBlockedRate = toUnitNumber(args[index + 1], input.maxBlockedRate);
      index += 1;
      continue;
    }
    if (token === "--max-blocked-total-for-safe" && index + 1 < args.length) {
      input.maxBlockedTotalForSafe = toNonNegativeInteger(
        args[index + 1],
        input.maxBlockedTotalForSafe
      );
      index += 1;
      continue;
    }
    if (token === "--ci") {
      input.ci = true;
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
    throw new Error(`shadow analysis input file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`shadow analysis input file is empty: ${absolutePath}`);
  }
  const normalizedRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalizedRaw);
}

function normalizeBlockedReasonRanking(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.entries(source)
    .map(([reason, total]) => ({
      reason: normalizeString(reason) || "unknown",
      total: toNonNegativeInteger(total, 0),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => {
      if (b.total !== a.total) {
        return b.total - a.total;
      }
      return String(a.reason).localeCompare(String(b.reason));
    });
}

function normalizeByToolEntries(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const source =
        item && typeof item === "object" && !Array.isArray(item) ? item : {};
      const eventsTotal = toNonNegativeInteger(source.events_total, 0);
      const driftErrorTotal = toNonNegativeInteger(source.drift_error_total, 0);
      const recoverableTotal = toNonNegativeInteger(source.recoverable_total, 0);
      const blockedTotal = toNonNegativeInteger(source.blocked_total, 0);
      return {
        tool_name: normalizeString(source.tool_name) || "unknown_tool",
        token_family: normalizeString(source.token_family),
        events_total: eventsTotal,
        drift_error_total: driftErrorTotal,
        recoverable_total: recoverableTotal,
        blocked_total: blockedTotal,
        recoverable_rate:
          Number.isFinite(Number(source.recoverable_rate)) &&
          Number(source.recoverable_rate) >= 0
            ? Number(source.recoverable_rate)
            : safeRatio(recoverableTotal, driftErrorTotal),
        blocked_rate: safeRatio(blockedTotal, eventsTotal),
      };
    })
    .filter((item) => item.events_total > 0);
}

function normalizePolicyLimits(value) {
  const source =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    snapshot_refresh_timeout_ms: toNonNegativeInteger(
      source.snapshot_refresh_timeout_ms,
      2000
    ),
    retry_dispatch_timeout_ms: toNonNegativeInteger(
      source.retry_dispatch_timeout_ms,
      5000
    ),
    total_recovery_timeout_ms: toNonNegativeInteger(
      source.total_recovery_timeout_ms,
      8000
    ),
    max_global_recovery_tasks: toNonNegativeInteger(
      source.max_global_recovery_tasks,
      10
    ),
    max_session_recovery_tasks: toNonNegativeInteger(
      source.max_session_recovery_tasks,
      1
    ),
    max_tool_recovery_tasks: toNonNegativeInteger(
      source.max_tool_recovery_tasks,
      1
    ),
    max_recovery_queue_size: toNonNegativeInteger(
      source.max_recovery_queue_size,
      10
    ),
  };
}

function buildFamilyStats(byToolEntries) {
  const map = new Map();
  for (const item of byToolEntries) {
    const family = normalizeString(item.token_family) || "unknown_family";
    if (!map.has(family)) {
      map.set(family, {
        token_family: family,
        tools_total: 0,
        events_total: 0,
        drift_error_total: 0,
        recoverable_total: 0,
        blocked_total: 0,
      });
    }
    const row = map.get(family);
    row.tools_total += 1;
    row.events_total += item.events_total;
    row.drift_error_total += item.drift_error_total;
    row.recoverable_total += item.recoverable_total;
    row.blocked_total += item.blocked_total;
  }
  return Array.from(map.values())
    .map((item) => ({
      ...item,
      recoverable_rate: safeRatio(item.recoverable_total, item.drift_error_total),
      blocked_rate: safeRatio(item.blocked_total, item.events_total),
    }))
    .sort((a, b) => {
      if (b.events_total !== a.events_total) {
        return b.events_total - a.events_total;
      }
      return String(a.token_family).localeCompare(String(b.token_family));
    });
}

function buildShadowAnalysisReport(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const snapshot =
    source.snapshot && typeof source.snapshot === "object" ? source.snapshot : {};
  const topN = Math.max(1, toNonNegativeInteger(source.topN, 5));
  const minRecoverableRate = toUnitNumber(source.minRecoverableRate, 0.6);
  const maxBlockedRate = toUnitNumber(source.maxBlockedRate, 0.4);
  const maxBlockedTotalForSafe = toNonNegativeInteger(
    source.maxBlockedTotalForSafe,
    5
  );

  const totals =
    snapshot.totals && typeof snapshot.totals === "object" ? snapshot.totals : {};
  const eventsTotal = toNonNegativeInteger(totals.events_total, 0);
  const driftErrorTotal = toNonNegativeInteger(totals.drift_error_total, 0);
  const recoverableTotal = toNonNegativeInteger(totals.recoverable_total, 0);
  const blockedTotal = toNonNegativeInteger(totals.blocked_total, 0);
  const blockedReasonRanking = normalizeBlockedReasonRanking(
    snapshot.blocked_by_reason
  );
  const byTool = normalizeByToolEntries(snapshot.by_tool);
  const familyStats = buildFamilyStats(byTool);

  const highRiskTools = byTool
    .map((item) => {
      const blockedRate = safeRatio(item.blocked_total, item.events_total);
      const nonRecoverableRate = Number((1 - item.recoverable_rate).toFixed(6));
      const driftShare = safeRatio(item.drift_error_total, driftErrorTotal);
      const riskScore = Number(
        (blockedRate * 0.6 + nonRecoverableRate * 0.3 + driftShare * 0.1).toFixed(
          6
        )
      );
      return {
        ...item,
        blocked_rate: blockedRate,
        drift_share: driftShare,
        risk_score: riskScore,
      };
    })
    .sort((a, b) => {
      if (b.risk_score !== a.risk_score) {
        return b.risk_score - a.risk_score;
      }
      return String(a.tool_name).localeCompare(String(b.tool_name));
    })
    .slice(0, topN);

  const safeFamilyKeep = [];
  const safeFamilyDrop = [];
  for (const family of familyStats) {
    if (family.token_family === "unknown_family") {
      continue;
    }
    const familyPasses =
      family.recoverable_rate >= minRecoverableRate &&
      family.blocked_rate <= maxBlockedRate &&
      family.blocked_total <= maxBlockedTotalForSafe;
    if (familyPasses) {
      safeFamilyKeep.push(family.token_family);
    } else {
      safeFamilyDrop.push(family.token_family);
    }
  }

  const policyLimits = normalizePolicyLimits(snapshot.policy_limits);

  const checks = [
    {
      id: "has_shadow_events",
      pass: eventsTotal > 0,
      threshold: ">0",
      current: eventsTotal,
      details: `events_total=${eventsTotal}`,
    },
    {
      id: "blocked_reason_coverage",
      pass:
        blockedTotal <= 0
          ? true
          : blockedReasonRanking.length > 0 &&
            blockedReasonRanking.reduce((acc, item) => acc + item.total, 0) >=
              blockedTotal,
      threshold: "ranked_reasons>=blocked_total",
      current: blockedReasonRanking.reduce((acc, item) => acc + item.total, 0),
      details: `blocked_total=${blockedTotal}`,
    },
    {
      id: "high_risk_tools_identified",
      pass: highRiskTools.length > 0,
      threshold: ">0",
      current: highRiskTools.length,
      details: `topN=${topN}`,
    },
    {
      id: "policy_limits_ready",
      pass:
        policyLimits.total_recovery_timeout_ms > 0 &&
        policyLimits.max_global_recovery_tasks > 0 &&
        policyLimits.max_session_recovery_tasks > 0 &&
        policyLimits.max_tool_recovery_tasks > 0 &&
        policyLimits.max_recovery_queue_size > 0,
      threshold: "all_limits>0",
      current: policyLimits,
      details: "timeout and concurrency limits must be configured",
    },
    {
      id: "safe_family_convergence_ready",
      pass: safeFamilyKeep.length > 0,
      threshold: ">0 keep families",
      current: safeFamilyKeep.length,
      details: `family_stats=${familyStats.length}`,
    },
  ];

  return {
    schema_version: "g2_token_shadow_analysis_report.v1",
    generated_at: new Date().toISOString(),
    source: {
      input_path: resolvePath(source.inputPath, SIDECAR_ROOT),
      source_schema_version: normalizeString(snapshot.schema_version),
      git_commit: source.gitCommit || detectGitCommit(),
      top_n: topN,
    },
    metrics: {
      events_total: eventsTotal,
      drift_error_total: driftErrorTotal,
      recoverable_total: recoverableTotal,
      blocked_total: blockedTotal,
      trigger_rate: safeRatio(driftErrorTotal, eventsTotal),
      recoverable_rate: safeRatio(recoverableTotal, driftErrorTotal),
    },
    blocked_reasons_topn: blockedReasonRanking.slice(0, topN),
    high_risk_tools_topn: highRiskTools,
    family_stats: familyStats,
    convergence: {
      proposed_auto_retry_safe_family_keep: safeFamilyKeep,
      proposed_auto_retry_safe_family_drop: safeFamilyDrop,
      min_recoverable_rate: minRecoverableRate,
      max_blocked_rate: maxBlockedRate,
      max_blocked_total_for_safe: maxBlockedTotalForSafe,
      policy_limits: policyLimits,
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
  const snapshot = readJsonOrThrow(options.inputPath);
  const report = buildShadowAnalysisReport({
    ...options,
    snapshot,
  });
  const outputPath = writeReport(report, options.outputPath);
  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-shadow-analysis] input=${resolvePath(options.inputPath, SIDECAR_ROOT)}`
  );
  // eslint-disable-next-line no-console
  console.log(`[g2-token-shadow-analysis] output=${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-shadow-analysis] events=${report.metrics.events_total} recoverable_rate=${report.metrics.recoverable_rate} blocked=${report.metrics.blocked_total}`
  );
  if (options.ci && report.all_passed !== true) {
    const failedChecks = report.checks
      .filter((item) => item.pass !== true)
      .map((item) => item.id)
      .join(", ");
    throw new Error(
      `G2 shadow analysis checks failed: ${failedChecks || "unknown"}`
    );
  }
  return { report, outputPath };
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error || "");
    // eslint-disable-next-line no-console
    console.error(`[g2-token-shadow-analysis] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  buildShadowAnalysisReport,
  runCli,
};

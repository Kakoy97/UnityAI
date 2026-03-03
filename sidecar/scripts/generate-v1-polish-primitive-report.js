#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  aggregateDailyBuckets,
  OVERFLOW_PROPERTY_PATH_KEY,
} = require("../src/application/v1PolishMetricsCollector");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "v1-polish-metrics.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "v1-polish-primitive-candidates.json"
);

function parseArgs(argv) {
  const input = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    topN: 20,
    minCount: 2,
    ci: false,
  };
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if ((token === "--input" || token === "-i") && i + 1 < args.length) {
      input.inputPath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if ((token === "--output" || token === "-o") && i + 1 < args.length) {
      input.outputPath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if (token === "--top" && i + 1 < args.length) {
      input.topN = toPositiveInteger(args[i + 1], 20, 1);
      i += 1;
      continue;
    }
    if (token === "--min-count" && i + 1 < args.length) {
      input.minCount = toPositiveInteger(args[i + 1], 2, 1);
      i += 1;
      continue;
    }
    if (token === "--ci") {
      input.ci = true;
      continue;
    }
  }
  return input;
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

function toPositiveInteger(value, fallback, minValue) {
  const n = Number(value);
  const fallbackValue = Number.isFinite(Number(fallback))
    ? Math.floor(Number(fallback))
    : 1;
  const min = Number.isFinite(Number(minValue)) ? Math.floor(Number(minValue)) : 1;
  if (!Number.isFinite(n) || n < min) {
    return fallbackValue;
  }
  return Math.floor(n);
}

function readJsonOrThrow(filePath) {
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

function buildPrimitiveCandidateReport(metricsSnapshot, options) {
  const source = metricsSnapshot && typeof metricsSnapshot === "object"
    ? metricsSnapshot
    : {};
  const opts = options && typeof options === "object" ? options : {};
  const topN = toPositiveInteger(opts.topN, 20, 1);
  const minCount = toPositiveInteger(opts.minCount, 2, 1);
  const aggregate = aggregateDailyBuckets(source.daily_buckets);
  const counters = aggregate.counters || {};
  const totalSamples = Number(counters.property_path_samples_total) || 0;
  const rawFrequency =
    aggregate.property_path_frequency &&
    typeof aggregate.property_path_frequency === "object"
      ? aggregate.property_path_frequency
      : {};

  const sortedEntries = Object.entries(rawFrequency)
    .filter(([propertyPath, rawCount]) => {
      if (!propertyPath || propertyPath === OVERFLOW_PROPERTY_PATH_KEY) {
        return false;
      }
      const n = Number(rawCount);
      return Number.isFinite(n) && n >= minCount;
    })
    .map(([propertyPath, rawCount]) => ({
      property_path: String(propertyPath),
      hit_count: Math.floor(Number(rawCount)),
    }))
    .sort((a, b) => {
      if (b.hit_count !== a.hit_count) {
        return b.hit_count - a.hit_count;
      }
      return a.property_path.localeCompare(b.property_path);
    });

  const candidates = sortedEntries.slice(0, topN).map((item, index) => ({
    rank: index + 1,
    property_path: item.property_path,
    hit_count: item.hit_count,
    hit_ratio_pct:
      totalSamples > 0
        ? Number(((item.hit_count / totalSamples) * 100).toFixed(3))
        : 0,
    suggested_primitive_name: suggestPrimitiveName(item.property_path),
    rationale: "High-frequency serialized patch path across write traffic",
  }));

  return {
    schema_version: "v1_polish_primitive_candidates.v1",
    generated_at: new Date().toISOString(),
    source_metrics_schema_version:
      typeof source.schema_version === "string" ? source.schema_version : "",
    source_window_start_date:
      typeof aggregate.window_start_date === "string"
        ? aggregate.window_start_date
        : "",
    source_window_end_date:
      typeof aggregate.window_end_date === "string" ? aggregate.window_end_date : "",
    retention_days:
      Number.isFinite(Number(source.retention_days)) && Number(source.retention_days) > 0
        ? Math.floor(Number(source.retention_days))
        : 0,
    summary: {
      top_n: topN,
      min_count: minCount,
      total_property_path_samples: totalSamples,
      distinct_property_paths: Object.keys(rawFrequency).filter(
        (item) => item && item !== OVERFLOW_PROPERTY_PATH_KEY
      ).length,
      candidate_count: candidates.length,
    },
    candidates,
  };
}

function suggestPrimitiveName(propertyPath) {
  const raw = String(propertyPath || "");
  const normalized = raw
    .replace(/\.Array\.data\[\d+\]/g, "")
    .replace(/\.Array\.size/g, " array_size")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .toLowerCase();
  const compact = normalized.replace(/^m_/, "");
  if (!compact) {
    return "set_serialized_property_candidate";
  }
  const capped = compact.length > 48 ? compact.slice(0, 48) : compact;
  return `set_${capped}`;
}

function writeReport(report, outputPath) {
  const filePath = resolvePath(outputPath, SIDECAR_ROOT);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function runCli(argv) {
  const options = parseArgs(argv);
  const metrics = readJsonOrThrow(options.inputPath);
  const report = buildPrimitiveCandidateReport(metrics, options);
  const outputPath = writeReport(report, options.outputPath);
  // eslint-disable-next-line no-console
  console.log(`[v1-polish-report] source=${resolvePath(options.inputPath, SIDECAR_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`[v1-polish-report] candidates=${report.summary.candidate_count}`);
  // eslint-disable-next-line no-console
  console.log(`[v1-polish-report] report=${outputPath}`);
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
    console.error(`[v1-polish-report] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  resolvePath,
  buildPrimitiveCandidateReport,
  suggestPrimitiveName,
  runCli,
};

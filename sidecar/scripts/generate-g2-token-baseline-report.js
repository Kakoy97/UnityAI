#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DRIFT_ERROR_CODE = "E_SCENE_REVISION_DRIFT";

const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  "scripts",
  "g2-token-baseline-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g2-token-baseline-report.json"
);

const DEFAULT_REQUIRED_SCENARIO_TYPES = [
  "simple",
  "medium",
  "complex",
  "error",
  "boundary",
];

const DEFAULT_ALERT_THRESHOLDS = {
  drift_incidence_alert_threshold: 0.15,
  manual_refresh_ratio_alert_threshold: 0.7,
  auto_retry_success_alert_threshold: 0.85,
  write_chain_avg_calls_alert_threshold: 12,
};

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

function toOptionalNonNegativeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.floor(n);
}

function toOptionalBoolean(value) {
  if (value === true) {
    return true;
  }
  if (value === false) {
    return false;
  }
  return null;
}

function safeDivide(numerator, denominator) {
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) {
    return 0;
  }
  return Number((n / d).toFixed(6));
}

function toRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Number(n.toFixed(6));
}

function quantile(numbers, percentile) {
  const values = Array.isArray(numbers)
    ? numbers
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
        .sort((a, b) => a - b)
    : [];
  if (!values.length) {
    return 0;
  }
  const p = Math.min(1, Math.max(0, Number(percentile)));
  if (values.length === 1) {
    return Number(values[0].toFixed(3));
  }
  const rawIndex = p * (values.length - 1);
  const lower = Math.floor(rawIndex);
  const upper = Math.ceil(rawIndex);
  if (lower === upper) {
    return Number(values[lower].toFixed(3));
  }
  const weight = rawIndex - lower;
  const interpolated = values[lower] * (1 - weight) + values[upper] * weight;
  return Number(interpolated.toFixed(3));
}

function parseArgs(argv) {
  const input = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    minSamplesPerScenario: 20,
    minToolCombinations: 3,
    minErrorCodeVariety: 5,
    minDriftEvents: 1,
    minManualRefreshEvents: 1,
    requiredScenarioTypes: [...DEFAULT_REQUIRED_SCENARIO_TYPES],
    gitCommit: "",
    timestamp: "",
    driftIncidenceAlertThreshold:
      DEFAULT_ALERT_THRESHOLDS.drift_incidence_alert_threshold,
    manualRefreshRatioAlertThreshold:
      DEFAULT_ALERT_THRESHOLDS.manual_refresh_ratio_alert_threshold,
    autoRetrySuccessAlertThreshold:
      DEFAULT_ALERT_THRESHOLDS.auto_retry_success_alert_threshold,
    writeChainAvgCallsAlertThreshold:
      DEFAULT_ALERT_THRESHOLDS.write_chain_avg_calls_alert_threshold,
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
    if (token === "--min-samples" && i + 1 < args.length) {
      input.minSamplesPerScenario = toNonNegativeInteger(args[i + 1], 20);
      i += 1;
      continue;
    }
    if (token === "--min-combos" && i + 1 < args.length) {
      input.minToolCombinations = toNonNegativeInteger(args[i + 1], 3);
      i += 1;
      continue;
    }
    if (token === "--min-error-codes" && i + 1 < args.length) {
      input.minErrorCodeVariety = toNonNegativeInteger(args[i + 1], 5);
      i += 1;
      continue;
    }
    if (token === "--min-drift-events" && i + 1 < args.length) {
      input.minDriftEvents = toNonNegativeInteger(args[i + 1], 1);
      i += 1;
      continue;
    }
    if (token === "--min-manual-refresh-events" && i + 1 < args.length) {
      input.minManualRefreshEvents = toNonNegativeInteger(args[i + 1], 1);
      i += 1;
      continue;
    }
    if (token === "--required-types" && i + 1 < args.length) {
      input.requiredScenarioTypes = String(args[i + 1] || "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      i += 1;
      continue;
    }
    if (token === "--git-commit" && i + 1 < args.length) {
      input.gitCommit = String(args[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--timestamp" && i + 1 < args.length) {
      input.timestamp = String(args[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--drift-alert-threshold" && i + 1 < args.length) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n >= 0) {
        input.driftIncidenceAlertThreshold = Number(n);
      }
      i += 1;
      continue;
    }
    if (token === "--manual-refresh-alert-threshold" && i + 1 < args.length) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n >= 0) {
        input.manualRefreshRatioAlertThreshold = Number(n);
      }
      i += 1;
      continue;
    }
    if (token === "--auto-retry-success-threshold" && i + 1 < args.length) {
      const n = Number(args[i + 1]);
      if (Number.isFinite(n) && n >= 0 && n <= 1) {
        input.autoRetrySuccessAlertThreshold = Number(n);
      }
      i += 1;
      continue;
    }
    if (token === "--write-chain-alert-threshold" && i + 1 < args.length) {
      input.writeChainAvgCallsAlertThreshold = toNonNegativeInteger(
        args[i + 1],
        input.writeChainAvgCallsAlertThreshold
      );
      i += 1;
      continue;
    }
  }
  if (!input.requiredScenarioTypes.length) {
    input.requiredScenarioTypes = [...DEFAULT_REQUIRED_SCENARIO_TYPES];
  }
  return input;
}

function readJsonOrThrow(filePath) {
  const absolutePath = resolvePath(filePath, SIDECAR_ROOT);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error(`Baseline samples file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`Baseline samples file is empty: ${absolutePath}`);
  }
  const normalizedRaw =
    raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalizedRaw);
}

function normalizeCallKind(rawKind, call) {
  const token = String(rawKind || "").trim().toLowerCase();
  if (token === "query" || token === "write" || token === "save") {
    return token;
  }
  if (call && call.is_query === true) {
    return "query";
  }
  if (call && call.is_write === true) {
    return "write";
  }
  if (call && call.is_save === true) {
    return "save";
  }
  return "other";
}

function normalizeToolCall(rawCall) {
  const call = rawCall && typeof rawCall === "object" ? rawCall : {};
  const hasManualRefreshAnnotation = Object.prototype.hasOwnProperty.call(
    call,
    "manual_refresh_after_drift"
  );
  const toolName =
    typeof call.tool_name === "string" && call.tool_name.trim()
      ? call.tool_name.trim()
      : "";
  const status =
    typeof call.status === "string" && call.status.trim()
      ? call.status.trim().toLowerCase()
      : call.success === false
      ? "error"
      : "ok";
  const kind = normalizeCallKind(call.kind, call);
  const latencyMs = toNonNegativeInteger(call.latency_ms, 0);
  const errorCode =
    typeof call.error_code === "string" && call.error_code.trim()
      ? call.error_code.trim()
      : "";

  return {
    tool_name: toolName,
    kind,
    status,
    latency_ms: latencyMs,
    error_code: errorCode,
    manual_refresh_annotation_present: hasManualRefreshAnnotation,
    manual_refresh_after_drift: call.manual_refresh_after_drift === true,
    auto_retry_attempted:
      call.auto_retry_attempted === true || call.recovery_attempted === true,
    auto_retry_success:
      call.auto_retry_success === true
        ? true
        : call.auto_retry_success === false
        ? false
        : toOptionalBoolean(call.recovery_success),
    auto_retry_duration_ms: toOptionalNonNegativeInteger(
      call.auto_retry_duration_ms ?? call.recovery_latency_ms
    ),
    token_candidate_issued:
      call.token_candidate_issued === true || call.read_token_issued === true,
  };
}

function normalizeErrorEntry(rawError) {
  const error = rawError && typeof rawError === "object" ? rawError : {};
  const errorCode =
    typeof error.error_code === "string" && error.error_code.trim()
      ? error.error_code.trim()
      : "";
  const toolName =
    typeof error.tool_name === "string" && error.tool_name.trim()
      ? error.tool_name.trim()
      : "";
  return {
    error_code: errorCode,
    tool_name: toolName,
  };
}

function normalizeScenarioSample(rawSample, index) {
  const sample = rawSample && typeof rawSample === "object" ? rawSample : {};
  const fallbackName = `scenario_${index + 1}`;
  const scenarioName =
    typeof sample.scenario_name === "string" && sample.scenario_name.trim()
      ? sample.scenario_name.trim()
      : fallbackName;
  const scenarioType =
    typeof sample.scenario_type === "string" && sample.scenario_type.trim()
      ? sample.scenario_type.trim()
      : "unknown";
  const sampleId =
    typeof sample.sample_id === "string" && sample.sample_id.trim()
      ? sample.sample_id.trim()
      : `${scenarioName}#${index + 1}`;
  const seed =
    typeof sample.seed === "string" && sample.seed.trim()
      ? sample.seed.trim()
      : "";
  const toolCalls = Array.isArray(sample.tool_calls)
    ? sample.tool_calls
        .map((call) => normalizeToolCall(call))
        .filter((call) => call.tool_name.length > 0)
    : [];
  const errors = Array.isArray(sample.errors)
    ? sample.errors
        .map((error) => normalizeErrorEntry(error))
        .filter((error) => error.error_code.length > 0)
    : [];
  const writeChainCallCount =
    Number.isFinite(Number(sample.write_chain_call_count)) &&
    Number(sample.write_chain_call_count) >= 0
      ? Number(sample.write_chain_call_count)
      : null;

  return {
    scenario_name: scenarioName,
    scenario_type: scenarioType,
    sample_id: sampleId,
    seed,
    tool_calls: toolCalls,
    errors,
    write_chain_call_count: writeChainCallCount,
  };
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

function buildToolCombination(sample) {
  const calls = Array.isArray(sample.tool_calls) ? sample.tool_calls : [];
  const ordered = [];
  const seen = new Set();
  for (const call of calls) {
    const toolName = String(call.tool_name || "").trim();
    if (!toolName || seen.has(toolName)) {
      continue;
    }
    seen.add(toolName);
    ordered.push(toolName);
  }
  return ordered.join(" -> ");
}

function buildErrorCodeStats(samples) {
  const counts = {};
  for (const sample of samples) {
    const seen = new Set();
    for (const call of sample.tool_calls) {
      if (!call.error_code) {
        continue;
      }
      const key = `${String(call.tool_name || "").trim()}|${call.error_code}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      counts[call.error_code] = toNonNegativeInteger(counts[call.error_code], 0) + 1;
    }
    for (const error of sample.errors) {
      if (!error.error_code) {
        continue;
      }
      const key = `${String(error.tool_name || "").trim()}|${error.error_code}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      counts[error.error_code] =
        toNonNegativeInteger(counts[error.error_code], 0) + 1;
    }
  }
  const rows = Object.entries(counts)
    .map(([error_code, count]) => ({ error_code, count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.error_code.localeCompare(b.error_code);
    });
  return {
    total_unique_error_codes: rows.length,
    rows,
  };
}

function countDriftEvents(sample) {
  const seen = new Set();
  let total = 0;
  for (const call of sample.tool_calls) {
    if (call.error_code !== DRIFT_ERROR_CODE) {
      continue;
    }
    const key = `${String(call.tool_name || "").trim()}|${call.error_code}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    total += 1;
  }
  for (const error of sample.errors) {
    if (error.error_code !== DRIFT_ERROR_CODE) {
      continue;
    }
    const key = `${String(error.tool_name || "").trim()}|${error.error_code}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    total += 1;
  }
  return total;
}

function countManualRefreshAfterDrift(sample) {
  const snapshotCalls = sample.tool_calls.filter(
    (call) => call.tool_name === "get_scene_snapshot_for_write"
  );
  if (!snapshotCalls.length) {
    return 0;
  }
  const hasAnnotation = snapshotCalls.some(
    (call) => call.manual_refresh_annotation_present === true
  );
  if (!hasAnnotation) {
    const sampleHasDrift = countDriftEvents(sample) > 0;
    return sampleHasDrift ? snapshotCalls.length : 0;
  }

  let driftSeenInCalls = false;
  let total = 0;
  for (const call of sample.tool_calls) {
    if (call.error_code === DRIFT_ERROR_CODE) {
      driftSeenInCalls = true;
    }
    if (call.tool_name !== "get_scene_snapshot_for_write") {
      continue;
    }
    const inferredManual = driftSeenInCalls && call.manual_refresh_after_drift !== false;
    if (call.manual_refresh_after_drift === true || inferredManual) {
      total += 1;
    }
  }
  return total;
}

function buildRepresentativenessSummary(samples, options, metrics) {
  const opts = options && typeof options === "object" ? options : {};
  const metric = metrics && typeof metrics === "object" ? metrics : {};
  const minSamplesPerScenario = toNonNegativeInteger(
    opts.minSamplesPerScenario,
    20
  );
  const minToolCombinations = toNonNegativeInteger(opts.minToolCombinations, 3);
  const minErrorCodeVariety = toNonNegativeInteger(opts.minErrorCodeVariety, 5);
  const minDriftEvents = toNonNegativeInteger(opts.minDriftEvents, 1);
  const minManualRefreshEvents = toNonNegativeInteger(
    opts.minManualRefreshEvents,
    1
  );
  const requiredScenarioTypes = Array.isArray(opts.requiredScenarioTypes)
    ? opts.requiredScenarioTypes
    : [...DEFAULT_REQUIRED_SCENARIO_TYPES];

  const scenarioTypeCounts = {};
  const scenarioStatsByName = {};
  const toolCombinationSet = new Set();

  for (const sample of samples) {
    const type = sample.scenario_type;
    scenarioTypeCounts[type] = toNonNegativeInteger(scenarioTypeCounts[type], 0) + 1;
    if (!scenarioStatsByName[sample.scenario_name]) {
      scenarioStatsByName[sample.scenario_name] = {
        sample_count: 0,
        scenario_type: type,
        combinations: new Set(),
      };
    }
    const stat = scenarioStatsByName[sample.scenario_name];
    stat.sample_count += 1;
    const combo = buildToolCombination(sample);
    if (combo) {
      stat.combinations.add(combo);
      toolCombinationSet.add(combo);
    }
  }

  const scenarioStats = Object.entries(scenarioStatsByName)
    .map(([name, value]) => ({
      scenario_name: name,
      scenario_type: value.scenario_type,
      sample_count: value.sample_count,
      unique_tool_combinations: value.combinations.size,
    }))
    .sort((a, b) => a.scenario_name.localeCompare(b.scenario_name));

  const checks = [];
  const missingTypes = requiredScenarioTypes.filter(
    (type) => toNonNegativeInteger(scenarioTypeCounts[type], 0) <= 0
  );
  checks.push({
    id: "required_scenario_types_present",
    pass: missingTypes.length === 0,
    details:
      missingTypes.length === 0
        ? "all required scenario types are present"
        : `missing types: ${missingTypes.join(", ")}`,
  });

  const underSampledScenarios = scenarioStats
    .filter((item) => item.sample_count < minSamplesPerScenario)
    .map((item) => `${item.scenario_name}:${item.sample_count}`);
  checks.push({
    id: "min_samples_per_scenario",
    pass: underSampledScenarios.length === 0,
    details:
      underSampledScenarios.length === 0
        ? `all scenarios >= ${minSamplesPerScenario}`
        : `under-sampled scenarios: ${underSampledScenarios.join(", ")}`,
  });

  checks.push({
    id: "min_tool_combinations",
    pass: toolCombinationSet.size >= minToolCombinations,
    details: `combos=${toolCombinationSet.size}, required>=${minToolCombinations}`,
  });

  checks.push({
    id: "min_error_code_variety",
    pass: toNonNegativeInteger(metric.unique_error_codes, 0) >= minErrorCodeVariety,
    details: `error_codes=${toNonNegativeInteger(
      metric.unique_error_codes,
      0
    )}, required>=${minErrorCodeVariety}`,
  });

  checks.push({
    id: "min_drift_events",
    pass: toNonNegativeInteger(metric.drift_events_total, 0) >= minDriftEvents,
    details: `drift_events=${toNonNegativeInteger(
      metric.drift_events_total,
      0
    )}, required>=${minDriftEvents}`,
  });

  checks.push({
    id: "min_manual_refresh_events",
    pass:
      toNonNegativeInteger(metric.manual_refresh_after_drift_total, 0) >=
      minManualRefreshEvents,
    details: `manual_refresh_after_drift=${toNonNegativeInteger(
      metric.manual_refresh_after_drift_total,
      0
    )}, required>=${minManualRefreshEvents}`,
  });

  return {
    required_scenario_types: requiredScenarioTypes,
    scenario_type_counts: scenarioTypeCounts,
    scenario_stats: scenarioStats,
    unique_tool_combinations: toolCombinationSet.size,
    checks,
    all_passed: checks.every((item) => item.pass === true),
  };
}

function buildDriftHotspots(samples, driftCountsByTool) {
  let driftTotal = 0;
  for (const value of Object.values(driftCountsByTool)) {
    driftTotal += toNonNegativeInteger(value, 0);
  }
  const rows = Object.entries(driftCountsByTool)
    .map(([tool_name, drift_count]) => ({
      tool_name,
      drift_count,
      drift_ratio: safeDivide(drift_count, Math.max(driftTotal, 1)),
    }))
    .sort((a, b) => {
      if (b.drift_count !== a.drift_count) {
        return b.drift_count - a.drift_count;
      }
      return a.tool_name.localeCompare(b.tool_name);
    });
  return {
    total_drift_events: driftTotal,
    rows,
  };
}

function buildPrimaryMetrics(samples) {
  let totalToolCalls = 0;
  let queryCallsTotal = 0;
  let writeCallsTotal = 0;
  let writeFlowSamplesTotal = 0;
  let writeChainCallCountTotal = 0;
  let driftEventsTotal = 0;
  let driftSamplesTotal = 0;
  let snapshotCallsTotal = 0;
  let manualRefreshAfterDriftTotal = 0;
  let autoRetryAttemptedTotal = 0;
  let autoRetrySuccessTotal = 0;
  let autoRetryFailureTotal = 0;
  let autoRetryUnknownOutcomeTotal = 0;
  let tokenCandidateIssuedTotal = 0;

  const autoRetryLatencyValues = [];
  const driftCountsByTool = {};

  for (const sample of samples) {
    const hasWrite = sample.tool_calls.some(
      (call) => call.kind === "write" || call.kind === "save"
    );
    if (hasWrite) {
      writeFlowSamplesTotal += 1;
      const sampleWriteChainCount =
        sample.write_chain_call_count !== null
          ? sample.write_chain_call_count
          : sample.tool_calls.length;
      writeChainCallCountTotal += toNonNegativeInteger(sampleWriteChainCount, 0);
    }

    for (const call of sample.tool_calls) {
      totalToolCalls += 1;
      if (call.kind === "query") {
        queryCallsTotal += 1;
      }
      if (call.kind === "write" || call.kind === "save") {
        writeCallsTotal += 1;
      }
      if (call.tool_name === "get_scene_snapshot_for_write") {
        snapshotCallsTotal += 1;
      }
      if (call.token_candidate_issued) {
        tokenCandidateIssuedTotal += 1;
      }
      if (call.auto_retry_attempted) {
        autoRetryAttemptedTotal += 1;
        if (call.auto_retry_success === true) {
          autoRetrySuccessTotal += 1;
        } else if (call.auto_retry_success === false) {
          autoRetryFailureTotal += 1;
        } else {
          autoRetryUnknownOutcomeTotal += 1;
        }
        if (
          Number.isFinite(Number(call.auto_retry_duration_ms)) &&
          Number(call.auto_retry_duration_ms) >= 0
        ) {
          autoRetryLatencyValues.push(Number(call.auto_retry_duration_ms));
        }
      }
      if (call.error_code === DRIFT_ERROR_CODE) {
        const toolName = String(call.tool_name || "").trim() || "unknown_tool";
        driftCountsByTool[toolName] = toNonNegativeInteger(
          driftCountsByTool[toolName],
          0
        ) + 1;
      }
    }

    const driftCountForSample = countDriftEvents(sample);
    driftEventsTotal += driftCountForSample;
    if (driftCountForSample > 0) {
      driftSamplesTotal += 1;
    }
    manualRefreshAfterDriftTotal += countManualRefreshAfterDrift(sample);
  }

  return {
    totals: {
      samples_total: samples.length,
      total_tool_calls: totalToolCalls,
      query_calls_total: queryCallsTotal,
      write_calls_total: writeCallsTotal,
      write_flow_samples_total: writeFlowSamplesTotal,
      write_chain_call_count_total: writeChainCallCountTotal,
      drift_events_total: driftEventsTotal,
      drift_samples_total: driftSamplesTotal,
      snapshot_calls_total: snapshotCallsTotal,
      manual_refresh_after_drift_total: manualRefreshAfterDriftTotal,
      auto_retry_attempted_total: autoRetryAttemptedTotal,
      auto_retry_success_total: autoRetrySuccessTotal,
      auto_retry_failure_total: autoRetryFailureTotal,
      auto_retry_unknown_outcome_total: autoRetryUnknownOutcomeTotal,
      token_candidate_issued_total: tokenCandidateIssuedTotal,
    },
    drift_incidence_rate_per_write_call: safeDivide(
      driftEventsTotal,
      Math.max(writeCallsTotal, 1)
    ),
    manual_refresh_after_drift_ratio: safeDivide(
      manualRefreshAfterDriftTotal,
      Math.max(driftEventsTotal, 1)
    ),
    avg_snapshot_calls_per_write_flow_sample: safeDivide(
      snapshotCallsTotal,
      Math.max(writeFlowSamplesTotal, 1)
    ),
    write_chain_avg_call_count: safeDivide(
      writeChainCallCountTotal,
      Math.max(writeFlowSamplesTotal, 1)
    ),
    auto_retry_attempted_rate_per_drift_event: safeDivide(
      autoRetryAttemptedTotal,
      Math.max(driftEventsTotal, 1)
    ),
    auto_retry_success_rate: safeDivide(
      autoRetrySuccessTotal,
      Math.max(autoRetryAttemptedTotal, 1)
    ),
    token_candidate_issue_rate_per_write_call: safeDivide(
      tokenCandidateIssuedTotal,
      Math.max(writeCallsTotal, 1)
    ),
    auto_retry_latency_p95_ms: quantile(autoRetryLatencyValues, 0.95),
    drift_counts_by_tool: driftCountsByTool,
  };
}

function buildObservabilitySummary(metrics, options) {
  const opts = options && typeof options === "object" ? options : {};
  const driftIncidenceAlertThreshold = Number.isFinite(
    Number(opts.driftIncidenceAlertThreshold)
  )
    ? Number(opts.driftIncidenceAlertThreshold)
    : DEFAULT_ALERT_THRESHOLDS.drift_incidence_alert_threshold;
  const manualRefreshRatioAlertThreshold = Number.isFinite(
    Number(opts.manualRefreshRatioAlertThreshold)
  )
    ? Number(opts.manualRefreshRatioAlertThreshold)
    : DEFAULT_ALERT_THRESHOLDS.manual_refresh_ratio_alert_threshold;
  const autoRetrySuccessAlertThreshold = Number.isFinite(
    Number(opts.autoRetrySuccessAlertThreshold)
  )
    ? Number(opts.autoRetrySuccessAlertThreshold)
    : DEFAULT_ALERT_THRESHOLDS.auto_retry_success_alert_threshold;
  const writeChainAvgCallsAlertThreshold = toNonNegativeInteger(
    opts.writeChainAvgCallsAlertThreshold,
    DEFAULT_ALERT_THRESHOLDS.write_chain_avg_calls_alert_threshold
  );

  const alerts = [];
  if (
    Number(metrics.drift_incidence_rate_per_write_call) >
    driftIncidenceAlertThreshold
  ) {
    alerts.push({
      code: "DRIFT_INCIDENCE_HIGH",
      severity: "warning",
      threshold: driftIncidenceAlertThreshold,
      current: metrics.drift_incidence_rate_per_write_call,
      message:
        "Scene revision drift incidence is high for write calls. Token automation rollout should stay gated.",
    });
  }
  if (
    Number(metrics.manual_refresh_after_drift_ratio) >
    manualRefreshRatioAlertThreshold
  ) {
    alerts.push({
      code: "MANUAL_REFRESH_AFTER_DRIFT_HIGH",
      severity: "warning",
      threshold: manualRefreshRatioAlertThreshold,
      current: metrics.manual_refresh_after_drift_ratio,
      message:
        "Manual snapshot refresh ratio after drift is high. Prioritize token automation coordinator rollout.",
    });
  }
  if (
    toNonNegativeInteger(metrics.totals.auto_retry_attempted_total, 0) > 0 &&
    Number(metrics.auto_retry_success_rate) < autoRetrySuccessAlertThreshold
  ) {
    alerts.push({
      code: "AUTO_RETRY_SUCCESS_RATE_LOW",
      severity: "warning",
      threshold: autoRetrySuccessAlertThreshold,
      current: metrics.auto_retry_success_rate,
      message:
        "Auto-retry success rate is below threshold. Validate idempotency and retry gating before enabling rollout.",
    });
  }
  if (
    Number(metrics.write_chain_avg_call_count) > writeChainAvgCallsAlertThreshold
  ) {
    alerts.push({
      code: "WRITE_CHAIN_CALL_COUNT_HIGH",
      severity: "warning",
      threshold: writeChainAvgCallsAlertThreshold,
      current: metrics.write_chain_avg_call_count,
      message:
        "Average write-chain call count is high. Query/contract consolidation is required before token rollout.",
    });
  }

  return {
    alert_thresholds: {
      drift_incidence_alert_threshold: driftIncidenceAlertThreshold,
      manual_refresh_ratio_alert_threshold: manualRefreshRatioAlertThreshold,
      auto_retry_success_alert_threshold: autoRetrySuccessAlertThreshold,
      write_chain_avg_calls_alert_threshold: writeChainAvgCallsAlertThreshold,
    },
    alerts,
  };
}

function buildG2TokenBaselineReport(input) {
  const opts = input && typeof input === "object" ? input : {};
  const source = opts.snapshot && typeof opts.snapshot === "object" ? opts.snapshot : {};
  const rawSamples = Array.isArray(source.samples) ? source.samples : [];
  const normalizedSamples = rawSamples.map((sample, index) =>
    normalizeScenarioSample(sample, index)
  );
  const metrics = buildPrimaryMetrics(normalizedSamples);
  const errorCodeStats = buildErrorCodeStats(normalizedSamples);
  const representativeness = buildRepresentativenessSummary(normalizedSamples, opts, {
    unique_error_codes: errorCodeStats.total_unique_error_codes,
    drift_events_total: metrics.totals.drift_events_total,
    manual_refresh_after_drift_total:
      metrics.totals.manual_refresh_after_drift_total,
  });
  const observability = buildObservabilitySummary(metrics, opts);
  const driftHotspots = buildDriftHotspots(normalizedSamples, metrics.drift_counts_by_tool);

  const gitCommit =
    opts.gitCommit ||
    source.git_commit ||
    process.env.GIT_COMMIT ||
    detectGitCommit();
  const timestamp =
    opts.timestamp ||
    source.timestamp ||
    source.generated_at ||
    new Date().toISOString();

  return {
    schema_version: "g2_token_baseline_metrics_report.v1",
    generated_at: new Date().toISOString(),
    source: {
      input_path: resolvePath(opts.inputPath, SIDECAR_ROOT),
      source_schema_version:
        typeof source.schema_version === "string" ? source.schema_version : "",
      git_commit: gitCommit,
      timestamp,
      sample_total: normalizedSamples.length,
    },
    metrics: {
      drift_incidence_rate_per_write_call: metrics.drift_incidence_rate_per_write_call,
      manual_refresh_after_drift_ratio: metrics.manual_refresh_after_drift_ratio,
      avg_snapshot_calls_per_write_flow_sample:
        metrics.avg_snapshot_calls_per_write_flow_sample,
      write_chain_avg_call_count: metrics.write_chain_avg_call_count,
      auto_retry_attempted_rate_per_drift_event:
        metrics.auto_retry_attempted_rate_per_drift_event,
      auto_retry_success_rate: metrics.auto_retry_success_rate,
      token_candidate_issue_rate_per_write_call:
        metrics.token_candidate_issue_rate_per_write_call,
      auto_retry_latency_p95_ms: metrics.auto_retry_latency_p95_ms,
      totals: metrics.totals,
    },
    representativeness,
    error_code_distribution: errorCodeStats,
    drift_hotspots: driftHotspots,
    observability,
    observability_alerts: observability.alerts,
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
  const report = buildG2TokenBaselineReport({
    ...options,
    snapshot,
  });
  const outputPath = writeReport(report, options.outputPath);
  // eslint-disable-next-line no-console
  console.log(`[g2-token-baseline] input=${resolvePath(options.inputPath, SIDECAR_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`[g2-token-baseline] output=${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[g2-token-baseline] samples=${report.source.sample_total} drift_incidence=${report.metrics.drift_incidence_rate_per_write_call}`
  );
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
    console.error(`[g2-token-baseline] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  buildG2TokenBaselineReport,
  runCli,
};

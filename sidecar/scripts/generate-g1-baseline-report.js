#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g1-baseline-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g1-baseline-report.json"
);

const DEFAULT_REQUIRED_SCENARIO_TYPES = [
  "simple",
  "medium",
  "complex",
  "error",
  "boundary",
];

const DEFAULT_PRIORITY_WEIGHTS = {
  call_ratio_weight: 0.6,
  error_ratio_weight: 0.4,
};

const DEFAULT_PRIORITY_THRESHOLDS = {
  p0: {
    min_score: 0.1,
    min_error_ratio: 0.15,
  },
  p1: {
    min_score: 0.05,
    min_error_ratio: 0.08,
  },
};

const DEFAULT_RECOVERY_OBSERVABILITY_THRESHOLDS = {
  recovery_success_rate_alert_threshold: 0.7,
  recovery_latency_p95_alert_ms: 2000,
};

const FAILURE_CATEGORY_CODE_MAP = {
  token: new Set([
    "E_SCENE_REVISION_DRIFT",
    "E_READ_REQUIRED",
    "E_STALE_SNAPSHOT",
    "E_TRANSACTION_TOKEN_INVALID",
  ]),
  parameter: new Set([
    "E_PROPERTY_NOT_FOUND",
    "E_PROPERTY_TYPE_MISMATCH",
    "E_TRANSACTION_REF_PATH_INVALID",
    "E_TRANSACTION_ALIAS_MISSING",
    "E_TRANSACTION_PLAN_INVALID",
  ]),
  execution: new Set([
    "E_TARGET_NOT_FOUND",
    "E_COMPONENT_NOT_FOUND",
    "E_COMPOSITE_STEP_FAILED",
    "E_TRANSACTION_STEP_FAILED",
  ]),
  guard: new Set([
    "E_SCHEMA_INVALID",
    "E_PRECONDITION_FAILED",
    "E_WRITE_ENVELOPE_REQUIRED",
    "E_SSOT_TOOL_UNSUPPORTED",
  ]),
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

function quantile(numbers, percentile) {
  const values = Array.isArray(numbers)
    ? numbers
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item >= 0)
        .sort((a, b) => a - b)
    : [];
  if (values.length === 0) {
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
    requiredScenarioTypes: [...DEFAULT_REQUIRED_SCENARIO_TYPES],
    gitCommit: "",
    timestamp: "",
    recoverySuccessAlertThreshold:
      DEFAULT_RECOVERY_OBSERVABILITY_THRESHOLDS.recovery_success_rate_alert_threshold,
    recoveryLatencyAlertThresholdMs:
      DEFAULT_RECOVERY_OBSERVABILITY_THRESHOLDS.recovery_latency_p95_alert_ms,
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
    if (token === "--recovery-success-threshold" && i + 1 < args.length) {
      const n = Number(args[i + 1]);
      input.recoverySuccessAlertThreshold =
        Number.isFinite(n) && n >= 0 && n <= 1
          ? Number(n)
          : input.recoverySuccessAlertThreshold;
      i += 1;
      continue;
    }
    if (token === "--recovery-latency-threshold-ms" && i + 1 < args.length) {
      input.recoveryLatencyAlertThresholdMs = toNonNegativeInteger(
        args[i + 1],
        input.recoveryLatencyAlertThresholdMs
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
  return JSON.parse(raw);
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
  const blindRetryCount = toNonNegativeInteger(sample.blind_retry_count, 0);

  const firstWriteCall = toolCalls.find(
    (call) => call.kind === "write" || call.kind === "save"
  );
  const firstWriteSuccess =
    typeof sample.first_write_success === "boolean"
      ? sample.first_write_success
      : firstWriteCall
      ? firstWriteCall.status === "ok"
      : false;

  return {
    scenario_name: scenarioName,
    scenario_type: scenarioType,
    sample_id: sampleId,
    seed,
    tool_calls: toolCalls,
    errors,
    blind_retry_count: blindRetryCount,
    first_write_success: firstWriteSuccess,
  };
}

function normalizeToolCall(rawCall) {
  const call = rawCall && typeof rawCall === "object" ? rawCall : {};
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
  const errorFeedbackBytes = toOptionalNonNegativeInteger(
    call.error_feedback_bytes ??
      call.structured_error_response_bytes ??
      call.error_response_bytes
  );
  const suggestedActionExecuted =
    call.suggested_action_executed === true ||
    call.recovery_suggested_action_executed === true;
  const recoveryAttempted =
    call.recovery_attempted === true || suggestedActionExecuted;
  const recoverySuccess =
    typeof call.recovery_success === "boolean" ? call.recovery_success : null;
  const recoveryLatencyMs = toOptionalNonNegativeInteger(call.recovery_latency_ms);

  return {
    tool_name: toolName,
    kind,
    status,
    latency_ms: latencyMs,
    error_code: errorCode,
    error_feedback_bytes: errorFeedbackBytes,
    suggested_action_executed: suggestedActionExecuted,
    recovery_attempted: recoveryAttempted,
    recovery_success: recoverySuccess,
    recovery_latency_ms: recoveryLatencyMs,
  };
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

function classifyErrorCategory(errorCode) {
  const code = String(errorCode || "").trim();
  if (!code) {
    return "unknown";
  }
  const categories = Object.keys(FAILURE_CATEGORY_CODE_MAP);
  for (const category of categories) {
    if (FAILURE_CATEGORY_CODE_MAP[category].has(code)) {
      return category;
    }
  }
  return "unknown";
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

function buildRepresentativenessSummary(samples, options) {
  const opts = options && typeof options === "object" ? options : {};
  const minSamplesPerScenario = toNonNegativeInteger(
    opts.minSamplesPerScenario,
    20
  );
  const minToolCombinations = toNonNegativeInteger(opts.minToolCombinations, 3);
  const minErrorCodeVariety = toNonNegativeInteger(opts.minErrorCodeVariety, 5);
  const requiredScenarioTypes = Array.isArray(opts.requiredScenarioTypes)
    ? opts.requiredScenarioTypes
    : [...DEFAULT_REQUIRED_SCENARIO_TYPES];

  const scenarioTypeCounts = {};
  const scenarioStatsByName = {};
  const toolCombinationSet = new Set();
  const errorCodeSet = new Set();

  for (const sample of samples) {
    const type = sample.scenario_type;
    scenarioTypeCounts[type] = toNonNegativeInteger(scenarioTypeCounts[type], 0) + 1;
    if (!scenarioStatsByName[sample.scenario_name]) {
      scenarioStatsByName[sample.scenario_name] = {
        sample_count: 0,
        scenario_type: type,
        unique_tool_combinations: 0,
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
    for (const error of sample.errors) {
      if (error.error_code) {
        errorCodeSet.add(error.error_code);
      }
    }
    for (const call of sample.tool_calls) {
      if (call.error_code) {
        errorCodeSet.add(call.error_code);
      }
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
    pass: errorCodeSet.size >= minErrorCodeVariety,
    details: `error_codes=${errorCodeSet.size}, required>=${minErrorCodeVariety}`,
  });

  return {
    required_scenario_types: requiredScenarioTypes,
    scenario_type_counts: scenarioTypeCounts,
    scenario_stats: scenarioStats,
    unique_tool_combinations: toolCombinationSet.size,
    unique_error_codes: errorCodeSet.size,
    checks,
    all_passed: checks.every((item) => item.pass === true),
  };
}

function buildPrimaryMetrics(samples) {
  const sampleCount = samples.length;
  if (sampleCount <= 0) {
    return {
      first_submit_success_rate: 0,
      avg_query_calls_per_sample: 0,
      blind_retry_rate: 0,
      get_write_contract_bundle_p95_latency_ms: 0,
      structured_error_response_p95_bytes: 0,
      totals: {
        samples_total: 0,
        write_first_submit_success_total: 0,
        query_calls_total: 0,
        blind_retry_events_total: 0,
        failure_events_total: 0,
      },
    };
  }

  let writeFirstSubmitSuccessTotal = 0;
  let queryCallsTotal = 0;
  let blindRetryEventsTotal = 0;
  let failureEventsTotal = 0;
  const bundleLatency = [];
  const structuredErrorResponseBytes = [];

  for (const sample of samples) {
    if (sample.first_write_success) {
      writeFirstSubmitSuccessTotal += 1;
    }
    blindRetryEventsTotal += toNonNegativeInteger(sample.blind_retry_count, 0);
    for (const call of sample.tool_calls) {
      if (call.kind === "query") {
        queryCallsTotal += 1;
      }
      if (call.tool_name === "get_write_contract_bundle") {
        bundleLatency.push(call.latency_ms);
      }
      if (call.status !== "ok") {
        failureEventsTotal += 1;
        if (
          Number.isFinite(Number(call.error_feedback_bytes)) &&
          Number(call.error_feedback_bytes) >= 0
        ) {
          structuredErrorResponseBytes.push(Number(call.error_feedback_bytes));
        }
      }
    }
    failureEventsTotal += sample.errors.length;
  }

  return {
    first_submit_success_rate: safeDivide(writeFirstSubmitSuccessTotal, sampleCount),
    avg_query_calls_per_sample: safeDivide(queryCallsTotal, sampleCount),
    blind_retry_rate: safeDivide(blindRetryEventsTotal, failureEventsTotal),
    get_write_contract_bundle_p95_latency_ms: quantile(bundleLatency, 0.95),
    structured_error_response_p95_bytes: quantile(
      structuredErrorResponseBytes,
      0.95
    ),
    totals: {
      samples_total: sampleCount,
      write_first_submit_success_total: writeFirstSubmitSuccessTotal,
      query_calls_total: queryCallsTotal,
      blind_retry_events_total: blindRetryEventsTotal,
      failure_events_total: failureEventsTotal,
    },
  };
}

function buildFailureCategorySummary(samples) {
  const counts = {
    token: 0,
    parameter: 0,
    execution: 0,
    guard: 0,
    unknown: 0,
  };
  const unknownCodes = new Set();
  let total = 0;

  for (const sample of samples) {
    const callErrorKeys = new Set();
    for (const call of sample.tool_calls) {
      if (!call.error_code) {
        continue;
      }
      const key = `${String(call.tool_name || "").trim()}|${call.error_code}`;
      callErrorKeys.add(key);
      const category = classifyErrorCategory(call.error_code);
      counts[category] += 1;
      total += 1;
      if (category === "unknown") {
        unknownCodes.add(call.error_code);
      }
    }
    for (const error of sample.errors) {
      const key = `${String(error.tool_name || "").trim()}|${error.error_code}`;
      if (callErrorKeys.has(key)) {
        continue;
      }
      const category = classifyErrorCategory(error.error_code);
      counts[category] += 1;
      total += 1;
      if (category === "unknown") {
        unknownCodes.add(error.error_code);
      }
    }
  }

  const known = total - counts.unknown;
  return {
    counts,
    total_failures: total,
    classified_coverage: safeDivide(known, Math.max(total, 1)),
    unknown_ratio: safeDivide(counts.unknown, Math.max(total, 1)),
    unknown_codes: Array.from(unknownCodes).sort(),
  };
}

function buildRecoveryObservabilitySummary(samples, options) {
  const opts = options && typeof options === "object" ? options : {};
  const successRateAlertThreshold =
    Number.isFinite(Number(opts.recoverySuccessAlertThreshold)) &&
    Number(opts.recoverySuccessAlertThreshold) >= 0 &&
    Number(opts.recoverySuccessAlertThreshold) <= 1
      ? Number(opts.recoverySuccessAlertThreshold)
      : DEFAULT_RECOVERY_OBSERVABILITY_THRESHOLDS.recovery_success_rate_alert_threshold;
  const latencyP95AlertMs = toNonNegativeInteger(
    opts.recoveryLatencyAlertThresholdMs,
    DEFAULT_RECOVERY_OBSERVABILITY_THRESHOLDS.recovery_latency_p95_alert_ms
  );

  let errorEventsTotal = 0;
  let suggestedActionExecutedTotal = 0;
  let recoveryAttemptsTotal = 0;
  let recoverySuccessTotal = 0;
  let recoveryFailureTotal = 0;
  let recoveryUnknownOutcomeTotal = 0;
  let recoveryLatencySum = 0;
  let recoveryLatencyCount = 0;
  const recoveryLatencyValues = [];

  for (const sample of samples) {
    for (const call of sample.tool_calls) {
      if (call.status !== "ok") {
        errorEventsTotal += 1;
      }
      if (call.suggested_action_executed === true) {
        suggestedActionExecutedTotal += 1;
      }
      if (call.recovery_attempted === true) {
        recoveryAttemptsTotal += 1;
        if (call.recovery_success === true) {
          recoverySuccessTotal += 1;
        } else if (call.recovery_success === false) {
          recoveryFailureTotal += 1;
        } else {
          recoveryUnknownOutcomeTotal += 1;
        }
        if (
          Number.isFinite(Number(call.recovery_latency_ms)) &&
          Number(call.recovery_latency_ms) >= 0
        ) {
          const latencyMs = Number(call.recovery_latency_ms);
          recoveryLatencyValues.push(latencyMs);
          recoveryLatencySum += latencyMs;
          recoveryLatencyCount += 1;
        }
      }
    }
  }

  const recoverySuccessRate = safeDivide(
    recoverySuccessTotal,
    Math.max(recoveryAttemptsTotal, 1)
  );
  const recoveryLatencyAvgMs =
    recoveryLatencyCount > 0
      ? Number((recoveryLatencySum / recoveryLatencyCount).toFixed(3))
      : 0;
  const recoveryLatencyP95Ms = quantile(recoveryLatencyValues, 0.95);

  const alerts = [];
  if (
    recoveryAttemptsTotal > 0 &&
    recoverySuccessRate < successRateAlertThreshold
  ) {
    alerts.push({
      code: "RECOVERY_SUCCESS_RATE_LOW",
      severity: "warning",
      threshold: successRateAlertThreshold,
      current: recoverySuccessRate,
      message:
        "Recovery success rate is below threshold. Inspect fix_steps quality and suggested_action guidance.",
    });
  }
  if (recoveryLatencyP95Ms > latencyP95AlertMs) {
    alerts.push({
      code: "RECOVERY_LATENCY_P95_HIGH",
      severity: "warning",
      threshold_ms: latencyP95AlertMs,
      current_ms: recoveryLatencyP95Ms,
      message:
        "Recovery latency P95 exceeds threshold. Inspect guidance complexity and expensive read chains.",
    });
  }

  return {
    error_events_total: errorEventsTotal,
    suggested_action_executed_total: suggestedActionExecutedTotal,
    recovery_attempts_total: recoveryAttemptsTotal,
    recovery_success_total: recoverySuccessTotal,
    recovery_failure_total: recoveryFailureTotal,
    recovery_unknown_outcome_total: recoveryUnknownOutcomeTotal,
    recovery_success_rate: recoverySuccessRate,
    recovery_latency_avg_ms: recoveryLatencyAvgMs,
    recovery_latency_p95_ms: recoveryLatencyP95Ms,
    alert_thresholds: {
      recovery_success_rate_alert_threshold: successRateAlertThreshold,
      recovery_latency_p95_alert_ms: latencyP95AlertMs,
    },
    alerts,
  };
}

function classifyPriority(score, errorRatio, thresholds) {
  const threshold = thresholds || DEFAULT_PRIORITY_THRESHOLDS;
  const s = Number(score);
  const e = Number(errorRatio);
  if (
    s >= Number(threshold.p0.min_score) ||
    e >= Number(threshold.p0.min_error_ratio)
  ) {
    return "P0";
  }
  if (
    s >= Number(threshold.p1.min_score) ||
    e >= Number(threshold.p1.min_error_ratio)
  ) {
    return "P1";
  }
  return "P2";
}

function buildToolPrioritySummary(samples, options) {
  const statsByTool = new Map();
  let totalCalls = 0;
  let totalErrors = 0;

  for (const sample of samples) {
    const callErrorKeys = new Set();
    for (const call of sample.tool_calls) {
      if (!call.tool_name) {
        continue;
      }
      totalCalls += 1;
      if (!statsByTool.has(call.tool_name)) {
        statsByTool.set(call.tool_name, {
          tool_name: call.tool_name,
          call_count: 0,
          error_count: 0,
        });
      }
      const stat = statsByTool.get(call.tool_name);
      stat.call_count += 1;
      if (call.status !== "ok") {
        stat.error_count += 1;
        totalErrors += 1;
        if (call.error_code) {
          const key = `${String(call.tool_name || "").trim()}|${call.error_code}`;
          callErrorKeys.add(key);
        }
      }
    }
    for (const error of sample.errors) {
      const toolName = String(error.tool_name || "").trim();
      if (!toolName) {
        continue;
      }
      const key = `${toolName}|${String(error.error_code || "").trim()}`;
      if (callErrorKeys.has(key)) {
        continue;
      }
      if (!statsByTool.has(toolName)) {
        statsByTool.set(toolName, {
          tool_name: toolName,
          call_count: 0,
          error_count: 0,
        });
      }
      const stat = statsByTool.get(toolName);
      stat.error_count += 1;
      totalErrors += 1;
    }
  }

  const weights =
    options && typeof options === "object" && options.priorityWeights
      ? options.priorityWeights
      : DEFAULT_PRIORITY_WEIGHTS;
  const thresholds =
    options && typeof options === "object" && options.priorityThresholds
      ? options.priorityThresholds
      : DEFAULT_PRIORITY_THRESHOLDS;

  const rows = Array.from(statsByTool.values()).map((stat) => {
    const callRatio = safeDivide(stat.call_count, Math.max(totalCalls, 1));
    const errorRatio = safeDivide(stat.error_count, Math.max(totalErrors, 1));
    const score =
      callRatio * Number(weights.call_ratio_weight) +
      errorRatio * Number(weights.error_ratio_weight);
    const priority = classifyPriority(score, errorRatio, thresholds);
    return {
      tool_name: stat.tool_name,
      call_count: stat.call_count,
      error_count: stat.error_count,
      call_ratio: toRatio(callRatio),
      error_ratio: toRatio(errorRatio),
      score: toRatio(score),
      priority,
    };
  });

  rows.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    if (b.error_ratio !== a.error_ratio) {
      return b.error_ratio - a.error_ratio;
    }
    return a.tool_name.localeCompare(b.tool_name);
  });

  return {
    weights,
    thresholds,
    total_tool_calls: totalCalls,
    total_tool_errors: totalErrors,
    tools: rows,
    p0_tools: rows.filter((item) => item.priority === "P0").map((item) => item.tool_name),
    p1_tools: rows.filter((item) => item.priority === "P1").map((item) => item.tool_name),
    p2_tools: rows.filter((item) => item.priority === "P2").map((item) => item.tool_name),
  };
}

function buildG1BaselineReport(input) {
  const opts = input && typeof input === "object" ? input : {};
  const source = opts.snapshot && typeof opts.snapshot === "object" ? opts.snapshot : {};
  const rawSamples = Array.isArray(source.samples) ? source.samples : [];
  const normalizedSamples = rawSamples.map((sample, index) =>
    normalizeScenarioSample(sample, index)
  );

  const representativeness = buildRepresentativenessSummary(normalizedSamples, opts);
  const metrics = buildPrimaryMetrics(normalizedSamples);
  const failureCategories = buildFailureCategorySummary(normalizedSamples);
  const recoveryObservability = buildRecoveryObservabilitySummary(
    normalizedSamples,
    opts
  );
  const toolPriority = buildToolPrioritySummary(normalizedSamples, opts);

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
    schema_version: "g1_baseline_metrics_report.v1",
    generated_at: new Date().toISOString(),
    source: {
      input_path: resolvePath(opts.inputPath, SIDECAR_ROOT),
      source_schema_version:
        typeof source.schema_version === "string" ? source.schema_version : "",
      git_commit: gitCommit,
      timestamp,
      sample_total: normalizedSamples.length,
    },
    metrics,
    representativeness,
    failure_categories: failureCategories,
    recovery_observability: recoveryObservability,
    observability_alerts: recoveryObservability.alerts,
    tool_priority: toolPriority,
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
  const report = buildG1BaselineReport({
    ...options,
    snapshot,
  });
  const outputPath = writeReport(report, options.outputPath);
  // eslint-disable-next-line no-console
  console.log(`[g1-baseline] input=${resolvePath(options.inputPath, SIDECAR_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`[g1-baseline] output=${outputPath}`);
  // eslint-disable-next-line no-console
  console.log(
    `[g1-baseline] samples=${report.source.sample_total} first_submit_success_rate=${report.metrics.first_submit_success_rate}`
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
    console.error(`[g1-baseline] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  resolvePath,
  classifyErrorCategory,
  buildRepresentativenessSummary,
  buildRecoveryObservabilitySummary,
  buildToolPrioritySummary,
  buildG1BaselineReport,
  runCli,
};

#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const {
  buildPlannerStepCdGateReport,
} = require("./generate-planner-stepcd-gate-report");
const {
  buildPlannerAliasRetirementGateReport,
} = require("./generate-planner-alias-retirement-gate-report");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  "scripts",
  "planner-cutover-gate-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "planner-cutover-gate-report.json"
);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasOwnKeys(value) {
  return Object.keys(normalizeObject(value)).length > 0;
}

function pickFirstObjectWithKeys(...candidates) {
  for (const candidate of candidates) {
    const normalized = normalizeObject(candidate);
    if (Object.keys(normalized).length > 0) {
      return normalized;
    }
  }
  return {};
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === 0 || value === "0" || value === "false") {
    return false;
  }
  return false;
}

function toNonNegativeNumber(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) {
    return n;
  }
  const f = Number(fallback);
  return Number.isFinite(f) && f >= 0 ? f : 0;
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
  const output = {
    inputPath: DEFAULT_INPUT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    ci: false,
  };
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if ((token === "--input" || token === "-i") && i + 1 < args.length) {
      output.inputPath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if ((token === "--output" || token === "-o") && i + 1 < args.length) {
      output.outputPath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if (token === "--ci") {
      output.ci = true;
    }
  }
  return output;
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
    throw new Error(`planner cutover gate input file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`planner cutover gate input file is empty: ${absolutePath}`);
  }
  const normalizedRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalizedRaw);
}

function resolveSnapshotSource(input) {
  const source = normalizeObject(input);
  const snapshot = normalizeObject(source.snapshot);
  if (Object.keys(snapshot).length > 0) {
    return snapshot;
  }
  return source;
}

function resolveMcpRuntime(input) {
  const snapshot = resolveSnapshotSource(input);
  return normalizeObject(snapshot.mcp_runtime);
}

function resolvePlannerOnlyExposureSnapshot(input) {
  const source = normalizeObject(input);
  const snapshot = resolveSnapshotSource(input);
  const runtime = resolveMcpRuntime(input);
  return pickFirstObjectWithKeys(
    runtime.planner_only_exposure,
    snapshot.planner_only_exposure,
    source.planner_only_exposure
  );
}

function resolvePlannerDirectPolicyState(runtime) {
  const plannerDirect = normalizeObject(runtime.planner_direct_compatibility);
  return normalizeObject(plannerDirect.policy_state);
}

function resolvePlannerVisibilityState(runtime) {
  return normalizeObject(runtime.planner_visibility_profile);
}

function resolvePlannerExposureCounters(exposureSnapshot) {
  const counters = normalizeObject(exposureSnapshot.counters);
  const metrics = normalizeObject(exposureSnapshot.metrics);
  const plannerEntryCallTotal = toNonNegativeNumber(
    counters.planner_entry_call_total,
    metrics.planner_entry_call_total
  );
  const plannerEntryAliasCallTotal = toNonNegativeNumber(
    counters.planner_entry_alias_call_total,
    metrics.planner_entry_alias_call_total
  );
  const externalDirectRuntimeCallTotal = toNonNegativeNumber(
    counters.external_direct_runtime_call_total,
    metrics.external_direct_runtime_call_total
  );
  return {
    planner_entry_call_total: plannerEntryCallTotal,
    planner_entry_alias_call_total: plannerEntryAliasCallTotal,
    external_direct_runtime_call_total: externalDirectRuntimeCallTotal,
  };
}

function buildCheck(key, pass, details) {
  return {
    key,
    pass: pass === true,
    details: normalizeObject(details),
  };
}

function evaluatePlannerCutover(input = {}) {
  const source = normalizeObject(input);
  const snapshot = resolveSnapshotSource(source);
  const runtime = resolveMcpRuntime(source);
  const visibilityState = resolvePlannerVisibilityState(runtime);
  const plannerDirectPolicyState = resolvePlannerDirectPolicyState(runtime);
  const exposureSnapshot = resolvePlannerOnlyExposureSnapshot(source);
  const exposurePolicyState = normalizeObject(exposureSnapshot.policy_state);
  const exposureCounters = resolvePlannerExposureCounters(exposureSnapshot);

  const stepCdReport = buildPlannerStepCdGateReport({ snapshot });
  const aliasRetirementReport = buildPlannerAliasRetirementGateReport(source);

  const firstHopTotal =
    exposureCounters.planner_entry_call_total +
    exposureCounters.external_direct_runtime_call_total;
  const plannerFirstHopShare = firstHopTotal
    ? exposureCounters.planner_entry_call_total / firstHopTotal
    : 0;

  const checks = [
    buildCheck("step_cd_gate_all_passed", stepCdReport.all_passed === true, {
      all_passed: stepCdReport.all_passed === true,
    }),
    buildCheck(
      "alias_retirement_gate_all_passed",
      aliasRetirementReport.all_passed === true,
      {
        all_passed: aliasRetirementReport.all_passed === true,
      }
    ),
    buildCheck(
      "entry_governance_enabled",
      normalizeBoolean(exposurePolicyState.enabled) === true,
      {
        enabled: normalizeBoolean(exposurePolicyState.enabled),
        snapshot_present: hasOwnKeys(exposureSnapshot),
      }
    ),
    buildCheck(
      "entry_mode_reject_active",
      normalizeString(exposurePolicyState.active_mode) === "reject",
      {
        active_mode: normalizeString(exposurePolicyState.active_mode),
      }
    ),
    buildCheck(
      "planner_visibility_active_planner_first",
      normalizeString(visibilityState.active_profile) === "planner_first",
      {
        active_profile: normalizeString(visibilityState.active_profile),
      }
    ),
    buildCheck(
      "direct_compatibility_active_deny",
      normalizeString(plannerDirectPolicyState.active_mode) === "deny",
      {
        active_mode: normalizeString(plannerDirectPolicyState.active_mode),
      }
    ),
    buildCheck(
      "mcp_runtime_first_hop_planner_100pct",
      firstHopTotal > 0 &&
        exposureCounters.external_direct_runtime_call_total === 0 &&
        plannerFirstHopShare === 1,
      {
        planner_first_hop_share: plannerFirstHopShare,
        planner_entry_call_total: exposureCounters.planner_entry_call_total,
        external_direct_runtime_call_total:
          exposureCounters.external_direct_runtime_call_total,
      }
    ),
    buildCheck(
      "external_direct_runtime_call_total_zero",
      exposureCounters.external_direct_runtime_call_total === 0,
      {
        external_direct_runtime_call_total:
          exposureCounters.external_direct_runtime_call_total,
      }
    ),
    buildCheck(
      "planner_alias_call_total_zero",
      exposureCounters.planner_entry_alias_call_total === 0,
      {
        planner_entry_alias_call_total:
          exposureCounters.planner_entry_alias_call_total,
      }
    ),
  ];

  const allPassed = checks.every((item) => item.pass === true);

  return {
    gate_config: {
      step6_requires_entry_mode: "reject",
      step6_requires_visibility_profile: "planner_first",
      step6_requires_direct_compatibility_mode: "deny",
      step6_requires_first_hop_planner_share: 1,
      step6_requires_external_direct_runtime_call_total: 0,
      step6_requires_planner_alias_call_total: 0,
    },
    observation: {
      entry_governance_enabled: normalizeBoolean(exposurePolicyState.enabled),
      entry_mode_active: normalizeString(exposurePolicyState.active_mode) || "legacy",
      visibility_active_profile:
        normalizeString(visibilityState.active_profile) || "legacy_full",
      direct_compatibility_active_mode:
        normalizeString(plannerDirectPolicyState.active_mode) || "allow",
      planner_first_hop_share: plannerFirstHopShare,
      planner_entry_call_total: exposureCounters.planner_entry_call_total,
      planner_entry_alias_call_total: exposureCounters.planner_entry_alias_call_total,
      external_direct_runtime_call_total:
        exposureCounters.external_direct_runtime_call_total,
    },
    step_cd_gate_report: stepCdReport,
    alias_retirement_gate_report: aliasRetirementReport,
    checks,
    all_passed: allPassed,
    recommendation: allPassed
      ? "eligible_for_step6_cutover_complete"
      : "keep_cutover_observing",
  };
}

function buildPlannerCutoverGateReport(input = {}) {
  const evaluation = evaluatePlannerCutover(input);
  return {
    schema_version: "planner_cutover_gate_report.v1",
    generated_at: new Date().toISOString(),
    ...evaluation,
  };
}

function writeJsonReport(filePath, payload) {
  const absolutePath = resolvePath(filePath, SIDECAR_ROOT);
  const dir = path.dirname(absolutePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return absolutePath;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputPayload = readJsonOrThrow(options.inputPath);
  const report = buildPlannerCutoverGateReport(inputPayload);
  report.input_path = options.inputPath;
  report.git_commit = detectGitCommit();
  const outputPath = writeJsonReport(options.outputPath, report);

  if (options.ci && report.all_passed !== true) {
    console.error(
      `[planner-cutover-gate] failed checks=${report.checks
        .filter((item) => item.pass !== true)
        .map((item) => item.key)
        .join(",")} output=${outputPath}`
    );
    process.exit(1);
  }

  console.log(
    `[planner-cutover-gate] checks=${report.checks.length} all_passed=${report.all_passed} output=${outputPath}`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  evaluatePlannerCutover,
  buildPlannerCutoverGateReport,
};

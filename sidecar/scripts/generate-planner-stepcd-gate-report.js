#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  "scripts",
  "planner-stepcd-gate-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "planner-stepcd-gate-report.json"
);

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
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

function toNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function toStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => normalizeString(item)).filter((item) => !!item)
    : [];
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
    throw new Error(`planner StepC/StepD gate input file not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`planner StepC/StepD gate input file is empty: ${absolutePath}`);
  }
  const normalizedRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalizedRaw);
}

function normalizeVisibilityState(value) {
  const source = value && typeof value === "object" ? value : {};
  const gate = source.gate && typeof source.gate === "object" ? source.gate : {};
  const rollback =
    source.rollback && typeof source.rollback === "object" ? source.rollback : {};
  return {
    requested_profile: normalizeString(source.requested_profile) || "legacy_full",
    active_profile: normalizeString(source.active_profile) || "legacy_full",
    reason: normalizeString(source.reason) || "unspecified",
    gate: {
      passed: normalizeBoolean(gate.passed),
      reasons: toStringArray(gate.reasons),
    },
    rollback: {
      triggered: normalizeBoolean(rollback.triggered),
      reasons: toStringArray(rollback.reasons),
    },
    covered_family_keys: toStringArray(source.covered_family_keys),
    managed_tool_names: toStringArray(source.managed_tool_names),
  };
}

function normalizeDirectCompatibilityState(value) {
  const source = value && typeof value === "object" ? value : {};
  const policyState =
    source.policy_state && typeof source.policy_state === "object"
      ? source.policy_state
      : source;
  const denyGate =
    policyState.deny_gate && typeof policyState.deny_gate === "object"
      ? policyState.deny_gate
      : {};
  const rollback =
    policyState.rollback && typeof policyState.rollback === "object"
      ? policyState.rollback
      : {};
  const totalsSource =
    source.totals && typeof source.totals === "object"
      ? source.totals
      : source.counters && typeof source.counters === "object"
        ? source.counters
        : {};
  const byFamilySource = Array.isArray(source.by_family) ? source.by_family : [];
  return {
    policy_state: {
      requested_mode: normalizeString(policyState.requested_mode) || "allow",
      active_mode: normalizeString(policyState.active_mode) || "allow",
      reason: normalizeString(policyState.reason) || "unspecified",
      deny_gate: {
        passed: normalizeBoolean(denyGate.passed),
        reasons: toStringArray(denyGate.reasons),
      },
      rollback: {
        triggered: normalizeBoolean(rollback.triggered),
        reasons: toStringArray(rollback.reasons),
      },
      managed_tool_names: toStringArray(policyState.managed_tool_names),
      managed_tool_family_map:
        policyState.managed_tool_family_map &&
        typeof policyState.managed_tool_family_map === "object"
          ? { ...policyState.managed_tool_family_map }
          : {},
    },
    totals: {
      decisions_total: toNonNegativeNumber(totalsSource.decisions_total),
      allow_total: toNonNegativeNumber(totalsSource.allow_total),
      warn_total: toNonNegativeNumber(totalsSource.warn_total),
      deny_total: toNonNegativeNumber(totalsSource.deny_total),
    },
    by_family_count: byFamilySource.length,
  };
}

function evaluateStepC(visibilityState) {
  const state = normalizeVisibilityState(visibilityState);
  const checks = [];
  checks.push({
    key: "step_c_state_present",
    pass: !!state.requested_profile && !!state.active_profile,
    details: {
      requested_profile: state.requested_profile,
      active_profile: state.active_profile,
    },
  });

  let profileCoherent = false;
  if (state.requested_profile !== "planner_first") {
    profileCoherent = state.active_profile === "legacy_full";
  } else if (state.active_profile === "planner_first") {
    profileCoherent = state.gate.passed === true && state.rollback.triggered === false;
  } else {
    profileCoherent = [
      "enable_gate_not_satisfied",
      "rollback_triggered",
      "requested_legacy_full",
    ].includes(state.reason);
  }
  checks.push({
    key: "step_c_profile_transition_coherent",
    pass: profileCoherent,
    details: {
      reason: state.reason,
      gate_passed: state.gate.passed,
      rollback_triggered: state.rollback.triggered,
    },
  });

  checks.push({
    key: "step_c_gate_reasons_observable",
    pass:
      Array.isArray(state.gate.reasons) &&
      Array.isArray(state.rollback.reasons),
    details: {
      gate_reasons: state.gate.reasons,
      rollback_reasons: state.rollback.reasons,
    },
  });

  return {
    state,
    checks,
  };
}

function evaluateStepD(directState) {
  const state = normalizeDirectCompatibilityState(directState);
  const policyState = state.policy_state;
  const checks = [];

  checks.push({
    key: "step_d_state_present",
    pass: !!policyState.requested_mode && !!policyState.active_mode,
    details: {
      requested_mode: policyState.requested_mode,
      active_mode: policyState.active_mode,
    },
  });

  let modeCoherent = false;
  if (policyState.requested_mode === "allow") {
    modeCoherent = policyState.active_mode === "allow";
  } else if (policyState.requested_mode === "warn") {
    modeCoherent = policyState.active_mode === "warn";
  } else if (policyState.requested_mode === "deny") {
    if (policyState.active_mode === "deny") {
      modeCoherent =
        policyState.deny_gate.passed === true &&
        policyState.rollback.triggered === false;
    } else if (policyState.active_mode === "warn") {
      modeCoherent = [
        "deny_gate_not_satisfied",
        "deny_rollback_triggered",
      ].includes(policyState.reason);
    }
  }
  checks.push({
    key: "step_d_mode_transition_coherent",
    pass: modeCoherent,
    details: {
      reason: policyState.reason,
      deny_gate_passed: policyState.deny_gate.passed,
      rollback_triggered: policyState.rollback.triggered,
    },
  });

  checks.push({
    key: "step_d_observability_totals_present",
    pass:
      state.totals.decisions_total >= 0 &&
      state.totals.allow_total >= 0 &&
      state.totals.warn_total >= 0 &&
      state.totals.deny_total >= 0,
    details: {
      totals: state.totals,
      by_family_count: state.by_family_count,
    },
  });

  return {
    state,
    checks,
  };
}

function buildPlannerStepCdGateReport(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const snapshot = source.snapshot && typeof source.snapshot === "object"
    ? source.snapshot
    : source;
  const mcpRuntime =
    snapshot.mcp_runtime && typeof snapshot.mcp_runtime === "object"
      ? snapshot.mcp_runtime
      : {};

  const stepC = evaluateStepC(mcpRuntime.planner_visibility_profile);
  const stepD = evaluateStepD(mcpRuntime.planner_direct_compatibility);
  const checks = [...stepC.checks, ...stepD.checks];
  const allPassed = checks.every((item) => item.pass === true);

  return {
    schema_version: "planner_stepcd_gate_report.v1",
    generated_at: new Date().toISOString(),
    step_c: stepC.state,
    step_d: stepD.state,
    checks,
    all_passed: allPassed,
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
  const report = buildPlannerStepCdGateReport({
    snapshot: inputPayload,
  });
  report.input_path = options.inputPath;
  report.git_commit = detectGitCommit();
  const outputPath = writeJsonReport(options.outputPath, report);
  if (options.ci && report.all_passed !== true) {
    console.error(
      `[planner-stepcd-gate] failed checks=${report.checks
        .filter((item) => item.pass !== true)
        .map((item) => item.key)
        .join(",")} output=${outputPath}`
    );
    process.exit(1);
  }
  console.log(
    `[planner-stepcd-gate] checks=${report.checks.length} all_passed=${report.all_passed} output=${outputPath}`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  buildPlannerStepCdGateReport,
  evaluateStepC,
  evaluateStepD,
};


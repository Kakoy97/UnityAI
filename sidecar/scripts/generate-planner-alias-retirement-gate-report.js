#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_INPUT_PATH = path.join(
  SIDECAR_ROOT,
  "scripts",
  "planner-alias-retirement-gate-samples.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "planner-alias-retirement-gate-report.json"
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

function toNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return Number.isFinite(Number(fallback)) && Number(fallback) >= 0
      ? Number(fallback)
      : 0;
  }
  return parsed;
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
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || "").trim();
    if ((token === "--input" || token === "-i") && index + 1 < args.length) {
      output.inputPath = resolvePath(args[index + 1], SIDECAR_ROOT);
      index += 1;
      continue;
    }
    if ((token === "--output" || token === "-o") && index + 1 < args.length) {
      output.outputPath = resolvePath(args[index + 1], SIDECAR_ROOT);
      index += 1;
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
    throw new Error(
      `planner alias retirement gate input file not found: ${absolutePath}`
    );
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(
      `planner alias retirement gate input file is empty: ${absolutePath}`
    );
  }
  const normalizedRaw = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(normalizedRaw);
}

function toIsoDate(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "";
  }
  const parsed = new Date(normalized);
  const time = parsed.getTime();
  if (!Number.isFinite(time)) {
    return "";
  }
  return parsed.toISOString().slice(0, 10);
}

function resolveAliasWindowSource(input) {
  const source = input && typeof input === "object" ? input : {};
  const snapshot =
    source.snapshot && typeof source.snapshot === "object" ? source.snapshot : source;
  const mcpRuntime =
    snapshot.mcp_runtime && typeof snapshot.mcp_runtime === "object"
      ? snapshot.mcp_runtime
      : {};
  const plannerOnlyExposure =
    mcpRuntime.planner_only_exposure &&
    typeof mcpRuntime.planner_only_exposure === "object"
      ? mcpRuntime.planner_only_exposure
      : source.planner_only_exposure && typeof source.planner_only_exposure === "object"
        ? source.planner_only_exposure
        : {};
  return (
    (source.alias_retirement_window &&
      typeof source.alias_retirement_window === "object" &&
      source.alias_retirement_window) ||
    (snapshot.alias_retirement_window &&
      typeof snapshot.alias_retirement_window === "object" &&
      snapshot.alias_retirement_window) ||
    (mcpRuntime.planner_alias_retirement &&
      typeof mcpRuntime.planner_alias_retirement === "object" &&
      mcpRuntime.planner_alias_retirement) ||
    (plannerOnlyExposure.alias_retirement_window &&
      typeof plannerOnlyExposure.alias_retirement_window === "object" &&
      plannerOnlyExposure.alias_retirement_window) ||
    {}
  );
}

function normalizeDailyRows(value) {
  const source = Array.isArray(value) ? value : [];
  const rows = source.map((item) => {
    const row = item && typeof item === "object" ? item : {};
    const date = toIsoDate(row.date || row.day || row.window_day);
    const plannerEntryCallTotal = toNonNegativeNumber(
      row.planner_entry_call_total !== undefined
        ? row.planner_entry_call_total
        : row.planner_entry_total,
      0
    );
    const plannerAliasCallTotal = toNonNegativeNumber(
      row.planner_entry_alias_call_total !== undefined
        ? row.planner_entry_alias_call_total
        : row.alias_call_total,
      0
    );
    const p1IncidentCount = toNonNegativeNumber(
      row.p1_incident_count !== undefined
        ? row.p1_incident_count
        : row.incident_p1_count,
      0
    );
    const aliasShare =
      plannerEntryCallTotal > 0
        ? plannerAliasCallTotal / plannerEntryCallTotal
        : plannerAliasCallTotal > 0
          ? 1
          : 0;

    return {
      date,
      planner_entry_call_total: plannerEntryCallTotal,
      planner_entry_alias_call_total: plannerAliasCallTotal,
      p1_incident_count: p1IncidentCount,
      alias_call_share: aliasShare,
    };
  });

  return rows
    .filter((row) => !!row.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function isConsecutiveDates(rows) {
  if (!Array.isArray(rows) || rows.length <= 1) {
    return true;
  }
  for (let i = 1; i < rows.length; i += 1) {
    const prev = new Date(rows[i - 1].date);
    const curr = new Date(rows[i].date);
    const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000);
    if (!Number.isFinite(diffDays) || diffDays !== 1) {
      return false;
    }
  }
  return true;
}

function evaluateAliasRetirement(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const aliasWindow = resolveAliasWindowSource(source);
  const requiredConsecutiveDays = Math.max(
    1,
    Math.floor(
      toNonNegativeNumber(
        aliasWindow.required_consecutive_days !== undefined
          ? aliasWindow.required_consecutive_days
          : source.required_consecutive_days,
        14
      )
    )
  );
  const aliasShareMax = toNonNegativeNumber(
    aliasWindow.alias_share_max !== undefined
      ? aliasWindow.alias_share_max
      : source.alias_share_max,
    0.01
  );
  const requiredReleaseWindows = Math.max(
    1,
    Math.floor(
      toNonNegativeNumber(
        aliasWindow.required_release_windows !== undefined
          ? aliasWindow.required_release_windows
          : source.required_release_windows,
        2
      )
    )
  );
  const p1IncidentMax = Math.floor(
    toNonNegativeNumber(
      aliasWindow.p1_incident_max !== undefined
        ? aliasWindow.p1_incident_max
        : source.p1_incident_max,
      0
    )
  );
  const releaseWindowsCompleted = Math.floor(
    toNonNegativeNumber(
      aliasWindow.release_windows_completed !== undefined
        ? aliasWindow.release_windows_completed
        : source.release_windows_completed,
      0
    )
  );
  const announcementPublished = normalizeBoolean(
    aliasWindow.announcement_published !== undefined
      ? aliasWindow.announcement_published
      : source.announcement_published
  );
  const dailyRows = normalizeDailyRows(
    aliasWindow.daily !== undefined ? aliasWindow.daily : source.daily
  );
  const windowRows = dailyRows.slice(-requiredConsecutiveDays);
  const hasRequiredDays = windowRows.length === requiredConsecutiveDays;
  const isConsecutive = hasRequiredDays ? isConsecutiveDates(windowRows) : false;

  const aliasShareViolations = [];
  for (const row of windowRows) {
    if (row.alias_call_share >= aliasShareMax) {
      aliasShareViolations.push({
        date: row.date,
        alias_call_share: row.alias_call_share,
        alias_share_max: aliasShareMax,
      });
    }
  }

  const p1IncidentCountWindow = windowRows.reduce(
    (sum, row) => sum + toNonNegativeNumber(row.p1_incident_count, 0),
    0
  );
  const hasP1Regression = p1IncidentCountWindow > p1IncidentMax;

  const checks = [
    {
      key: "alias_window_has_required_days",
      pass: hasRequiredDays,
      details: {
        required_consecutive_days: requiredConsecutiveDays,
        observed_days: windowRows.length,
      },
    },
    {
      key: "alias_window_is_consecutive_daily",
      pass: isConsecutive,
      details: {
        required_consecutive_days: requiredConsecutiveDays,
        window_start_date: hasRequiredDays ? windowRows[0].date : "",
        window_end_date: hasRequiredDays
          ? windowRows[windowRows.length - 1].date
          : "",
      },
    },
    {
      key: "alias_share_below_threshold",
      pass: hasRequiredDays && isConsecutive && aliasShareViolations.length === 0,
      details: {
        alias_share_max: aliasShareMax,
        violation_count: aliasShareViolations.length,
        violations: aliasShareViolations,
      },
    },
    {
      key: "alias_window_has_zero_p1_incidents",
      pass: hasRequiredDays && isConsecutive && !hasP1Regression,
      details: {
        p1_incident_max: p1IncidentMax,
        p1_incident_count_14d: p1IncidentCountWindow,
      },
    },
    {
      key: "alias_retirement_announcement_published",
      pass: announcementPublished === true,
      details: {
        announcement_published: announcementPublished,
      },
    },
    {
      key: "alias_retirement_release_windows_completed",
      pass: releaseWindowsCompleted >= requiredReleaseWindows,
      details: {
        required_release_windows: requiredReleaseWindows,
        release_windows_completed: releaseWindowsCompleted,
      },
    },
  ];

  const allPassed = checks.every((item) => item.pass === true);
  const observedAliasShare = windowRows.map((row) =>
    toNonNegativeNumber(row.alias_call_share, 0)
  );
  const aliasShareMaxObserved =
    observedAliasShare.length > 0 ? Math.max(...observedAliasShare) : 0;
  const aliasShareAvgObserved =
    observedAliasShare.length > 0
      ? observedAliasShare.reduce((sum, value) => sum + value, 0) /
        observedAliasShare.length
      : 0;

  return {
    gate_config: {
      required_consecutive_days: requiredConsecutiveDays,
      alias_share_max: aliasShareMax,
      required_release_windows: requiredReleaseWindows,
      p1_incident_max: p1IncidentMax,
    },
    observation: {
      window_start_date: hasRequiredDays && windowRows[0] ? windowRows[0].date : "",
      window_end_date:
        hasRequiredDays && windowRows[windowRows.length - 1]
          ? windowRows[windowRows.length - 1].date
          : "",
      observed_days: windowRows.length,
      alias_share_max_observed_14d: aliasShareMaxObserved,
      alias_share_avg_observed_14d: aliasShareAvgObserved,
      p1_incident_count_14d: p1IncidentCountWindow,
      announcement_published: announcementPublished,
      release_windows_completed: releaseWindowsCompleted,
    },
    checks,
    all_passed: allPassed,
    recommendation:
      allPassed === true ? "eligible_for_alias_removal" : "keep_alias_for_compat",
  };
}

function buildPlannerAliasRetirementGateReport(input = {}) {
  const evaluation = evaluateAliasRetirement(input);
  return {
    schema_version: "planner_alias_retirement_gate_report.v1",
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
  const report = buildPlannerAliasRetirementGateReport(inputPayload);
  report.input_path = options.inputPath;
  report.git_commit = detectGitCommit();
  const outputPath = writeJsonReport(options.outputPath, report);

  if (options.ci && report.all_passed !== true) {
    console.error(
      `[planner-alias-retirement-gate] failed checks=${report.checks
        .filter((item) => item.pass !== true)
        .map((item) => item.key)
        .join(",")} output=${outputPath}`
    );
    process.exit(1);
  }

  console.log(
    `[planner-alias-retirement-gate] checks=${report.checks.length} all_passed=${report.all_passed} output=${outputPath}`
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  parseArgs,
  evaluateAliasRetirement,
  buildPlannerAliasRetirementGateReport,
};

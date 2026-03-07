#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const SIDECAR_ROOT = path.resolve(__dirname, "..");
const DEFAULT_BASELINE_REPORT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g1-baseline-report.json"
);
const DEFAULT_OUTPUT_PATH = path.join(
  SIDECAR_ROOT,
  ".state",
  "g1-tool-priority-freeze.json"
);
const DEFAULT_DICTIONARY_PATH = path.resolve(
  SIDECAR_ROOT,
  "..",
  "ssot",
  "dictionary",
  "tools.json"
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
  const input = {
    baselinePath: DEFAULT_BASELINE_REPORT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    dictionaryPath: DEFAULT_DICTIONARY_PATH,
    writeDictionary: false,
    allowRepresentativenessFail: false,
  };
  const args = Array.isArray(argv) ? argv : [];
  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "").trim();
    if ((token === "--baseline" || token === "-b") && i + 1 < args.length) {
      input.baselinePath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if ((token === "--output" || token === "-o") && i + 1 < args.length) {
      input.outputPath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if ((token === "--dictionary" || token === "-d") && i + 1 < args.length) {
      input.dictionaryPath = resolvePath(args[i + 1], SIDECAR_ROOT);
      i += 1;
      continue;
    }
    if (token === "--write-dictionary") {
      input.writeDictionary = true;
      continue;
    }
    if (token === "--allow-representativeness-fail") {
      input.allowRepresentativenessFail = true;
      continue;
    }
  }
  return input;
}

function readJsonOrThrow(filePath, label) {
  const absolutePath = resolvePath(filePath, SIDECAR_ROOT);
  if (!absolutePath || !fs.existsSync(absolutePath)) {
    throw new Error(`${label || "json file"} not found: ${absolutePath}`);
  }
  const raw = fs.readFileSync(absolutePath, "utf8");
  if (!raw || !raw.trim()) {
    throw new Error(`${label || "json file"} is empty: ${absolutePath}`);
  }
  return JSON.parse(raw);
}

function assertDictionaryShape(dictionary) {
  if (!dictionary || typeof dictionary !== "object" || Array.isArray(dictionary)) {
    throw new Error("Dictionary root must be object");
  }
  if (!Array.isArray(dictionary.tools)) {
    throw new Error("Dictionary missing tools array");
  }
}

function normalizeToolPriorityRows(baselineReport) {
  const report = baselineReport && typeof baselineReport === "object" ? baselineReport : {};
  const toolPriority =
    report.tool_priority && typeof report.tool_priority === "object"
      ? report.tool_priority
      : {};
  const rows = Array.isArray(toolPriority.tools) ? toolPriority.tools : [];
  return rows
    .map((item) => {
      const row = item && typeof item === "object" ? item : {};
      return {
        tool_name: String(row.tool_name || "").trim(),
        priority: String(row.priority || "").trim().toUpperCase(),
        score: Number(row.score) || 0,
        call_ratio: Number(row.call_ratio) || 0,
        error_ratio: Number(row.error_ratio) || 0,
        call_count: Number.isFinite(Number(row.call_count)) ? Math.floor(Number(row.call_count)) : 0,
        error_count: Number.isFinite(Number(row.error_count))
          ? Math.floor(Number(row.error_count))
          : 0,
      };
    })
    .filter((item) => item.tool_name.length > 0);
}

function normalizePriority(priority) {
  const token = String(priority || "").trim().toUpperCase();
  if (token === "P0" || token === "P1" || token === "P2") {
    return token;
  }
  return "P2";
}

function buildPriorityFreeze(baselineReport, dictionary, options) {
  const opts = options && typeof options === "object" ? options : {};
  const baseline = baselineReport && typeof baselineReport === "object" ? baselineReport : {};
  const representativeness =
    baseline.representativeness && typeof baseline.representativeness === "object"
      ? baseline.representativeness
      : {};
  if (representativeness.all_passed === false && !opts.allowRepresentativenessFail) {
    throw new Error(
      "Baseline representativeness check failed; re-sample before generating tool priority freeze."
    );
  }

  assertDictionaryShape(dictionary);

  const rows = normalizeToolPriorityRows(baseline);
  const dictionaryToolNames = dictionary.tools
    .map((tool) => (tool && typeof tool.name === "string" ? tool.name.trim() : ""))
    .filter((name) => name.length > 0);
  const dictionarySet = new Set(dictionaryToolNames);

  const unknownBaselineTools = rows
    .map((item) => item.tool_name)
    .filter((name) => !dictionarySet.has(name))
    .sort((a, b) => a.localeCompare(b));
  if (unknownBaselineTools.length > 0) {
    throw new Error(
      `Baseline contains tools absent in dictionary: ${unknownBaselineTools.join(", ")}`
    );
  }

  const rowMap = new Map();
  for (const row of rows) {
    rowMap.set(row.tool_name, row);
  }

  const tools = dictionaryToolNames.map((toolName) => {
    const row = rowMap.get(toolName);
    const priority = normalizePriority(row ? row.priority : "P2");
    return {
      tool_name: toolName,
      tool_priority: priority,
      must_configure: priority === "P0",
      score: row ? Number(row.score.toFixed(6)) : 0,
      call_ratio: row ? Number(row.call_ratio.toFixed(6)) : 0,
      error_ratio: row ? Number(row.error_ratio.toFixed(6)) : 0,
      call_count: row ? row.call_count : 0,
      error_count: row ? row.error_count : 0,
      observed_in_baseline: !!row,
      freeze_reason: row ? "from_baseline" : "not_observed_in_baseline_default_p2",
    };
  });

  tools.sort((a, b) => {
    if (a.tool_priority !== b.tool_priority) {
      return a.tool_priority.localeCompare(b.tool_priority);
    }
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.tool_name.localeCompare(b.tool_name);
  });

  const p0Tools = tools
    .filter((item) => item.tool_priority === "P0")
    .map((item) => item.tool_name);
  const p1Tools = tools
    .filter((item) => item.tool_priority === "P1")
    .map((item) => item.tool_name);
  const p2Tools = tools
    .filter((item) => item.tool_priority === "P2")
    .map((item) => item.tool_name);
  const unobservedTools = tools
    .filter((item) => !item.observed_in_baseline)
    .map((item) => item.tool_name);

  return {
    schema_version: "g1_tool_priority_freeze.v1",
    generated_at: new Date().toISOString(),
    source: {
      baseline_schema_version:
        typeof baseline.schema_version === "string" ? baseline.schema_version : "",
      baseline_generated_at:
        typeof baseline.generated_at === "string" ? baseline.generated_at : "",
      baseline_git_commit:
        baseline.source && typeof baseline.source === "object"
          ? String(baseline.source.git_commit || "")
          : "",
      dictionary_path: resolvePath(opts.dictionaryPath, SIDECAR_ROOT),
      dictionary_tool_total: dictionaryToolNames.length,
      observed_tool_total: rows.length,
    },
    representativeness_gate: {
      all_passed: representativeness.all_passed !== false,
      allow_representativeness_fail: !!opts.allowRepresentativenessFail,
      checks:
        Array.isArray(representativeness.checks) && representativeness.checks.length > 0
          ? representativeness.checks
          : [],
    },
    summary: {
      p0_total: p0Tools.length,
      p1_total: p1Tools.length,
      p2_total: p2Tools.length,
      unobserved_tool_total: unobservedTools.length,
    },
    p0_tools: p0Tools,
    p1_tools: p1Tools,
    p2_tools: p2Tools,
    unobserved_tools: unobservedTools,
    tools,
  };
}

function applyFreezeToDictionary(dictionary, freezeReport) {
  assertDictionaryShape(dictionary);
  const freeze = freezeReport && typeof freezeReport === "object" ? freezeReport : {};
  const tools = Array.isArray(freeze.tools) ? freeze.tools : [];
  const map = new Map();
  for (const item of tools) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const name = String(item.tool_name || "").trim();
    if (!name) {
      continue;
    }
    map.set(name, {
      tool_priority: normalizePriority(item.tool_priority),
      must_configure: item.must_configure === true,
      priority_score: Number(item.score) || 0,
    });
  }

  for (const tool of dictionary.tools) {
    const name = tool && typeof tool.name === "string" ? tool.name.trim() : "";
    if (!name || !map.has(name)) {
      continue;
    }
    const row = map.get(name);
    tool.tool_priority = row.tool_priority;
    tool.must_configure = row.must_configure;
    tool.priority_score = Number(row.priority_score.toFixed(6));
  }

  if (!dictionary._definitions || typeof dictionary._definitions !== "object") {
    dictionary._definitions = {};
  }
  dictionary._definitions.g1_priority_freeze = {
    schema_version: String(freeze.schema_version || "g1_tool_priority_freeze.v1"),
    generated_at: String(freeze.generated_at || new Date().toISOString()),
    source_git_commit:
      freeze.source && typeof freeze.source === "object"
        ? String(freeze.source.baseline_git_commit || "")
        : "",
    p0_total: Array.isArray(freeze.p0_tools) ? freeze.p0_tools.length : 0,
    p1_total: Array.isArray(freeze.p1_tools) ? freeze.p1_tools.length : 0,
    p2_total: Array.isArray(freeze.p2_tools) ? freeze.p2_tools.length : 0,
  };

  return dictionary;
}

function writeJson(targetPath, payload) {
  const absolutePath = resolvePath(targetPath, SIDECAR_ROOT);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, JSON.stringify(payload, null, 2), "utf8");
  return absolutePath;
}

function runCli(argv) {
  const options = parseArgs(argv);
  const baseline = readJsonOrThrow(options.baselinePath, "baseline report");
  const dictionary = readJsonOrThrow(options.dictionaryPath, "dictionary");
  const freeze = buildPriorityFreeze(baseline, dictionary, options);
  const outputPath = writeJson(options.outputPath, freeze);

  let dictionaryPath = "";
  if (options.writeDictionary) {
    const updated = applyFreezeToDictionary(dictionary, freeze);
    dictionaryPath = writeJson(options.dictionaryPath, updated);
  }

  // eslint-disable-next-line no-console
  console.log(`[g1-priority-freeze] baseline=${resolvePath(options.baselinePath, SIDECAR_ROOT)}`);
  // eslint-disable-next-line no-console
  console.log(`[g1-priority-freeze] freeze=${outputPath}`);
  if (dictionaryPath) {
    // eslint-disable-next-line no-console
    console.log(`[g1-priority-freeze] dictionary_updated=${dictionaryPath}`);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[g1-priority-freeze] p0=${freeze.summary.p0_total} p1=${freeze.summary.p1_total} p2=${freeze.summary.p2_total}`
  );
  return {
    freeze,
    outputPath,
    dictionaryPath,
  };
}

if (require.main === module) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    const message = error && error.stack ? error.stack : String(error || "");
    // eslint-disable-next-line no-console
    console.error(`[g1-priority-freeze] fatal: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  buildPriorityFreeze,
  applyFreezeToDictionary,
  runCli,
  resolvePath,
};


#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { CodexAppServerPlanner } = require("../src/adapters/codexAppServerPlanner");

const DEFAULT_ROUNDS = 20;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);

  const baseline = await runSuite({
    runId,
    name: "filter_off",
    rounds: args.rounds,
    scopeFilterEnabled: false,
    minKeepLines: args.minKeepLines,
  });
  const candidate = await runSuite({
    runId,
    name: "filter_on",
    rounds: args.rounds,
    scopeFilterEnabled: true,
    minKeepLines: args.minKeepLines,
  });

  const comparison = buildComparison(baseline, candidate);
  const report = {
    version: 1,
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    config: {
      rounds: args.rounds,
      min_keep_lines: args.minKeepLines,
      focus_scope: "Scene/Canvas/TargetB",
    },
    baseline,
    candidate,
    comparison,
  };

  const reportPath = writeReport(report);
  printSummary(report, reportPath);
  process.exitCode = comparison.summary.improved ? 0 : 2;
}

function parseArgs(argv) {
  const args = {
    rounds: DEFAULT_ROUNDS,
    minKeepLines: 1,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    if (token === "--rounds" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.rounds = Math.floor(n);
      }
      i += 1;
      continue;
    }
    if (token === "--min-keep-lines" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.minKeepLines = Math.floor(n);
      }
      i += 1;
      continue;
    }
  }
  return args;
}

async function runSuite(options) {
  const opts = options && typeof options === "object" ? options : {};
  const rounds = Number.isFinite(opts.rounds) && opts.rounds > 0
    ? Number(opts.rounds)
    : DEFAULT_ROUNDS;
  const suiteName = typeof opts.name === "string" ? opts.name : "suite";
  const runId = typeof opts.runId === "string" ? opts.runId : "run";
  const scopeFilterEnabled = opts.scopeFilterEnabled === true;
  const minKeepLines =
    Number.isFinite(opts.minKeepLines) && opts.minKeepLines > 0
      ? Number(opts.minKeepLines)
      : 1;

  const planner = new CodexAppServerPlanner({
    workspaceRoot: path.resolve(__dirname, "..", ".."),
    timeoutMs: 1000,
    executable: "codex",
    promptTemplate: "v2",
    memoryInjectionMode: "always",
    memoryCapsuleMode: "legacy",
    memoryScopeFilterEnabled: scopeFilterEnabled,
    memoryScopeFilterMinKeepLines: minKeepLines,
    snapshotStore: null,
  });

  const sessionKey = `step7_scope_filter_${suiteName}_${runId}`;
  const context = {
    scene_path: "Scene/MainScene",
    selection_tree: {
      max_depth: 2,
      root: {
        name: "TargetB",
        path: "Scene/Canvas/TargetB",
        depth: 0,
        children: [],
      },
    },
  };
  const userMessage = "continue changes for Scene/Canvas/TargetB";
  const roundsOut = [];

  try {
    for (let round = 1; round <= rounds; round += 1) {
      planner.persistedConversationMemory.set(sessionKey, {
        lines: buildMixedScopeMemoryLines(round),
        updatedAt: Date.now(),
      });
      const details = planner.getConversationMemoryCapsuleDetails(sessionKey, {
        context,
        userMessage,
      });
      const text = details && typeof details.text === "string" ? details.text : "";
      roundsOut.push({
        round,
        memory_chars: text.length,
        memory_lines: toNumber(details.included_lines),
        raw_source_lines: toNumber(details.raw_source_lines),
        relevance_dropped_lines: toNumber(details.relevance_dropped_lines),
        relevance_filtered: details.relevance_filtered === true,
        relevant_mentions: countMentions(text, "TargetB"),
        irrelevant_mentions:
          countMentions(text, "TargetA") + countMentions(text, "TargetC"),
      });
    }
  } finally {
    await planner.close();
  }

  const relevanceFilteredRounds = roundsOut.filter((item) => item.relevance_filtered).length;
  return {
    name: suiteName,
    scope_filter_enabled: scopeFilterEnabled,
    rounds,
    metrics: {
      memory_chars: percentileSummary(roundsOut.map((item) => item.memory_chars)),
      relevance_dropped_lines: percentileSummary(
        roundsOut.map((item) => item.relevance_dropped_lines)
      ),
      irrelevant_mentions: percentileSummary(
        roundsOut.map((item) => item.irrelevant_mentions)
      ),
      relevant_mentions: percentileSummary(
        roundsOut.map((item) => item.relevant_mentions)
      ),
      relevance_filtered_round_ratio:
        roundsOut.length > 0 ? relevanceFilteredRounds / roundsOut.length : 0,
    },
    samples: roundsOut.slice(0, 6),
  };
}

function buildMixedScopeMemoryLines(round) {
  const lines = [
    `Plan | Goal=taskA_${round} | Scope=Scene/Canvas/TargetA | Actions=visuals(1):CompA@Scene/Canvas/TargetA`,
    `Final | Outcome=completed(okA_${round}) | Compile=ok | Action=ok`,
    `Plan | Goal=taskB_${round} | Scope=Scene/Canvas/TargetB | Actions=visuals(1):CompB@Scene/Canvas/TargetB`,
    `Final | Outcome=failed(action_failed_B_${round}) | Compile=ok | Action=fail | Error=E_ACTION_COMPONENT_NOT_FOUND`,
    `Plan | Goal=taskC_${round} | Scope=Scene/Canvas/TargetC | Actions=visuals(1):CompC@Scene/Canvas/TargetC`,
    `Final | Outcome=completed(okC_${round}) | Compile=ok | Action=ok`,
  ];
  if (round % 2 === 0) {
    lines.push(
      `Plan | Goal=taskB_extra_${round} | Scope=Scene/Canvas/TargetB | Actions=visuals(1):CompB2@Scene/Canvas/TargetB`
    );
  }
  return lines;
}

function countMentions(text, token) {
  const source = typeof text === "string" ? text : "";
  const needle = typeof token === "string" ? token : "";
  if (!source || !needle) {
    return 0;
  }
  let index = 0;
  let count = 0;
  while (index >= 0) {
    index = source.indexOf(needle, index);
    if (index < 0) {
      break;
    }
    count += 1;
    index += needle.length;
  }
  return count;
}

function buildComparison(baseline, candidate) {
  const b = baseline && baseline.metrics ? baseline.metrics : {};
  const c = candidate && candidate.metrics ? candidate.metrics : {};
  const irrelevantP50Delta = computeDeltaPercent(
    valueAt(b.irrelevant_mentions, "p50"),
    valueAt(c.irrelevant_mentions, "p50")
  );
  const irrelevantP95Delta = computeDeltaPercent(
    valueAt(b.irrelevant_mentions, "p95"),
    valueAt(c.irrelevant_mentions, "p95")
  );
  const charsP50Delta = computeDeltaPercent(
    valueAt(b.memory_chars, "p50"),
    valueAt(c.memory_chars, "p50")
  );
  const charsP95Delta = computeDeltaPercent(
    valueAt(b.memory_chars, "p95"),
    valueAt(c.memory_chars, "p95")
  );
  const relevantP50Before = valueAt(b.relevant_mentions, "p50");
  const relevantP50After = valueAt(c.relevant_mentions, "p50");
  const improved =
    Number.isFinite(irrelevantP50Delta) &&
    Number.isFinite(irrelevantP95Delta) &&
    irrelevantP50Delta < 0 &&
    irrelevantP95Delta < 0 &&
    relevantP50After >= Math.max(1, relevantP50Before * 0.5);

  return {
    summary: {
      comparable: true,
      improved,
    },
    deltas: {
      irrelevant_mentions_p50_delta_percent: irrelevantP50Delta,
      irrelevant_mentions_p95_delta_percent: irrelevantP95Delta,
      memory_chars_p50_delta_percent: charsP50Delta,
      memory_chars_p95_delta_percent: charsP95Delta,
    },
  };
}

function computeDeltaPercent(before, after) {
  const b = Number(before);
  const a = Number(after);
  if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(a)) {
    return 0;
  }
  return ((a - b) / b) * 100;
}

function valueAt(summary, key) {
  if (!summary || typeof summary !== "object") {
    return 0;
  }
  const n = Number(summary[key]);
  return Number.isFinite(n) ? n : 0;
}

function percentileSummary(values) {
  const arr = Array.isArray(values)
    ? values.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];
  if (arr.length === 0) {
    return { count: 0, p50: 0, p95: 0, min: 0, max: 0, avg: 0 };
  }
  arr.sort((a, b) => a - b);
  const sum = arr.reduce((acc, item) => acc + item, 0);
  return {
    count: arr.length,
    p50: percentile(arr, 50),
    p95: percentile(arr, 95),
    min: arr[0],
    max: arr[arr.length - 1],
    avg: sum / arr.length,
  };
}

function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) {
    return 0;
  }
  const rank = (Number(p) / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sorted[low];
  }
  const weight = rank - low;
  return sorted[low] * (1 - weight) + sorted[high] * weight;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function writeReport(report) {
  const stateDir = path.resolve(__dirname, "..", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, `step7-scope-filter-compare-${report.run_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const deltas =
    report && report.comparison && report.comparison.deltas
      ? report.comparison.deltas
      : {};
  // eslint-disable-next-line no-console
  console.log(`[step7-scope] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(`[step7-scope] improved=${report.comparison.summary.improved}`);
  // eslint-disable-next-line no-console
  console.log(
    `[step7-scope] irrelevant_delta_p50=${formatPercent(deltas.irrelevant_mentions_p50_delta_percent)} irrelevant_delta_p95=${formatPercent(deltas.irrelevant_mentions_p95_delta_percent)}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[step7-scope] memory_chars_delta_p50=${formatPercent(deltas.memory_chars_p50_delta_percent)} memory_chars_delta_p95=${formatPercent(deltas.memory_chars_p95_delta_percent)}`
  );
  // eslint-disable-next-line no-console
  console.log(`[step7-scope] report=${reportPath}`);
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "0.00%";
  }
  return `${n.toFixed(2)}%`;
}

function buildRunId(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const ms = String(d.getUTCMilliseconds()).padStart(3, "0");
  const pid = String(process.pid || 0).padStart(5, "0");
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
  return [
    d.getUTCFullYear(),
    pad(d.getUTCMonth() + 1),
    pad(d.getUTCDate()),
    "_",
    pad(d.getUTCHours()),
    pad(d.getUTCMinutes()),
    pad(d.getUTCSeconds()),
    ms,
    "_",
    pid,
    "_",
    rand,
  ].join("");
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    `[step7-scope] fatal: ${error && error.stack ? error.stack : error}`
  );
  process.exitCode = 1;
});

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { CodexAppServerPlanner } = require("../src/adapters/codexAppServerPlanner");

const DEFAULT_ROUNDS = 24;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const runId = buildRunId(startedAt);

  const legacy = await runSuite({
    runId,
    mode: "legacy",
    rounds: args.rounds,
    hotLines: args.hotLines,
    capsuleMaxLines: args.capsuleMaxLines,
    coldSummaryMaxChars: args.coldSummaryMaxChars,
  });
  const layered = await runSuite({
    runId,
    mode: "layered",
    rounds: args.rounds,
    hotLines: args.hotLines,
    capsuleMaxLines: args.capsuleMaxLines,
    coldSummaryMaxChars: args.coldSummaryMaxChars,
  });

  const comparison = buildComparison(legacy, layered);
  const report = {
    version: 1,
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    config: {
      rounds: args.rounds,
      hot_lines: args.hotLines,
      capsule_max_lines: args.capsuleMaxLines,
      cold_summary_max_chars: args.coldSummaryMaxChars,
    },
    baseline: legacy,
    candidate: layered,
    comparison,
  };

  const reportPath = writeReport(report);
  printSummary(report, reportPath);
  process.exitCode = comparison.summary.improved ? 0 : 2;
}

function parseArgs(argv) {
  const args = {
    rounds: DEFAULT_ROUNDS,
    hotLines: 2,
    capsuleMaxLines: 4,
    coldSummaryMaxChars: 220,
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
    if (token === "--hot-lines" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.hotLines = Math.floor(n);
      }
      i += 1;
      continue;
    }
    if (token === "--capsule-max-lines" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.capsuleMaxLines = Math.floor(n);
      }
      i += 1;
      continue;
    }
    if (token === "--cold-summary-max-chars" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.coldSummaryMaxChars = Math.floor(n);
      }
      i += 1;
      continue;
    }
  }

  return args;
}

async function runSuite(options) {
  const opts = options && typeof options === "object" ? options : {};
  const mode = opts.mode === "layered" ? "layered" : "legacy";
  const rounds = Number.isFinite(opts.rounds) && opts.rounds > 0
    ? Number(opts.rounds)
    : DEFAULT_ROUNDS;
  const runId = typeof opts.runId === "string" ? opts.runId : "unknown";
  const sessionKey = `step7_memory_${mode}_${runId}`;
  const planner = new CodexAppServerPlanner({
    workspaceRoot: path.resolve(__dirname, "..", ".."),
    timeoutMs: 1000,
    executable: "codex",
    promptTemplate: "v2",
    memoryInjectionMode: "always",
    memoryCapsuleMode: mode,
    memoryHotLines:
      Number.isFinite(opts.hotLines) && opts.hotLines > 0 ? Number(opts.hotLines) : 2,
    memoryCapsuleMaxLines:
      Number.isFinite(opts.capsuleMaxLines) && opts.capsuleMaxLines > 0
        ? Number(opts.capsuleMaxLines)
        : 4,
    memoryColdSummaryMaxChars:
      Number.isFinite(opts.coldSummaryMaxChars) && opts.coldSummaryMaxChars > 0
        ? Number(opts.coldSummaryMaxChars)
        : 220,
    snapshotStore: null,
  });

  const roundsOut = [];
  try {
    for (let round = 1; round <= rounds; round += 1) {
      const lines = buildSyntheticMemoryLines(round);
      planner.persistedConversationMemory.set(sessionKey, {
        lines,
        updatedAt: Date.now(),
      });
      const details = planner.getConversationMemoryCapsuleDetails(sessionKey);
      const context = buildSyntheticContext(round);
      const prompt = planner.buildConversationPrompt(
        buildSyntheticUserMessage(round),
        context,
        {
          memoryCapsule: details.text,
        }
      );
      roundsOut.push({
        round,
        source_lines: toNumber(details.source_lines),
        memory_lines: toNumber(details.included_lines),
        memory_chars: details && typeof details.text === "string" ? details.text.length : 0,
        saved_lines: toNumber(details.saved_lines),
        compaction_ratio: toNumber(details.compaction_ratio),
        cold_summary_included: details.cold_summary_included === true,
        cold_summary_chars: toNumber(details.cold_summary_chars),
        prompt_chars: typeof prompt === "string" ? prompt.length : 0,
      });
    }
  } finally {
    await planner.close();
  }

  return {
    mode,
    rounds,
    metrics: {
      source_lines: percentileSummary(roundsOut.map((item) => item.source_lines)),
      memory_lines: percentileSummary(roundsOut.map((item) => item.memory_lines)),
      memory_chars: percentileSummary(roundsOut.map((item) => item.memory_chars)),
      saved_lines: percentileSummary(roundsOut.map((item) => item.saved_lines)),
      compaction_ratio: percentileSummary(roundsOut.map((item) => item.compaction_ratio)),
      prompt_chars: percentileSummary(roundsOut.map((item) => item.prompt_chars)),
    },
    samples: roundsOut.slice(0, 5),
  };
}

function buildSyntheticMemoryLines(round) {
  const lines = [];
  const totalPairs = Math.max(2, round + 3);
  for (let i = 1; i <= totalPairs; i += 1) {
    lines.push(
      `Plan | Goal=task_${round}_${i} | Scope=Scene/Canvas/Node_${(i % 4) + 1} | Actions=visuals(1):Comp_${i}@Scene/Canvas/Node_${(i % 4) + 1}`
    );
    if (i % 3 === 0) {
      lines.push(
        `Final | Outcome=failed(action_failed_${i}) | Compile=ok | Action=fail | Error=E_ACTION_COMPONENT_NOT_FOUND`
      );
    } else {
      lines.push(
        `Final | Outcome=completed(ok_${i}) | Compile=ok | Action=ok`
      );
    }
  }
  return lines;
}

function buildSyntheticContext(round) {
  const width = round % 2 === 0 ? 3 : 2;
  return {
    scene_path: "Scene/MainScene",
    selection_tree: {
      max_depth: 4,
      root: buildSelectionNode("Scene/Canvas/Image", 0, 3, width),
      truncated_node_count: 0,
      truncated_reason: "",
    },
  };
}

function buildSelectionNode(pathValue, depth, maxDepth, width) {
  const node = {
    name: `Node_${depth}`,
    path: pathValue,
    depth,
    components: ["Transform", `Comp${depth}`],
    children: [],
  };
  if (depth >= maxDepth) {
    return node;
  }
  for (let i = 0; i < width; i += 1) {
    node.children.push(
      buildSelectionNode(`${pathValue}/Child_${depth}_${i}`, depth + 1, maxDepth, width)
    );
  }
  return node;
}

function buildSyntheticUserMessage(round) {
  return round % 2 === 0
    ? `continue execution round ${round}`
    : `keep previous intent and refine actions for round ${round}`;
}

function buildComparison(baseline, candidate) {
  const b = baseline && baseline.metrics ? baseline.metrics : {};
  const c = candidate && candidate.metrics ? candidate.metrics : {};
  const promptP50Delta = computeDeltaPercent(
    valueAt(b.prompt_chars, "p50"),
    valueAt(c.prompt_chars, "p50")
  );
  const promptP95Delta = computeDeltaPercent(
    valueAt(b.prompt_chars, "p95"),
    valueAt(c.prompt_chars, "p95")
  );
  const memoryP50Delta = computeDeltaPercent(
    valueAt(b.memory_chars, "p50"),
    valueAt(c.memory_chars, "p50")
  );
  const memoryP95Delta = computeDeltaPercent(
    valueAt(b.memory_chars, "p95"),
    valueAt(c.memory_chars, "p95")
  );
  const improved =
    Number.isFinite(promptP50Delta) &&
    Number.isFinite(promptP95Delta) &&
    Number.isFinite(memoryP50Delta) &&
    Number.isFinite(memoryP95Delta) &&
    promptP50Delta < 0 &&
    promptP95Delta < 0 &&
    memoryP50Delta < 0 &&
    memoryP95Delta < 0;

  return {
    summary: {
      comparable: true,
      improved,
    },
    deltas: {
      prompt_chars_p50_delta_percent: promptP50Delta,
      prompt_chars_p95_delta_percent: promptP95Delta,
      memory_chars_p50_delta_percent: memoryP50Delta,
      memory_chars_p95_delta_percent: memoryP95Delta,
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
  const filePath = path.join(stateDir, `step7-memory-compare-${report.run_id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const comparison =
    report && report.comparison && report.comparison.deltas
      ? report.comparison.deltas
      : {};
  // eslint-disable-next-line no-console
  console.log(`[step7] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(`[step7] improved=${report.comparison.summary.improved}`);
  // eslint-disable-next-line no-console
  console.log(
    `[step7] prompt_delta_p50=${formatPercent(comparison.prompt_chars_p50_delta_percent)} prompt_delta_p95=${formatPercent(comparison.prompt_chars_p95_delta_percent)}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[step7] memory_delta_p50=${formatPercent(comparison.memory_chars_p50_delta_percent)} memory_delta_p95=${formatPercent(comparison.memory_chars_p95_delta_percent)}`
  );
  // eslint-disable-next-line no-console
  console.log(`[step7] report=${reportPath}`);
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
  console.error(`[step7] fatal: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});

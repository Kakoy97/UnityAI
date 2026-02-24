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
    name: "pin_compact_off",
    rounds: args.rounds,
    compactEnabled: false,
    maxChars: args.maxChars,
    maxAddedChars: args.maxAddedChars,
  });
  const candidate = await runSuite({
    runId,
    name: "pin_compact_on",
    rounds: args.rounds,
    compactEnabled: true,
    maxChars: args.maxChars,
    maxAddedChars: args.maxAddedChars,
  });

  const comparison = buildComparison(baseline, candidate);
  const report = {
    version: 1,
    run_id: runId,
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    config: {
      rounds: args.rounds,
      signal_pin_max_chars: args.maxChars,
      signal_pin_max_added_chars: args.maxAddedChars,
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
    maxChars: 90,
    maxAddedChars: 120,
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
    if (token === "--max-chars" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.maxChars = Math.floor(n);
      }
      i += 1;
      continue;
    }
    if (token === "--max-added-chars" && i + 1 < argv.length) {
      const n = Number(argv[i + 1]);
      if (Number.isFinite(n) && n > 0) {
        args.maxAddedChars = Math.floor(n);
      }
      i += 1;
      continue;
    }
  }
  return args;
}

async function runSuite(options) {
  const opts = options && typeof options === "object" ? options : {};
  const rounds =
    Number.isFinite(opts.rounds) && opts.rounds > 0
      ? Number(opts.rounds)
      : DEFAULT_ROUNDS;
  const suiteName = typeof opts.name === "string" ? opts.name : "suite";
  const runId = typeof opts.runId === "string" ? opts.runId : "run";
  const compactEnabled = opts.compactEnabled === true;
  const maxChars =
    Number.isFinite(opts.maxChars) && opts.maxChars > 0
      ? Number(opts.maxChars)
      : 90;
  const maxAddedChars =
    Number.isFinite(opts.maxAddedChars) && opts.maxAddedChars > 0
      ? Number(opts.maxAddedChars)
      : 120;

  const planner = new CodexAppServerPlanner({
    workspaceRoot: path.resolve(__dirname, "..", ".."),
    timeoutMs: 1000,
    executable: "codex",
    promptTemplate: "v2",
    memoryInjectionMode: "always",
    memoryCapsuleMode: "legacy",
    memoryScopeFilterEnabled: true,
    memoryScopeFilterMinKeepLines: 1,
    memoryNoiseFilterEnabled: true,
    memoryNoiseFilterMinKeepLines: 1,
    memorySignalPinEnabled: true,
    memorySignalPinMaxLines: 2,
    memorySignalPinCompactEnabled: compactEnabled,
    memorySignalPinMaxChars: maxChars,
    memorySignalPinMaxAddedChars: maxAddedChars,
    snapshotStore: null,
  });

  const sessionKey = `step7_signal_pin_compact_${suiteName}_${runId}`;
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
  const userMessage = "continue work on Scene/Canvas/TargetB";
  const roundsOut = [];

  try {
    for (let round = 1; round <= rounds; round += 1) {
      planner.persistedConversationMemory.set(sessionKey, {
        lines: buildSignalPinLongLines(round),
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
        signal_pinned_lines: toNumber(details.signal_pinned_lines),
        signal_pin_compacted_lines: toNumber(details.signal_pin_compacted_lines),
        signal_pin_added_chars: toNumber(details.signal_pin_added_chars),
        failure_mentions: countMentions(text, "Error=E_ACTION_COMPONENT_NOT_FOUND"),
        pinned_failure_mentions: countMentions(text, "PinnedFailure"),
      });
    }
  } finally {
    await planner.close();
  }

  return {
    name: suiteName,
    compact_enabled: compactEnabled,
    rounds,
    metrics: {
      memory_chars: percentileSummary(roundsOut.map((item) => item.memory_chars)),
      signal_pinned_lines: percentileSummary(
        roundsOut.map((item) => item.signal_pinned_lines)
      ),
      signal_pin_compacted_lines: percentileSummary(
        roundsOut.map((item) => item.signal_pin_compacted_lines)
      ),
      signal_pin_added_chars: percentileSummary(
        roundsOut.map((item) => item.signal_pin_added_chars)
      ),
      failure_mentions: percentileSummary(
        roundsOut.map((item) => item.failure_mentions)
      ),
      pinned_failure_mentions: percentileSummary(
        roundsOut.map((item) => item.pinned_failure_mentions)
      ),
    },
    samples: roundsOut.slice(0, 6),
  };
}

function buildSignalPinLongLines(round) {
  const longTail = `detail_${round}_detail_detail_detail_detail_detail_detail_detail_detail_detail`;
  return [
    `Plan | Goal=taskA_${round} | Scope=Scene/Canvas/TargetA | Actions=visuals(1):CompA@Scene/Canvas/TargetA`,
    `Final | Outcome=failed(action_failed_A_${longTail}) | Compile=ok | Action=fail | Error=E_ACTION_COMPONENT_NOT_FOUND`,
    `Plan | Goal=chat_${round} | Scope=Scene/Canvas/TargetA | Actions=chat | Reply=brainstorm only`,
    `Plan | Goal=taskB_${round} | Scope=Scene/Canvas/TargetB | Actions=visuals(1):CompB@Scene/Canvas/TargetB`,
    `Final | Outcome=completed(ok_B_${round}) | Compile=ok | Action=ok`,
  ];
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
  const charsP50Delta = computeDeltaPercent(
    valueAt(b.memory_chars, "p50"),
    valueAt(c.memory_chars, "p50")
  );
  const charsP95Delta = computeDeltaPercent(
    valueAt(b.memory_chars, "p95"),
    valueAt(c.memory_chars, "p95")
  );
  const failureP50Delta =
    valueAt(c.failure_mentions, "p50") - valueAt(b.failure_mentions, "p50");
  const failureP95Delta =
    valueAt(c.failure_mentions, "p95") - valueAt(b.failure_mentions, "p95");
  const compactedP50 = valueAt(c.signal_pin_compacted_lines, "p50");
  const improved =
    compactedP50 > 0 &&
    charsP50Delta < 0 &&
    charsP95Delta < 0 &&
    failureP50Delta >= 0 &&
    failureP95Delta >= 0;

  return {
    summary: {
      comparable: true,
      improved,
    },
    deltas: {
      memory_chars_p50_delta_percent: charsP50Delta,
      memory_chars_p95_delta_percent: charsP95Delta,
      failure_mentions_p50_delta: failureP50Delta,
      failure_mentions_p95_delta: failureP95Delta,
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
  const filePath = path.join(
    stateDir,
    `step7-pin-compact-compare-${report.run_id}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const deltas =
    report && report.comparison && report.comparison.deltas
      ? report.comparison.deltas
      : {};
  // eslint-disable-next-line no-console
  console.log(`[step7-pin-compact] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(`[step7-pin-compact] improved=${report.comparison.summary.improved}`);
  // eslint-disable-next-line no-console
  console.log(
    `[step7-pin-compact] memory_chars_delta_p50=${formatPercent(deltas.memory_chars_p50_delta_percent)} memory_chars_delta_p95=${formatPercent(deltas.memory_chars_p95_delta_percent)}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[step7-pin-compact] failure_delta_p50=${formatNumber(deltas.failure_mentions_p50_delta)} failure_delta_p95=${formatNumber(deltas.failure_mentions_p95_delta)}`
  );
  // eslint-disable-next-line no-console
  console.log(`[step7-pin-compact] report=${reportPath}`);
}

function formatPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "n/a";
  }
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return "n/a";
  }
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}`;
}

function buildRunId(now) {
  const date = now instanceof Date ? now : new Date();
  const stamp = date.toISOString().replace(/[-:.TZ]/g, "").slice(0, 17);
  const pid = String(process.pid || "0").padStart(5, "0");
  const rand = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${stamp}_${pid}_${rand}`;
}

main().catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  // eslint-disable-next-line no-console
  console.error(`[step7-pin-compact] failed: ${message}`);
  process.exitCode = 1;
});

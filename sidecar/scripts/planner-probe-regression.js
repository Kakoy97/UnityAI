#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { CodexAppServerPlanner } = require("../src/adapters/codexAppServerPlanner");

async function main() {
  const runId = buildRunId(new Date());
  const startedAt = new Date().toISOString();
  const report = {
    run_id: runId,
    started_at: startedAt,
    finished_at: "",
    cases: [],
    summary: {
      passed: 0,
      failed: 0,
      total: 0,
    },
  };

  await runCase(report, "probe_success_continuation", runProbeSuccessContinuation);
  await runCase(report, "probe_error_fallback_continuation", runProbeErrorFallbackContinuation);

  report.finished_at = new Date().toISOString();
  report.summary.total = report.cases.length;
  const reportPath = writeReport(report);
  printSummary(report, reportPath);
  process.exitCode = report.summary.failed > 0 ? 1 : 0;
}

async function runProbeSuccessContinuation() {
  const targetPath = "Scene/Canvas/Image";
  const runner = new ScriptedJsonRpcRunner([
    {
      turnId: "turn_text_probe_1",
      notifications: [
        {
          method: "item/agentMessage/delta",
          params: {
            delta: "Checking live components first.",
            item: {
              tool_name: "query_unity_components",
              call_id: "call_probe_success",
              arguments: {
                target_path: targetPath,
              },
            },
          },
        },
      ],
      completion: {
        turn: {
          id: "turn_text_probe_1",
          status: "completed",
          usage: {
            input_tokens: 120,
            output_tokens: 24,
            total_tokens: 144,
          },
        },
      },
    },
    {
      turnId: "turn_text_probe_2",
      notifications: [
        {
          method: "item/completed",
          params: {
            item: {
              text:
                "Probe result received. Keep KeepComponent and remove RemoveMeA + RemoveMeB.",
            },
          },
        },
      ],
      completion: {
        turn: {
          id: "turn_text_probe_2",
          status: "completed",
          usage: {
            input_tokens: 90,
            output_tokens: 18,
            total_tokens: 108,
          },
        },
      },
    },
  ]);

  const planner = createPlanner();
  const queryCalls = [];
  let assistantText = "";
  try {
    assistantText = await planner.runTextTurn(runner, {
      threadId: "t_probe_success",
      prompt: "Remove all components except KeepComponent.",
      signal: null,
      keepaliveIntervalMs: 0,
      queryUnityComponents: async ({ targetPath: pathArg }) => {
        queryCalls.push(pathArg);
        return {
          query_id: "uq_probe_success",
          target_path: pathArg,
          components: [
            {
              short_name: "KeepComponent",
              assembly_qualified_name: "KeepComponent, Assembly-CSharp",
            },
            {
              short_name: "RemoveMeA",
              assembly_qualified_name: "RemoveMeA, Assembly-CSharp",
            },
            {
              short_name: "RemoveMeB",
              assembly_qualified_name: "RemoveMeB, Assembly-CSharp",
            },
          ],
          error_code: "",
          error_message: "",
        };
      },
    });
  } finally {
    await planner.close();
  }

  if (queryCalls.length !== 1 || queryCalls[0] !== targetPath) {
    throw new Error(
      `expected one probe call to ${targetPath}, got ${JSON.stringify(queryCalls)}`
    );
  }

  const secondPrompt = runner.getTurnStartPrompt(1);
  assertContains(
    secondPrompt,
    "\"short_name\": \"RemoveMeA\"",
    "continuation prompt should contain probe component RemoveMeA"
  );
  assertContains(
    secondPrompt,
    "\"short_name\": \"RemoveMeB\"",
    "continuation prompt should contain probe component RemoveMeB"
  );
  if (!assistantText || !assistantText.includes("KeepComponent")) {
    throw new Error(
      `expected assistant text to include KeepComponent, got: ${assistantText || "(empty)"}`
    );
  }

  return {
    query_calls: queryCalls,
    assistant_text: assistantText,
  };
}

async function runProbeErrorFallbackContinuation() {
  const targetPath = "Scene/Canvas/Image";
  const runner = new ScriptedJsonRpcRunner([
    {
      turnId: "turn_text_fallback_1",
      notifications: [
        {
          method: "item/agentMessage/delta",
          params: {
            delta: "Need a quick probe first.",
            item: {
              tool_name: "query_unity_components",
              call_id: "call_probe_error",
              arguments: {
                target_path: targetPath,
              },
            },
          },
        },
      ],
      completion: {
        turn: {
          id: "turn_text_fallback_1",
          status: "completed",
          usage: {
            input_tokens: 80,
            output_tokens: 16,
            total_tokens: 96,
          },
        },
      },
    },
    {
      turnId: "turn_text_fallback_2",
      notifications: [
        {
          method: "item/completed",
          params: {
            item: {
              text: "Probe unavailable. Proceed conservatively without inventing components.",
            },
          },
        },
      ],
      completion: {
        turn: {
          id: "turn_text_fallback_2",
          status: "completed",
          usage: {
            input_tokens: 70,
            output_tokens: 14,
            total_tokens: 84,
          },
        },
      },
    },
  ]);

  const planner = createPlanner();
  const queryCalls = [];
  let assistantText = "";
  try {
    assistantText = await planner.runTextTurn(runner, {
      threadId: "t_probe_error",
      prompt: "Probe then plan safely.",
      signal: null,
      keepaliveIntervalMs: 0,
      queryUnityComponents: async ({ targetPath: pathArg }) => {
        queryCalls.push(pathArg);
        throw new Error("Unity busy while compiling");
      },
    });
  } finally {
    await planner.close();
  }

  if (queryCalls.length !== 1 || queryCalls[0] !== targetPath) {
    throw new Error(
      `expected one probe call to ${targetPath}, got ${JSON.stringify(queryCalls)}`
    );
  }

  const secondPrompt = runner.getTurnStartPrompt(1);
  assertContains(
    secondPrompt,
    "\"error_code\": \"unity_query_failed\"",
    "continuation prompt should contain fallback error_code"
  );
  assertContains(
    secondPrompt,
    "Unity busy while compiling",
    "continuation prompt should contain original fallback error message"
  );
  if (!assistantText || !assistantText.includes("Probe unavailable")) {
    throw new Error(
      `expected assistant text to include fallback sentence, got: ${assistantText || "(empty)"}`
    );
  }

  return {
    query_calls: queryCalls,
    assistant_text: assistantText,
  };
}

function createPlanner() {
  return new CodexAppServerPlanner({
    workspaceRoot: path.resolve(__dirname, "..", ".."),
    timeoutMs: 60000,
    promptTemplate: "v2",
    enableUnityComponentQueryTool: true,
  });
}

class ScriptedJsonRpcRunner {
  /**
   * @param {Array<{ turnId: string, notifications?: Array<any>, completion: any }>} scenarios
   */
  constructor(scenarios) {
    this.scenarios = Array.isArray(scenarios) ? scenarios.slice() : [];
    this.startedTurns = [];
    this.activeByTurnId = new Map();
    this.listeners = new Set();
  }

  onNotification(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async request(method, params) {
    if (method !== "turn/start") {
      throw new Error(`unsupported request method: ${method}`);
    }
    if (this.scenarios.length === 0) {
      throw new Error("no scripted scenario remaining for turn/start");
    }
    const scenario = this.scenarios.shift();
    this.startedTurns.push({
      method,
      params: deepClone(params),
      scenario: {
        turnId: scenario.turnId,
      },
    });
    this.activeByTurnId.set(scenario.turnId, scenario);
    queueMicrotask(() => {
      const items = Array.isArray(scenario.notifications)
        ? scenario.notifications
        : [];
      for (const note of items) {
        this.emitNotification(note);
      }
    });
    return {
      turn: {
        id: scenario.turnId,
      },
    };
  }

  async waitForTurnCompleted(turnId) {
    const scenario = this.activeByTurnId.get(turnId);
    if (!scenario) {
      throw new Error(`missing scripted completion for turnId=${turnId}`);
    }
    await sleep(0);
    return deepClone(scenario.completion);
  }

  async stop() {
    this.listeners.clear();
    this.activeByTurnId.clear();
  }

  getTurnStartPrompt(index) {
    const item =
      Number.isFinite(index) && index >= 0
        ? this.startedTurns[index]
        : null;
    if (!item || !item.params || !Array.isArray(item.params.input)) {
      return "";
    }
    const firstInput = item.params.input[0];
    if (!firstInput || typeof firstInput.text !== "string") {
      return "";
    }
    return firstInput.text;
  }

  emitNotification(notification) {
    const payload = deepClone(notification);
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch {
        // ignore listener errors in regression runner
      }
    }
  }
}

async function runCase(report, name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    report.cases.push({
      name,
      status: "pass",
      duration_ms: Date.now() - started,
      details,
    });
    report.summary.passed += 1;
  } catch (error) {
    report.cases.push({
      name,
      status: "fail",
      duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    report.summary.failed += 1;
  }
}

function assertContains(text, needle, message) {
  const haystack = typeof text === "string" ? text : "";
  if (!haystack.includes(String(needle))) {
    throw new Error(message || `expected text to include: ${needle}`);
  }
}

function writeReport(report) {
  const stateDir = path.resolve(__dirname, "..", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(
    stateDir,
    `planner-probe-regression-${report.run_id}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  // eslint-disable-next-line no-console
  console.log(`[planner-probe] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(
    `[planner-probe] total=${report.summary.total} pass=${report.summary.passed} fail=${report.summary.failed}`
  );
  // eslint-disable-next-line no-console
  console.log(`[planner-probe] report=${reportPath}`);
  if (report.summary.failed > 0) {
    // eslint-disable-next-line no-console
    console.error("[planner-probe] failing cases:");
    for (const item of report.cases) {
      if (item.status === "fail") {
        // eslint-disable-next-line no-console
        console.error(`  - ${item.name}: ${item.error}`);
      }
    }
  }
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

function deepClone(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(
    `[planner-probe] fatal: ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});


#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { CodexAppServerPlanner } = require("../src/adapters/codexAppServerPlanner");

async function main() {
  const runId = buildRunId(new Date());
  const report = {
    run_id: runId,
    started_at: new Date().toISOString(),
    finished_at: "",
    cases: [],
    summary: {
      passed: 0,
      failed: 0,
      total: 0,
    },
  };

  await runCase(
    report,
    "bootstrap_memory_injection_once",
    runBootstrapMemoryInjectionOnce
  );
  await runCase(
    report,
    "memory_injection_disabled",
    runMemoryInjectionDisabled
  );
  await runCase(
    report,
    "chat_noise_filter_drops_chat_lines",
    runChatNoiseFilterDropsChatLines
  );
  await runCase(
    report,
    "scope_relevance_filter_prefers_current_scope",
    runScopeRelevanceFilterPrefersCurrentScope
  );
  await runCase(
    report,
    "signal_pin_keeps_failure_line_under_scope_filter",
    runSignalPinKeepsFailureLineUnderScopeFilter
  );
  await runCase(
    report,
    "signal_pin_compacts_under_char_budget",
    runSignalPinCompactsUnderCharBudget
  );
  await runCase(
    report,
    "context_budget_truncation_signal",
    runContextBudgetTruncationSignal
  );
  await runCase(
    report,
    "layered_memory_capsule_compaction",
    runLayeredMemoryCapsuleCompaction
  );

  report.finished_at = new Date().toISOString();
  report.summary.total = report.cases.length;
  const reportPath = writeReport(report);
  printSummary(report, reportPath);
  process.exitCode = report.summary.failed > 0 ? 1 : 0;
}

async function runBootstrapMemoryInjectionOnce() {
  const planner = createPlanner({
    memoryInjectionMode: "bootstrap_only",
  });
  const sessionKey = "thread_bootstrap_memory";
  const session = createFakeSession(sessionKey, { needsBootstrapContext: true });
  const prompts = [];

  planner.persistedConversationMemory.set(sessionKey, {
    lines: [
      "Plan | Goal=remove old script | Scope=Scene/Canvas/Image | Actions=visuals(1):OldScript@Scene/Canvas/Image",
      "Final | Outcome=completed(all_visual_actions_completed) | Compile=ok | Action=ok",
    ],
    updatedAt: Date.now(),
  });

  const firstProgress = [];
  const secondProgress = [];
  try {
    attachPlanTurnStubs(planner, session, prompts);
    await planner.planTurn({
      requestId: "mem_bootstrap_first_req",
      threadId: sessionKey,
      turnId: "mem_bootstrap_first_turn",
      userMessage: "继续处理上一步",
      context: buildSimpleContext(),
      onProgress: (event) => firstProgress.push(event),
    });
    await planner.planTurn({
      requestId: "mem_bootstrap_second_req",
      threadId: sessionKey,
      turnId: "mem_bootstrap_second_turn",
      userMessage: "继续",
      context: buildSimpleContext(),
      onProgress: (event) => secondProgress.push(event),
    });
  } finally {
    await planner.close();
  }

  if (prompts.length !== 2) {
    throw new Error(`expected 2 prompts, got ${prompts.length}`);
  }
  if (!prompts[0].includes("Recovered conversation memory (compressed capsule):")) {
    throw new Error("first prompt should include recovered memory capsule");
  }
  if (prompts[1].includes("Recovered conversation memory (compressed capsule):")) {
    throw new Error("second prompt should not include recovered memory capsule");
  }

  const firstMemoryEvent = findProgressEvent(firstProgress, "text_turn.memory_policy");
  const secondMemoryEvent = findProgressEvent(secondProgress, "text_turn.memory_policy");
  if (!firstMemoryEvent || !firstMemoryEvent.metrics || firstMemoryEvent.metrics.memory_injected !== true) {
    throw new Error("first turn should emit memory_injected=true");
  }
  if (!secondMemoryEvent || !secondMemoryEvent.metrics || secondMemoryEvent.metrics.memory_injected !== false) {
    throw new Error("second turn should emit memory_injected=false");
  }

  return {
    first_memory_injected: true,
    second_memory_injected: false,
    first_prompt_chars: prompts[0].length,
    second_prompt_chars: prompts[1].length,
  };
}

async function runMemoryInjectionDisabled() {
  const planner = createPlanner({
    memoryInjectionMode: "disabled",
  });
  const sessionKey = "thread_memory_disabled";
  const session = createFakeSession(sessionKey, { needsBootstrapContext: true });
  const prompts = [];
  const progressEvents = [];

  planner.persistedConversationMemory.set(sessionKey, {
    lines: ["Plan | Goal=test memory disabled"],
    updatedAt: Date.now(),
  });

  try {
    attachPlanTurnStubs(planner, session, prompts);
    await planner.planTurn({
      requestId: "mem_disabled_req",
      threadId: sessionKey,
      turnId: "mem_disabled_turn",
      userMessage: "继续",
      context: buildSimpleContext(),
      onProgress: (event) => progressEvents.push(event),
    });
  } finally {
    await planner.close();
  }

  if (prompts.length !== 1) {
    throw new Error(`expected 1 prompt, got ${prompts.length}`);
  }
  if (prompts[0].includes("Recovered conversation memory (compressed capsule):")) {
    throw new Error("prompt should not include memory capsule when mode=disabled");
  }
  const memoryEvent = findProgressEvent(progressEvents, "text_turn.memory_policy");
  if (!memoryEvent || !memoryEvent.metrics || memoryEvent.metrics.memory_injected !== false) {
    throw new Error("memory policy event should report memory_injected=false");
  }
  return {
    memory_mode: memoryEvent.metrics.memory_mode,
    memory_injected: memoryEvent.metrics.memory_injected,
  };
}

async function runChatNoiseFilterDropsChatLines() {
  const planner = createPlanner({
    memoryInjectionMode: "always",
    memoryCapsuleMode: "legacy",
    memoryNoiseFilterEnabled: true,
    memoryNoiseFilterMinKeepLines: 1,
  });
  const sessionKey = "thread_chat_noise_filter";
  const session = createFakeSession(sessionKey, { needsBootstrapContext: false });
  const prompts = [];
  const progressEvents = [];

  planner.persistedConversationMemory.set(sessionKey, {
    lines: [
      "Plan | Goal=hello | Scope=Scene/Canvas/TargetA | Actions=chat | Reply=Hi there",
      "Plan | Goal=execute update | Scope=Scene/Canvas/TargetB | Actions=visuals(1):CompB@Scene/Canvas/TargetB",
      "Final | Outcome=completed(ok) | Compile=ok | Action=ok",
    ],
    updatedAt: Date.now(),
  });

  try {
    attachPlanTurnStubs(planner, session, prompts);
    await planner.planTurn({
      requestId: "chat_noise_req",
      threadId: sessionKey,
      turnId: "chat_noise_turn",
      userMessage: "continue on Scene/Canvas/TargetB",
      context: {
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
      },
      onProgress: (event) => progressEvents.push(event),
    });
  } finally {
    await planner.close();
  }

  if (prompts.length !== 1) {
    throw new Error(`expected 1 prompt, got ${prompts.length}`);
  }
  const memoryCapsule = extractMemoryCapsuleFromPrompt(prompts[0]);
  if (!memoryCapsule) {
    throw new Error("memory capsule should not be empty");
  }
  if (memoryCapsule.includes("Actions=chat")) {
    throw new Error("memory capsule should drop chat-only plan lines");
  }
  const memoryEvent = findProgressEvent(progressEvents, "text_turn.memory_policy");
  if (!memoryEvent || !memoryEvent.metrics) {
    throw new Error("missing text_turn.memory_policy progress event");
  }
  if (memoryEvent.metrics.memory_noise_filter_enabled !== true) {
    throw new Error("expected memory_noise_filter_enabled=true");
  }
  if (memoryEvent.metrics.memory_noise_filtered !== true) {
    throw new Error("expected memory_noise_filtered=true");
  }
  if (Number(memoryEvent.metrics.memory_noise_dropped_lines || 0) <= 0) {
    throw new Error(
      `expected memory_noise_dropped_lines > 0, got ${String(memoryEvent.metrics.memory_noise_dropped_lines)}`
    );
  }
  return {
    memory_noise_filter_enabled: memoryEvent.metrics.memory_noise_filter_enabled,
    memory_noise_filtered: memoryEvent.metrics.memory_noise_filtered,
    memory_noise_kept_lines: memoryEvent.metrics.memory_noise_kept_lines,
    memory_noise_dropped_lines: memoryEvent.metrics.memory_noise_dropped_lines,
  };
}

async function runContextBudgetTruncationSignal() {
  const planner = createPlanner({
    memoryInjectionMode: "bootstrap_only",
    contextPathHintsMax: 2,
    contextDepthLimit: 2,
    contextNodeVisitBudget: 24,
  });
  const sessionKey = "thread_context_budget";
  const session = createFakeSession(sessionKey, { needsBootstrapContext: false });
  const prompts = [];
  const progressEvents = [];

  try {
    attachPlanTurnStubs(planner, session, prompts);
    await planner.planTurn({
      requestId: "context_budget_req",
      threadId: sessionKey,
      turnId: "context_budget_turn",
      userMessage: "请继续执行",
      context: buildLargeSelectionContext(),
      onProgress: (event) => progressEvents.push(event),
    });
  } finally {
    await planner.close();
  }

  if (prompts.length !== 1) {
    throw new Error(`expected 1 prompt, got ${prompts.length}`);
  }
  const summary = extractContextSummaryFromPrompt(prompts[0]);
  const selectionTree =
    summary && summary.selection_tree && typeof summary.selection_tree === "object"
      ? summary.selection_tree
      : null;
  if (!selectionTree) {
    throw new Error("prompt context summary should include selection_tree");
  }
  const hints = Array.isArray(selectionTree.path_hints)
    ? selectionTree.path_hints
    : [];
  if (hints.length > 2) {
    throw new Error(`expected <=2 path_hints, got ${hints.length}`);
  }
  if (Number(selectionTree.max_depth || 0) > 2) {
    throw new Error(
      `expected max_depth <= 2, got ${String(selectionTree.max_depth)}`
    );
  }

  const budgetEvent = findProgressEvent(progressEvents, "text_turn.context_budget");
  if (!budgetEvent || !budgetEvent.metrics) {
    throw new Error("missing text_turn.context_budget progress event");
  }
  if (budgetEvent.metrics.path_hints_limit !== 2) {
    throw new Error(
      `expected path_hints_limit=2, got ${String(budgetEvent.metrics.path_hints_limit)}`
    );
  }
  if (budgetEvent.metrics.context_truncated !== true) {
    throw new Error("expected context_truncated=true for oversized selection tree");
  }

  return {
    path_hints_count: hints.length,
    path_hints_limit: budgetEvent.metrics.path_hints_limit,
    context_truncated: budgetEvent.metrics.context_truncated,
    max_depth: selectionTree.max_depth,
  };
}

async function runScopeRelevanceFilterPrefersCurrentScope() {
  const planner = createPlanner({
    memoryInjectionMode: "always",
    memoryCapsuleMode: "legacy",
    memoryScopeFilterEnabled: true,
    memoryScopeFilterMinKeepLines: 1,
  });
  const sessionKey = "thread_scope_relevance";
  const session = createFakeSession(sessionKey, { needsBootstrapContext: false });
  const prompts = [];
  const progressEvents = [];

  planner.persistedConversationMemory.set(sessionKey, {
    lines: [
      "Plan | Goal=taskA | Scope=Scene/Canvas/TargetA | Actions=visuals(1):CompA@Scene/Canvas/TargetA",
      "Final | Outcome=completed(okA) | Compile=ok | Action=ok",
      "Plan | Goal=taskB | Scope=Scene/Canvas/TargetB | Actions=visuals(1):CompB@Scene/Canvas/TargetB",
      "Final | Outcome=failed(action_failed_B) | Compile=ok | Action=fail | Error=E_ACTION_COMPONENT_NOT_FOUND",
      "Plan | Goal=taskC | Scope=Scene/Canvas/TargetC | Actions=visuals(1):CompC@Scene/Canvas/TargetC",
      "Final | Outcome=completed(okC) | Compile=ok | Action=ok",
    ],
    updatedAt: Date.now(),
  });

  try {
    attachPlanTurnStubs(planner, session, prompts);
    await planner.planTurn({
      requestId: "scope_relevance_req",
      threadId: sessionKey,
      turnId: "scope_relevance_turn",
      userMessage: "continue change on Scene/Canvas/TargetB only",
      context: {
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
      },
      onProgress: (event) => progressEvents.push(event),
    });
  } finally {
    await planner.close();
  }

  if (prompts.length !== 1) {
    throw new Error(`expected 1 prompt, got ${prompts.length}`);
  }
  const memoryCapsule = extractMemoryCapsuleFromPrompt(prompts[0]);
  if (!memoryCapsule.includes("TargetB")) {
    throw new Error("memory capsule should retain TargetB relevant lines");
  }
  if (memoryCapsule.includes("TargetA")) {
    throw new Error("memory capsule should drop unrelated TargetA lines");
  }
  const memoryEvent = findProgressEvent(progressEvents, "text_turn.memory_policy");
  if (!memoryEvent || !memoryEvent.metrics) {
    throw new Error("missing text_turn.memory_policy progress event");
  }
  if (memoryEvent.metrics.memory_scope_filter_enabled !== true) {
    throw new Error("expected memory_scope_filter_enabled=true");
  }
  if (memoryEvent.metrics.memory_relevance_filtered !== true) {
    throw new Error("expected memory_relevance_filtered=true");
  }
  if (Number(memoryEvent.metrics.memory_relevance_dropped_lines || 0) <= 0) {
    throw new Error(
      `expected memory_relevance_dropped_lines > 0, got ${String(memoryEvent.metrics.memory_relevance_dropped_lines)}`
    );
  }
  return {
    memory_scope_filter_enabled: memoryEvent.metrics.memory_scope_filter_enabled,
    memory_relevance_filtered: memoryEvent.metrics.memory_relevance_filtered,
    memory_relevance_kept_lines: memoryEvent.metrics.memory_relevance_kept_lines,
    memory_relevance_dropped_lines: memoryEvent.metrics.memory_relevance_dropped_lines,
  };
}

async function runSignalPinKeepsFailureLineUnderScopeFilter() {
  const planner = createPlanner({
    memoryInjectionMode: "always",
    memoryCapsuleMode: "legacy",
    memoryScopeFilterEnabled: true,
    memoryScopeFilterMinKeepLines: 1,
    memorySignalPinEnabled: true,
    memorySignalPinMaxLines: 2,
  });
  const sessionKey = "thread_signal_pin_scope";
  const session = createFakeSession(sessionKey, { needsBootstrapContext: false });
  const prompts = [];
  const progressEvents = [];

  planner.persistedConversationMemory.set(sessionKey, {
    lines: [
      "Plan | Goal=taskA | Scope=Scene/Canvas/TargetA | Actions=visuals(1):CompA@Scene/Canvas/TargetA",
      "Final | Outcome=failed(action_failed_A) | Compile=ok | Action=fail | Error=E_ACTION_COMPONENT_NOT_FOUND",
      "Plan | Goal=taskB | Scope=Scene/Canvas/TargetB | Actions=visuals(1):CompB@Scene/Canvas/TargetB",
      "Final | Outcome=completed(okB) | Compile=ok | Action=ok",
    ],
    updatedAt: Date.now(),
  });

  try {
    attachPlanTurnStubs(planner, session, prompts);
    await planner.planTurn({
      requestId: "signal_pin_req",
      threadId: sessionKey,
      turnId: "signal_pin_turn",
      userMessage: "continue on Scene/Canvas/TargetB",
      context: {
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
      },
      onProgress: (event) => progressEvents.push(event),
    });
  } finally {
    await planner.close();
  }

  if (prompts.length !== 1) {
    throw new Error(`expected 1 prompt, got ${prompts.length}`);
  }
  const memoryCapsule = extractMemoryCapsuleFromPrompt(prompts[0]);
  if (!memoryCapsule.includes("Error=E_ACTION_COMPONENT_NOT_FOUND")) {
    throw new Error("signal pin should preserve failure error line");
  }
  const memoryEvent = findProgressEvent(progressEvents, "text_turn.memory_policy");
  if (!memoryEvent || !memoryEvent.metrics) {
    throw new Error("missing text_turn.memory_policy progress event");
  }
  if (memoryEvent.metrics.memory_signal_pin_enabled !== true) {
    throw new Error("expected memory_signal_pin_enabled=true");
  }
  if (Number(memoryEvent.metrics.memory_signal_pinned_lines || 0) <= 0) {
    throw new Error(
      `expected memory_signal_pinned_lines > 0, got ${String(memoryEvent.metrics.memory_signal_pinned_lines)}`
    );
  }
  if (Number(memoryEvent.metrics.memory_signal_pin_failure_lines || 0) <= 0) {
    throw new Error(
      `expected memory_signal_pin_failure_lines > 0, got ${String(memoryEvent.metrics.memory_signal_pin_failure_lines)}`
    );
  }
  return {
    memory_signal_pin_enabled: memoryEvent.metrics.memory_signal_pin_enabled,
    memory_signal_pinned_lines: memoryEvent.metrics.memory_signal_pinned_lines,
    memory_signal_pin_failure_lines:
      memoryEvent.metrics.memory_signal_pin_failure_lines,
  };
}

async function runSignalPinCompactsUnderCharBudget() {
  const planner = createPlanner({
    memoryInjectionMode: "always",
    memoryCapsuleMode: "legacy",
    memoryScopeFilterEnabled: true,
    memoryScopeFilterMinKeepLines: 1,
    memoryNoiseFilterEnabled: true,
    memoryNoiseFilterMinKeepLines: 1,
    memorySignalPinEnabled: true,
    memorySignalPinMaxLines: 2,
    memorySignalPinCompactEnabled: true,
    memorySignalPinMaxChars: 90,
    memorySignalPinMaxAddedChars: 120,
  });
  const sessionKey = "thread_signal_pin_compact";
  const session = createFakeSession(sessionKey, { needsBootstrapContext: false });
  const prompts = [];
  const progressEvents = [];
  const longTail =
    "detail_detail_detail_detail_detail_detail_detail_detail_detail_detail_detail_detail";

  planner.persistedConversationMemory.set(sessionKey, {
    lines: [
      "Plan | Goal=taskA_compact | Scope=Scene/Canvas/TargetA | Actions=visuals(1):CompA@Scene/Canvas/TargetA",
      `Final | Outcome=failed(action_failed_A_${longTail}) | Compile=ok | Action=fail | Error=E_ACTION_COMPONENT_NOT_FOUND`,
      `Plan | Goal=taskB_compact | Scope=Scene/Canvas/TargetB | Actions=visuals(1):CompB@Scene/Canvas/TargetB`,
      "Final | Outcome=completed(ok_B) | Compile=ok | Action=ok",
    ],
    updatedAt: Date.now(),
  });

  try {
    attachPlanTurnStubs(planner, session, prompts);
    await planner.planTurn({
      requestId: "signal_pin_compact_req",
      threadId: sessionKey,
      turnId: "signal_pin_compact_turn",
      userMessage: "continue on Scene/Canvas/TargetB",
      context: {
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
      },
      onProgress: (event) => progressEvents.push(event),
    });
  } finally {
    await planner.close();
  }

  if (prompts.length !== 1) {
    throw new Error(`expected 1 prompt, got ${prompts.length}`);
  }
  const memoryCapsule = extractMemoryCapsuleFromPrompt(prompts[0]);
  if (!memoryCapsule.includes("PinnedFailure")) {
    throw new Error("expected compacted pinned failure line in memory capsule");
  }
  if (!memoryCapsule.includes("Error=E_ACTION_COMPONENT_NOT_FOUND")) {
    throw new Error("compacted pinned failure should retain error code");
  }
  if (memoryCapsule.includes(longTail)) {
    throw new Error("compacted pin should not keep full long tail text");
  }
  const memoryEvent = findProgressEvent(progressEvents, "text_turn.memory_policy");
  if (!memoryEvent || !memoryEvent.metrics) {
    throw new Error("missing text_turn.memory_policy progress event");
  }
  if (memoryEvent.metrics.memory_signal_pin_compact_enabled !== true) {
    throw new Error("expected memory_signal_pin_compact_enabled=true");
  }
  if (Number(memoryEvent.metrics.memory_signal_pin_compacted_lines || 0) <= 0) {
    throw new Error(
      `expected memory_signal_pin_compacted_lines > 0, got ${String(memoryEvent.metrics.memory_signal_pin_compacted_lines)}`
    );
  }
  if (Number(memoryEvent.metrics.memory_signal_pin_added_chars || 0) > 120) {
    throw new Error(
      `expected memory_signal_pin_added_chars <= 120, got ${String(memoryEvent.metrics.memory_signal_pin_added_chars)}`
    );
  }
  return {
    memory_signal_pin_compact_enabled:
      memoryEvent.metrics.memory_signal_pin_compact_enabled,
    memory_signal_pin_compacted_lines:
      memoryEvent.metrics.memory_signal_pin_compacted_lines,
    memory_signal_pin_added_chars:
      memoryEvent.metrics.memory_signal_pin_added_chars,
  };
}

async function runLayeredMemoryCapsuleCompaction() {
  const planner = createPlanner({
    memoryInjectionMode: "always",
    memoryCapsuleMode: "layered",
    memoryHotLines: 2,
    memoryCapsuleMaxLines: 3,
    memoryColdSummaryMaxChars: 120,
  });
  const sessionKey = "thread_layered_capsule";
  const session = createFakeSession(sessionKey, { needsBootstrapContext: true });
  const prompts = [];
  const progressEvents = [];

  planner.persistedConversationMemory.set(sessionKey, {
    lines: [
      "Plan | Goal=alpha | Scope=Scene/Canvas/A | Actions=files(1):Alpha.cs",
      "Final | Outcome=completed(ok) | Compile=ok | Action=ok",
      "Plan | Goal=beta | Scope=Scene/Canvas/B | Actions=visuals(1):OldComp@Scene/Canvas/B",
      "Final | Outcome=failed(action_failed) | Compile=ok | Action=fail | Error=E_ACTION_COMPONENT_NOT_FOUND",
      "Plan | Goal=gamma | Scope=Scene/Canvas/C | Actions=visuals(1):NewComp@Scene/Canvas/C",
      "Final | Outcome=completed(all_visual_actions_completed) | Compile=ok | Action=ok",
    ],
    updatedAt: Date.now(),
  });

  try {
    attachPlanTurnStubs(planner, session, prompts);
    await planner.planTurn({
      requestId: "layered_capsule_req",
      threadId: sessionKey,
      turnId: "layered_capsule_turn",
      userMessage: "continue",
      context: buildSimpleContext(),
      onProgress: (event) => progressEvents.push(event),
    });
  } finally {
    await planner.close();
  }

  if (prompts.length !== 1) {
    throw new Error(`expected 1 prompt, got ${prompts.length}`);
  }
  const memoryCapsule = extractMemoryCapsuleFromPrompt(prompts[0]);
  if (!memoryCapsule || !memoryCapsule.includes("ColdSummary=")) {
    throw new Error("layered capsule should include ColdSummary");
  }
  const capsuleLines = memoryCapsule
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !!line);
  if (capsuleLines.length > 3) {
    throw new Error(`expected capsule lines <= 3, got ${capsuleLines.length}`);
  }
  if (
    !memoryCapsule.includes(
      "Final | Outcome=completed(all_visual_actions_completed) | Compile=ok | Action=ok"
    )
  ) {
    throw new Error("layered capsule should keep latest hot final line");
  }

  const memoryEvent = findProgressEvent(progressEvents, "text_turn.memory_policy");
  if (!memoryEvent || !memoryEvent.metrics) {
    throw new Error("missing text_turn.memory_policy progress event");
  }
  if (memoryEvent.metrics.memory_capsule_mode !== "layered") {
    throw new Error(
      `expected memory_capsule_mode=layered, got ${String(memoryEvent.metrics.memory_capsule_mode)}`
    );
  }
  if (memoryEvent.metrics.memory_source_lines < 6) {
    throw new Error(
      `expected memory_source_lines>=6, got ${String(memoryEvent.metrics.memory_source_lines)}`
    );
  }
  if (memoryEvent.metrics.memory_lines > 3) {
    throw new Error(
      `expected memory_lines<=3, got ${String(memoryEvent.metrics.memory_lines)}`
    );
  }
  if (memoryEvent.metrics.memory_cold_summary_included !== true) {
    throw new Error("expected memory_cold_summary_included=true");
  }

  return {
    memory_capsule_mode: memoryEvent.metrics.memory_capsule_mode,
    memory_source_lines: memoryEvent.metrics.memory_source_lines,
    memory_lines: memoryEvent.metrics.memory_lines,
    memory_cold_summary_included: memoryEvent.metrics.memory_cold_summary_included,
    capsule_preview: capsuleLines.slice(0, 2).join(" | "),
  };
}

function createPlanner(options) {
  const opts = options && typeof options === "object" ? options : {};
  return new CodexAppServerPlanner({
    workspaceRoot: path.resolve(__dirname, "..", ".."),
    timeoutMs: 1000,
    executable: "codex",
    promptTemplate: "v2",
    memoryInjectionMode: opts.memoryInjectionMode || "bootstrap_only",
    memoryCapsuleMode: opts.memoryCapsuleMode || "layered",
    memoryHotLines:
      Number.isFinite(opts.memoryHotLines) ? Number(opts.memoryHotLines) : 2,
    memoryCapsuleMaxLines:
      Number.isFinite(opts.memoryCapsuleMaxLines)
        ? Number(opts.memoryCapsuleMaxLines)
        : 4,
    memoryColdSummaryMaxChars:
      Number.isFinite(opts.memoryColdSummaryMaxChars)
        ? Number(opts.memoryColdSummaryMaxChars)
        : 220,
    memoryScopeFilterEnabled:
      typeof opts.memoryScopeFilterEnabled === "boolean"
        ? opts.memoryScopeFilterEnabled
        : true,
    memoryScopeFilterMinKeepLines:
      Number.isFinite(opts.memoryScopeFilterMinKeepLines)
        ? Number(opts.memoryScopeFilterMinKeepLines)
        : 2,
    memoryNoiseFilterEnabled:
      typeof opts.memoryNoiseFilterEnabled === "boolean"
        ? opts.memoryNoiseFilterEnabled
        : true,
    memoryNoiseFilterMinKeepLines:
      Number.isFinite(opts.memoryNoiseFilterMinKeepLines)
        ? Number(opts.memoryNoiseFilterMinKeepLines)
        : 2,
    memorySignalPinEnabled:
      typeof opts.memorySignalPinEnabled === "boolean"
        ? opts.memorySignalPinEnabled
        : true,
    memorySignalPinMaxLines:
      Number.isFinite(opts.memorySignalPinMaxLines)
        ? Number(opts.memorySignalPinMaxLines)
        : 2,
    memorySignalPinCompactEnabled:
      typeof opts.memorySignalPinCompactEnabled === "boolean"
        ? opts.memorySignalPinCompactEnabled
        : true,
    memorySignalPinMaxChars:
      Number.isFinite(opts.memorySignalPinMaxChars)
        ? Number(opts.memorySignalPinMaxChars)
        : 120,
    memorySignalPinMaxAddedChars:
      Number.isFinite(opts.memorySignalPinMaxAddedChars)
        ? Number(opts.memorySignalPinMaxAddedChars)
        : 240,
    contextPathHintsMax:
      Number.isFinite(opts.contextPathHintsMax) ? Number(opts.contextPathHintsMax) : 6,
    contextDepthLimit:
      Number.isFinite(opts.contextDepthLimit) ? Number(opts.contextDepthLimit) : 4,
    contextNodeVisitBudget:
      Number.isFinite(opts.contextNodeVisitBudget)
        ? Number(opts.contextNodeVisitBudget)
        : 300,
    snapshotStore: null,
  });
}

function createFakeSession(sessionKey, options) {
  const opts = options && typeof options === "object" ? options : {};
  const now = Date.now();
  return {
    key: sessionKey,
    runner: {},
    appThreadId: `app_thread_${sessionKey}`,
    inUse: 1,
    createdAt: now,
    lastUsedAt: now,
    needsBootstrapContext: opts.needsBootstrapContext !== false,
  };
}

function attachPlanTurnStubs(planner, session, prompts) {
  planner.withSessionRunner = async (_clientThreadId, _signal, work) => work(session);
  planner.runStageWithThreadRecovery = async (_session, _signal, work) => work();
  planner.runTextTurn = async (_runner, options) => {
    const prompt = options && typeof options.prompt === "string" ? options.prompt : "";
    prompts.push(prompt);
    return "assistant-plan-text";
  };
  planner.runExtractionTurn = async () => ({
    task_allocation: null,
  });
}

function buildSimpleContext() {
  return {
    scene_path: "Scene/MainScene",
    selection_tree: {
      max_depth: 2,
      root: {
        name: "Image",
        path: "Scene/Canvas/Image",
        depth: 0,
        children: [],
      },
    },
  };
}

function buildLargeSelectionContext() {
  return {
    scene_path: "Scene/MainScene",
    selection_tree: {
      max_depth: 6,
      root: buildSelectionNode("Scene/Canvas/Image", 0, 4, 3),
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

function extractContextSummaryFromPrompt(prompt) {
  const text = typeof prompt === "string" ? prompt : "";
  const markers = ["Unity context summary:\n", "Unity context:\n"];
  let marker = "";
  for (const item of markers) {
    if (text.includes(item)) {
      marker = item;
      break;
    }
  }
  if (!marker) {
    throw new Error("prompt does not contain context summary marker");
  }
  const start = text.indexOf(marker) + marker.length;
  const memoryAnchor = "\n\nRecovered conversation memory (compressed capsule):";
  const end = text.includes(memoryAnchor, start)
    ? text.indexOf(memoryAnchor, start)
    : text.length;
  const jsonText = text.slice(start, end).trim();
  if (!jsonText) {
    throw new Error("context summary json is empty");
  }
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new Error(`failed to parse context summary json: ${error.message}`);
  }
}

function extractMemoryCapsuleFromPrompt(prompt) {
  const text = typeof prompt === "string" ? prompt : "";
  const marker = "\n\nRecovered conversation memory (compressed capsule):\n";
  if (!text.includes(marker)) {
    return "";
  }
  const start = text.indexOf(marker) + marker.length;
  const tail = text.slice(start);
  const endMarker = "\nUse this capsule only as context. Do not quote it verbatim.";
  const end = tail.indexOf(endMarker);
  const body = end >= 0 ? tail.slice(0, end) : tail;
  return body.trim();
}

function findProgressEvent(events, stageName) {
  if (!Array.isArray(events)) {
    return null;
  }
  for (const item of events) {
    if (item && item.stage === stageName) {
      return item;
    }
  }
  return null;
}

async function runCase(report, name, handler) {
  const startedAt = Date.now();
  try {
    const details = await handler();
    report.cases.push({
      name,
      status: "pass",
      duration_ms: Date.now() - startedAt,
      details,
    });
    report.summary.passed += 1;
  } catch (error) {
    report.cases.push({
      name,
      status: "fail",
      duration_ms: Date.now() - startedAt,
      error: error && error.message ? error.message : String(error),
    });
    report.summary.failed += 1;
  }
}

function writeReport(report) {
  const stateDir = path.resolve(__dirname, "..", ".state");
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(
    stateDir,
    `planner-memory-regression-${report.run_id}.json`
  );
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2), "utf8");
  return filePath;
}

function printSummary(report, reportPath) {
  const elapsedMs =
    Date.parse(report.finished_at || new Date().toISOString()) -
    Date.parse(report.started_at);
  // eslint-disable-next-line no-console
  console.log(`[planner-memory] run_id=${report.run_id}`);
  // eslint-disable-next-line no-console
  console.log(
    `[planner-memory] total=${report.summary.total} pass=${report.summary.passed} fail=${report.summary.failed}`
  );
  // eslint-disable-next-line no-console
  console.log(
    `[planner-memory] elapsed_ms=${Number.isFinite(elapsedMs) ? elapsedMs : 0}`
  );
  // eslint-disable-next-line no-console
  console.log(`[planner-memory] report=${reportPath}`);
  if (report.summary.failed > 0) {
    // eslint-disable-next-line no-console
    console.error("[planner-memory] failing cases:");
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

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(`[planner-memory] fatal: ${error && error.stack ? error.stack : error}`);
  process.exitCode = 1;
});

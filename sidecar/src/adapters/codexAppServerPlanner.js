"use strict";

const { spawn } = require("child_process");
const SILENT_STAGE_KEEPALIVE_MS = 10000;
const DEFAULT_SESSION_IDLE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_MAX_SESSION_RUNNERS = 4;
const DEFAULT_PERSISTED_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_PERSISTED_SESSIONS = 64;
const PERSISTED_SESSION_TOUCH_PERSIST_INTERVAL_MS = 30000;
const DEFAULT_MEMORY_MAX_LINES = 8;
const DEFAULT_MEMORY_MAX_TOTAL_CHARS = 1200;
const MEMORY_USER_SNIPPET_MAX_CHARS = 80;
const MEMORY_ASSISTANT_SNIPPET_MAX_CHARS = 180;
const DEFAULT_MEMORY_INJECTION_MODE = "bootstrap_only";
const SUPPORTED_MEMORY_INJECTION_MODES = Object.freeze([
  "bootstrap_only",
  "always",
  "disabled",
]);
const DEFAULT_MEMORY_CAPSULE_MODE = "layered";
const SUPPORTED_MEMORY_CAPSULE_MODES = Object.freeze(["layered", "legacy"]);
const DEFAULT_MEMORY_HOT_LINES = 2;
const DEFAULT_MEMORY_CAPSULE_MAX_LINES = 4;
const DEFAULT_MEMORY_COLD_SUMMARY_MAX_CHARS = 220;
const DEFAULT_MEMORY_SCOPE_FILTER_ENABLED = true;
const DEFAULT_MEMORY_SCOPE_FILTER_MIN_KEEP_LINES = 2;
const DEFAULT_MEMORY_NOISE_FILTER_ENABLED = true;
const DEFAULT_MEMORY_NOISE_FILTER_MIN_KEEP_LINES = 2;
const DEFAULT_MEMORY_SIGNAL_PIN_ENABLED = true;
const DEFAULT_MEMORY_SIGNAL_PIN_MAX_LINES = 2;
const DEFAULT_MEMORY_SIGNAL_PIN_COMPACT_ENABLED = true;
const DEFAULT_MEMORY_SIGNAL_PIN_MAX_CHARS = 120;
const DEFAULT_MEMORY_SIGNAL_PIN_MAX_ADDED_CHARS = 240;
const DEFAULT_CONTEXT_PATH_HINTS_MAX = 6;
const DEFAULT_CONTEXT_DEPTH_LIMIT = 4;
const DEFAULT_CONTEXT_NODE_VISIT_BUDGET = 300;
const DEFAULT_PROMPT_TEMPLATE = "v2";
const SUPPORTED_PROMPT_TEMPLATES = Object.freeze(["v1", "v2"]);
const REASONING_TOOL_TYPES = Object.freeze(["read_file", "search_code"]);
const UNITY_COMPONENT_QUERY_TOOL = Object.freeze({
  type: "function",
  name: "query_unity_components",
  description:
    "CRITICAL: Use this tool immediately and directly whenever you need to know what components exist on a GameObject. Do not attempt to guess, and do not look for shortcuts in the codebase. If the user wants to act on multiple nodes, invoke this tool multiple times for each target path.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["target_path"],
    properties: {
      target_path: {
        type: "string",
      },
    },
  },
});
const EXTRACTION_RESPONSE_FORMAT = Object.freeze({ type: "json_object" });
const ALLOWED_FILE_ACTION_TYPES = Object.freeze([
  "create_file",
  "update_file",
  "rename_file",
  "delete_file",
]);
const ALLOWED_VISUAL_ACTION_TYPES = Object.freeze([
  "add_component",
  "remove_component",
  "replace_component",
  "create_gameobject",
]);
const ALLOWED_PRIMITIVE_TYPES = Object.freeze([
  "Cube",
  "Sphere",
  "Capsule",
  "Cylinder",
  "Plane",
  "Quad",
]);
const ALLOWED_UI_TYPES = Object.freeze([
  "Canvas",
  "Panel",
  "Button",
  "Image",
  "Text",
  "TMP_Text",
]);
const ALLOWED_CREATE_GAMEOBJECT_TYPES = Object.freeze([
  ...ALLOWED_PRIMITIVE_TYPES,
  ...ALLOWED_UI_TYPES,
]);

class CodexAppServerPlanner {
  /**
   * @param {{
   *  workspaceRoot: string,
   *  timeoutMs?: number,
   *  executable?: string,
   *  sessionIdleTtlMs?: number,
 *  maxSessionRunners?: number,
 *  persistedSessionTtlMs?: number,
 *  maxPersistedSessions?: number,
 *  promptTemplate?: string,
 *  memoryInjectionMode?: "bootstrap_only" | "always" | "disabled",
 *  memoryCapsuleMode?: "layered" | "legacy",
 *  memoryHotLines?: number,
 *  memoryCapsuleMaxLines?: number,
 *  memoryColdSummaryMaxChars?: number,
 *  memoryScopeFilterEnabled?: boolean,
 *  memoryScopeFilterMinKeepLines?: number,
 *  memoryNoiseFilterEnabled?: boolean,
 *  memoryNoiseFilterMinKeepLines?: number,
 *  memorySignalPinEnabled?: boolean,
 *  memorySignalPinMaxLines?: number,
 *  memorySignalPinCompactEnabled?: boolean,
 *  memorySignalPinMaxChars?: number,
 *  memorySignalPinMaxAddedChars?: number,
 *  contextPathHintsMax?: number,
 *  contextDepthLimit?: number,
 *  contextNodeVisitBudget?: number,
 *  enableUnityComponentQueryTool?: boolean,
 *  snapshotStore?: { loadSnapshot: () => any, saveSnapshot: (snapshot: any) => boolean }
 * }} options
 */
  constructor(options) {
    const opts = options || {};
    this.workspaceRoot = opts.workspaceRoot || process.cwd();
    this.timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? Number(opts.timeoutMs)
      : 60000;
    this.executable = opts.executable || "codex";
    this.sessionIdleTtlMs =
      Number.isFinite(opts.sessionIdleTtlMs) && opts.sessionIdleTtlMs > 0
        ? Number(opts.sessionIdleTtlMs)
        : DEFAULT_SESSION_IDLE_TTL_MS;
    this.maxSessionRunners =
      Number.isFinite(opts.maxSessionRunners) && opts.maxSessionRunners > 0
        ? Number(opts.maxSessionRunners)
        : DEFAULT_MAX_SESSION_RUNNERS;
    this.persistedSessionTtlMs =
      Number.isFinite(opts.persistedSessionTtlMs) && opts.persistedSessionTtlMs > 0
        ? Number(opts.persistedSessionTtlMs)
        : DEFAULT_PERSISTED_SESSION_TTL_MS;
    this.maxPersistedSessions =
      Number.isFinite(opts.maxPersistedSessions) && opts.maxPersistedSessions > 0
        ? Number(opts.maxPersistedSessions)
        : DEFAULT_MAX_PERSISTED_SESSIONS;
    this.promptTemplate = normalizePromptTemplate(opts.promptTemplate);
    this.memoryInjectionMode = normalizeMemoryInjectionMode(
      opts.memoryInjectionMode
    );
    this.memoryCapsuleMode = normalizeMemoryCapsuleMode(opts.memoryCapsuleMode);
    this.memoryHotLines = normalizePositiveInteger(
      opts.memoryHotLines,
      DEFAULT_MEMORY_HOT_LINES
    );
    this.memoryCapsuleMaxLines = normalizePositiveInteger(
      opts.memoryCapsuleMaxLines,
      DEFAULT_MEMORY_CAPSULE_MAX_LINES
    );
    this.memoryColdSummaryMaxChars = normalizePositiveInteger(
      opts.memoryColdSummaryMaxChars,
      DEFAULT_MEMORY_COLD_SUMMARY_MAX_CHARS
    );
    this.memoryScopeFilterEnabled =
      typeof opts.memoryScopeFilterEnabled === "boolean"
        ? opts.memoryScopeFilterEnabled
        : DEFAULT_MEMORY_SCOPE_FILTER_ENABLED;
    this.memoryScopeFilterMinKeepLines = normalizePositiveInteger(
      opts.memoryScopeFilterMinKeepLines,
      DEFAULT_MEMORY_SCOPE_FILTER_MIN_KEEP_LINES
    );
    this.memoryNoiseFilterEnabled =
      typeof opts.memoryNoiseFilterEnabled === "boolean"
        ? opts.memoryNoiseFilterEnabled
        : DEFAULT_MEMORY_NOISE_FILTER_ENABLED;
    this.memoryNoiseFilterMinKeepLines = normalizePositiveInteger(
      opts.memoryNoiseFilterMinKeepLines,
      DEFAULT_MEMORY_NOISE_FILTER_MIN_KEEP_LINES
    );
    this.memorySignalPinEnabled =
      typeof opts.memorySignalPinEnabled === "boolean"
        ? opts.memorySignalPinEnabled
        : DEFAULT_MEMORY_SIGNAL_PIN_ENABLED;
    this.memorySignalPinMaxLines = normalizePositiveInteger(
      opts.memorySignalPinMaxLines,
      DEFAULT_MEMORY_SIGNAL_PIN_MAX_LINES
    );
    this.memorySignalPinCompactEnabled =
      typeof opts.memorySignalPinCompactEnabled === "boolean"
        ? opts.memorySignalPinCompactEnabled
        : DEFAULT_MEMORY_SIGNAL_PIN_COMPACT_ENABLED;
    this.memorySignalPinMaxChars = normalizePositiveInteger(
      opts.memorySignalPinMaxChars,
      DEFAULT_MEMORY_SIGNAL_PIN_MAX_CHARS
    );
    this.memorySignalPinMaxAddedChars = normalizePositiveInteger(
      opts.memorySignalPinMaxAddedChars,
      DEFAULT_MEMORY_SIGNAL_PIN_MAX_ADDED_CHARS
    );
    this.contextPathHintsMax = normalizeNonNegativeInteger(
      opts.contextPathHintsMax,
      DEFAULT_CONTEXT_PATH_HINTS_MAX
    );
    this.contextDepthLimit = normalizePositiveInteger(
      opts.contextDepthLimit,
      DEFAULT_CONTEXT_DEPTH_LIMIT
    );
    this.contextNodeVisitBudget = normalizePositiveInteger(
      opts.contextNodeVisitBudget,
      DEFAULT_CONTEXT_NODE_VISIT_BUDGET
    );
    this.enableUnityComponentQueryTool =
      opts.enableUnityComponentQueryTool !== false;
    this.snapshotStore = opts.snapshotStore || null;
    /** @type {Map<string, { key: string, runner: JsonRpcRunner, appThreadId: string, inUse: number, createdAt: number, lastUsedAt: number, needsBootstrapContext: boolean }>} */
    this.sessionRunners = new Map();
    /** @type {Map<string, { appThreadId: string, updatedAt: number }>} */
    this.persistedSessionThreads = new Map();
    /** @type {Map<string, { lines: string[], updatedAt: number }>} */
    this.persistedConversationMemory = new Map();
    this.enabled = true;
    this.restorePersistedSessionThreads();
  }

  /**
   * @param {{
   *  requestId: string,
   *  threadId: string,
   *  turnId: string,
   *  userMessage: string,
   *  context: any,
   *  signal?: AbortSignal,
   *  onDelta?: (delta: string) => void,
   *  onMessage?: (message: string) => void,
   *  onProgress?: (event?: any) => void,
   *  queryUnityComponents?: (arg: { targetPath: string }) => Promise<{ query_id?: string, target_path?: string, components?: Array<{ short_name: string, assembly_qualified_name: string }>, error_code?: string, error_message?: string }>
   * }} input
   * @returns {Promise<{assistant_text: string, task_allocation: any}>}
   */
  async planTurn(input) {
    return this.withSessionRunner(input.threadId, input.signal, async (session) => {
      const assistantText = await this.runStageWithThreadRecovery(
        session,
        input.signal,
        () => {
          const memoryCapsuleDetails = this.shouldInjectMemoryCapsule(session)
            ? this.getConversationMemoryCapsuleDetails(session.key, {
                context: input.context,
                userMessage: input.userMessage,
              })
            : buildEmptyMemoryCapsuleDetails(this.memoryCapsuleMode);
          const memoryCapsule = memoryCapsuleDetails.text;
          this.emitBootstrapMemoryProgress(
            input.onProgress,
            memoryCapsuleDetails,
            session
          );
          const contextSnapshot = this.buildConversationContextSnapshot(input.context);
          this.emitContextBudgetProgress(input.onProgress, contextSnapshot.metrics);
          return this.runTextTurn(session.runner, {
            threadId: session.appThreadId,
            prompt: this.buildConversationPrompt(input.userMessage, input.context, {
              memoryCapsule,
              contextSummary: contextSnapshot.summary,
            }),
            tools: buildReasoningTools({
              enableUnityComponentQueryTool:
                this.enableUnityComponentQueryTool,
            }),
            signal: input.signal,
            onDelta: input.onDelta,
            onMessage: input.onMessage,
            onProgress: input.onProgress,
            queryUnityComponents: this.enableUnityComponentQueryTool
              ? input.queryUnityComponents
              : null,
            keepaliveIntervalMs: SILENT_STAGE_KEEPALIVE_MS,
          });
        }
      );
      session.needsBootstrapContext = false;

      const taskAllocation = await this.runStageWithThreadRecovery(
        session,
        input.signal,
        () => this.runExtractionTurn(session.runner, {
          threadId: session.appThreadId,
          prompt: this.buildAllocationExtractionPrompt(
            input.userMessage,
            input.context,
            assistantText
          ),
          signal: input.signal,
          onProgress: input.onProgress,
          keepaliveIntervalMs: SILENT_STAGE_KEEPALIVE_MS,
        })
      );
      this.updateConversationMemory(session.key, {
        userMessage: input.userMessage,
        context: input.context,
        assistantText,
        taskAllocation,
      });

      return {
        assistant_text: assistantText,
        task_allocation: taskAllocation,
      };
    });
  }

  /**
   * @param {{
   *  requestId: string,
   *  threadId: string,
   *  turnId: string,
   *  executionReport: any,
   *  signal?: AbortSignal,
   *  onDelta?: (delta: string) => void,
   *  onMessage?: (message: string) => void,
   *  onProgress?: (event?: any) => void
   * }} input
   * @returns {Promise<string>}
   */
  async finalizeTurn(input) {
    return this.withSessionRunner(input.threadId, input.signal, async (session) => {
      const summary = await this.runStageWithThreadRecovery(
        session,
        input.signal,
        () => this.runTextTurn(session.runner, {
          threadId: session.appThreadId,
          prompt: this.buildFinalizePrompt(input.executionReport),
          toolChoice: "none",
          signal: input.signal,
          onDelta: input.onDelta,
          onMessage: input.onMessage,
          onProgress: input.onProgress,
          keepaliveIntervalMs: SILENT_STAGE_KEEPALIVE_MS,
        })
      );

      return summary;
    });
  }

  recordExecutionMemory(input) {
    const payload = input && typeof input === "object" ? input : {};
    const sessionKey = normalizeSessionKey(payload.threadId);
    this.updateConversationMemory(sessionKey, {
      executionReport: payload.executionReport,
      assistantText:
        typeof payload.finalMessage === "string" ? payload.finalMessage : "",
    });
  }

  async withSessionRunner(clientThreadId, signal, work) {
    const sessionKey = normalizeSessionKey(clientThreadId);
    const session = await this.acquireSessionRunner(sessionKey, signal);
    try {
      return await work(session);
    } catch (error) {
      if (isThreadMissingError(error)) {
        this.removePersistedSessionThread(sessionKey, { persist: true });
      }
      if (shouldResetSessionOnError(error)) {
        await this.disposeSessionRunner(sessionKey, { force: true });
      }
      throw error;
    } finally {
      this.releaseSessionRunner(sessionKey);
    }
  }

  async acquireSessionRunner(sessionKey, signal) {
    await this.cleanupIdleSessionRunners({ keepKey: sessionKey });
    this.cleanupPersistedSessionThreads({ keepKey: sessionKey, persist: false });
    this.cleanupPersistedConversationMemory({ keepKey: sessionKey, persist: false });

    let session = this.sessionRunners.get(sessionKey);
    if (!session) {
      session = await this.createSessionRunner(sessionKey, signal);
    }

    session.inUse += 1;
    session.lastUsedAt = Date.now();
    return session;
  }

  releaseSessionRunner(sessionKey) {
    const session = this.sessionRunners.get(sessionKey);
    if (!session) {
      return;
    }
    if (session.inUse > 0) {
      session.inUse -= 1;
    }
    session.lastUsedAt = Date.now();
    this.touchPersistedSessionThread(sessionKey, session.appThreadId);
    this.cleanupIdleSessionRunners().catch(() => {
      // ignore cleanup failures
    });
  }

  async createSessionRunner(sessionKey, signal) {
    const runner = new JsonRpcRunner({
      executable: this.executable,
      args: ["app-server"],
      timeoutMs: this.timeoutMs,
    });

    await runner.start();
    try {
      await this.initializeRunner(runner, signal);
      const restoredAppThreadId = this.getPersistedSessionThreadId(sessionKey);
      const appThreadId = restoredAppThreadId || await this.startThread(runner, signal);
      const now = Date.now();
      const session = {
        key: sessionKey,
        runner,
        appThreadId,
        inUse: 0,
        createdAt: now,
        lastUsedAt: now,
        needsBootstrapContext: !restoredAppThreadId,
      };
      this.sessionRunners.set(sessionKey, session);
      this.updatePersistedSessionThread(sessionKey, appThreadId, {
        forcePersist: true,
      });
      return session;
    } catch (error) {
      try {
        await runner.stop();
      } catch {
        // ignore shutdown errors
      }
      throw error;
    }
  }

  async cleanupIdleSessionRunners(options) {
    const opts = options && typeof options === "object" ? options : {};
    const keepKey =
      typeof opts.keepKey === "string" && opts.keepKey ? opts.keepKey : "";
    const now = Date.now();
    const disposeKeys = new Set();

    for (const [key, session] of this.sessionRunners.entries()) {
      if (!session || session.inUse > 0 || key === keepKey) {
        continue;
      }
      if (now - session.lastUsedAt > this.sessionIdleTtlMs) {
        disposeKeys.add(key);
      }
    }

    const projectedSize = this.sessionRunners.size - disposeKeys.size;
    if (projectedSize > this.maxSessionRunners) {
      const idle = [];
      for (const [key, session] of this.sessionRunners.entries()) {
        if (!session || session.inUse > 0 || key === keepKey || disposeKeys.has(key)) {
          continue;
        }
        idle.push({
          key,
          lastUsedAt: Number.isFinite(session.lastUsedAt)
            ? Number(session.lastUsedAt)
            : 0,
        });
      }
      idle.sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      let overflow = projectedSize - this.maxSessionRunners;
      for (const item of idle) {
        if (overflow <= 0) {
          break;
        }
        disposeKeys.add(item.key);
        overflow -= 1;
      }
    }

    for (const key of disposeKeys) {
      await this.disposeSessionRunner(key);
    }
  }

  async disposeSessionRunner(sessionKey, options) {
    const opts = options && typeof options === "object" ? options : {};
    const force = opts.force === true;
    const session = this.sessionRunners.get(sessionKey);
    if (!session) {
      return;
    }
    if (!force && session.inUse > 0) {
      return;
    }

    this.sessionRunners.delete(sessionKey);
    try {
      await session.runner.stop();
    } catch {
      // ignore shutdown errors
    }
  }

  async close() {
    const keys = Array.from(this.sessionRunners.keys());
    for (const key of keys) {
      await this.disposeSessionRunner(key, { force: true });
    }
    this.persistSessionThreadSnapshot();
  }

  async runStageWithThreadRecovery(session, signal, work) {
    try {
      const result = await work();
      this.touchPersistedSessionThread(session.key, session.appThreadId);
      return result;
    } catch (error) {
      if (!isThreadMissingError(error)) {
        throw error;
      }
      await this.recreateSessionThread(session, signal);
      const result = await work();
      this.updatePersistedSessionThread(session.key, session.appThreadId, {
        forcePersist: true,
      });
      return result;
    }
  }

  async recreateSessionThread(session, signal) {
    if (!session || !session.runner) {
      throw new Error("planner session is not available");
    }
    const nextThreadId = await this.startThread(session.runner, signal);
    session.appThreadId = nextThreadId;
    session.lastUsedAt = Date.now();
    session.needsBootstrapContext = true;
    this.updatePersistedSessionThread(session.key, nextThreadId, {
      forcePersist: true,
    });
    return nextThreadId;
  }

  shouldInjectBootstrapMemory(session) {
    return !!(session && session.needsBootstrapContext === true);
  }

  shouldInjectMemoryCapsule(session) {
    if (this.memoryInjectionMode === "disabled") {
      return false;
    }
    if (this.memoryInjectionMode === "always") {
      return true;
    }
    return this.shouldInjectBootstrapMemory(session);
  }

  getContextSummaryOptions() {
    return {
      pathHintsMax: this.contextPathHintsMax,
      depthLimit: this.contextDepthLimit,
      nodeVisitBudget: this.contextNodeVisitBudget,
    };
  }

  buildConversationContextSnapshot(context) {
    const result = buildPromptContextSummaryWithStats(
      context,
      this.getContextSummaryOptions()
    );
    const stats =
      result && result.stats && typeof result.stats === "object"
        ? result.stats
        : {};
    return {
      summary:
        result && result.summary && typeof result.summary === "object"
          ? result.summary
          : {},
      metrics: {
        selection_tree_present: !!stats.selection_tree_present,
        context_truncated: !!stats.context_truncated,
        path_hints_count: Number.isFinite(stats.path_hints_count)
          ? Number(stats.path_hints_count)
          : 0,
        path_hints_limit: this.contextPathHintsMax,
        depth_limit: this.contextDepthLimit,
        node_visit_budget: this.contextNodeVisitBudget,
        max_depth_input: Number.isFinite(stats.max_depth_input)
          ? Number(stats.max_depth_input)
          : 0,
      },
    };
  }

  emitBootstrapMemoryProgress(onProgress, memoryCapsuleDetails, session) {
    if (typeof onProgress !== "function") {
      return;
    }
    const details =
      memoryCapsuleDetails &&
      typeof memoryCapsuleDetails === "object" &&
      !Array.isArray(memoryCapsuleDetails)
        ? memoryCapsuleDetails
        : buildEmptyMemoryCapsuleDetails(this.memoryCapsuleMode);
    const text = typeof details.text === "string" ? details.text.trim() : "";
    onProgress({
      stage: "text_turn.memory_policy",
      metrics: {
        memory_mode: this.memoryInjectionMode,
        memory_injected: !!text,
        memory_chars: text.length,
        memory_lines: Number.isFinite(details.included_lines)
          ? Number(details.included_lines)
          : 0,
        memory_source_lines: Number.isFinite(details.source_lines)
          ? Number(details.source_lines)
          : 0,
        memory_saved_lines: Number.isFinite(details.saved_lines)
          ? Number(details.saved_lines)
          : 0,
        memory_compaction_ratio: Number.isFinite(details.compaction_ratio)
          ? Number(details.compaction_ratio)
          : 0,
        memory_raw_source_lines: Number.isFinite(details.raw_source_lines)
          ? Number(details.raw_source_lines)
          : 0,
        memory_capsule_mode:
          typeof details.capsule_mode === "string"
            ? details.capsule_mode
            : this.memoryCapsuleMode,
        memory_cold_summary_included: details.cold_summary_included === true,
        memory_cold_summary_chars: Number.isFinite(details.cold_summary_chars)
          ? Number(details.cold_summary_chars)
          : 0,
        memory_scope_filter_enabled: details.scope_filter_enabled === true,
        memory_relevance_filtered: details.relevance_filtered === true,
        memory_relevance_kept_lines: Number.isFinite(details.relevance_kept_lines)
          ? Number(details.relevance_kept_lines)
          : 0,
        memory_relevance_dropped_lines: Number.isFinite(details.relevance_dropped_lines)
          ? Number(details.relevance_dropped_lines)
          : 0,
        memory_noise_filter_enabled: details.noise_filter_enabled === true,
        memory_noise_filtered: details.noise_filtered === true,
        memory_noise_kept_lines: Number.isFinite(details.noise_kept_lines)
          ? Number(details.noise_kept_lines)
          : 0,
        memory_noise_dropped_lines: Number.isFinite(details.noise_dropped_lines)
          ? Number(details.noise_dropped_lines)
          : 0,
        memory_signal_pin_enabled: details.signal_pin_enabled === true,
        memory_signal_pinned_lines: Number.isFinite(details.signal_pinned_lines)
          ? Number(details.signal_pinned_lines)
          : 0,
        memory_signal_pin_failure_lines: Number.isFinite(details.signal_pin_failure_lines)
          ? Number(details.signal_pin_failure_lines)
          : 0,
        memory_signal_pin_plan_lines: Number.isFinite(details.signal_pin_plan_lines)
          ? Number(details.signal_pin_plan_lines)
          : 0,
        memory_signal_pin_compact_enabled:
          details.signal_pin_compact_enabled === true,
        memory_signal_pin_compacted_lines: Number.isFinite(
          details.signal_pin_compacted_lines
        )
          ? Number(details.signal_pin_compacted_lines)
          : 0,
        memory_signal_pin_added_chars: Number.isFinite(details.signal_pin_added_chars)
          ? Number(details.signal_pin_added_chars)
          : 0,
        bootstrap_required: this.shouldInjectBootstrapMemory(session),
      },
    });
  }

  emitContextBudgetProgress(onProgress, metrics) {
    if (typeof onProgress !== "function") {
      return;
    }
    const payload = metrics && typeof metrics === "object" ? metrics : {};
    onProgress({
      stage: "text_turn.context_budget",
      metrics: payload,
    });
  }

  getPersistedSessionThreadId(sessionKey) {
    if (!sessionKey) {
      return "";
    }
    const entry = this.persistedSessionThreads.get(sessionKey);
    if (!entry) {
      return "";
    }
    if (
      isStaleTimestamp(entry.updatedAt, this.persistedSessionTtlMs) ||
      !entry.appThreadId
    ) {
      this.persistedSessionThreads.delete(sessionKey);
      this.persistSessionThreadSnapshot();
      return "";
    }
    return entry.appThreadId;
  }

  touchPersistedSessionThread(sessionKey, appThreadId) {
    this.updatePersistedSessionThread(sessionKey, appThreadId, {
      forcePersist: false,
    });
  }

  updatePersistedSessionThread(sessionKey, appThreadId, options) {
    const normalizedKey = normalizeSessionKey(sessionKey);
    const normalizedThread = typeof appThreadId === "string" ? appThreadId.trim() : "";
    if (!normalizedThread) {
      return;
    }

    const opts = options && typeof options === "object" ? options : {};
    const now = Date.now();
    const existing = this.persistedSessionThreads.get(normalizedKey);
    const sameThread = !!(existing && existing.appThreadId === normalizedThread);

    this.persistedSessionThreads.set(normalizedKey, {
      appThreadId: normalizedThread,
      updatedAt: now,
    });
    const pruned = this.cleanupPersistedSessionThreads({
      keepKey: normalizedKey,
      persist: false,
    });
    if (
      opts.forcePersist === true ||
      !sameThread ||
      pruned ||
      !existing ||
      now - existing.updatedAt >= PERSISTED_SESSION_TOUCH_PERSIST_INTERVAL_MS
    ) {
      this.persistSessionThreadSnapshot();
    }
  }

  removePersistedSessionThread(sessionKey, options) {
    if (!sessionKey) {
      return false;
    }
    const removed = this.persistedSessionThreads.delete(sessionKey);
    if (!removed) {
      return false;
    }
    const opts = options && typeof options === "object" ? options : {};
    if (opts.persist !== false) {
      this.persistSessionThreadSnapshot();
    }
    return true;
  }

  cleanupPersistedSessionThreads(options) {
    const opts = options && typeof options === "object" ? options : {};
    const keepKey =
      typeof opts.keepKey === "string" && opts.keepKey ? opts.keepKey : "";
    const now = Date.now();
    let changed = false;

    for (const [key, entry] of this.persistedSessionThreads.entries()) {
      if (!entry || !entry.appThreadId) {
        this.persistedSessionThreads.delete(key);
        changed = true;
        continue;
      }
      if (key === keepKey) {
        continue;
      }
      if (isStaleTimestamp(entry.updatedAt, this.persistedSessionTtlMs, now)) {
        this.persistedSessionThreads.delete(key);
        changed = true;
      }
    }

    if (this.persistedSessionThreads.size > this.maxPersistedSessions) {
      const evictable = [];
      for (const [key, entry] of this.persistedSessionThreads.entries()) {
        if (key === keepKey) {
          continue;
        }
        evictable.push({
          key,
          updatedAt: Number.isFinite(entry.updatedAt) ? Number(entry.updatedAt) : 0,
        });
      }
      evictable.sort((a, b) => a.updatedAt - b.updatedAt);
      let overflow = this.persistedSessionThreads.size - this.maxPersistedSessions;
      for (const item of evictable) {
        if (overflow <= 0) {
          break;
        }
        if (this.persistedSessionThreads.delete(item.key)) {
          changed = true;
          overflow -= 1;
        }
      }
    }

    if (changed && opts.persist !== false) {
      this.persistSessionThreadSnapshot();
    }
    return changed;
  }

  getConversationMemoryCapsule(sessionKey, options) {
    return this.getConversationMemoryCapsuleDetails(sessionKey, options).text;
  }

  getConversationMemoryCapsuleDetails(sessionKey, options) {
    if (!sessionKey) {
      return buildEmptyMemoryCapsuleDetails(this.memoryCapsuleMode);
    }
    const entry = this.persistedConversationMemory.get(sessionKey);
    if (!entry || !Array.isArray(entry.lines) || entry.lines.length === 0) {
      return buildEmptyMemoryCapsuleDetails(this.memoryCapsuleMode);
    }
    if (isStaleTimestamp(entry.updatedAt, this.persistedSessionTtlMs)) {
      this.persistedConversationMemory.delete(sessionKey);
      this.persistSessionThreadSnapshot();
      return buildEmptyMemoryCapsuleDetails(this.memoryCapsuleMode);
    }

    const normalized = entry.lines
      .filter((line) => typeof line === "string" && line.trim())
      .map((line) => line.trim());
    if (normalized.length === 0) {
      return buildEmptyMemoryCapsuleDetails(this.memoryCapsuleMode);
    }
    const recent = normalized.slice(-DEFAULT_MEMORY_MAX_LINES);
    const noiseFilter = filterMemoryNoiseLines(recent, {
      enabled: this.memoryNoiseFilterEnabled,
      minKeepLines: this.memoryNoiseFilterMinKeepLines,
    });
    const noiseFilteredLines =
      noiseFilter && Array.isArray(noiseFilter.lines)
        ? noiseFilter.lines
        : recent;
    const relevanceFilter = filterMemoryLinesByRelevance(noiseFilteredLines, {
      enabled: this.memoryScopeFilterEnabled,
      minKeepLines: this.memoryScopeFilterMinKeepLines,
      context:
        options &&
        typeof options === "object" &&
        !Array.isArray(options)
          ? options.context
          : null,
      userMessage:
        options &&
        typeof options === "object" &&
        !Array.isArray(options)
          ? options.userMessage
          : "",
    });
    const filteredLines =
      relevanceFilter && Array.isArray(relevanceFilter.lines)
        ? relevanceFilter.lines
        : noiseFilteredLines;
    const signalPin = mergePinnedExecutionSignals(filteredLines, noiseFilteredLines, {
      enabled: this.memorySignalPinEnabled,
      maxPinnedLines: this.memorySignalPinMaxLines,
      compactEnabled: this.memorySignalPinCompactEnabled,
      maxCharsPerLine: this.memorySignalPinMaxChars,
      maxAddedChars: this.memorySignalPinMaxAddedChars,
    });
    const pinnedLines =
      signalPin && Array.isArray(signalPin.lines) && signalPin.lines.length > 0
        ? signalPin.lines
        : filteredLines;
    const details = this.memoryCapsuleMode === "legacy"
      ? buildLegacyMemoryCapsuleDetails(pinnedLines)
      : buildLayeredMemoryCapsuleDetails(pinnedLines, {
          hotLines: this.memoryHotLines,
          maxLines: this.memoryCapsuleMaxLines,
          coldSummaryMaxChars: this.memoryColdSummaryMaxChars,
        });
    details.raw_source_lines = recent.length;
    details.noise_filter_enabled = this.memoryNoiseFilterEnabled;
    details.noise_filtered = noiseFilter.filtered === true;
    details.noise_kept_lines = Number.isFinite(noiseFilter.keptLines)
      ? Number(noiseFilter.keptLines)
      : noiseFilteredLines.length;
    details.noise_dropped_lines = Number.isFinite(noiseFilter.droppedLines)
      ? Number(noiseFilter.droppedLines)
      : Math.max(0, recent.length - noiseFilteredLines.length);
    details.scope_filter_enabled = this.memoryScopeFilterEnabled;
    details.relevance_filtered = relevanceFilter.filtered === true;
    details.relevance_kept_lines = Number.isFinite(relevanceFilter.keptLines)
      ? Number(relevanceFilter.keptLines)
      : pinnedLines.length;
    details.relevance_dropped_lines = Number.isFinite(relevanceFilter.droppedLines)
      ? Number(relevanceFilter.droppedLines)
      : Math.max(0, recent.length - pinnedLines.length);
    details.signal_pin_enabled = this.memorySignalPinEnabled;
    details.signal_pinned_lines = Number.isFinite(signalPin.pinnedLines)
      ? Number(signalPin.pinnedLines)
      : 0;
    details.signal_pin_failure_lines = Number.isFinite(signalPin.failurePinnedLines)
      ? Number(signalPin.failurePinnedLines)
      : 0;
    details.signal_pin_plan_lines = Number.isFinite(signalPin.planPinnedLines)
      ? Number(signalPin.planPinnedLines)
      : 0;
    details.signal_pin_compact_enabled = this.memorySignalPinCompactEnabled;
    details.signal_pin_compacted_lines = Number.isFinite(signalPin.compactedLines)
      ? Number(signalPin.compactedLines)
      : 0;
    details.signal_pin_added_chars = Number.isFinite(signalPin.addedChars)
      ? Number(signalPin.addedChars)
      : 0;
    return details;
  }

  updateConversationMemory(sessionKey, input) {
    const normalizedKey = normalizeSessionKey(sessionKey);
    const payload = input && typeof input === "object" ? input : {};
    const nextLine = buildConversationMemoryLine({
      userMessage: payload.userMessage,
      context: payload.context,
      assistantText: payload.assistantText,
      taskAllocation: payload.taskAllocation,
      executionReport: payload.executionReport,
    });
    if (!nextLine) {
      return;
    }

    const now = Date.now();
    const existing = this.persistedConversationMemory.get(normalizedKey);
    const lines = existing && Array.isArray(existing.lines)
      ? existing.lines.filter((line) => typeof line === "string" && line.trim())
      : [];

    if (lines.length === 0 || lines[lines.length - 1] !== nextLine) {
      lines.push(nextLine);
    }
    while (lines.length > DEFAULT_MEMORY_MAX_LINES) {
      lines.shift();
    }
    while (
      lines.length > 1 &&
      lines.join("\n").length > DEFAULT_MEMORY_MAX_TOTAL_CHARS
    ) {
      lines.shift();
    }

    this.persistedConversationMemory.set(normalizedKey, {
      lines,
      updatedAt: now,
    });
    this.cleanupPersistedConversationMemory({
      keepKey: normalizedKey,
      persist: false,
    });
    this.persistSessionThreadSnapshot();
  }

  cleanupPersistedConversationMemory(options) {
    const opts = options && typeof options === "object" ? options : {};
    const keepKey =
      typeof opts.keepKey === "string" && opts.keepKey ? opts.keepKey : "";
    const now = Date.now();
    let changed = false;

    for (const [key, entry] of this.persistedConversationMemory.entries()) {
      if (!entry || !Array.isArray(entry.lines) || entry.lines.length === 0) {
        this.persistedConversationMemory.delete(key);
        changed = true;
        continue;
      }
      if (key === keepKey) {
        continue;
      }
      if (isStaleTimestamp(entry.updatedAt, this.persistedSessionTtlMs, now)) {
        this.persistedConversationMemory.delete(key);
        changed = true;
      }
    }

    if (this.persistedConversationMemory.size > this.maxPersistedSessions) {
      const evictable = [];
      for (const [key, entry] of this.persistedConversationMemory.entries()) {
        if (key === keepKey) {
          continue;
        }
        evictable.push({
          key,
          updatedAt: Number.isFinite(entry.updatedAt) ? Number(entry.updatedAt) : 0,
        });
      }
      evictable.sort((a, b) => a.updatedAt - b.updatedAt);
      let overflow = this.persistedConversationMemory.size - this.maxPersistedSessions;
      for (const item of evictable) {
        if (overflow <= 0) {
          break;
        }
        if (this.persistedConversationMemory.delete(item.key)) {
          changed = true;
          overflow -= 1;
        }
      }
    }

    if (changed && opts.persist !== false) {
      this.persistSessionThreadSnapshot();
    }
    return changed;
  }

  restorePersistedSessionThreads() {
    if (!this.snapshotStore || typeof this.snapshotStore.loadSnapshot !== "function") {
      return;
    }
    const snapshot = this.snapshotStore.loadSnapshot();
    if (!snapshot || typeof snapshot !== "object") {
      return;
    }

    this.persistedSessionThreads.clear();
    this.persistedConversationMemory.clear();
    const now = Date.now();
    if (Array.isArray(snapshot.sessions)) {
      for (const item of snapshot.sessions) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const sessionKey = normalizeSessionKey(item.session_key);
        const appThreadId =
          typeof item.app_thread_id === "string" ? item.app_thread_id.trim() : "";
        const updatedAt = Number.isFinite(item.updated_at)
          ? Number(item.updated_at)
          : numberOrNow(item.updated_at);
        if (!appThreadId) {
          continue;
        }
        if (isStaleTimestamp(updatedAt, this.persistedSessionTtlMs, now)) {
          continue;
        }
        this.persistedSessionThreads.set(sessionKey, {
          appThreadId,
          updatedAt,
        });
      }
    }

    if (Array.isArray(snapshot.memories)) {
      for (const item of snapshot.memories) {
        if (!item || typeof item !== "object") {
          continue;
        }
        const sessionKey = normalizeSessionKey(item.session_key);
        const updatedAt = Number.isFinite(item.updated_at)
          ? Number(item.updated_at)
          : numberOrNow(item.updated_at);
        if (isStaleTimestamp(updatedAt, this.persistedSessionTtlMs, now)) {
          continue;
        }
        const lines = Array.isArray(item.lines)
          ? item.lines
              .filter((line) => typeof line === "string" && line.trim())
              .map((line) => truncateText(line, DEFAULT_MEMORY_MAX_TOTAL_CHARS))
          : [];
        if (lines.length === 0) {
          continue;
        }
        this.persistedConversationMemory.set(sessionKey, {
          lines: lines.slice(-DEFAULT_MEMORY_MAX_LINES),
          updatedAt,
        });
      }
    }
    this.cleanupPersistedSessionThreads({ persist: true });
    this.cleanupPersistedConversationMemory({ persist: true });
  }

  persistSessionThreadSnapshot() {
    if (!this.snapshotStore || typeof this.snapshotStore.saveSnapshot !== "function") {
      return;
    }

    const sessions = [];
    for (const [sessionKey, entry] of this.persistedSessionThreads.entries()) {
      if (!entry || !entry.appThreadId) {
        continue;
      }
      sessions.push({
        session_key: sessionKey,
        app_thread_id: entry.appThreadId,
        updated_at: Number.isFinite(entry.updatedAt) ? Number(entry.updatedAt) : Date.now(),
      });
    }

    sessions.sort((a, b) => b.updated_at - a.updated_at);
    const memories = [];
    for (const [sessionKey, entry] of this.persistedConversationMemory.entries()) {
      if (!entry || !Array.isArray(entry.lines) || entry.lines.length === 0) {
        continue;
      }
      memories.push({
        session_key: sessionKey,
        updated_at: Number.isFinite(entry.updatedAt) ? Number(entry.updatedAt) : Date.now(),
        lines: entry.lines
          .filter((line) => typeof line === "string" && line.trim())
          .map((line) => truncateText(line, DEFAULT_MEMORY_MAX_TOTAL_CHARS))
          .slice(-DEFAULT_MEMORY_MAX_LINES),
      });
    }
    memories.sort((a, b) => b.updated_at - a.updated_at);

    this.snapshotStore.saveSnapshot({
      version: 1,
      saved_at: new Date().toISOString(),
      sessions,
      memories,
    });
  }

  async initializeRunner(runner, signal) {
    await raceWithAbort(
      runner.request("initialize", {
        clientInfo: {
          name: "unity-sidecar",
          title: "Unity Sidecar",
          version: "0.1.0",
        },
        capabilities: {
          experimentalApi: true,
        },
      }),
      signal
    );
  }

  async startThread(runner, signal) {
    const threadResult = await raceWithAbort(
      runner.request("thread/start", {
        cwd: normalizePath(this.workspaceRoot),
        experimentalRawEvents: false,
      }),
      signal
    );
    const threadId =
      threadResult &&
      threadResult.thread &&
      typeof threadResult.thread.id === "string"
        ? threadResult.thread.id
        : "";
    if (!threadId) {
      throw new Error("app-server thread/start returned empty thread id");
    }
    return threadId;
  }

  async runTextTurn(runner, options) {
    const markProgress = createProgressReporter(options.onProgress);
    const queryUnityComponents =
      typeof options.queryUnityComponents === "function"
        ? options.queryUnityComponents
        : null;
    const maxUnityQueryRounds = 3;
    let currentPrompt = options.prompt;

    for (let queryRound = 0; queryRound <= maxUnityQueryRounds; queryRound += 1) {
      const turnResult = await this.runSingleTextTurn(runner, {
        ...options,
        prompt: currentPrompt,
        markProgress,
      });
      const normalized = normalizeAssistantText(turnResult.assistantText);
      const toolCalls = Array.isArray(turnResult.queryUnityComponentCalls)
        ? turnResult.queryUnityComponentCalls
        : [];

      if (toolCalls.length === 0) {
        if (!normalized) {
          throw new Error("planner returned empty message");
        }
        return normalized;
      }
      if (!queryUnityComponents) {
        throw new Error("query_unity_components tool bridge is not configured");
      }
      if (queryRound >= maxUnityQueryRounds) {
        throw new Error("unity components query round limit exceeded");
      }

      markProgress("text_turn.query_components.requested");
      let stopQueryKeepalive = () => {};
      try {
        stopQueryKeepalive = startProgressKeepalive(
          markProgress,
          options.keepaliveIntervalMs,
          "text_turn.query_components.keepalive"
        );
        const queryResults = [];
        for (const toolCall of toolCalls) {
          let queryResult;
          try {
            queryResult = await raceWithAbort(
              queryUnityComponents({
                targetPath: toolCall.target_path,
              }),
              options.signal
            );
          } catch (error) {
            queryResult = buildUnityQueryFallbackResult(error);
          }
          queryResults.push({
            call_id: toolCall.call_id || "",
            target_path: toolCall.target_path || "",
            result: normalizeUnityQueryToolResult(queryResult),
          });
        }
        markProgress("text_turn.query_components.completed");
        currentPrompt = buildContinuationPromptAfterUnityComponentsQuery(
          options.prompt,
          normalized,
          toolCalls,
          queryResults
        );
      } finally {
        stopQueryKeepalive();
      }
    }

    throw new Error("unity components query round limit exceeded");
  }

  async runSingleTextTurn(runner, options) {
    const threadId = options.threadId;
    const prompt = options.prompt;
    const signal = options.signal;
    const onDelta = options.onDelta;
    const onMessage = options.onMessage;
    const tools = normalizeTurnTools(options.tools);
    const toolChoice = normalizeToolChoice(options.toolChoice);
    const markProgress =
      typeof options.markProgress === "function"
        ? options.markProgress
        : createProgressReporter(options.onProgress);

    let activeTurnId = "";
    let latestMessage = "";
    let mergedDelta = "";
    let textTurnStartedAt = 0;
    let firstTokenReported = false;
    /** @type {Array<{call_id: string, target_path: string}>} */
    const queryUnityComponentCalls = [];

    const reportFirstToken = (timestamp) => {
      if (firstTokenReported || textTurnStartedAt <= 0) {
        return;
      }
      const now =
        Number.isFinite(timestamp) && timestamp > 0
          ? Number(timestamp)
          : Date.now();
      const ttftMs = Math.max(0, now - textTurnStartedAt);
      firstTokenReported = true;
      markProgress({
        stage: "text_turn.first_token",
        timestamp: now,
        metrics: {
          ttft_ms: ttftMs,
        },
      });
    };

    const unsubscribe = runner.onNotification((message) => {
      if (!isNotificationForTurn(message, activeTurnId)) {
        return;
      }
      markProgress("text_turn.notification");

      const extractedCalls = extractQueryUnityComponentsToolCalls(message);
      if (extractedCalls.length > 0) {
        mergeQueryUnityComponentCalls(queryUnityComponentCalls, extractedCalls);
      }

      const delta = extractDelta(message);
      if (delta) {
        reportFirstToken(Date.now());
        mergedDelta += delta;
        latestMessage += delta;
        if (typeof onDelta === "function") {
          try {
            onDelta(delta);
          } catch {
            // ignore callback exceptions
          }
        }
      }

      const completedText = extractCompletedText(message);
      if (completedText) {
        reportFirstToken(Date.now());
        latestMessage = completedText;
        if (typeof onMessage === "function") {
          try {
            onMessage(completedText);
          } catch {
            // ignore callback exceptions
          }
        }
      }
    });

    let stopKeepalive = () => {};
    try {
      markProgress("text_turn.starting");
      const turnStartParams = {
        threadId,
        input: [
          {
            type: "text",
            text: prompt,
            text_elements: [],
          },
        ],
      };
      if (tools) {
        turnStartParams.tools = tools;
      }
      if (toolChoice) {
        turnStartParams.tool_choice = toolChoice;
      }
      const response = await raceWithAbort(
        runner.request("turn/start", turnStartParams),
        signal
      );

      activeTurnId = extractTurnIdFromStart(response);
      if (!activeTurnId) {
        throw new Error("app-server turn/start returned empty turn id");
      }
      textTurnStartedAt = Date.now();
      markProgress("text_turn.started");

      stopKeepalive = startProgressKeepalive(
        markProgress,
        options.keepaliveIntervalMs,
        "text_turn.keepalive"
      );

      const completion = await raceWithAbort(
        runner.waitForTurnCompleted(activeTurnId),
        signal
      );

      ensureCompletedStatus(completion);
      reportFirstToken(Date.now());
      markProgress("text_turn.completed");
      const usageMetrics = extractTokenUsageFromTurnPayload(completion);
      if (usageMetrics) {
        markProgress({
          stage: "text_turn.usage",
          metrics: usageMetrics,
        });
      }
      const completionCalls = extractQueryUnityComponentsToolCalls({
        method: "turn/completed",
        params: completion,
      });
      if (completionCalls.length > 0) {
        mergeQueryUnityComponentCalls(
          queryUnityComponentCalls,
          completionCalls
        );
      }
      return {
        assistantText: latestMessage || mergedDelta,
        queryUnityComponentCalls,
      };
    } finally {
      stopKeepalive();
      unsubscribe();
    }
  }

  async runExtractionTurn(runner, options) {
    const threadId = options.threadId;
    const prompt = options.prompt;
    const signal = options.signal;
    const onProgress = options.onProgress;
    const markProgress = createProgressReporter(onProgress);

    let activeTurnId = "";
    let latestMessage = "";

    const unsubscribe = runner.onNotification((message) => {
      if (!isNotificationForTurn(message, activeTurnId)) {
        return;
      }
      markProgress("extraction_turn.notification");

      const delta = extractDelta(message);
      if (delta) {
        latestMessage += delta;
      }

      const completedText = extractCompletedText(message);
      if (completedText) {
        latestMessage = completedText;
      }
    });

    let stopKeepalive = () => {};
    try {
      markProgress("extraction_turn.starting");
      const turnStartParams = {
        threadId,
        input: [
          {
            type: "text",
            text: prompt,
            text_elements: [],
          },
        ],
        tool_choice: "none",
        response_format: EXTRACTION_RESPONSE_FORMAT,
        outputSchema: buildAllocationOutputSchema(),
      };
      const response = await raceWithAbort(
        runner.request("turn/start", turnStartParams),
        signal
      );

      activeTurnId = extractTurnIdFromStart(response);
      if (!activeTurnId) {
        throw new Error("app-server extraction turn/start returned empty turn id");
      }
      markProgress("extraction_turn.started");

      stopKeepalive = startProgressKeepalive(
        markProgress,
        options.keepaliveIntervalMs,
        "extraction_turn.keepalive"
      );

      const completion = await raceWithAbort(
        runner.waitForTurnCompleted(activeTurnId),
        signal
      );

      ensureCompletedStatus(completion);
      markProgress("extraction_turn.completed");
      const usageMetrics = extractTokenUsageFromTurnPayload(completion);
      if (usageMetrics) {
        markProgress({
          stage: "extraction_turn.usage",
          metrics: usageMetrics,
        });
      }

      const completedAllocation = extractTaskAllocationFromCompletion(completion);
      if (completedAllocation.found) {
        return normalizeTaskAllocation(completedAllocation.value);
      }

      const parsed = parseJsonObject(latestMessage);
      if (Object.prototype.hasOwnProperty.call(parsed, "task_allocation")) {
        return normalizeTaskAllocation(parsed.task_allocation);
      }
      if (looksLikeTaskAllocationObject(parsed)) {
        return normalizeTaskAllocation(parsed);
      }
      throw new Error("planner extraction missing task_allocation");
    } catch (error) {
      markProgress({
        stage: "extraction_turn.failed",
        metrics: {
          reason: classifyExtractionFailureReason(error),
        },
      });
      throw error;
    } finally {
      stopKeepalive();
      unsubscribe();
    }
  }

  buildConversationPrompt(userMessage, context, options) {
    if (this.promptTemplate === "v1") {
      return this.buildConversationPromptV1(userMessage, context, options);
    }
    return this.buildConversationPromptV2(userMessage, context, options);
  }

  buildConversationPromptV1(userMessage, context, options) {
    const safeMessage = typeof userMessage === "string" ? userMessage : "";
    const opts = options && typeof options === "object" ? options : {};
    const memoryCapsule =
      typeof opts.memoryCapsule === "string" ? opts.memoryCapsule.trim() : "";
    const contextSummary =
      opts.contextSummary &&
      typeof opts.contextSummary === "object" &&
      !Array.isArray(opts.contextSummary)
        ? opts.contextSummary
        : buildPromptContextSummary(context, this.getContextSummaryOptions());
    const contextJson = JSON.stringify(contextSummary, null, 2);
    const preferChinese = /[\u3400-\u9fff]/.test(safeMessage);
    const languageRule = preferChinese
      ? "Use Simplified Chinese."
      : "Reply in the same language as the user.";

    const prompt = [
      "You are Codex, a practical Unity copilot.",
      "You are fully aware of your JSON schema capabilities (file_actions and visual_layer_actions). They ONLY support exact component names, there are no hidden wildcard (`*`) or batch removal features. NEVER use code search tools to inspect the sidecar, protocol, or unity editor core implementation. Only use code search tools to explore the user's game logic.",
      "Reply naturally and helpfully. Do not output JSON.",
      "Keep the response concise and action-focused.",
      "Target <= 6 short sentences and avoid long preamble/explanations.",
      "This is the reasoning stage. You may use exploration tools (read_file/search_code) if needed.",
      languageRule,
      "",
      ...this.buildCriticalArchitectureConstraintsLines(),
      "",
      "If the user asks for discussion or brainstorming, focus on solution guidance.",
      "If the user clearly asks for execution, explain briefly what you will do.",
      "",
      "User message:",
      safeMessage,
      "",
      "Unity context:",
      contextJson,
    ];
    if (memoryCapsule) {
      prompt.push(
        "",
        "Recovered conversation memory (compressed capsule):",
        memoryCapsule,
        "Use this capsule only as context. Do not quote it verbatim."
      );
    }
    if (this.enableUnityComponentQueryTool) {
      prompt.splice(6, 0, "If you need live components on a target object, call query_unity_components tool directly.");
    } else {
      prompt.splice(6, 0, "Unity component query tool is disabled; rely on provided context and avoid unsupported guessing.");
    }
    return prompt.join("\n");
  }

  buildConversationPromptV2(userMessage, context, options) {
    const safeMessage = typeof userMessage === "string" ? userMessage : "";
    const opts = options && typeof options === "object" ? options : {};
    const memoryCapsule =
      typeof opts.memoryCapsule === "string" ? opts.memoryCapsule.trim() : "";
    const contextSummary =
      opts.contextSummary &&
      typeof opts.contextSummary === "object" &&
      !Array.isArray(opts.contextSummary)
        ? opts.contextSummary
        : buildPromptContextSummary(context, this.getContextSummaryOptions());
    const contextJson = JSON.stringify(contextSummary, null, 2);
    const preferChinese = /[\u3400-\u9fff]/.test(safeMessage);
    const languageRule = preferChinese
      ? "Use Simplified Chinese."
      : "Reply in the same language as the user.";

    const prompt = [
      "You are Codex, a pragmatic Unity copilot for this workspace.",
      "This is Phase 1 reasoning only: produce concise natural-language planning, not JSON.",
      "Exploration policy: use read_file/search_code only when directly required for the current user goal.",
      "Tool budget: at most 3 total tool calls unless a concrete blocker remains unresolved.",
      "Never inspect sidecar internals, protocol glue, Unity editor implementation, or unrelated directories.",
      "If the user asks for discussion/brainstorming, avoid tools unless they explicitly request repository inspection.",
      "If execution intent is explicit, summarize concrete file and visual actions in <= 6 short sentences.",
      languageRule,
      "",
      ...this.buildCriticalArchitectureConstraintsLines(),
      "",
      "User message:",
      safeMessage,
      "",
      "Unity context summary:",
      contextJson,
    ];
    if (memoryCapsule) {
      prompt.push(
        "",
        "Recovered conversation memory (compressed capsule):",
        memoryCapsule,
        "Use this capsule only as context. Do not quote it verbatim."
      );
    }
    if (this.enableUnityComponentQueryTool) {
      prompt.splice(5, 0, "If live component names are required, call query_unity_components immediately instead of guessing.");
    } else {
      prompt.splice(5, 0, "Unity component query tool is currently disabled; only use component names grounded in current context.");
    }
    return prompt.join("\n");
  }

  buildAllocationExtractionPrompt(userMessage, context, assistantText) {
    if (this.promptTemplate === "v1") {
      return this.buildAllocationExtractionPromptV1(
        userMessage,
        context,
        assistantText
      );
    }
    return this.buildAllocationExtractionPromptV2(
      userMessage,
      context,
      assistantText
    );
  }

  buildAllocationExtractionPromptV1(userMessage, context, assistantText) {
    const safeMessage = typeof userMessage === "string" ? userMessage : "";
    const contextSummary = buildPromptContextSummary(
      context,
      this.getContextSummaryOptions()
    );
    const contextJson = JSON.stringify(contextSummary, null, 2);
    const assistant = summarizeAssistantTextForExtraction(assistantText, 360);

    return [
      "You are a ruthless JSON translator for Unity sidecar extraction.",
      "No tools are available in this stage. Do not explore files or run extra checks.",
      "You are not a planner in this stage; you are a deterministic translator.",
      "Strictly and uniquely translate Phase 1 intent into schema-compliant JSON.",
      "Do not invent new actions, targets, files, or parameters that are not grounded in user message, assistant intent summary, and Unity context.",
      "Translate plan to schema-compliant JSON directly.",
      "When task_allocation is an object, you MUST fill reasoning_and_plan before action arrays.",
      "Place all planning logic only inside reasoning_and_plan. Do not add extra fields outside schema.",
      "Keep reasoning_and_plan concise but complete.",
      "Return one JSON object only, with no markdown, no preface, and no extra text.",
      "Strictly follow the provided output schema.",
      "",
      ...this.buildCriticalArchitectureConstraintsLines(),
      "",
      "If the user intent is discussion/chitchat/consultative and not explicit execution, set task_allocation to null.",
      "When execution is explicit, produce task_allocation with file_actions and/or visual_layer_actions.",
      "Hard constraints:",
      "- file_actions type must be one of: create_file, update_file, rename_file, delete_file",
      "- file paths must stay under Assets/Scripts/AIGenerated/",
      "- task_allocation.reasoning_and_plan is required for executable turns and must summarize intent, constraints, and final action mapping",
      "- create_file/update_file require path, content, overwrite_if_exists",
      "- rename_file requires old_path and new_path",
      "- delete_file requires path",
      "- visual_layer_actions type must be one of: add_component, remove_component, replace_component, create_gameobject",
      "- visual action target must be selection",
      "- add_component requires target_object_path and component_assembly_qualified_name",
      "- remove_component requires target_object_path and component_assembly_qualified_name (component_name alias is also accepted)",
      "- replace_component requires target_object_path, source_component_assembly_qualified_name, component_assembly_qualified_name",
      "- create_gameobject requires name, parent_path, and one of object_type/ui_type/primitive_type",
      "- object_type/ui_type/primitive_type must be one of Primitive/UI names (Cube/Sphere/Capsule/Cylinder/Plane/Quad/Canvas/Panel/Button/Image/Text/TMP_Text)",
      "- For component names in visual_layer_actions, you can use natural or partial names (e.g., 'count' for 'CountAndLog'). The Unity executor will automatically fuzzy-match it on the target object.",
      "- If filtering/exclusion is requested (for example keep A and remove others), reasoning_and_plan must explicitly list current components from selection_tree, then list keep/remove decisions, then map 1:1 to remove_component actions.",
      "- Do not invent any non-schema fields. Adhere strictly to the JSON schema.",
      "",
      "EXAMPLE OUTPUT FORMAT:",
      "{",
      '  "task_allocation": {',
      '    "reasoning_and_plan": "Need to rename script and update visual components. Keep target object under Scene/Canvas and remove legacy script before creating a new UI button.",',
      '    "file_actions": [',
      "      {",
      '        "type": "rename_file",',
      '        "old_path": "Assets/Scripts/AIGenerated/OldName.cs",',
      '        "new_path": "Assets/Scripts/AIGenerated/NewName.cs",',
      '        "overwrite_if_exists": true',
      "      }",
      "    ],",
      '    "visual_layer_actions": [',
      "      {",
      '        "type": "remove_component",',
      '        "target_object_path": "Scene/MyObject",',
      '        "component_assembly_qualified_name": "OldName, Assembly-CSharp"',
      "      },",
      "      {",
      '        "type": "create_gameobject",',
      '        "name": "MyButton",',
      '        "parent_path": "Scene/Canvas",',
      '        "ui_type": "Button"',
      "      }",
      "    ]",
      "  }",
      "}",
      "",
      "User message:",
      safeMessage,
      "",
      "Assistant intent summary:",
      assistant,
      "",
      "Unity context:",
      contextJson,
    ].join("\n");
  }

  buildAllocationExtractionPromptV2(userMessage, context, assistantText) {
    const safeMessage = typeof userMessage === "string" ? userMessage : "";
    const contextSummary = buildPromptContextSummary(
      context,
      this.getContextSummaryOptions()
    );
    const contextJson = JSON.stringify(contextSummary, null, 2);
    const assistant = summarizeAssistantTextForExtraction(assistantText, 420);

    return [
      "You are a deterministic JSON translator for Unity sidecar extraction.",
      "This is Phase 2 translation only. No planning, no brainstorming, no tool usage.",
      "Your only evidence sources are: user message, assistant intent summary, and Unity context summary.",
      "If evidence is insufficient for safe executable actions, return {\"task_allocation\": null}.",
      "If executable, return exactly one JSON object with task_allocation.reasoning_and_plan, file_actions, visual_layer_actions.",
      "Do not invent targets, paths, files, components, or parameters that are absent from evidence.",
      "Return pure JSON only: no markdown fence, no prose, no comments.",
      "",
      ...this.buildCriticalArchitectureConstraintsLines(),
      "",
      "Hard constraints:",
      "- file_actions.type in {create_file, update_file, rename_file, delete_file}",
      "- file paths must stay under Assets/Scripts/AIGenerated/",
      "- executable task_allocation must include non-empty reasoning_and_plan",
      "- create_file/update_file require path/content/overwrite_if_exists",
      "- rename_file requires old_path/new_path (overwrite_if_exists optional)",
      "- delete_file requires path",
      "- visual_layer_actions.type in {add_component, remove_component, replace_component, create_gameobject}",
      "- visual action target must be selection when provided",
      "- add_component requires target_object_path + component_assembly_qualified_name",
      "- remove_component requires target_object_path + component_name or component_assembly_qualified_name",
      "- replace_component requires target_object_path + source_component_assembly_qualified_name + component_assembly_qualified_name",
      "- create_gameobject requires name + parent_path (+ object_type/ui_type/primitive_type)",
      "- object_type/ui_type/primitive_type allowed values: Cube/Sphere/Capsule/Cylinder/Plane/Quad/Canvas/Panel/Button/Image/Text/TMP_Text",
      "- for exclusion tasks (keep X remove others), map each remove_component to concrete components from context/probe results only",
      "",
      "Few-shot examples:",
      '{"task_allocation": null}',
      "{",
      '  "task_allocation": {',
      '    "reasoning_and_plan": "User wants executable changes. Rename one script and remove one old component on the selected object before creating a UI button under Canvas.",',
      '    "file_actions": [',
      '      {"type":"rename_file","old_path":"Assets/Scripts/AIGenerated/OldName.cs","new_path":"Assets/Scripts/AIGenerated/NewName.cs","overwrite_if_exists":true}',
      "    ],",
      '    "visual_layer_actions": [',
      '      {"type":"remove_component","target":"selection","target_object_path":"Scene/Canvas/Image","component_name":"OldName"},',
      '      {"type":"create_gameobject","target":"selection","name":"MyButton","parent_path":"Scene/Canvas","ui_type":"Button"}',
      "    ]",
      "  }",
      "}",
      "",
      "User message:",
      safeMessage,
      "",
      "Assistant intent summary:",
      assistant,
      "",
      "Unity context summary:",
      contextJson,
    ].join("\n");
  }

  buildFinalizePrompt(executionReport) {
    const reportSummary = buildFinalizeExecutionSummary(executionReport);
    const reportJson = JSON.stringify(reportSummary, null, 2);
    const preferChinese = /[\u3400-\u9fff]/.test(reportJson);
    const languageRule = preferChinese
      ? "Use Simplified Chinese."
      : "Use concise natural language.";

    return [
      "You are Codex summarizing a Unity execution turn for the end user.",
      languageRule,
      "",
      ...this.buildCriticalArchitectureConstraintsLines(),
      "",
      "Provide a direct user-facing summary with concrete outcomes and next-step hints when helpful.",
      "If execution did not happen yet, do not invent execution details.",
      "Do not output JSON.",
      "",
      "Execution report:",
      reportJson,
    ].join("\n");
  }

  buildCriticalArchitectureConstraintsLines() {
    return [
      "CRITICAL ARCHITECTURE CONSTRAINTS (MUST FOLLOW):",
      "1. VISUAL LAYER: To attach scripts or modify GameObjects, declare JSON visual_layer_actions only. Allowed types are add_component/remove_component/replace_component/create_gameobject. Native Unity C# executes the action.",
      "2. FOCUS ON CODE: Use file_actions for scripts/files and visual_layer_actions for Unity object operations. Then stop and wait for execution report.",
    ];
  }
}

class JsonRpcRunner {
  /**
   * @param {{
   *  executable: string,
   *  args: string[],
   *  timeoutMs: number
   * }} options
   */
  constructor(options) {
    this.executable = options.executable;
    this.args = Array.isArray(options.args) ? options.args : [];
    this.timeoutMs = options.timeoutMs;
    this.child = null;
    this.started = false;
    this.reqId = 1;
    this.pending = new Map();
    this.notificationHandlers = [];
    this.stdoutBuffer = "";
    this.turnCompletedWaiters = new Map();
  }

  async start() {
    if (this.started) {
      return;
    }

    this.child = await new Promise((resolve, reject) => {
      const child = spawn(this.executable, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
        shell: needsShellOnWindows(this.executable),
      });
      const onError = (error) => {
        child.removeListener("spawn", onSpawn);
        reject(error);
      };
      const onSpawn = () => {
        child.removeListener("error", onError);
        resolve(child);
      };
      child.once("error", onError);
      child.once("spawn", onSpawn);
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.onStdout(chunk));
    this.child.stderr.on("data", () => {
      // Keep stderr silent; sidecar logging is handled at higher layers.
    });
    this.child.on("exit", () => {
      this.rejectAllPending(new Error("codex app-server exited unexpectedly"));
      this.resolveAllTurnWaiters(
        null,
        new Error("codex app-server exited unexpectedly")
      );
    });
    this.started = true;
  }

  async stop() {
    if (!this.child) {
      return;
    }
    const child = this.child;
    this.child = null;
    this.started = false;
    try {
      child.kill();
    } catch {
      // ignore
    }
  }

  onNotification(handler) {
    if (typeof handler !== "function") {
      return () => {};
    }
    this.notificationHandlers.push(handler);
    return () => {
      const index = this.notificationHandlers.indexOf(handler);
      if (index >= 0) {
        this.notificationHandlers.splice(index, 1);
      }
    };
  }

  request(method, params) {
    if (!this.child || !this.started) {
      return Promise.reject(new Error("codex app-server is not running"));
    }
    const id = String(this.reqId++);
    const payload = {
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });

      this.child.stdin.write(JSON.stringify(payload) + "\n");
    });
  }

  waitForTurnCompleted(turnId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.turnCompletedWaiters.delete(turnId);
        reject(new Error(`turn completion timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      this.turnCompletedWaiters.set(turnId, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  onStdout(chunk) {
    this.stdoutBuffer += chunk;
    const lines = this.stdoutBuffer.split(/\r?\n/);
    this.stdoutBuffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        continue;
      }
      this.handleMessage(message);
    }
  }

  handleMessage(message) {
    if (!message || typeof message !== "object") {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const id = String(message.id);
      const pending = this.pending.get(id);
      if (!pending) {
        return;
      }
      this.pending.delete(id);
      if (message.error) {
        const reason =
          message.error && message.error.message
            ? String(message.error.message)
            : "json-rpc error";
        pending.reject(new Error(reason));
        return;
      }
      pending.resolve(message.result);
      return;
    }

    if (typeof message.method === "string") {
      if (message.method === "turn/completed") {
        const params = message.params || {};
        const turn = params.turn || {};
        const turnId = typeof turn.id === "string" ? turn.id : "";
        const waiter = turnId ? this.turnCompletedWaiters.get(turnId) : null;
        if (waiter) {
          this.turnCompletedWaiters.delete(turnId);
          waiter.resolve(params);
        }
      }

      for (const handler of this.notificationHandlers) {
        try {
          handler(message);
        } catch {
          // ignore callback exceptions
        }
      }
    }
  }

  rejectAllPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  resolveAllTurnWaiters(value, error) {
    for (const waiter of this.turnCompletedWaiters.values()) {
      if (error) {
        waiter.reject(error);
      } else {
        waiter.resolve(value);
      }
    }
    this.turnCompletedWaiters.clear();
  }
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function buildReasoningTools(options) {
  const opts = options && typeof options === "object" ? options : {};
  const enableUnityComponentQueryTool =
    opts.enableUnityComponentQueryTool !== false;
  const tools = REASONING_TOOL_TYPES.map((type) => ({ type }));
  if (!enableUnityComponentQueryTool) {
    return tools;
  }
  tools.push({
    type: UNITY_COMPONENT_QUERY_TOOL.type,
    name: UNITY_COMPONENT_QUERY_TOOL.name,
    description: UNITY_COMPONENT_QUERY_TOOL.description,
    strict: UNITY_COMPONENT_QUERY_TOOL.strict,
    parameters: UNITY_COMPONENT_QUERY_TOOL.parameters,
  });
  return tools;
}

function normalizeTurnTools(value) {
  if (!Array.isArray(value)) {
    return null;
  }
  const tools = value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item }));
  return tools;
}

function normalizeToolChoice(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || "";
}

function needsShellOnWindows(executable) {
  if (process.platform !== "win32") {
    return false;
  }
  const lower = String(executable || "").trim().toLowerCase();
  return lower.endsWith(".cmd") || lower.endsWith(".bat");
}

function buildAllocationOutputSchema() {
  return {
    type: "object",
    required: ["task_allocation"],
    additionalProperties: false,
    properties: {
      task_allocation: {
        anyOf: [
          {
            type: "null",
          },
          {
            type: "object",
            required: ["reasoning_and_plan", "file_actions", "visual_layer_actions"],
            additionalProperties: false,
            properties: {
              reasoning_and_plan: {
                type: "string",
                minLength: 1,
              },
              file_actions: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "object",
                      required: ["type", "path", "content", "overwrite_if_exists"],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["create_file", "update_file"],
                        },
                        path: { type: "string" },
                        content: { type: "string" },
                        overwrite_if_exists: { type: "boolean" },
                      },
                    },
                    {
                      type: "object",
                      required: ["type", "old_path", "new_path"],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["rename_file"],
                        },
                        old_path: { type: "string" },
                        new_path: { type: "string" },
                      },
                    },
                    {
                      type: "object",
                      required: [
                        "type",
                        "old_path",
                        "new_path",
                        "overwrite_if_exists",
                      ],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["rename_file"],
                        },
                        old_path: { type: "string" },
                        new_path: { type: "string" },
                        overwrite_if_exists: { type: "boolean" },
                      },
                    },
                    {
                      type: "object",
                      required: ["type", "path"],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["delete_file"],
                        },
                        path: { type: "string" },
                      },
                    },
                  ],
                },
              },
              visual_layer_actions: {
                type: "array",
                items: {
                  anyOf: [
                    {
                      type: "object",
                      required: [
                        "type",
                        "target_object_path",
                        "component_name",
                      ],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["remove_component"],
                        },
                        target_object_path: { type: "string" },
                        component_name: { type: "string" },
                      },
                    },
                    {
                      type: "object",
                      required: [
                        "type",
                        "target_object_path",
                        "component_assembly_qualified_name",
                      ],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["remove_component"],
                        },
                        target_object_path: { type: "string" },
                        component_assembly_qualified_name: { type: "string" },
                      },
                    },
                    {
                      type: "object",
                      required: [
                        "type",
                        "target",
                        "target_object_path",
                        "component_assembly_qualified_name",
                      ],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["remove_component"],
                        },
                        target: {
                          type: "string",
                          enum: ["selection"],
                        },
                        target_object_path: { type: "string" },
                        component_assembly_qualified_name: { type: "string" },
                      },
                    },
                    {
                      type: "object",
                      required: [
                        "type",
                        "target",
                        "target_object_path",
                        "component_assembly_qualified_name",
                      ],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["add_component"],
                        },
                        target: {
                          type: "string",
                          enum: ["selection"],
                        },
                        target_object_path: { type: "string" },
                        component_assembly_qualified_name: { type: "string" },
                      },
                    },
                    {
                      type: "object",
                      required: [
                        "type",
                        "target",
                        "target_object_path",
                        "source_component_assembly_qualified_name",
                        "component_assembly_qualified_name",
                      ],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["replace_component"],
                        },
                        target: {
                          type: "string",
                          enum: ["selection"],
                        },
                        target_object_path: { type: "string" },
                        source_component_assembly_qualified_name: { type: "string" },
                        component_assembly_qualified_name: { type: "string" },
                      },
                    },
                    {
                      type: "object",
                      required: [
                        "type",
                        "name",
                        "parent_path",
                        "object_type",
                      ],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["create_gameobject"],
                        },
                        name: { type: "string" },
                        parent_path: { type: "string" },
                        object_type: {
                          type: "string",
                          enum: [...ALLOWED_CREATE_GAMEOBJECT_TYPES],
                        },
                      },
                    },
                    {
                      type: "object",
                      required: ["type", "name", "parent_path", "ui_type"],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["create_gameobject"],
                        },
                        name: { type: "string" },
                        parent_path: { type: "string" },
                        ui_type: {
                          type: "string",
                          enum: [...ALLOWED_UI_TYPES],
                        },
                      },
                    },
                    {
                      type: "object",
                      required: ["type", "name", "parent_path", "primitive_type"],
                      additionalProperties: false,
                      properties: {
                        type: {
                          type: "string",
                          enum: ["create_gameobject"],
                        },
                        name: { type: "string" },
                        parent_path: { type: "string" },
                        primitive_type: {
                          type: "string",
                          enum: [...ALLOWED_PRIMITIVE_TYPES],
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    },
  };
}

function parseJsonObject(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new Error("planner returned empty message");
  }

  const candidate = stripMarkdownFence(text);
  try {
    const parsed = JSON.parse(candidate);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("planner JSON is not an object");
    }
    return parsed;
  } catch (err) {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first < 0 || last < first) {
      throw new Error("planner did not return valid JSON");
    }
    const block = candidate.slice(first, last + 1);
    try {
      const parsed = JSON.parse(block);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("planner JSON is not an object");
      }
      return parsed;
    } catch {
      throw new Error("planner JSON parse failed");
    }
  }
}

function normalizeTaskAllocation(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("planner task_allocation is invalid");
  }

  const reasoningAndPlan =
    typeof value.reasoning_and_plan === "string"
      ? value.reasoning_and_plan.trim()
      : "";
  if (!reasoningAndPlan) {
    throw new Error("planner task_allocation.reasoning_and_plan is required");
  }

  const fileActions = Array.isArray(value.file_actions) ? value.file_actions : [];
  const visualActions = Array.isArray(value.visual_layer_actions)
    ? value.visual_layer_actions
    : [];

  return {
    reasoning_and_plan: reasoningAndPlan,
    file_actions: fileActions.map(normalizeFileAction),
    visual_layer_actions: visualActions.map(normalizeVisualAction),
  };
}

function normalizeFileAction(item) {
  if (!item || typeof item !== "object") {
    throw new Error("planner file action must be an object");
  }

  const type = String(item.type || "").trim();
  if (!ALLOWED_FILE_ACTION_TYPES.includes(type)) {
    throw new Error("planner file action is invalid");
  }

  if (type === "create_file" || type === "update_file") {
    const path = String(item.path || "").trim();
    const content = typeof item.content === "string" ? item.content : "";
    const overwriteIfExists = !!item.overwrite_if_exists;
    if (!path) {
      throw new Error("planner file action path is invalid");
    }
    return {
      type,
      path,
      content,
      overwrite_if_exists: overwriteIfExists,
    };
  }

  if (type === "rename_file") {
    const oldPath = String(item.old_path || "").trim();
    const newPath = String(item.new_path || "").trim();
    const overwriteIfExists = !!item.overwrite_if_exists;
    if (!oldPath || !newPath) {
      throw new Error("planner rename_file action is invalid");
    }
    return {
      type,
      old_path: oldPath,
      new_path: newPath,
      overwrite_if_exists: overwriteIfExists,
    };
  }

  const path = String(item.path || "").trim();
  if (!path) {
    throw new Error("planner delete_file action path is invalid");
  }
  return {
    type,
    path,
  };
}

function normalizeVisualAction(item) {
  if (!item || typeof item !== "object") {
    throw new Error("planner visual action must be an object");
  }

  const type = String(item.type || "").trim();
  const rawTarget = String(item.target || "").trim();
  const target = rawTarget || "selection";
  if (
    !ALLOWED_VISUAL_ACTION_TYPES.includes(type) ||
    (rawTarget && target !== "selection")
  ) {
    throw new Error("planner visual action is invalid");
  }

  if (type === "add_component") {
    const targetObjectPath = String(item.target_object_path || "").trim();
    const componentName = String(
      item.component_assembly_qualified_name || ""
    ).trim();
    if (!targetObjectPath || !componentName) {
      throw new Error("planner visual action is invalid");
    }
    return {
      type,
      target,
      target_object_path: targetObjectPath,
      component_assembly_qualified_name: componentName,
    };
  }

  if (type === "remove_component") {
    const targetObjectPath = String(item.target_object_path || "").trim();
    const componentName = String(
      item.component_name || item.component_assembly_qualified_name || ""
    ).trim();
    if (!targetObjectPath || !componentName) {
      throw new Error("planner visual action is invalid");
    }
    return {
      type,
      target,
      target_object_path: targetObjectPath,
      component_name: componentName,
      component_assembly_qualified_name: componentName,
    };
  }

  if (type === "replace_component") {
    const targetObjectPath = String(item.target_object_path || "").trim();
    const sourceComponent = String(
      item.source_component_assembly_qualified_name || ""
    ).trim();
    const targetComponent = String(
      item.component_assembly_qualified_name || ""
    ).trim();
    if (!targetObjectPath || !sourceComponent || !targetComponent) {
      throw new Error("planner replace_component action is invalid");
    }
    return {
      type,
      target,
      target_object_path: targetObjectPath,
      source_component_assembly_qualified_name: sourceComponent,
      component_assembly_qualified_name: targetComponent,
    };
  }

  const name = String(item.name || "").trim();
  const parentPath = String(item.parent_path || item.parent_object_path || "").trim();
  const objectType = String(
    item.object_type || item.primitive_type || item.ui_type || ""
  ).trim();
  if (!name || !parentPath || !objectType) {
    throw new Error("planner create_gameobject action requires name/parent_path/object_type");
  }
  if (!ALLOWED_CREATE_GAMEOBJECT_TYPES.includes(objectType)) {
    throw new Error("planner create_gameobject object_type is invalid");
  }
  const primitiveType = ALLOWED_PRIMITIVE_TYPES.includes(objectType)
    ? objectType
    : "";
  const uiType = ALLOWED_UI_TYPES.includes(objectType)
    ? objectType
    : "";
  return {
    type,
    target,
    name,
    parent_path: parentPath,
    object_type: objectType,
    parent_object_path: parentPath,
    primitive_type: primitiveType,
    ui_type: uiType,
  };
}

function normalizeAssistantText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function buildUnityQueryFallbackResult(error) {
  const message =
    error && typeof error.message === "string" && error.message.trim()
      ? error.message.trim()
      : "unity components probe failed";
  return {
    components: [],
    error_code: "unity_query_failed",
    error_message: message,
  };
}

function normalizeUnityQueryToolResult(value) {
  const raw = value && typeof value === "object" ? value : {};
  const components = Array.isArray(raw.components)
    ? raw.components
        .filter((item) => item && typeof item === "object")
        .map((item) => ({
          short_name:
            typeof item.short_name === "string" ? item.short_name.trim() : "",
          assembly_qualified_name:
            typeof item.assembly_qualified_name === "string"
              ? item.assembly_qualified_name.trim()
              : "",
        }))
        .filter((item) => item.short_name && item.assembly_qualified_name)
        .slice(0, 80)
    : [];
  const errorCode =
    typeof raw.error_code === "string" ? raw.error_code.trim() : "";
  const errorMessage =
    typeof raw.error_message === "string" ? raw.error_message.trim() : "";
  return {
    query_id: typeof raw.query_id === "string" ? raw.query_id.trim() : "",
    target_path:
      typeof raw.target_path === "string" ? raw.target_path.trim() : "",
    components,
    error_code: errorCode,
    error_message: errorMessage,
  };
}

function buildContinuationPromptAfterUnityComponentsQuery(
  originalPrompt,
  previousAssistantText,
  toolCalls,
  queryResults
) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const results = Array.isArray(queryResults) ? queryResults : [];
  const toolResultSummary = results.map((item) => {
    const result = normalizeUnityQueryToolResult(item ? item.result : null);
    return {
      call_id: item && typeof item.call_id === "string" ? item.call_id : "",
      target_path:
        item && typeof item.target_path === "string"
          ? item.target_path
          : "",
      components_count: result.components.length,
      components: result.components,
      error_code: result.error_code,
      error_message: result.error_message,
    };
  });

  return [
    "Continue the same user turn. A Unity component probe result is now available.",
    "Do not repeat previous preface. Continue concise planning based on this data.",
    "",
    "Original task context (trimmed):",
    truncateText(String(originalPrompt || ""), 800),
    "",
    "Previous assistant output:",
    truncateText(String(previousAssistantText || ""), 400),
    "",
    "Tool calls:",
    JSON.stringify(calls, null, 2),
    "",
    "Probe result JSON:",
    JSON.stringify(toolResultSummary, null, 2),
    "",
    "If a probe result has error_code, treat the probe as unavailable and continue with conservative planning.",
    "Do not invent component names when probe is unavailable.",
    "",
    "If this is sufficient, continue normally.",
    "Only if another object path is required, call query_unity_components tool again.",
  ].join("\n");
}

function mergeQueryUnityComponentCalls(target, incoming) {
  if (!Array.isArray(target) || !Array.isArray(incoming)) {
    return;
  }
  const seen = new Set(
    target.map((item) =>
      `${item && item.call_id ? item.call_id : ""}|${
        item && item.target_path ? item.target_path : ""
      }`
    )
  );
  for (const item of incoming) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const callId =
      typeof item.call_id === "string" ? item.call_id.trim() : "";
    const targetPath =
      typeof item.target_path === "string" ? item.target_path.trim() : "";
    if (!targetPath) {
      continue;
    }
    const key = `${callId}|${targetPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    target.push({
      call_id: callId,
      target_path: targetPath,
    });
  }
}

function extractQueryUnityComponentsToolCalls(message) {
  if (!message || typeof message !== "object") {
    return [];
  }

  const collected = [];
  collectQueryUnityComponentsToolCalls(message, collected, 0);
  if (collected.length === 0) {
    return [];
  }

  const unique = [];
  mergeQueryUnityComponentCalls(unique, collected);
  return unique;
}

function collectQueryUnityComponentsToolCalls(value, output, depth) {
  if (depth > 8 || !output || !Array.isArray(output) || value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectQueryUnityComponentsToolCalls(item, output, depth + 1);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const extracted = tryExtractQueryUnityComponentsToolCall(value);
  if (extracted) {
    output.push(extracted);
  }

  for (const child of Object.values(value)) {
    collectQueryUnityComponentsToolCalls(child, output, depth + 1);
  }
}

function tryExtractQueryUnityComponentsToolCall(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const toolName = extractToolCallName(value);
  if (toolName !== "query_unity_components") {
    return null;
  }

  const targetPath = extractTargetPathFromToolCall(value);
  if (!targetPath) {
    return null;
  }

  return {
    call_id: extractToolCallId(value),
    target_path: targetPath,
  };
}

function extractToolCallName(value) {
  const candidates = [
    value.name,
    value.tool_name,
    value.toolName,
    value.function_name,
    value.functionName,
    value.tool && value.tool.name,
    value.function && value.function.name,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = candidate.trim();
    if (normalized === "query_unity_components") {
      return normalized;
    }
  }

  return "";
}

function extractToolCallId(value) {
  const candidates = [
    value.call_id,
    value.callId,
    value.tool_call_id,
    value.toolCallId,
    value.id,
    value.function_call_id,
    value.functionCallId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = candidate.trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function extractTargetPathFromToolCall(value) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const candidates = [
    value.target_path,
    value.targetPath,
    value.arguments,
    value.args,
    value.input,
    value.parameters,
    value.arguments_json,
    value.args_json,
    value.function && value.function.arguments,
    value.function && value.function.args,
    value.function && value.function.input,
    value.function && value.function.parameters,
    value.payload,
  ];

  for (const candidate of candidates) {
    const extracted = extractTargetPathFromToolCallArgs(candidate, 0);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function extractTargetPathFromToolCallArgs(value, depth) {
  if (depth > 5 || value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) {
      return "";
    }

    const directJsonMatch = text.match(/"target_path"\s*:\s*"([^"]+)"/i);
    if (directJsonMatch && directJsonMatch[1] && directJsonMatch[1].trim()) {
      return directJsonMatch[1].trim();
    }

    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        return extractTargetPathFromToolCallArgs(parsed, depth + 1);
      } catch {
        return "";
      }
    }

    return "";
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractTargetPathFromToolCallArgs(item, depth + 1);
      if (extracted) {
        return extracted;
      }
    }
    return "";
  }

  if (typeof value !== "object") {
    return "";
  }

  if (typeof value.target_path === "string" && value.target_path.trim()) {
    return value.target_path.trim();
  }
  if (typeof value.targetPath === "string" && value.targetPath.trim()) {
    return value.targetPath.trim();
  }

  for (const child of Object.values(value)) {
    const extracted = extractTargetPathFromToolCallArgs(child, depth + 1);
    if (extracted) {
      return extracted;
    }
  }

  return "";
}

function ensureCompletedStatus(completion) {
  if (
    completion &&
    completion.turn &&
    completion.turn.status &&
    completion.turn.status !== "completed"
  ) {
    const errorMessage =
      completion.turn.error && completion.turn.error.message
        ? completion.turn.error.message
        : `turn completed with status=${completion.turn.status}`;
    throw new Error(errorMessage);
  }
}

function extractTurnIdFromStart(response) {
  return response &&
    response.turn &&
    typeof response.turn.id === "string"
    ? response.turn.id
    : "";
}

function isNotificationForTurn(message, turnId) {
  if (!message || typeof message !== "object") {
    return false;
  }
  if (!turnId) {
    return true;
  }

  const notificationTurnId = extractTurnIdFromNotification(message);
  if (!notificationTurnId) {
    return true;
  }

  return notificationTurnId === turnId;
}

function extractTurnIdFromNotification(message) {
  const params = message && message.params ? message.params : null;
  if (!params || typeof params !== "object") {
    return "";
  }

  const candidates = [
    params.turn_id,
    params.turnId,
    params.turn && params.turn.id,
    params.item && params.item.turn_id,
    params.item && params.item.turnId,
    params.item && params.item.turn && params.item.turn.id,
    params.msg && params.msg.turn_id,
    params.msg && params.msg.turnId,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return "";
}

function extractDelta(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  const params = message.params && typeof message.params === "object"
    ? message.params
    : {};
  const method = typeof message.method === "string" ? message.method : "";

  if (
    method !== "item/agentMessage/delta" &&
    method !== "codex/event/agent_message_delta" &&
    method !== "codex/event/agent_message_chunk" &&
    method !== "agent_message.delta"
  ) {
    return "";
  }

  if (typeof params.delta === "string" && params.delta) {
    return params.delta;
  }

  if (params.msg && typeof params.msg.delta === "string" && params.msg.delta) {
    return params.msg.delta;
  }

  if (params.msg && typeof params.msg.chunk === "string" && params.msg.chunk) {
    return params.msg.chunk;
  }

  if (params.item && typeof params.item.delta === "string" && params.item.delta) {
    return params.item.delta;
  }

  return "";
}

function extractCompletedText(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  const params = message.params && typeof message.params === "object"
    ? message.params
    : {};

  if (message.method === "item/completed") {
    const text =
      params &&
      params.item &&
      typeof params.item.text === "string"
        ? params.item.text
        : "";
    return text || "";
  }

  if (message.method === "codex/event/agent_message") {
    const text =
      params &&
      params.msg &&
      typeof params.msg.message === "string"
        ? params.msg.message
        : "";
    return text || "";
  }

  if (message.method === "turn/completed") {
    const turn = params && params.turn && typeof params.turn === "object"
      ? params.turn
      : {};
    const content =
      typeof turn.output === "string"
        ? turn.output
        : typeof turn.result === "string"
          ? turn.result
          : "";
    return content || "";
  }

  return "";
}

function extractTaskAllocationFromCompletion(completion) {
  const candidates = [];
  const params =
    completion && typeof completion === "object" ? completion : null;
  const turn =
    params && params.turn && typeof params.turn === "object"
      ? params.turn
      : null;

  if (turn) {
    candidates.push(turn.output);
    candidates.push(turn.result);
    candidates.push(turn.output_json);
    candidates.push(turn.structured_output);
  }
  if (params) {
    candidates.push(params.output);
    candidates.push(params.result);
  }

  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) {
      continue;
    }

    if (typeof candidate === "object" && !Array.isArray(candidate)) {
      if (Object.prototype.hasOwnProperty.call(candidate, "task_allocation")) {
        return {
          found: true,
          value: candidate.task_allocation,
        };
      }
      if (looksLikeTaskAllocationObject(candidate)) {
        return {
          found: true,
          value: candidate,
        };
      }
      continue;
    }

    if (typeof candidate === "string") {
      try {
        const parsed = parseJsonObject(candidate);
        if (Object.prototype.hasOwnProperty.call(parsed, "task_allocation")) {
          return {
            found: true,
            value: parsed.task_allocation,
          };
        }
        if (looksLikeTaskAllocationObject(parsed)) {
          return {
            found: true,
            value: parsed,
          };
        }
      } catch {
        // ignore non-json candidates
      }
    }
  }

  return {
    found: false,
    value: null,
  };
}

function stripMarkdownFence(value) {
  const text = String(value || "").trim();
  if (!text.startsWith("```")) {
    return text;
  }
  const lines = text.split(/\r?\n/);
  if (lines.length < 3) {
    return text;
  }
  const start = lines[0];
  const end = lines[lines.length - 1];
  if (!start.startsWith("```") || !end.startsWith("```")) {
    return text;
  }
  return lines.slice(1, -1).join("\n").trim();
}

function looksLikeTaskAllocationObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const allowedKeys = new Set([
    "reasoning_and_plan",
    "file_actions",
    "visual_layer_actions",
  ]);
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      return false;
    }
  }
  if (!Array.isArray(value.file_actions) || !Array.isArray(value.visual_layer_actions)) {
    return false;
  }
  return true;
}

function raceWithAbort(promise, signal) {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(new Error("planner aborted"));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new Error("planner aborted"));
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      }
    );
  });
}

function classifyExtractionFailureReason(error) {
  const message =
    error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  if (!message) {
    return "unknown";
  }
  if (message.includes("missing task_allocation")) {
    return "missing_task_allocation";
  }
  if (message.includes("json parse")) {
    return "json_parse_failed";
  }
  if (message.includes("aborted")) {
    return "aborted";
  }
  if (message.includes("timed out")) {
    return "timeout";
  }
  if (message.includes("schema")) {
    return "schema_invalid";
  }
  return "unknown";
}

function extractTokenUsageFromTurnPayload(payload) {
  const candidates = [];
  collectUsageCandidates(payload, candidates, 0);
  /** @type {null | { input_tokens: number, output_tokens: number, total_tokens: number }} */
  let best = null;
  for (const candidate of candidates) {
    const normalized = normalizeTokenUsage(candidate);
    if (!normalized) {
      continue;
    }
    if (!best || normalized.total_tokens > best.total_tokens) {
      best = normalized;
    }
  }
  return best;
}

function collectUsageCandidates(value, output, depth) {
  if (
    depth > 10 ||
    !Array.isArray(output) ||
    value === null ||
    value === undefined
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUsageCandidates(item, output, depth + 1);
    }
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (looksLikeUsageObject(value)) {
    output.push(value);
  }
  const entries = Object.entries(value);
  for (const [, child] of entries) {
    collectUsageCandidates(child, output, depth + 1);
  }
}

function looksLikeUsageObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  return keys.some((key) => /token|usage/i.test(String(key || "")));
}

function normalizeTokenUsage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const inputTokens = readFirstFiniteNumber(value, [
    "input_tokens",
    "prompt_tokens",
    "inputTokens",
    "promptTokens",
    "prompt_token_count",
    "promptTokenCount",
    "input_token_count",
    "inputTokenCount",
  ]);
  const outputTokens = readFirstFiniteNumber(value, [
    "output_tokens",
    "completion_tokens",
    "outputTokens",
    "completionTokens",
    "completion_token_count",
    "completionTokenCount",
    "output_token_count",
    "outputTokenCount",
  ]);
  const totalTokens = readFirstFiniteNumber(value, [
    "total_tokens",
    "totalTokens",
    "total_token_count",
    "totalTokenCount",
  ]);

  const normalizedInput = inputTokens > 0 ? Math.floor(inputTokens) : 0;
  const normalizedOutput = outputTokens > 0 ? Math.floor(outputTokens) : 0;
  const sum = normalizedInput + normalizedOutput;
  const normalizedTotal = totalTokens > 0
    ? Math.max(Math.floor(totalTokens), sum)
    : sum;
  if (normalizedTotal <= 0) {
    return null;
  }
  return {
    input_tokens: normalizedInput,
    output_tokens: normalizedOutput,
    total_tokens: normalizedTotal,
  };
}

function readFirstFiniteNumber(value, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(keys)
  ) {
    return 0;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    const n = Number(value[key]);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return 0;
}

function createProgressReporter(onProgress) {
  let lastTickAt = 0;
  return (eventOrStage) => {
    if (typeof onProgress !== "function") {
      return;
    }
    const normalizedEvent = normalizeProgressEvent(eventOrStage);
    const stageName = normalizedEvent.stage;
    if (!stageName) {
      return;
    }
    const isLifecycleStage =
      stageName.endsWith(".starting") ||
      stageName.endsWith(".started") ||
      stageName.endsWith(".completed");
    const now = Number.isFinite(normalizedEvent.timestamp)
      ? Number(normalizedEvent.timestamp)
      : Date.now();
    const hasMetrics = !!normalizedEvent.metrics;
    if (!isLifecycleStage && !hasMetrics && now - lastTickAt < 300) {
      return;
    }
    lastTickAt = now;
    try {
      onProgress(normalizedEvent);
    } catch {
      // ignore callback exceptions
    }
  };
}

function normalizeProgressEvent(eventOrStage) {
  if (typeof eventOrStage === "string") {
    return {
      stage: eventOrStage,
      timestamp: Date.now(),
    };
  }
  if (!eventOrStage || typeof eventOrStage !== "object") {
    return {
      stage: "",
      timestamp: Date.now(),
    };
  }
  const stage =
    typeof eventOrStage.stage === "string" ? eventOrStage.stage : "";
  const timestamp =
    Number.isFinite(eventOrStage.timestamp) && eventOrStage.timestamp > 0
      ? Number(eventOrStage.timestamp)
      : Date.now();
  const metrics = normalizeProgressMetrics(eventOrStage.metrics);
  return metrics
    ? {
        stage,
        timestamp,
        metrics,
      }
    : {
        stage,
        timestamp,
      };
}

function normalizeProgressMetrics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const normalized = {};
  for (const key of Object.keys(value)) {
    const raw = value[key];
    if (Number.isFinite(raw)) {
      normalized[key] = Number(raw);
      continue;
    }
    if (typeof raw === "string") {
      normalized[key] = raw;
      continue;
    }
    if (typeof raw === "boolean") {
      normalized[key] = raw;
    }
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

function startProgressKeepalive(markProgress, intervalMs, stageName) {
  if (typeof markProgress !== "function") {
    return () => {};
  }
  const ms = Number(intervalMs);
  if (!Number.isFinite(ms) || ms <= 0) {
    return () => {};
  }

  const timer = setInterval(() => {
    markProgress(typeof stageName === "string" ? stageName : "keepalive");
  }, ms);

  if (timer && typeof timer.unref === "function") {
    timer.unref();
  }

  return () => {
    clearInterval(timer);
  };
}

function normalizeSessionKey(value) {
  if (!value || typeof value !== "string") {
    return "default";
  }
  const key = value.trim();
  return key || "default";
}

function normalizePromptTemplate(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (SUPPORTED_PROMPT_TEMPLATES.includes(raw)) {
    return raw;
  }
  return DEFAULT_PROMPT_TEMPLATE;
}

function normalizeMemoryInjectionMode(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (SUPPORTED_MEMORY_INJECTION_MODES.includes(raw)) {
    return raw;
  }
  return DEFAULT_MEMORY_INJECTION_MODE;
}

function normalizeMemoryCapsuleMode(value) {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (SUPPORTED_MEMORY_CAPSULE_MODES.includes(raw)) {
    return raw;
  }
  return DEFAULT_MEMORY_CAPSULE_MODE;
}

function normalizePositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function normalizeNonNegativeInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

function isThreadMissingError(error) {
  const message =
    error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  if (!message) {
    return false;
  }
  const hasThreadToken = message.includes("thread");
  if (!hasThreadToken) {
    return false;
  }
  return (
    message.includes("not found") ||
    message.includes("unknown") ||
    message.includes("invalid") ||
    message.includes("does not exist")
  );
}

function shouldResetSessionOnError(error) {
  const message =
    error && typeof error.message === "string"
      ? error.message.toLowerCase()
      : "";
  if (!message) {
    return false;
  }
  return (
    message.includes("planner aborted") ||
    message.includes("timed out") ||
    message.includes("exited unexpectedly") ||
    message.includes("not running") ||
    message.includes("epipe") ||
    message.includes("json-rpc error")
  );
}

function isStaleTimestamp(timestamp, ttlMs, now) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return true;
  }
  const ttl = Number(ttlMs);
  if (!Number.isFinite(ttl) || ttl <= 0) {
    return false;
  }
  const current = Number.isFinite(now) ? Number(now) : Date.now();
  return current - ts > ttl;
}

function numberOrNow(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : Date.now();
}

function buildPromptContextSummary(context, options) {
  return buildPromptContextSummaryWithStats(context, options).summary;
}

function buildPromptContextSummaryWithStats(context, options) {
  const normalizedOptions = normalizeContextSummaryOptions(options);
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {
      summary: {},
      stats: {
        selection_tree_present: false,
        context_truncated: false,
        path_hints_count: 0,
        max_depth_input: 0,
      },
    };
  }

  const summary = {};
  const stats = {
    selection_tree_present: false,
    context_truncated: false,
    path_hints_count: 0,
    max_depth_input: 0,
  };
  const scenePath = findStringByKeyPattern(
    context,
    [/^scene_path$/i, /^active_scene_path$/i, /scene/i],
    0,
    60
  );
  if (scenePath) {
    summary.scene_path = scenePath;
  }

  const selectedPath = findStringByKeyPattern(
    context,
    [/target_object_path/i, /^object_path$/i, /^path$/i, /selected/i],
    0,
    80
  );
  if (selectedPath) {
    summary.selected_object_path = selectedPath;
  }

  const selectedName = findStringByKeyPattern(
    context,
    [/^name$/i, /object_name/i, /selected_name/i],
    0,
    80
  );
  if (selectedName) {
    summary.selected_object_name = selectedName;
  }

  const selectionTree =
    context.selection_tree && typeof context.selection_tree === "object"
      ? context.selection_tree
      : null;
  if (selectionTree) {
    const treeResult = summarizeSelectionTree(selectionTree, normalizedOptions);
    summary.selection_tree = treeResult.summary;
    stats.selection_tree_present = true;
    stats.context_truncated = treeResult.truncated;
    stats.path_hints_count = treeResult.pathHintsCount;
    stats.max_depth_input = treeResult.maxDepthInput;
  }

  return {
    summary,
    stats,
  };
}

function summarizeSelectionTree(selectionTree, options) {
  const normalizedOptions = normalizeContextSummaryOptions(options);
  const summary = {};
  const maxDepthInput = Number.isFinite(Number(selectionTree && selectionTree.max_depth))
    ? Math.max(0, Math.floor(Number(selectionTree.max_depth)))
    : 0;
  let contextTruncated = false;
  if (
    selectionTree &&
    Number.isFinite(selectionTree.max_depth) &&
    selectionTree.max_depth > 0
  ) {
    summary.max_depth = Math.min(
      Number(selectionTree.max_depth),
      normalizedOptions.depthLimit
    );
    if (Number(selectionTree.max_depth) > normalizedOptions.depthLimit) {
      contextTruncated = true;
    }
  }

  const paths = [];
  const collectStats = {
    pathLimitHit: false,
    depthLimitHit: false,
    nodeBudgetHit: false,
  };
  collectPathCandidates(selectionTree, paths, 0, { visited: 0 }, {
    maxCount: normalizedOptions.pathHintsMax,
    depthLimit: normalizedOptions.depthLimit,
    nodeVisitBudget: normalizedOptions.nodeVisitBudget,
    stats: collectStats,
  });
  if (paths.length > 0) {
    summary.path_hints = paths.slice(0, normalizedOptions.pathHintsMax);
  }

  if (collectStats.pathLimitHit || collectStats.depthLimitHit || collectStats.nodeBudgetHit) {
    contextTruncated = true;
  }
  return {
    summary,
    pathHintsCount: paths.length,
    maxDepthInput,
    truncated: contextTruncated,
  };
}

function collectPathCandidates(value, output, depth, state, limits) {
  const opts =
    limits && typeof limits === "object"
      ? limits
      : {
          maxCount: DEFAULT_CONTEXT_PATH_HINTS_MAX,
          depthLimit: DEFAULT_CONTEXT_DEPTH_LIMIT,
          nodeVisitBudget: DEFAULT_CONTEXT_NODE_VISIT_BUDGET,
          stats: null,
        };
  const stats =
    opts.stats && typeof opts.stats === "object" ? opts.stats : null;
  if (
    !value ||
    !state ||
    depth > opts.depthLimit ||
    state.visited >= opts.nodeVisitBudget ||
    output.length >= opts.maxCount
  ) {
    if (depth > opts.depthLimit && stats) {
      stats.depthLimitHit = true;
    }
    if (state && state.visited >= opts.nodeVisitBudget && stats) {
      stats.nodeBudgetHit = true;
    }
    if (output.length >= opts.maxCount && stats) {
      stats.pathLimitHit = true;
    }
    return;
  }
  state.visited += 1;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (output.length >= opts.maxCount) {
        if (stats) {
          stats.pathLimitHit = true;
        }
        return;
      }
      collectPathCandidates(item, output, depth + 1, state, opts);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (output.length >= opts.maxCount) {
      if (stats) {
        stats.pathLimitHit = true;
      }
      return;
    }
    if (
      typeof child === "string" &&
      child &&
      (/(path|object|target)/i.test(key) || child.includes("/"))
    ) {
      if (!output.includes(child)) {
        output.push(child);
        if (output.length >= opts.maxCount && stats) {
          stats.pathLimitHit = true;
        }
      }
    }
    if (child && typeof child === "object") {
      collectPathCandidates(child, output, depth + 1, state, opts);
    }
  }
}

function normalizeContextSummaryOptions(options) {
  const opts = options && typeof options === "object" ? options : {};
  return {
    pathHintsMax: normalizeNonNegativeInteger(
      opts.pathHintsMax,
      DEFAULT_CONTEXT_PATH_HINTS_MAX
    ),
    depthLimit: normalizePositiveInteger(
      opts.depthLimit,
      DEFAULT_CONTEXT_DEPTH_LIMIT
    ),
    nodeVisitBudget: normalizePositiveInteger(
      opts.nodeVisitBudget,
      DEFAULT_CONTEXT_NODE_VISIT_BUDGET
    ),
  };
}

function findStringByKeyPattern(value, patterns, depth, budget) {
  if (!value || budget <= 0 || depth > 5) {
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findStringByKeyPattern(item, patterns, depth + 1, budget - 1);
      if (hit) {
        return hit;
      }
    }
    return "";
  }
  if (typeof value !== "object") {
    return "";
  }

  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && child) {
      for (const pattern of patterns) {
        if (pattern.test(key)) {
          return child;
        }
      }
    }
  }

  for (const child of Object.values(value)) {
    if (!child || typeof child !== "object") {
      continue;
    }
    const hit = findStringByKeyPattern(child, patterns, depth + 1, budget - 1);
    if (hit) {
      return hit;
    }
  }

  return "";
}

function summarizeAssistantTextForExtraction(assistantText, maxChars) {
  if (!assistantText || typeof assistantText !== "string") {
    return "";
  }
  const normalized = assistantText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Number(maxChars) : 360;
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit)}...`;
}

function buildFinalizeExecutionSummary(executionReport) {
  const report =
    executionReport &&
    typeof executionReport === "object" &&
    !Array.isArray(executionReport)
      ? executionReport
      : {};
  const summary = {
    request_id: typeof report.request_id === "string" ? report.request_id : "",
    outcome: typeof report.outcome === "string" ? report.outcome : "",
    reason: typeof report.reason === "string" ? report.reason : "",
    compile_success:
      typeof report.compile_success === "boolean" ? report.compile_success : null,
    action_success:
      typeof report.action_success === "boolean" ? report.action_success : null,
    auto_fix_attempts: Number.isFinite(report.auto_fix_attempts)
      ? Number(report.auto_fix_attempts)
      : 0,
    max_auto_fix_attempts: Number.isFinite(report.max_auto_fix_attempts)
      ? Number(report.max_auto_fix_attempts)
      : 0,
    last_failure_code:
      typeof report.last_failure_code === "string" ? report.last_failure_code : "",
    last_failure_message: truncateText(
      typeof report.last_failure_message === "string"
        ? report.last_failure_message
        : "",
      200
    ),
    chat_only: !!report.chat_only,
  };

  if (Array.isArray(report.files_changed) && report.files_changed.length > 0) {
    summary.files_changed = report.files_changed.slice(0, 8).map((item) => ({
      type: item && typeof item.type === "string" ? item.type : "",
      path: item && typeof item.path === "string" ? item.path : "",
    }));
  } else {
    summary.files_changed = [];
  }

  if (Array.isArray(report.compile_errors) && report.compile_errors.length > 0) {
    summary.compile_errors = report.compile_errors.slice(0, 2).map((item) => ({
      code: item && typeof item.code === "string" ? item.code : "",
      message: truncateText(
        item && typeof item.message === "string" ? item.message : "",
        220
      ),
    }));
  } else {
    summary.compile_errors = [];
  }

  if (report.action_error && typeof report.action_error === "object") {
    summary.action_error = {
      error_code:
        typeof report.action_error.error_code === "string"
          ? report.action_error.error_code
          : "",
      error_message: truncateText(
        typeof report.action_error.error_message === "string"
          ? report.action_error.error_message
          : "",
        220
      ),
    };
  } else {
    summary.action_error = null;
  }

  return summary;
}

function truncateText(value, maxChars) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "";
  }
  const limit = Number.isFinite(maxChars) && maxChars > 0 ? Number(maxChars) : 200;
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

function buildConversationMemoryLine(input) {
  const payload = input && typeof input === "object" ? input : {};
  const hasExecutionReport =
    payload.executionReport &&
    typeof payload.executionReport === "object" &&
    !Array.isArray(payload.executionReport);
  if (hasExecutionReport) {
    return buildFinalizeMemoryLine(payload);
  }
  return buildPlanningMemoryLine(payload);
}

function buildPlanningMemoryLine(payload) {
  const user = compactSingleLineText(
    payload.userMessage,
    MEMORY_USER_SNIPPET_MAX_CHARS
  );
  const assistant = compactSingleLineText(
    payload.assistantText,
    MEMORY_ASSISTANT_SNIPPET_MAX_CHARS
  );
  const contextSummary = buildPromptContextSummary(payload.context);
  const scope = compactSingleLineText(
    contextSummary.selected_object_path ||
      contextSummary.selected_object_name ||
      contextSummary.scene_path,
    90
  );
  const actionSummary = buildTaskAllocationMemorySummary(payload.taskAllocation);
  if (!user && !assistant && !actionSummary) {
    return "";
  }

  const parts = ["Plan"];
  if (user) {
    parts.push(`Goal=${user}`);
  }
  if (scope) {
    parts.push(`Scope=${scope}`);
  }
  if (actionSummary) {
    parts.push(`Actions=${actionSummary}`);
  }
  if (assistant) {
    parts.push(`Reply=${assistant}`);
  }
  return parts.join(" | ");
}

function buildFinalizeMemoryLine(payload) {
  const report = payload.executionReport;
  const outcome = compactSingleLineText(report.outcome, 40) || "unknown";
  const reason = compactSingleLineText(report.reason, 60);
  const compile = compactOutcomeFlag(report.compile_success);
  const action = compactOutcomeFlag(report.action_success);
  const files = extractExecutionFileList(report, 3);
  const failureCode = compactSingleLineText(
    report.last_failure_code ||
      (report.action_error &&
      typeof report.action_error === "object"
        ? report.action_error.error_code
        : ""),
    32
  );
  const assistant = compactSingleLineText(
    payload.assistantText,
    MEMORY_ASSISTANT_SNIPPET_MAX_CHARS
  );

  const parts = ["Final"];
  parts.push(`Outcome=${reason ? `${outcome}(${reason})` : outcome}`);
  parts.push(`Compile=${compile}`);
  parts.push(`Action=${action}`);
  if (files) {
    parts.push(`Files=${files}`);
  }
  if (failureCode) {
    parts.push(`Error=${failureCode}`);
  }
  if (assistant) {
    parts.push(`Reply=${assistant}`);
  }
  return parts.join(" | ");
}

function buildTaskAllocationMemorySummary(taskAllocation) {
  if (
    !taskAllocation ||
    typeof taskAllocation !== "object" ||
    Array.isArray(taskAllocation)
  ) {
    return "chat";
  }
  const fileCount = Array.isArray(taskAllocation.file_actions)
    ? taskAllocation.file_actions.length
    : 0;
  const visualCount = Array.isArray(taskAllocation.visual_layer_actions)
    ? taskAllocation.visual_layer_actions.length
    : 0;
  if (fileCount === 0 && visualCount === 0) {
    return "chat";
  }

  const parts = [];
  if (fileCount > 0) {
    const fileNames = taskAllocation.file_actions
      .map((item) => normalizeFileName(item && item.path))
      .filter((name) => !!name)
      .slice(0, 2);
    parts.push(
      fileNames.length > 0
        ? `files(${fileCount}):${fileNames.join(",")}`
        : `files(${fileCount})`
    );
  }
  if (visualCount > 0) {
    const visualNames = taskAllocation.visual_layer_actions
      .map((item) => extractVisualMemoryName(item))
      .filter((name) => !!name)
      .slice(0, 2);
    parts.push(
      visualNames.length > 0
        ? `visuals(${visualCount}):${visualNames.join(",")}`
        : `visuals(${visualCount})`
    );
  }
  return parts.join("; ");
}

function compactSingleLineText(value, maxChars) {
  const text = typeof value === "string" ? value : "";
  if (!text) {
    return "";
  }
  return truncateText(text.replace(/\s+/g, " ").trim(), maxChars);
}

function compactOutcomeFlag(value) {
  if (value === true) {
    return "ok";
  }
  if (value === false) {
    return "fail";
  }
  return "-";
}

function normalizeFileName(value) {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path) {
    return "";
  }
  const normalized = path.replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function extractVisualMemoryName(item) {
  if (!item || typeof item !== "object") {
    return "";
  }
  const type = typeof item.type === "string" ? item.type : "";
  const name = typeof item.name === "string" ? item.name : "";
  const primitiveType =
    typeof item.primitive_type === "string" ? item.primitive_type : "";
  const uiType = typeof item.ui_type === "string" ? item.ui_type : "";
  const component = typeof item.component_assembly_qualified_name === "string"
    ? item.component_assembly_qualified_name
    : "";
  const componentName = typeof item.component_name === "string"
    ? item.component_name
    : "";
  const sourceComponent =
    typeof item.source_component_assembly_qualified_name === "string"
      ? item.source_component_assembly_qualified_name
      : "";
  const target = typeof item.target_object_path === "string"
    ? item.target_object_path
    : "";
  const parent = typeof item.parent_object_path === "string"
    ? item.parent_object_path
    : "";
  const parentPath = typeof item.parent_path === "string" ? item.parent_path : "";
  const objectType =
    typeof item.object_type === "string" ? item.object_type : "";
  const componentShort = component ? component.split(",")[0].trim() : "";
  const componentNameShort = componentName ? componentName.trim() : "";
  const sourceComponentShort = sourceComponent
    ? sourceComponent.split(",")[0].trim()
    : "";
  const targetShort = target ? truncateText(target, 40) : "";
  const parentShort = (parentPath || parent) ? truncateText(parentPath || parent, 40) : "";
  const objectKind = objectType || primitiveType || uiType;
  if (type === "create_gameobject") {
    if (name && parentShort && objectKind) {
      return `${type}:${name}@${parentShort}[${objectKind}]`;
    }
    if (name && parentShort) {
      return `${type}:${name}@${parentShort}`;
    }
    if (name) {
      return `${type}:${name}`;
    }
  }
  if (type === "replace_component" && sourceComponentShort && componentShort) {
    return `${sourceComponentShort}->${componentShort}`;
  }
  if ((componentNameShort || componentShort) && targetShort) {
    return `${componentNameShort || componentShort}@${targetShort}`;
  }
  return componentNameShort || componentShort || sourceComponentShort || targetShort || type;
}

function extractExecutionFileList(report, maxCount) {
  if (!report || typeof report !== "object" || !Array.isArray(report.files_changed)) {
    return "";
  }
  const limit = Number.isFinite(maxCount) && maxCount > 0 ? Number(maxCount) : 3;
  const names = [];
  const seen = new Set();
  for (const item of report.files_changed) {
    const name = normalizeFileName(item && item.path);
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    names.push(name);
    if (names.length >= limit) {
      break;
    }
  }
  return names.join(",");
}

function filterMemoryNoiseLines(lines, options) {
  const normalized = Array.isArray(lines)
    ? lines
        .filter((line) => typeof line === "string" && line.trim())
        .map((line) => line.trim())
    : [];
  if (normalized.length === 0) {
    return {
      lines: [],
      filtered: false,
      keptLines: 0,
      droppedLines: 0,
    };
  }

  const opts = options && typeof options === "object" ? options : {};
  const enabled = opts.enabled === true;
  if (!enabled) {
    return {
      lines: normalized,
      filtered: false,
      keptLines: normalized.length,
      droppedLines: 0,
    };
  }

  const minKeepLines = normalizePositiveInteger(
    opts.minKeepLines,
    DEFAULT_MEMORY_NOISE_FILTER_MIN_KEEP_LINES
  );
  const protectedIndexes = new Set();
  const startTail = Math.max(0, normalized.length - minKeepLines);
  for (let i = startTail; i < normalized.length; i += 1) {
    protectedIndexes.add(i);
  }

  const kept = [];
  let dropped = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    const line = normalized[i];
    if (protectedIndexes.has(i)) {
      kept.push(line);
      continue;
    }
    if (isChatOnlyMemoryPlanLine(line)) {
      dropped += 1;
      continue;
    }
    kept.push(line);
  }

  if (kept.length === 0) {
    return {
      lines: normalized,
      filtered: false,
      keptLines: normalized.length,
      droppedLines: 0,
    };
  }
  return {
    lines: kept,
    filtered: dropped > 0,
    keptLines: kept.length,
    droppedLines: dropped,
  };
}

function isChatOnlyMemoryPlanLine(line) {
  const parsed = parseMemoryLineFields(line);
  if (!parsed || parsed.kind !== "Plan") {
    return false;
  }
  const actions = compactSingleLineText(parsed.fields.Actions, 40).toLowerCase();
  if (!actions) {
    return false;
  }
  return actions === "chat" || actions.startsWith("chat;");
}

function mergePinnedExecutionSignals(baseLines, sourceLines, options) {
  const base = Array.isArray(baseLines)
    ? baseLines.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];
  const source = Array.isArray(sourceLines)
    ? sourceLines.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];
  const opts = options && typeof options === "object" ? options : {};
  const enabled = opts.enabled === true;
  if (!enabled || source.length === 0) {
    return {
      lines: base.length > 0 ? base : source,
      pinnedLines: 0,
      failurePinnedLines: 0,
      planPinnedLines: 0,
      compactedLines: 0,
      addedChars: 0,
    };
  }

  const maxPinnedLines = normalizePositiveInteger(
    opts.maxPinnedLines,
    DEFAULT_MEMORY_SIGNAL_PIN_MAX_LINES
  );
  const compactEnabled = opts.compactEnabled === true;
  const maxCharsPerLine = normalizePositiveInteger(
    opts.maxCharsPerLine,
    DEFAULT_MEMORY_SIGNAL_PIN_MAX_CHARS
  );
  const maxAddedChars = normalizePositiveInteger(
    opts.maxAddedChars,
    DEFAULT_MEMORY_SIGNAL_PIN_MAX_ADDED_CHARS
  );

  const selectedSource = new Set(base);
  const selectedOutput = new Set(base);
  const failureCandidates = [];
  const planCandidates = [];
  for (let i = 0; i < source.length; i += 1) {
    const line = source[i];
    const parsed = parseMemoryLineFields(line);
    if (isCriticalFailureMemoryLine(parsed)) {
      failureCandidates.push({ index: i, line, parsed });
      continue;
    }
    if (isExecutablePlanMemoryLine(parsed)) {
      planCandidates.push({ index: i, line, parsed });
    }
  }

  const pinnedQueue = [];
  for (const item of failureCandidates.slice(-maxPinnedLines)) {
    pinnedQueue.push({ ...item, type: "failure" });
  }
  for (const item of planCandidates.slice(-maxPinnedLines)) {
    pinnedQueue.push({ ...item, type: "plan" });
  }
  pinnedQueue.sort((a, b) => {
    if (a.type === b.type) {
      return a.index - b.index;
    }
    return a.type === "failure" ? -1 : 1;
  });

  let pinnedLines = 0;
  let failurePinnedLines = 0;
  let planPinnedLines = 0;
  let compactedLines = 0;
  let addedChars = 0;
  const syntheticPinnedLines = [];
  for (const item of pinnedQueue) {
    if (pinnedLines >= maxPinnedLines) {
      break;
    }
    if (selectedSource.has(item.line)) {
      continue;
    }
    let outputLine = item.line;
    let compacted = false;
    if (compactEnabled) {
      const compact = buildCompactPinnedMemoryLine(
        item.parsed,
        item.type,
        maxCharsPerLine
      );
      if (compact && compact !== outputLine) {
        outputLine = compact;
        compacted = true;
      } else if (outputLine.length > maxCharsPerLine) {
        outputLine = truncateText(outputLine, maxCharsPerLine);
        compacted = outputLine !== item.line;
      }
    }
    if (!outputLine) {
      continue;
    }
    if (selectedOutput.has(outputLine)) {
      continue;
    }

    let nextAddedChars = addedChars + outputLine.length;
    if (nextAddedChars > maxAddedChars) {
      if (pinnedLines > 0) {
        continue;
      }
      const forcedLimit = Math.max(32, maxAddedChars);
      outputLine = truncateText(outputLine, forcedLimit);
      if (!outputLine || selectedOutput.has(outputLine)) {
        continue;
      }
      nextAddedChars = outputLine.length;
    }

    if (outputLine === item.line) {
      selectedSource.add(item.line);
    } else {
      syntheticPinnedLines.push(outputLine);
    }
    selectedOutput.add(outputLine);
    pinnedLines += 1;
    addedChars = nextAddedChars;
    if (compacted) {
      compactedLines += 1;
    }
    if (item.type === "failure") {
      failurePinnedLines += 1;
    } else if (item.type === "plan") {
      planPinnedLines += 1;
    }
  }

  const merged = [];
  const mergedSeen = new Set();
  for (const line of source) {
    if (selectedSource.has(line)) {
      appendUnique(merged, mergedSeen, line);
    }
  }
  for (const line of syntheticPinnedLines) {
    appendUnique(merged, mergedSeen, line);
  }
  const lines = merged.length > 0 ? merged : (base.length > 0 ? base : source);
  return {
    lines,
    pinnedLines,
    failurePinnedLines,
    planPinnedLines,
    compactedLines,
    addedChars,
  };
}

function isCriticalFailureMemoryLine(parsed) {
  if (!parsed || parsed.kind !== "Final" || !parsed.fields) {
    return false;
  }
  const error = compactSingleLineText(parsed.fields.Error, 64);
  const compile = compactSingleLineText(parsed.fields.Compile, 10).toLowerCase();
  const action = compactSingleLineText(parsed.fields.Action, 10).toLowerCase();
  const outcome = compactSingleLineText(parsed.fields.Outcome, 64).toLowerCase();
  if (error) {
    return true;
  }
  if (compile === "fail" || action === "fail") {
    return true;
  }
  return /(failed|error|timeout|cancel)/i.test(outcome);
}

function isExecutablePlanMemoryLine(parsed) {
  if (!parsed || parsed.kind !== "Plan" || !parsed.fields) {
    return false;
  }
  const actions = compactSingleLineText(parsed.fields.Actions, 80).toLowerCase();
  if (!actions || actions === "chat" || actions.startsWith("chat;")) {
    return false;
  }
  return actions.includes("visuals(") || actions.includes("files(");
}

function buildCompactPinnedMemoryLine(parsed, type, maxChars) {
  if (!parsed || !parsed.fields) {
    return "";
  }
  const scope = compactSingleLineText(parsed.fields.Scope, 48);
  if (type === "failure" || parsed.kind === "Final") {
    const error = compactSingleLineText(parsed.fields.Error, 42);
    const outcome = compactSingleLineText(parsed.fields.Outcome, 52);
    const parts = ["PinnedFailure"];
    if (scope) {
      parts.push(`Scope=${scope}`);
    }
    if (error) {
      parts.push(`Error=${error}`);
    }
    if (outcome) {
      parts.push(`Outcome=${outcome}`);
    }
    if (!error && !outcome) {
      parts.push("Outcome=failed");
    }
    return truncateText(parts.join(" | "), maxChars);
  }
  if (type === "plan" || parsed.kind === "Plan") {
    const actions = compactSingleLineText(parsed.fields.Actions, 56);
    const goal = compactSingleLineText(parsed.fields.Goal, 40);
    const parts = ["PinnedPlan"];
    if (scope) {
      parts.push(`Scope=${scope}`);
    }
    if (actions) {
      parts.push(`Actions=${actions}`);
    } else if (goal) {
      parts.push(`Goal=${goal}`);
    }
    return truncateText(parts.join(" | "), maxChars);
  }
  return "";
}

function filterMemoryLinesByRelevance(lines, options) {
  const normalized = Array.isArray(lines)
    ? lines
        .filter((line) => typeof line === "string" && line.trim())
        .map((line) => line.trim())
    : [];
  if (normalized.length === 0) {
    return {
      lines: [],
      filtered: false,
      keptLines: 0,
      droppedLines: 0,
    };
  }

  const opts = options && typeof options === "object" ? options : {};
  const enabled = opts.enabled === true;
  if (!enabled) {
    return {
      lines: normalized,
      filtered: false,
      keptLines: normalized.length,
      droppedLines: 0,
    };
  }

  const focusCandidates = deriveMemoryFocusCandidates(
    opts.context,
    opts.userMessage
  );
  if (focusCandidates.length === 0) {
    return {
      lines: normalized,
      filtered: false,
      keptLines: normalized.length,
      droppedLines: 0,
    };
  }

  const matchedIndexes = new Set();
  for (let i = 0; i < normalized.length; i += 1) {
    if (isMemoryLineRelevantForFocus(normalized[i], focusCandidates)) {
      matchedIndexes.add(i);
    }
  }

  // No relevance hit: keep original lines to avoid accidental memory erasure.
  if (matchedIndexes.size === 0) {
    return {
      lines: normalized,
      filtered: false,
      keptLines: normalized.length,
      droppedLines: 0,
    };
  }

  const minKeepLines = normalizePositiveInteger(
    opts.minKeepLines,
    DEFAULT_MEMORY_SCOPE_FILTER_MIN_KEEP_LINES
  );
  const keepIndexes = new Set(matchedIndexes);
  const startTail = Math.max(0, normalized.length - minKeepLines);
  for (let i = startTail; i < normalized.length; i += 1) {
    keepIndexes.add(i);
  }

  const kept = [];
  for (let i = 0; i < normalized.length; i += 1) {
    if (keepIndexes.has(i)) {
      kept.push(normalized[i]);
    }
  }
  const droppedLines = Math.max(0, normalized.length - kept.length);
  return {
    lines: kept.length > 0 ? kept : normalized,
    filtered: droppedLines > 0,
    keptLines: kept.length > 0 ? kept.length : normalized.length,
    droppedLines: droppedLines > 0 ? droppedLines : 0,
  };
}

function deriveMemoryFocusCandidates(context, userMessage) {
  const summary = buildPromptContextSummary(context);
  const seeds = [];
  if (summary && typeof summary.selected_object_path === "string") {
    seeds.push(summary.selected_object_path);
  }
  if (summary && typeof summary.selected_object_name === "string") {
    seeds.push(summary.selected_object_name);
  }
  if (summary && typeof summary.scene_path === "string") {
    seeds.push(summary.scene_path);
  }
  const user = typeof userMessage === "string" ? userMessage : "";
  const pathLikeMatches = user.match(/Scene\/[A-Za-z0-9_./-]+/g);
  if (Array.isArray(pathLikeMatches)) {
    for (const item of pathLikeMatches) {
      seeds.push(item);
    }
  }

  const out = [];
  const seen = new Set();
  for (const raw of seeds) {
    const value = compactSingleLineText(raw, 120).toLowerCase();
    if (!value) {
      continue;
    }
    appendUnique(out, seen, value);
    if (value.includes("/")) {
      const parts = value.split("/").filter((part) => !!part);
      if (parts.length > 0) {
        appendUnique(out, seen, parts[parts.length - 1]);
      }
      if (parts.length > 1) {
        appendUnique(
          out,
          seen,
          `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
        );
      }
    }
  }
  return out.filter((item) => item.length >= 3);
}

function isMemoryLineRelevantForFocus(line, focusCandidates) {
  const parsed = parseMemoryLineFields(line);
  const haystacks = [];
  if (typeof line === "string") {
    haystacks.push(line.toLowerCase());
  }
  if (parsed && parsed.fields) {
    if (typeof parsed.fields.Scope === "string") {
      haystacks.push(parsed.fields.Scope.toLowerCase());
    }
    if (typeof parsed.fields.Actions === "string") {
      haystacks.push(parsed.fields.Actions.toLowerCase());
    }
    if (typeof parsed.fields.Reply === "string") {
      haystacks.push(parsed.fields.Reply.toLowerCase());
    }
  }
  if (haystacks.length === 0) {
    return false;
  }

  for (const candidate of focusCandidates) {
    for (const hay of haystacks) {
      if (!candidate || !hay) {
        continue;
      }
      if (hay.includes(candidate) || candidate.includes(hay)) {
        return true;
      }
    }
  }
  return false;
}

function appendUnique(out, seen, value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || seen.has(text)) {
    return;
  }
  seen.add(text);
  out.push(text);
}

function buildEmptyMemoryCapsuleDetails(mode) {
  return {
    text: "",
    source_lines: 0,
    raw_source_lines: 0,
    included_lines: 0,
    saved_lines: 0,
    compaction_ratio: 0,
    cold_summary_included: false,
    cold_summary_chars: 0,
    scope_filter_enabled: false,
    relevance_filtered: false,
    relevance_kept_lines: 0,
    relevance_dropped_lines: 0,
    noise_filter_enabled: false,
    noise_filtered: false,
    noise_kept_lines: 0,
    noise_dropped_lines: 0,
    signal_pin_enabled: false,
    signal_pinned_lines: 0,
    signal_pin_failure_lines: 0,
    signal_pin_plan_lines: 0,
    signal_pin_compact_enabled: false,
    signal_pin_compacted_lines: 0,
    signal_pin_added_chars: 0,
    capsule_mode:
      typeof mode === "string" && mode.trim() ? mode.trim() : DEFAULT_MEMORY_CAPSULE_MODE,
  };
}

function buildLegacyMemoryCapsuleDetails(lines) {
  const normalized = Array.isArray(lines)
    ? lines.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];
  if (normalized.length === 0) {
    return buildEmptyMemoryCapsuleDetails("legacy");
  }
  const text = normalized.map((line, index) => `${index + 1}. ${line}`).join("\n");
  return {
    text,
    source_lines: normalized.length,
    raw_source_lines: normalized.length,
    included_lines: normalized.length,
    saved_lines: 0,
    compaction_ratio: normalized.length > 0 ? 1 : 0,
    cold_summary_included: false,
    cold_summary_chars: 0,
    scope_filter_enabled: false,
    relevance_filtered: false,
    relevance_kept_lines: normalized.length,
    relevance_dropped_lines: 0,
    noise_filter_enabled: false,
    noise_filtered: false,
    noise_kept_lines: normalized.length,
    noise_dropped_lines: 0,
    signal_pin_enabled: false,
    signal_pinned_lines: 0,
    signal_pin_failure_lines: 0,
    signal_pin_plan_lines: 0,
    signal_pin_compact_enabled: false,
    signal_pin_compacted_lines: 0,
    signal_pin_added_chars: 0,
    capsule_mode: "legacy",
  };
}

function buildLayeredMemoryCapsuleDetails(lines, options) {
  const normalized = Array.isArray(lines)
    ? lines.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];
  if (normalized.length === 0) {
    return buildEmptyMemoryCapsuleDetails("layered");
  }
  const opts = options && typeof options === "object" ? options : {};
  const hotLines = normalizePositiveInteger(opts.hotLines, DEFAULT_MEMORY_HOT_LINES);
  const maxLines = normalizePositiveInteger(
    opts.maxLines,
    DEFAULT_MEMORY_CAPSULE_MAX_LINES
  );
  const coldSummaryMaxChars = normalizePositiveInteger(
    opts.coldSummaryMaxChars,
    DEFAULT_MEMORY_COLD_SUMMARY_MAX_CHARS
  );

  const sourceLines = normalized.length;
  const hot = normalized.slice(-hotLines);
  const cold = normalized.slice(0, Math.max(0, sourceLines - hot.length));
  const output = [];
  const coldSummary = buildColdMemorySummary(cold, coldSummaryMaxChars);
  const coldSummaryChars = coldSummary.length;
  if (coldSummary) {
    output.push(`ColdSummary=${coldSummary}`);
  }

  const allowedHot = Math.max(1, maxLines - output.length);
  const hotSlice = hot.slice(-allowedHot);
  output.push(...hotSlice);
  const trimmed = output.slice(-maxLines);
  const text = trimmed.map((line, index) => `${index + 1}. ${line}`).join("\n");
  const includedLines = trimmed.length;
  const savedLines = Math.max(0, sourceLines - includedLines);
  return {
    text,
    source_lines: sourceLines,
    raw_source_lines: sourceLines,
    included_lines: includedLines,
    saved_lines: savedLines,
    compaction_ratio: sourceLines > 0 ? includedLines / sourceLines : 0,
    cold_summary_included: !!coldSummary,
    cold_summary_chars: coldSummaryChars,
    scope_filter_enabled: false,
    relevance_filtered: false,
    relevance_kept_lines: sourceLines,
    relevance_dropped_lines: 0,
    noise_filter_enabled: false,
    noise_filtered: false,
    noise_kept_lines: sourceLines,
    noise_dropped_lines: 0,
    signal_pin_enabled: false,
    signal_pinned_lines: 0,
    signal_pin_failure_lines: 0,
    signal_pin_plan_lines: 0,
    signal_pin_compact_enabled: false,
    signal_pin_compacted_lines: 0,
    signal_pin_added_chars: 0,
    capsule_mode: "layered",
  };
}

function buildColdMemorySummary(lines, maxChars) {
  const normalized = Array.isArray(lines)
    ? lines.filter((line) => typeof line === "string" && line.trim()).map((line) => line.trim())
    : [];
  if (normalized.length === 0) {
    return "";
  }
  let planCount = 0;
  let finalCount = 0;
  let failureCount = 0;
  const scopeSet = new Set();
  const actionTags = new Set();
  let latestOutcome = "";
  let latestError = "";

  for (const line of normalized) {
    const parsed = parseMemoryLineFields(line);
    if (parsed.kind === "Plan") {
      planCount += 1;
      if (parsed.fields.Scope) {
        scopeSet.add(compactSingleLineText(parsed.fields.Scope, 36));
      }
      if (parsed.fields.Actions) {
        actionTags.add(compactSingleLineText(parsed.fields.Actions, 40));
      }
      continue;
    }
    if (parsed.kind === "Final") {
      finalCount += 1;
      const outcome = compactSingleLineText(parsed.fields.Outcome, 40);
      const compile = compactSingleLineText(parsed.fields.Compile, 10).toLowerCase();
      const action = compactSingleLineText(parsed.fields.Action, 10).toLowerCase();
      const error = compactSingleLineText(parsed.fields.Error, 32);
      if (outcome) {
        latestOutcome = outcome;
      }
      if (error) {
        latestError = error;
      }
      if (
        error ||
        compile === "fail" ||
        action === "fail" ||
        /(failed|error|timeout|cancel)/i.test(outcome)
      ) {
        failureCount += 1;
      }
    }
  }

  const parts = [];
  parts.push(`plans=${planCount}`);
  parts.push(`finals=${finalCount}`);
  if (failureCount > 0) {
    parts.push(`failures=${failureCount}`);
  }
  if (scopeSet.size > 0) {
    parts.push(`scope=${Array.from(scopeSet).slice(0, 2).join(",")}`);
  }
  if (actionTags.size > 0) {
    parts.push(`actions=${Array.from(actionTags).slice(0, 1).join(",")}`);
  }
  if (latestError) {
    parts.push(`last_error=${latestError}`);
  } else if (latestOutcome) {
    parts.push(`last_outcome=${latestOutcome}`);
  }
  return truncateText(parts.join("; "), maxChars);
}

function parseMemoryLineFields(line) {
  const text = typeof line === "string" ? line.trim() : "";
  if (!text) {
    return { kind: "", fields: {} };
  }
  const segments = text.split("|").map((item) => item.trim()).filter((item) => !!item);
  const kind = segments.length > 0 ? segments[0] : "";
  const fields = {};
  for (let i = 1; i < segments.length; i += 1) {
    const segment = segments[i];
    const idx = segment.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    if (!key || !value) {
      continue;
    }
    fields[key] = value;
  }
  return { kind, fields };
}

module.exports = {
  CodexAppServerPlanner,
};

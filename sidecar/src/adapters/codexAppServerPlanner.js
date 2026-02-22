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
   *  queryUnityComponents?: (arg: { targetPath: string }) => Promise<{ query_id?: string, target_path?: string, components?: Array<{ short_name: string, assembly_qualified_name: string }>, error_message?: string }>
   * }} input
   * @returns {Promise<{assistant_text: string, task_allocation: any}>}
   */
  async planTurn(input) {
    return this.withSessionRunner(input.threadId, input.signal, async (session) => {
      const assistantText = await this.runStageWithThreadRecovery(
        session,
        input.signal,
        () => {
          const memoryCapsule = this.shouldInjectBootstrapMemory(session)
            ? this.getConversationMemoryCapsule(session.key)
            : "";
          return this.runTextTurn(session.runner, {
            threadId: session.appThreadId,
            prompt: this.buildConversationPrompt(input.userMessage, input.context, {
              memoryCapsule,
            }),
            tools: buildReasoningTools(),
            signal: input.signal,
            onDelta: input.onDelta,
            onMessage: input.onMessage,
            onProgress: input.onProgress,
            queryUnityComponents: input.queryUnityComponents,
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

  getConversationMemoryCapsule(sessionKey) {
    if (!sessionKey) {
      return "";
    }
    const entry = this.persistedConversationMemory.get(sessionKey);
    if (!entry || !Array.isArray(entry.lines) || entry.lines.length === 0) {
      return "";
    }
    if (isStaleTimestamp(entry.updatedAt, this.persistedSessionTtlMs)) {
      this.persistedConversationMemory.delete(sessionKey);
      this.persistSessionThreadSnapshot();
      return "";
    }

    const normalized = entry.lines
      .filter((line) => typeof line === "string" && line.trim())
      .map((line) => line.trim());
    if (normalized.length === 0) {
      return "";
    }
    return normalized
      .slice(-DEFAULT_MEMORY_MAX_LINES)
      .map((line, index) => `${index + 1}. ${line}`)
      .join("\n");
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
          const queryResult = await raceWithAbort(
            queryUnityComponents({
              targetPath: toolCall.target_path,
            }),
            options.signal
          );
          queryResults.push({
            call_id: toolCall.call_id || "",
            target_path: toolCall.target_path || "",
            result: queryResult,
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
    /** @type {Array<{call_id: string, target_path: string}>} */
    const queryUnityComponentCalls = [];

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
      markProgress("text_turn.completed");
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

      const completedAllocation = extractTaskAllocationFromCompletion(completion);
      if (completedAllocation.found) {
        return normalizeTaskAllocation(completedAllocation.value);
      }

      const parsed = parseJsonObject(latestMessage);
      if (!Object.prototype.hasOwnProperty.call(parsed, "task_allocation")) {
        throw new Error("planner extraction missing task_allocation");
      }

      return normalizeTaskAllocation(parsed.task_allocation);
    } finally {
      stopKeepalive();
      unsubscribe();
    }
  }

  buildConversationPrompt(userMessage, context, options) {
    const safeMessage = typeof userMessage === "string" ? userMessage : "";
    const opts = options && typeof options === "object" ? options : {};
    const memoryCapsule =
      typeof opts.memoryCapsule === "string" ? opts.memoryCapsule.trim() : "";
    const contextSummary = buildPromptContextSummary(context);
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
      "If you need live components on a target object, call query_unity_components tool directly.",
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
    return prompt.join("\n");
  }

  buildAllocationExtractionPrompt(userMessage, context, assistantText) {
    const safeMessage = typeof userMessage === "string" ? userMessage : "";
    const contextSummary = buildPromptContextSummary(context);
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

function buildReasoningTools() {
  return [
    ...REASONING_TOOL_TYPES.map((type) => ({ type })),
    {
      type: UNITY_COMPONENT_QUERY_TOOL.type,
      name: UNITY_COMPONENT_QUERY_TOOL.name,
      description: UNITY_COMPONENT_QUERY_TOOL.description,
      strict: UNITY_COMPONENT_QUERY_TOOL.strict,
      parameters: UNITY_COMPONENT_QUERY_TOOL.parameters,
    },
  ];
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

function buildContinuationPromptAfterUnityComponentsQuery(
  originalPrompt,
  previousAssistantText,
  toolCalls,
  queryResults
) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const results = Array.isArray(queryResults) ? queryResults : [];
  const toolResultSummary = results.map((item) => {
    const result =
      item && item.result && typeof item.result === "object" ? item.result : {};
    const components = Array.isArray(result.components)
      ? result.components
          .filter((component) => component && typeof component === "object")
          .map((component) => ({
            short_name:
              typeof component.short_name === "string"
                ? component.short_name
                : "",
            assembly_qualified_name:
              typeof component.assembly_qualified_name === "string"
                ? component.assembly_qualified_name
                : "",
          }))
          .filter(
            (component) =>
              component.short_name && component.assembly_qualified_name
          )
          .slice(0, 80)
      : [];
    const errorMessage =
      typeof result.error_message === "string"
        ? result.error_message.trim()
        : "";
    return {
      call_id: item && typeof item.call_id === "string" ? item.call_id : "",
      target_path:
        item && typeof item.target_path === "string"
          ? item.target_path
          : "",
      components_count: components.length,
      components,
      error_message: errorMessage,
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

function createProgressReporter(onProgress) {
  let lastTickAt = 0;
  return (stage) => {
    if (typeof onProgress !== "function") {
      return;
    }
    const stageName = typeof stage === "string" ? stage : "";
    const isLifecycleStage =
      stageName.endsWith(".starting") ||
      stageName.endsWith(".started") ||
      stageName.endsWith(".completed");
    const now = Date.now();
    if (!isLifecycleStage && now - lastTickAt < 300) {
      return;
    }
    lastTickAt = now;
    try {
      onProgress({
        stage: stageName,
        timestamp: now,
      });
    } catch {
      // ignore callback exceptions
    }
  };
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

function buildPromptContextSummary(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    return {};
  }

  const summary = {};
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
    summary.selection_tree = summarizeSelectionTree(selectionTree);
  }

  return summary;
}

function summarizeSelectionTree(selectionTree) {
  const summary = {};
  if (
    selectionTree &&
    Number.isFinite(selectionTree.max_depth) &&
    selectionTree.max_depth > 0
  ) {
    summary.max_depth = Number(selectionTree.max_depth);
  }

  const paths = [];
  collectPathCandidates(selectionTree, paths, 0, { count: 0 }, 120);
  if (paths.length > 0) {
    summary.path_hints = paths.slice(0, 6);
  }

  return summary;
}

function collectPathCandidates(value, output, depth, budget, maxCount) {
  if (
    !value ||
    depth > 4 ||
    !budget ||
    budget.count > 300 ||
    output.length >= maxCount
  ) {
    return;
  }
  budget.count += 1;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (output.length >= maxCount) {
        return;
      }
      collectPathCandidates(item, output, depth + 1, budget, maxCount);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (output.length >= maxCount) {
      return;
    }
    if (
      typeof child === "string" &&
      child &&
      (/(path|object|target)/i.test(key) || child.includes("/"))
    ) {
      if (!output.includes(child)) {
        output.push(child);
      }
    }
    if (child && typeof child === "object") {
      collectPathCandidates(child, output, depth + 1, budget, maxCount);
    }
  }
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

module.exports = {
  CodexAppServerPlanner,
};

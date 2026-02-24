"use strict";

const path = require("path");
const { TurnStore } = require("./domain/turnStore");
const { TurnService } = require("./application/turnService");
const { createServer } = require("./infrastructure/serverFactory");
const { nowIso } = require("./adapters/clockAdapter");
const { FileStateSnapshotStore } = require("./infrastructure/fileStateSnapshotStore");
const { FileActionExecutor } = require("./adapters/fileActionExecutor");
const { AutoFixExecutor } = require("./adapters/autoFixExecutor");
const { CodexAppServerPlanner } = require("./adapters/codexAppServerPlanner");
const { FakeTimeoutPlanner } = require("./adapters/fakeTimeoutPlanner");
const { FakeUnityQueryPlanner } = require("./adapters/fakeUnityQueryPlanner");

function bootstrap(port) {
  const codexSoftTimeoutMs = parseEnvPositive(
    "CODEX_SOFT_TIMEOUT_MS",
    60000
  );
  const codexHardTimeoutMs = parseEnvPositive(
    "CODEX_HARD_TIMEOUT_MS",
    200000
  );
  const unityComponentQueryTimeoutMs = parseEnvPositive(
    "UNITY_COMPONENT_QUERY_TIMEOUT_MS",
    5000
  );
  const compileTimeoutMs = parseEnvPositive("COMPILE_TIMEOUT_MS", 120000);
  const cacheTtlMs = parseEnvPositive("REQUEST_CACHE_TTL_MS", 15 * 60 * 1000);
  const maintenanceIntervalMs = parseEnvPositive(
    "MAINTENANCE_INTERVAL_MS",
    10000
  );
  const maxAutoFixAttempts = parseEnvNonNegative("MAX_AUTO_FIX_ATTEMPTS", 1);
  const useCodexAppServer = parseEnvBoolean("USE_CODEX_APP_SERVER", true);
  const useFakeCodexTimeoutPlanner = parseEnvBoolean(
    "USE_FAKE_CODEX_TIMEOUT_PLANNER",
    false
  );
  const useFakeUnityQueryPlanner = parseEnvBoolean(
    "USE_FAKE_UNITY_QUERY_PLANNER",
    false
  );
  const enableTimeoutAbortCleanup = parseEnvBoolean(
    "ENABLE_TIMEOUT_ABORT_CLEANUP",
    true
  );
  const enableMcpAdapter = parseEnvBoolean("ENABLE_MCP_ADAPTER", false);
  const mcpMaxQueue = parseEnvNonNegative("MCP_MAX_QUEUE", 1);
  const mcpJobTtlMs = parseEnvPositive("MCP_JOB_TTL_MS", 24 * 60 * 60 * 1000);
  const mcpStreamMaxEvents = parseEnvPositive("MCP_STREAM_MAX_EVENTS", 500);
  const mcpStreamMaxSubscribers = parseEnvPositive(
    "MCP_STREAM_MAX_SUBSCRIBERS",
    32
  );
  const mcpStreamRecoveryJobsMax = parseEnvNonNegative(
    "MCP_STREAM_RECOVERY_JOBS_MAX",
    20
  );
  const codexExecutable = parseEnvString("CODEX_EXECUTABLE", "codex");
  const codexSessionIdleTtlMs = parseEnvPositive(
    "CODEX_SESSION_IDLE_TTL_MS",
    15 * 60 * 1000
  );
  const codexMaxSessionRunners = parseEnvPositive(
    "CODEX_MAX_SESSION_RUNNERS",
    4
  );
  const codexPersistedSessionTtlMs = parseEnvPositive(
    "CODEX_PERSISTED_SESSION_TTL_MS",
    7 * 24 * 60 * 60 * 1000
  );
  const codexMaxPersistedSessions = parseEnvPositive(
    "CODEX_MAX_PERSISTED_SESSIONS",
    64
  );
  const plannerPromptTemplate = parseEnvString(
    "PLANNER_PROMPT_TEMPLATE",
    "v2"
  );
  const plannerMemoryInjectionMode = parseEnvString(
    "PLANNER_MEMORY_INJECTION_MODE",
    "bootstrap_only"
  );
  const plannerMemoryCapsuleMode = parseEnvString(
    "PLANNER_MEMORY_CAPSULE_MODE",
    "layered"
  );
  const plannerMemoryHotLines = parseEnvPositive(
    "PLANNER_MEMORY_HOT_LINES",
    2
  );
  const plannerMemoryCapsuleMaxLines = parseEnvPositive(
    "PLANNER_MEMORY_CAPSULE_MAX_LINES",
    4
  );
  const plannerMemoryColdSummaryMaxChars = parseEnvPositive(
    "PLANNER_MEMORY_COLD_SUMMARY_MAX_CHARS",
    220
  );
  const plannerMemoryScopeFilterEnabled = parseEnvBoolean(
    "PLANNER_MEMORY_SCOPE_FILTER",
    true
  );
  const plannerMemoryScopeFilterMinKeepLines = parseEnvPositive(
    "PLANNER_MEMORY_SCOPE_FILTER_MIN_KEEP_LINES",
    2
  );
  const plannerMemoryNoiseFilterEnabled = parseEnvBoolean(
    "PLANNER_MEMORY_NOISE_FILTER",
    true
  );
  const plannerMemoryNoiseFilterMinKeepLines = parseEnvPositive(
    "PLANNER_MEMORY_NOISE_FILTER_MIN_KEEP_LINES",
    2
  );
  const plannerMemorySignalPinEnabled = parseEnvBoolean(
    "PLANNER_MEMORY_SIGNAL_PIN",
    true
  );
  const plannerMemorySignalPinMaxLines = parseEnvPositive(
    "PLANNER_MEMORY_SIGNAL_PIN_MAX_LINES",
    2
  );
  const plannerMemorySignalPinCompactEnabled = parseEnvBoolean(
    "PLANNER_MEMORY_SIGNAL_PIN_COMPACT",
    true
  );
  const plannerMemorySignalPinMaxChars = parseEnvPositive(
    "PLANNER_MEMORY_SIGNAL_PIN_MAX_CHARS",
    120
  );
  const plannerMemorySignalPinMaxAddedChars = parseEnvPositive(
    "PLANNER_MEMORY_SIGNAL_PIN_MAX_ADDED_CHARS",
    240
  );
  const plannerContextPathHintsMax = parseEnvNonNegative(
    "PLANNER_CONTEXT_PATH_HINTS_MAX",
    6
  );
  const plannerContextDepthLimit = parseEnvPositive(
    "PLANNER_CONTEXT_DEPTH_LIMIT",
    4
  );
  const plannerContextNodeVisitBudget = parseEnvPositive(
    "PLANNER_CONTEXT_NODE_VISIT_BUDGET",
    300
  );
  const fakeUnityQueryTargetPath = parseEnvString(
    "FAKE_UNITY_QUERY_TARGET_PATH",
    "Scene/Canvas/Image"
  );
  const fakeUnityQueryMode = parseEnvString(
    "FAKE_UNITY_QUERY_MODE",
    "chat_only"
  );
  const fakeUnityQueryKeepComponent = parseEnvString(
    "FAKE_UNITY_QUERY_KEEP_COMPONENT",
    "KeepComponent"
  );
  const fakeUnityQueryIgnoreComponents = parseEnvString(
    "FAKE_UNITY_QUERY_IGNORE_COMPONENTS",
    "Transform,RectTransform"
  )
    .split(",")
    .map((item) => item.trim())
    .filter((item) => !!item);
  const enableUnityComponentQueryTool = parseEnvBoolean(
    "ENABLE_UNITY_COMPONENT_QUERY_TOOL",
    true
  );

  const snapshotStore = new FileStateSnapshotStore({
    filePath: path.resolve(__dirname, "..", ".state", "sidecar-state.json"),
  });
  const codexSessionSnapshotStore = new FileStateSnapshotStore({
    filePath: path.resolve(__dirname, "..", ".state", "codex-session-map.json"),
  });
  const mcpJobSnapshotStore = new FileStateSnapshotStore({
    filePath: path.resolve(__dirname, "..", ".state", "mcp-job-state.json"),
  });

  const turnStore = new TurnStore({
    codexSoftTimeoutMs,
    codexHardTimeoutMs,
    compileTimeoutMs,
    cacheTtlMs,
    maintenanceIntervalMs,
    maxAutoFixAttempts,
    snapshotStore,
  });
  turnStore.startMaintenance();

  const fileActionExecutor = new FileActionExecutor({
    workspaceRoot: path.resolve(__dirname, "..", ".."),
    allowedWriteRoots: ["Assets/Scripts/AIGenerated/"],
    forbiddenWriteRoots: ["ProjectSettings/", "Packages/"],
    maxFileBytes: 102400,
  });

  const autoFixExecutor = new AutoFixExecutor({
    workspaceRoot: path.resolve(__dirname, "..", ".."),
    allowedWriteRoots: ["Assets/Scripts/AIGenerated/"],
    maxFileBytes: 102400,
  });

  const codexPlanner = useFakeCodexTimeoutPlanner
    ? new FakeTimeoutPlanner()
    : useFakeUnityQueryPlanner
      ? new FakeUnityQueryPlanner({
          targetPath: fakeUnityQueryTargetPath,
          mode: fakeUnityQueryMode,
          keepComponentShortName: fakeUnityQueryKeepComponent,
          ignoreComponents: fakeUnityQueryIgnoreComponents,
        })
    : useCodexAppServer
      ? new CodexAppServerPlanner({
          workspaceRoot: path.resolve(__dirname, "..", ".."),
          timeoutMs: Math.max(codexHardTimeoutMs, codexSoftTimeoutMs),
          executable: codexExecutable,
          sessionIdleTtlMs: codexSessionIdleTtlMs,
          maxSessionRunners: codexMaxSessionRunners,
          persistedSessionTtlMs: codexPersistedSessionTtlMs,
          maxPersistedSessions: codexMaxPersistedSessions,
          promptTemplate: plannerPromptTemplate,
          memoryInjectionMode: plannerMemoryInjectionMode,
          memoryCapsuleMode: plannerMemoryCapsuleMode,
          memoryHotLines: plannerMemoryHotLines,
          memoryCapsuleMaxLines: plannerMemoryCapsuleMaxLines,
          memoryColdSummaryMaxChars: plannerMemoryColdSummaryMaxChars,
          memoryScopeFilterEnabled: plannerMemoryScopeFilterEnabled,
          memoryScopeFilterMinKeepLines: plannerMemoryScopeFilterMinKeepLines,
          memoryNoiseFilterEnabled: plannerMemoryNoiseFilterEnabled,
          memoryNoiseFilterMinKeepLines: plannerMemoryNoiseFilterMinKeepLines,
          memorySignalPinEnabled: plannerMemorySignalPinEnabled,
          memorySignalPinMaxLines: plannerMemorySignalPinMaxLines,
          memorySignalPinCompactEnabled: plannerMemorySignalPinCompactEnabled,
          memorySignalPinMaxChars: plannerMemorySignalPinMaxChars,
          memorySignalPinMaxAddedChars: plannerMemorySignalPinMaxAddedChars,
          contextPathHintsMax: plannerContextPathHintsMax,
          contextDepthLimit: plannerContextDepthLimit,
          contextNodeVisitBudget: plannerContextNodeVisitBudget,
          enableUnityComponentQueryTool,
          snapshotStore: codexSessionSnapshotStore,
        })
      : null;

  const turnService = new TurnService({
    turnStore,
    nowIso,
    sessionCacheTtlMs: cacheTtlMs,
    unityComponentQueryTimeoutMs,
    enableMcpAdapter,
    mcpMaxQueue,
    mcpJobTtlMs,
    mcpStreamMaxEvents,
    mcpStreamMaxSubscribers,
    mcpStreamRecoveryJobsMax,
    mcpSnapshotStore: mcpJobSnapshotStore,
    enableTimeoutAbortCleanup,
    fileActionExecutor,
    codexPlanner,
    autoFixExecutor,
  });

  const server = createServer({
    port,
    turnService,
  });

  server.on("close", () => {
    turnStore.stopMaintenance();
    turnStore.persist();
    if (codexPlanner && typeof codexPlanner.close === "function") {
      codexPlanner.close().catch(() => {
        // ignore planner shutdown errors
      });
    }
  });

  return server;
}

function parseEnvPositive(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function parseEnvNonNegative(name, fallback) {
  const raw = process.env[name];
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return n;
}

function parseEnvBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const value = String(raw).trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes" || value === "on") {
    return true;
  }
  if (value === "0" || value === "false" || value === "no" || value === "off") {
    return false;
  }
  return fallback;
}

function parseEnvString(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return fallback;
  }
  const text = String(raw).trim();
  return text || fallback;
}

module.exports = {
  bootstrap,
};

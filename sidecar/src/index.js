"use strict";

const path = require("path");
const { TurnStore } = require("./domain/turnStore");
const { TurnService } = require("./application/turnService");
const { createServer } = require("./infrastructure/serverFactory");
const { nowIso } = require("./adapters/clockAdapter");
const { FileStateSnapshotStore } = require("./infrastructure/fileStateSnapshotStore");
const { FileActionExecutor } = require("./adapters/fileActionExecutor");
const {
  parseMcpLeaseStartupConfig,
  assertNoDeprecatedAutoCleanupSettings,
  assertNoRuntimeModeRollbackSettings,
} = require("./adapters/argAdapter");
const { LEGACY_ANCHOR_MIGRATION_CONTRACT } = require("./ports/contracts");

function bootstrap(port, options) {
  const opts = options && typeof options === "object" ? options : {};
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
  const enableTimeoutAbortCleanup = parseEnvBoolean(
    "ENABLE_TIMEOUT_ABORT_CLEANUP",
    true
  );
  const enableMcpAdapter = true;
  const enableMcpEyes = true;
  const unityQueryTimeoutMs = parseEnvPositive("UNITY_QUERY_TIMEOUT_MS", 60000);
  const unityQueryMaxTimeoutMs = parseEnvPositive(
    "UNITY_QUERY_MAX_TIMEOUT_MS",
    5 * 60 * 1000
  );
  const unityQueryTerminalRetentionMs = parseEnvPositive(
    "UNITY_QUERY_TERMINAL_RETENTION_MS",
    5 * 60 * 1000
  );
  const unityQueryMaxEntries = parseEnvPositive("UNITY_QUERY_MAX_ENTRIES", 2000);
  const unityQueryContractVersion = parseEnvString(
    "UNITY_QUERY_CONTRACT_VERSION",
    "unity.query.v2"
  );
  const readTokenHardMaxAgeMs = parseEnvPositive(
    "READ_TOKEN_HARD_MAX_AGE_MS",
    3 * 60 * 1000
  );
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
  const legacyAnchorModeEnvName =
    LEGACY_ANCHOR_MIGRATION_CONTRACT &&
    typeof LEGACY_ANCHOR_MIGRATION_CONTRACT.mode_env === "string"
      ? LEGACY_ANCHOR_MIGRATION_CONTRACT.mode_env
      : "LEGACY_ANCHOR_MODE";
  const legacyAnchorAllowedModes =
    LEGACY_ANCHOR_MIGRATION_CONTRACT &&
    Array.isArray(LEGACY_ANCHOR_MIGRATION_CONTRACT.allowed_modes)
      ? LEGACY_ANCHOR_MIGRATION_CONTRACT.allowed_modes
      : ["warn", "deny"];
  const legacyAnchorDefaultMode =
    LEGACY_ANCHOR_MIGRATION_CONTRACT &&
    typeof LEGACY_ANCHOR_MIGRATION_CONTRACT.default_mode === "string"
      ? LEGACY_ANCHOR_MIGRATION_CONTRACT.default_mode
      : "warn";
  const legacyAnchorDenySignoffEnvName =
    LEGACY_ANCHOR_MIGRATION_CONTRACT &&
    LEGACY_ANCHOR_MIGRATION_CONTRACT.deny_switch_gate &&
    typeof LEGACY_ANCHOR_MIGRATION_CONTRACT.deny_switch_gate.manual_signoff_env ===
      "string"
      ? LEGACY_ANCHOR_MIGRATION_CONTRACT.deny_switch_gate.manual_signoff_env
      : "LEGACY_ANCHOR_DENY_SIGNOFF";
  const legacyAnchorMode = parseEnvEnum(
    legacyAnchorModeEnvName,
    legacyAnchorDefaultMode,
    legacyAnchorAllowedModes
  );
  const legacyAnchorDenySignoff = parseEnvBoolean(
    legacyAnchorDenySignoffEnvName,
    false
  );
  assertNoDeprecatedAutoCleanupSettings(opts.argv, process.env);
  assertNoRuntimeModeRollbackSettings(opts.argv, process.env);
  const leaseConfig =
    opts.mcpLeaseConfig && typeof opts.mcpLeaseConfig === "object"
      ? opts.mcpLeaseConfig
      : parseMcpLeaseStartupConfig(process.env);
  const mcpLeaseHeartbeatTimeoutMs =
    Number.isFinite(Number(leaseConfig.mcpLeaseHeartbeatTimeoutMs)) &&
    Number(leaseConfig.mcpLeaseHeartbeatTimeoutMs) > 0
      ? Math.floor(Number(leaseConfig.mcpLeaseHeartbeatTimeoutMs))
      : 60 * 1000;
  const mcpLeaseMaxRuntimeMs =
    Number.isFinite(Number(leaseConfig.mcpLeaseMaxRuntimeMs)) &&
    Number(leaseConfig.mcpLeaseMaxRuntimeMs) > 0
      ? Math.floor(Number(leaseConfig.mcpLeaseMaxRuntimeMs))
      : 5 * 60 * 1000;
  const mcpRebootWaitTimeoutMs =
    Number.isFinite(Number(leaseConfig.mcpRebootWaitTimeoutMs)) &&
    Number(leaseConfig.mcpRebootWaitTimeoutMs) > 0
      ? Math.floor(Number(leaseConfig.mcpRebootWaitTimeoutMs))
      : 3 * 60 * 1000;
  const mcpLeaseJanitorIntervalMs =
    Number.isFinite(Number(leaseConfig.mcpLeaseJanitorIntervalMs)) &&
    Number(leaseConfig.mcpLeaseJanitorIntervalMs) > 0
      ? Math.floor(Number(leaseConfig.mcpLeaseJanitorIntervalMs))
      : 1000;

  const snapshotStore = new FileStateSnapshotStore({
    filePath: path.resolve(__dirname, "..", ".state", "sidecar-state.json"),
  });
  const mcpJobSnapshotStore = new FileStateSnapshotStore({
    filePath: path.resolve(__dirname, "..", ".state", "mcp-job-state.json"),
  });

  const turnStore = new TurnStore({
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

  const turnService = new TurnService({
    turnStore,
    nowIso,
    sessionCacheTtlMs: cacheTtlMs,
    unityComponentQueryTimeoutMs,
    enableMcpAdapter,
    enableMcpEyes,
    unityQueryTimeoutMs,
    unityQueryMaxTimeoutMs,
    unityQueryTerminalRetentionMs,
    unityQueryMaxEntries,
    unityQueryContractVersion,
    readTokenHardMaxAgeMs,
    mcpMaxQueue,
    mcpJobTtlMs,
    mcpStreamMaxEvents,
    mcpStreamMaxSubscribers,
    mcpStreamRecoveryJobsMax,
    mcpLeaseHeartbeatTimeoutMs,
    mcpLeaseMaxRuntimeMs,
    mcpRebootWaitTimeoutMs,
    mcpLeaseJanitorIntervalMs,
    legacyAnchorMode,
    legacyAnchorDenySignoff,
    mcpSnapshotStore: mcpJobSnapshotStore,
    enableTimeoutAbortCleanup,
    fileActionExecutor,
  });

  const server = createServer({
    port,
    turnService,
  });

  server.on("close", () => {
    turnStore.stopMaintenance();
    turnStore.persist();
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

function parseEnvEnum(name, fallback, allowedValues) {
  const fallbackValue =
    typeof fallback === "string" && fallback.trim() ? fallback.trim() : "";
  const allowed = new Set(
    Array.isArray(allowedValues)
      ? allowedValues
          .filter((value) => typeof value === "string" && value.trim())
          .map((value) => value.trim())
      : []
  );
  if (!allowed.has(fallbackValue) && allowed.size > 0) {
    return Array.from(allowed)[0];
  }
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") {
    return fallbackValue;
  }
  const normalized = String(raw).trim();
  if (allowed.size === 0 || allowed.has(normalized)) {
    return normalized;
  }
  return fallbackValue;
}

function parseEnvString(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null) {
    return fallback;
  }
  const normalized = String(raw).trim();
  return normalized || fallback;
}

module.exports = {
  bootstrap,
};

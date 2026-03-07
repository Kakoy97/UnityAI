"use strict";

const path = require("path");
const { TurnStore } = require("./domain/turnStore");
const { TurnService } = require("./application/turnService");
const {
  V1PolishMetricsCollector,
} = require("./application/v1PolishMetricsCollector");
const {
  DEFAULT_FUSE_FAILURE_THRESHOLD,
  DEFAULT_FUSE_COOLDOWN_MS,
} = require("./application/captureCompositeRuntime");
const { createServer } = require("./infrastructure/serverFactory");
const { nowIso } = require("./adapters/clockAdapter");
const { FileStateSnapshotStore } = require("./infrastructure/fileStateSnapshotStore");
const { FileActionExecutor } = require("./adapters/fileActionExecutor");
const {
  assertSsotArtifactsAvailable,
} = require("./application/ssotRuntime/startupArtifactsGuard");

function bootstrap(port, options) {
  const opts = options && typeof options === "object" ? options : {};
  assertSsotArtifactsAvailable();
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
  const tokenAutoIssueEnabled = parseEnvBoolean(
    "TOKEN_AUTO_ISSUE_ENABLED",
    true
  );
  const tokenAutoRetryShadowEnabled = parseEnvBoolean(
    "TOKEN_AUTO_RETRY_SHADOW_ENABLED",
    true
  );
  const tokenAutoRetryEnabled = parseEnvBoolean(
    "TOKEN_AUTO_RETRY_ENABLED",
    true
  );

  const snapshotStore = new FileStateSnapshotStore({
    filePath: path.resolve(__dirname, "..", ".state", "sidecar-state.json"),
  });
  const v1PolishMetricsSnapshotStore = new FileStateSnapshotStore({
    filePath: path.resolve(__dirname, "..", ".state", "v1-polish-metrics.json"),
  });
  const v1PolishMetricsEnabled = parseEnvBoolean(
    "V1_POLISH_METRICS_ENABLED",
    true
  );
  const v1PolishMetricsRetentionDays = parseEnvPositive(
    "V1_POLISH_METRICS_RETENTION_DAYS",
    7
  );
  const v1PolishMetricsTopN = parseEnvPositive("V1_POLISH_METRICS_TOP_N", 10);
  const captureCompositeEnabled = parseEnvBoolean(
    "CAPTURE_COMPOSITE_ENABLED",
    false
  );
  const captureCompositeFuseFailureThreshold = parseEnvPositive(
    "CAPTURE_COMPOSITE_FUSE_FAILURE_THRESHOLD",
    DEFAULT_FUSE_FAILURE_THRESHOLD
  );
  const captureCompositeFuseCooldownMs = parseEnvPositive(
    "CAPTURE_COMPOSITE_FUSE_COOLDOWN_MS",
    DEFAULT_FUSE_COOLDOWN_MS
  );
  const retryFuseEnabled = parseEnvBoolean("UX_RETRY_FUSE_ENABLED", true);
  const retryFuseWindowMs = parseEnvPositive("UX_RETRY_FUSE_WINDOW_MS", 30000);
  const retryFuseMaxAttempts = parseEnvPositive(
    "UX_RETRY_FUSE_MAX_ATTEMPTS",
    2
  );
  const v1PolishMetricsCollector = new V1PolishMetricsCollector({
    enabled: v1PolishMetricsEnabled,
    retentionDays: v1PolishMetricsRetentionDays,
    topN: v1PolishMetricsTopN,
    snapshotStore: v1PolishMetricsSnapshotStore,
    storagePath: path.relative(
      path.resolve(__dirname, ".."),
      path.resolve(__dirname, "..", ".state", "v1-polish-metrics.json")
    ),
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
    unityQueryTimeoutMs,
    unityQueryMaxTimeoutMs,
    unityQueryTerminalRetentionMs,
    unityQueryMaxEntries,
    unityQueryContractVersion,
    readTokenHardMaxAgeMs,
    tokenAutoIssueEnabled,
    tokenAutoRetryShadowEnabled,
    tokenAutoRetryEnabled,
    v1PolishMetricsCollector,
    captureCompositeEnabled,
    captureCompositeFuseFailureThreshold,
    captureCompositeFuseCooldownMs,
    retryFuseEnabled,
    retryFuseWindowMs,
    retryFuseMaxAttempts,
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

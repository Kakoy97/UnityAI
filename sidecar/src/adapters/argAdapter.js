"use strict";

const {
  JOB_LEASE_CONTRACT,
  RUNTIME_MODE_FREEZE_CONTRACT,
} = require("../ports/contracts");

function getArgValue(argv, name, fallback) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return fallback;
  }
  return argv[index + 1];
}

function parsePort(argv, fallbackPort) {
  const raw = getArgValue(argv, "--port", String(fallbackPort));
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }
  return port;
}

function findDeprecatedOccFlag(argv) {
  const flags = Array.isArray(argv) ? argv : [];
  const deprecated = new Set([
    "--enable-strict-read-token",
    "--mcp-submit-require-read-token",
  ]);
  for (const token of flags) {
    if (deprecated.has(token)) {
      return token;
    }
  }
  return "";
}

function assertNoDeprecatedOccFlags(argv) {
  const hit = findDeprecatedOccFlag(argv);
  if (!hit) {
    return;
  }
  throw new Error(
    `Deprecated OCC flag is not supported: ${hit}. Token guard is now always enforced.`
  );
}

function assertNoRuntimeModeRollbackSettings(argv, env) {
  const flags = Array.isArray(argv) ? argv : [];
  const source = env && typeof env === "object" ? env : process.env;
  const forbiddenFlags =
    RUNTIME_MODE_FREEZE_CONTRACT &&
    Array.isArray(RUNTIME_MODE_FREEZE_CONTRACT.forbidden_disable_switches)
      ? RUNTIME_MODE_FREEZE_CONTRACT.forbidden_disable_switches
      : [];
  for (const token of flags) {
    if (forbiddenFlags.includes(token)) {
      throw new Error(
        `Deprecated runtime mode switch is not supported: ${token}. Phase6 only supports gateway mode.`
      );
    }
  }

  const forbiddenEnvs =
    RUNTIME_MODE_FREEZE_CONTRACT &&
    Array.isArray(RUNTIME_MODE_FREEZE_CONTRACT.forbidden_disable_envs)
      ? RUNTIME_MODE_FREEZE_CONTRACT.forbidden_disable_envs
      : [];
  for (const key of forbiddenEnvs) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") {
      continue;
    }
    if (isFalsyToken(raw)) {
      throw new Error(
        `Deprecated runtime mode env is not supported: ${key}=${raw}. Phase6 only supports gateway mode.`
      );
    }
  }
}

function parseMcpLeaseStartupConfig(env) {
  const source = env && typeof env === "object" ? env : process.env;
  const defaults =
    JOB_LEASE_CONTRACT && JOB_LEASE_CONTRACT.defaults
      ? JOB_LEASE_CONTRACT.defaults
      : {};
  const minimums =
    JOB_LEASE_CONTRACT && JOB_LEASE_CONTRACT.minimums
      ? JOB_LEASE_CONTRACT.minimums
      : {};
  const names =
    JOB_LEASE_CONTRACT && JOB_LEASE_CONTRACT.startup_env
      ? JOB_LEASE_CONTRACT.startup_env
      : {};

  return {
    mcpLeaseHeartbeatTimeoutMs: parsePositiveWithMin(
      source[names.heartbeat_timeout_ms || "MCP_LEASE_HEARTBEAT_TIMEOUT_MS"],
      defaults.heartbeat_timeout_ms || 60000,
      minimums.heartbeat_timeout_ms || 1000
    ),
    mcpLeaseMaxRuntimeMs: parsePositiveWithMin(
      source[names.max_runtime_ms || "MCP_LEASE_MAX_RUNTIME_MS"],
      defaults.max_runtime_ms || 300000,
      minimums.max_runtime_ms || 1000
    ),
    mcpRebootWaitTimeoutMs: parsePositiveWithMin(
      source[names.reboot_wait_timeout_ms || "MCP_REBOOT_WAIT_TIMEOUT_MS"],
      defaults.reboot_wait_timeout_ms || 180000,
      minimums.reboot_wait_timeout_ms || 1000
    ),
    mcpLeaseJanitorIntervalMs: parsePositiveWithMin(
      source[names.janitor_interval_ms || "MCP_LEASE_JANITOR_INTERVAL_MS"],
      defaults.janitor_interval_ms || 1000,
      minimums.janitor_interval_ms || 250
    ),
  };
}

function assertNoDeprecatedAutoCleanupSettings(argv, env) {
  const flags = Array.isArray(argv) ? argv : [];
  const source = env && typeof env === "object" ? env : process.env;
  const forbiddenFlags =
    JOB_LEASE_CONTRACT &&
    Array.isArray(JOB_LEASE_CONTRACT.forbidden_disable_switches)
      ? JOB_LEASE_CONTRACT.forbidden_disable_switches
      : [];
  for (const token of flags) {
    if (forbiddenFlags.includes(token)) {
      throw new Error(
        `Deprecated auto-cleanup disable flag is not supported: ${token}. Job janitor is always enabled.`
      );
    }
  }

  const forbiddenEnvs =
    JOB_LEASE_CONTRACT &&
    Array.isArray(JOB_LEASE_CONTRACT.forbidden_disable_envs)
      ? JOB_LEASE_CONTRACT.forbidden_disable_envs
      : [];
  for (const key of forbiddenEnvs) {
    const raw = source[key];
    if (raw === undefined || raw === null || raw === "") {
      continue;
    }
    if (key.includes("DISABLE")) {
      if (isTruthyToken(raw)) {
        throw new Error(
          `Deprecated auto-cleanup disable env is not supported: ${key}. Job janitor is always enabled.`
        );
      }
      continue;
    }
    if (isFalsyToken(raw)) {
      throw new Error(
        `Deprecated auto-cleanup toggle env is not supported: ${key}. Job janitor is always enabled.`
      );
    }
  }

  const startupEnv =
    JOB_LEASE_CONTRACT && JOB_LEASE_CONTRACT.startup_env
      ? JOB_LEASE_CONTRACT.startup_env
      : {};
  const timeoutKeys = [
    startupEnv.heartbeat_timeout_ms || "MCP_LEASE_HEARTBEAT_TIMEOUT_MS",
    startupEnv.max_runtime_ms || "MCP_LEASE_MAX_RUNTIME_MS",
    startupEnv.reboot_wait_timeout_ms || "MCP_REBOOT_WAIT_TIMEOUT_MS",
    startupEnv.janitor_interval_ms || "MCP_LEASE_JANITOR_INTERVAL_MS",
  ];
  for (const key of timeoutKeys) {
    if (source[key] === undefined || source[key] === null || source[key] === "") {
      continue;
    }
    const n = Number(source[key]);
    if (Number.isFinite(n) && n <= 0) {
      throw new Error(
        `Invalid ${key}: ${source[key]}. Auto-cleanup timeouts/interval must be positive and cannot disable janitor.`
      );
    }
  }
}

function parsePositiveWithMin(rawValue, fallback, minValue) {
  const fallbackValue =
    Number.isFinite(Number(fallback)) && Number(fallback) > 0
      ? Math.floor(Number(fallback))
      : 1;
  const min =
    Number.isFinite(Number(minValue)) && Number(minValue) > 0
      ? Math.floor(Number(minValue))
      : 1;
  const n = Number(rawValue);
  if (!Number.isFinite(n) || n < min) {
    return fallbackValue >= min ? fallbackValue : min;
  }
  return Math.floor(n);
}

function isTruthyToken(raw) {
  const token = String(raw).trim().toLowerCase();
  return token === "1" || token === "true" || token === "yes" || token === "on";
}

function isFalsyToken(raw) {
  const token = String(raw).trim().toLowerCase();
  return token === "0" || token === "false" || token === "no" || token === "off";
}

module.exports = {
  parsePort,
  assertNoDeprecatedOccFlags,
  assertNoRuntimeModeRollbackSettings,
  parseMcpLeaseStartupConfig,
  assertNoDeprecatedAutoCleanupSettings,
};

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseMcpLeaseStartupConfig,
  assertNoDeprecatedAutoCleanupSettings,
} = require("../../src/adapters/argAdapter");

test("parseMcpLeaseStartupConfig uses Phase4 defaults when env missing", () => {
  const config = parseMcpLeaseStartupConfig({});
  assert.equal(config.mcpLeaseHeartbeatTimeoutMs, 60000);
  assert.equal(config.mcpLeaseMaxRuntimeMs, 300000);
  assert.equal(config.mcpRebootWaitTimeoutMs, 180000);
  assert.equal(config.mcpLeaseJanitorIntervalMs, 1000);
});

test("parseMcpLeaseStartupConfig clamps invalid/too-small values to safe defaults", () => {
  const config = parseMcpLeaseStartupConfig({
    MCP_LEASE_HEARTBEAT_TIMEOUT_MS: "200",
    MCP_LEASE_MAX_RUNTIME_MS: "-1",
    MCP_REBOOT_WAIT_TIMEOUT_MS: "abc",
    MCP_LEASE_JANITOR_INTERVAL_MS: "100",
  });
  assert.equal(config.mcpLeaseHeartbeatTimeoutMs, 60000);
  assert.equal(config.mcpLeaseMaxRuntimeMs, 300000);
  assert.equal(config.mcpRebootWaitTimeoutMs, 180000);
  assert.equal(config.mcpLeaseJanitorIntervalMs, 1000);
});

test("assertNoDeprecatedAutoCleanupSettings rejects disable flags and env toggles", () => {
  assert.throws(() => {
    assertNoDeprecatedAutoCleanupSettings(
      ["node", "index.js", "--disable-mcp-auto-cleanup"],
      {}
    );
  }, /auto-cleanup disable flag/i);

  assert.throws(() => {
    assertNoDeprecatedAutoCleanupSettings([], {
      MCP_DISABLE_AUTO_CLEANUP: "true",
    });
  }, /auto-cleanup disable env/i);

  assert.throws(() => {
    assertNoDeprecatedAutoCleanupSettings([], {
      MCP_LEASE_JANITOR_INTERVAL_MS: "0",
    });
  }, /cannot disable janitor/i);
});

test("assertNoDeprecatedAutoCleanupSettings allows valid timeout overrides", () => {
  assert.doesNotThrow(() => {
    assertNoDeprecatedAutoCleanupSettings([], {
      MCP_LEASE_HEARTBEAT_TIMEOUT_MS: "70000",
      MCP_LEASE_MAX_RUNTIME_MS: "350000",
      MCP_REBOOT_WAIT_TIMEOUT_MS: "200000",
      MCP_LEASE_JANITOR_INTERVAL_MS: "2000",
      MCP_AUTO_CLEANUP_ENABLED: "true",
    });
  });
});

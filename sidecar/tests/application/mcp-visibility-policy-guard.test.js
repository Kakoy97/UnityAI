"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { getMcpCommandRegistry } = require("../../src/mcp/commandRegistry");
const { UnityMcpServer } = require("../../src/mcp/mcpServer");
const {
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
  MCP_ENTRY_GOVERNANCE_CONTRACT,
  MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT,
  MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT,
} = require("../../src/ports/contracts");

function normalizeToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toToolSet(value) {
  const source = Array.isArray(value) ? value : [];
  return new Set(source.map((item) => normalizeToolName(item)).filter((item) => !!item));
}

function createServerWithRegistry(registry) {
  const server = Object.create(UnityMcpServer.prototype);
  server.commandRegistry = registry;
  return server;
}

function resolvePlannerOnlyExpectedVisibleToolNames({
  activeToolNameSet,
  exposedToolNameSet,
  localStaticToolNameSet,
  disabledToolNameSet,
  deprecatedToolNameSet,
  removedToolNameSet,
  plannerPrimaryToolName,
  plannerAliasToolName,
  entryGovernanceEnabled,
}) {
  const expected = new Set();
  for (const toolName of activeToolNameSet.values()) {
    if (!exposedToolNameSet.has(toolName)) {
      continue;
    }
    if (
      disabledToolNameSet.has(toolName) ||
      deprecatedToolNameSet.has(toolName) ||
      removedToolNameSet.has(toolName)
    ) {
      continue;
    }
    const isPlannerEntry =
      toolName === plannerPrimaryToolName || toolName === plannerAliasToolName;
    if (isPlannerEntry) {
      if (entryGovernanceEnabled && toolName === plannerAliasToolName) {
        continue;
      }
      expected.add(toolName);
      continue;
    }
    if (localStaticToolNameSet.has(toolName)) {
      expected.add(toolName);
    }
  }
  return expected;
}

function createMockVisibilityContract(input) {
  const source = input && typeof input === "object" ? input : {};
  const freezeArray = (items) =>
    Object.freeze(
      (Array.isArray(items) ? items : [])
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    );
  return Object.freeze({
    visibility_formula: "visible = exposed & active - disabled",
    registry_snapshot_source: "McpCommandRegistry.listMcpToolNames()",
    active_tool_names: freezeArray(source.active_tool_names),
    deprecated_tool_names: freezeArray(source.deprecated_tool_names),
    removed_tool_names: freezeArray(source.removed_tool_names),
    exposed_tool_names: freezeArray(source.exposed_tool_names),
    local_static_tool_names: freezeArray(source.local_static_tool_names),
    disabled_tools: freezeArray(source.disabled_tools),
    disabled_tool_notes: Object.freeze({}),
  });
}

function createMockPlannerVisibilityProfileContract(input) {
  const source = input && typeof input === "object" ? input : {};
  const freezeArray = (items) =>
    Object.freeze(
      (Array.isArray(items) ? items : [])
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    );
  const normalizeMetric = (value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : null;
  };
  const enableGateMetrics =
    source.enable_gate && typeof source.enable_gate === "object"
      ? source.enable_gate.metrics
      : {};
  const rollbackMetrics =
    source.rollback_trigger && typeof source.rollback_trigger === "object"
      ? source.rollback_trigger.metrics
      : {};
  return Object.freeze({
    profile_formula:
      "tools/list visible = exposed & active - disabled - managed_when_planner_first",
    supported_profiles: Object.freeze(["legacy_full", "planner_first"]),
    requested_profile:
      normalizeToolName(source.requested_profile) || "planner_first",
    covered_family_keys: freezeArray(source.covered_family_keys),
    managed_tool_names: freezeArray(source.managed_tool_names),
    enable_gate: Object.freeze({
      covered_family_ratio_min: 0.8,
      planner_path_failure_rate_max: 0.01,
      planner_path_p95_regression_max: 0.1,
      metrics: Object.freeze({
        covered_family_ratio: normalizeMetric(enableGateMetrics.covered_family_ratio),
        planner_path_failure_rate: normalizeMetric(
          enableGateMetrics.planner_path_failure_rate
        ),
        planner_path_p95_regression: normalizeMetric(
          enableGateMetrics.planner_path_p95_regression
        ),
      }),
    }),
    rollback_trigger: Object.freeze({
      planner_path_failure_rate_1h_max: 0.02,
      planner_path_p95_regression_1h_max: 0.2,
      metrics: Object.freeze({
        planner_path_failure_rate_1h: normalizeMetric(
          rollbackMetrics.planner_path_failure_rate_1h
        ),
        planner_path_p95_regression_1h: normalizeMetric(
          rollbackMetrics.planner_path_p95_regression_1h
        ),
      }),
    }),
  });
}

function createMockPlannerDirectCompatibilityContract(input) {
  const source = input && typeof input === "object" ? input : {};
  const freezeArray = (items) =>
    Object.freeze(
      (Array.isArray(items) ? items : [])
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    );
  const normalizeMetric = (value) => {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : null;
  };
  const denyGateMetrics =
    source.deny_gate && typeof source.deny_gate === "object"
      ? source.deny_gate.metrics
      : {};
  const rollbackMetrics =
    source.rollback_trigger && typeof source.rollback_trigger === "object"
      ? source.rollback_trigger.metrics
      : {};
  return Object.freeze({
    policy_formula:
      "direct mode for managed tools = allow|warn|deny; deny gated by Step D thresholds with rollback-to-warn",
    supported_modes: Object.freeze(["allow", "warn", "deny"]),
    requested_mode: normalizeToolName(source.requested_mode) || "allow",
    managed_tool_names: freezeArray(source.managed_tool_names),
    managed_tool_family_map:
      source.managed_tool_family_map && typeof source.managed_tool_family_map === "object"
        ? Object.freeze({ ...source.managed_tool_family_map })
        : Object.freeze({}),
    deny_gate: Object.freeze({
      direct_warn_soak_days_min: 7,
      planner_success_rate_min: 0.99,
      direct_share_for_deny_max: 0.1,
      metrics: Object.freeze({
        direct_warn_soak_days: normalizeMetric(denyGateMetrics.direct_warn_soak_days),
        planner_success_rate_for_deny: normalizeMetric(
          denyGateMetrics.planner_success_rate_for_deny
        ),
        direct_share_for_deny: normalizeMetric(denyGateMetrics.direct_share_for_deny),
      }),
    }),
    rollback_trigger: Object.freeze({
      deny_incident_guard_max: 0,
      deny_failure_guard_24h_max: 0.015,
      metrics: Object.freeze({
        deny_incident_count_24h: normalizeMetric(rollbackMetrics.deny_incident_count_24h),
        deny_failure_rate_24h: normalizeMetric(rollbackMetrics.deny_failure_rate_24h),
      }),
    }),
  });
}

function createMockEntryGovernanceContract(input) {
  const source = input && typeof input === "object" ? input : {};
  const mode = normalizeToolName(source.mode).toLowerCase();
  const normalizedMode =
    mode === "legacy" || mode === "observe" || mode === "reject"
      ? mode
      : "legacy";
  return Object.freeze({
    policy_formula:
      "single-state-machine for external MCP entry governance: legacy|observe|reject",
    supported_modes: Object.freeze(["legacy", "observe", "reject"]),
    enabled: source.enabled === true,
    mode: normalizedMode,
    observe_shadow: source.observe_shadow === true,
    planner_primary_tool_name:
      normalizeToolName(source.planner_primary_tool_name) || "planner_execute_mcp",
    planner_alias_tool_name:
      normalizeToolName(source.planner_alias_tool_name) || "",
  });
}

async function withMockedVisibilityContract(mockedContract, run, options = {}) {
  const contractsPath = require.resolve("../../src/ports/contracts");
  const mcpServerPath = require.resolve("../../src/mcp/mcpServer");
  // Ensure module cache entries are materialized before swapping exports.
  require(contractsPath);

  const originalContractsExports = require.cache[contractsPath].exports;
  const mockedProfileContract =
    options && typeof options === "object"
      ? options.mockedPlannerProfileContract
      : null;
  const mockedDirectCompatibilityContract =
    options && typeof options === "object"
      ? options.mockedPlannerDirectCompatibilityContract
      : null;
  const mockedEntryGovernanceContract =
    options && typeof options === "object"
      ? options.mockedEntryGovernanceContract
      : null;
  require.cache[contractsPath].exports = {
    ...originalContractsExports,
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT: mockedContract,
    ...(mockedProfileContract
      ? { MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT: mockedProfileContract }
      : {}),
    ...(mockedDirectCompatibilityContract
      ? {
          MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT:
            mockedDirectCompatibilityContract,
        }
      : {}),
    ...(mockedEntryGovernanceContract
      ? {
          MCP_ENTRY_GOVERNANCE_CONTRACT: mockedEntryGovernanceContract,
        }
      : {}),
  };
  delete require.cache[mcpServerPath];

  try {
    const { UnityMcpServer: MockedUnityMcpServer } = require(mcpServerPath);
    await run(MockedUnityMcpServer);
  } finally {
    delete require.cache[mcpServerPath];
    require.cache[contractsPath].exports = originalContractsExports;
  }
}

test("visibility contract is artifact-driven and no longer exposes legacy allowlist fields", () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
      "security_allowlist"
    ),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
      "allowlist_source"
    ),
    false
  );
  assert.equal(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.active_tool_names),
    true
  );
  assert.equal(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.deprecated_tool_names),
    true
  );
  assert.equal(
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.removed_tool_names),
    true
  );
  assert.equal(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.active_tool_names.length > 0,
    true
  );
  assert.equal(
    String(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.visibility_policy_path || "").endsWith(
      "visibility-policy.generated.json"
    ),
    true
  );
  assert.equal(
    Array.isArray(MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT.managed_tool_names),
    true
  );
  assert.equal(
    Array.isArray(MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT.covered_family_keys),
    true
  );
  const rawRequestedProfile = normalizeToolName(process.env.MCP_VISIBILITY_PROFILE);
  const expectedRequestedProfile =
    rawRequestedProfile === "legacy_full" || rawRequestedProfile === "planner_first"
      ? rawRequestedProfile
      : "planner_first";
  assert.equal(
    MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT.requested_profile,
    expectedRequestedProfile
  );
  assert.equal(
    Array.isArray(MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT.managed_tool_names),
    true
  );
  const rawRequestedDirectMode = normalizeToolName(process.env.MCP_PLANNER_DIRECT_MODE);
  const expectedRequestedDirectMode =
    rawRequestedDirectMode === "allow" ||
    rawRequestedDirectMode === "warn" ||
    rawRequestedDirectMode === "deny"
      ? rawRequestedDirectMode
      : "allow";
  assert.equal(
    MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT.requested_mode,
    expectedRequestedDirectMode
  );
  assert.equal(
    MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT.data_source.evaluation_mode,
    "env_snapshot_static"
  );
  assert.equal(
    MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT.data_source.metric_env_keys
      .planner_success_rate_for_deny,
    "MCP_PLANNER_SUCCESS_RATE_FOR_DENY_7D"
  );
  const rawEntryMode = normalizeToolName(process.env.MCP_ENTRY_MODE).toLowerCase();
  const expectedEntryMode =
    rawEntryMode === "legacy" || rawEntryMode === "observe" || rawEntryMode === "reject"
      ? rawEntryMode
      : "reject";
  assert.equal(
    MCP_ENTRY_GOVERNANCE_CONTRACT.mode,
    expectedEntryMode
  );
  assert.equal(
    typeof MCP_ENTRY_GOVERNANCE_CONTRACT.enabled,
    "boolean"
  );
  assert.equal(
    MCP_ENTRY_GOVERNANCE_CONTRACT.planner_primary_tool_name,
    "planner_execute_mcp"
  );
  assert.equal(
    MCP_ENTRY_GOVERNANCE_CONTRACT.planner_alias_tool_name,
    ""
  );
});

test("tools/list visibility is synchronized with active/deprecated/removed/disabled policy sets", async () => {
  const registry = getMcpCommandRegistry();
  const server = createServerWithRegistry(registry);
  const tools = await server.getToolDefinitions();
  const listedToolNameSet = new Set(
    tools.map((item) => normalizeToolName(item && item.name)).filter((item) => !!item)
  );

  const activeToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.active_tool_names
  );
  const deprecatedToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.deprecated_tool_names
  );
  const removedToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.removed_tool_names
  );
  const disabledToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools
  );
  const exposedToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.exposed_tool_names
  );
  const localStaticToolNameSet = toToolSet(
    MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.local_static_tool_names
  );
  const plannerPrimaryToolName =
    normalizeToolName(MCP_ENTRY_GOVERNANCE_CONTRACT.planner_primary_tool_name) ||
    "planner_execute_mcp";
  const plannerAliasToolName =
    normalizeToolName(MCP_ENTRY_GOVERNANCE_CONTRACT.planner_alias_tool_name) ||
    "";
  const expectedVisibleToolNameSet = resolvePlannerOnlyExpectedVisibleToolNames({
    activeToolNameSet,
    exposedToolNameSet,
    localStaticToolNameSet,
    disabledToolNameSet,
    deprecatedToolNameSet,
    removedToolNameSet,
    plannerPrimaryToolName,
    plannerAliasToolName,
    entryGovernanceEnabled: MCP_ENTRY_GOVERNANCE_CONTRACT.enabled === true,
  });

  for (const listedName of listedToolNameSet) {
    assert.equal(
      activeToolNameSet.has(listedName),
      true,
      `listed tool should be active: ${listedName}`
    );
    assert.equal(
      deprecatedToolNameSet.has(listedName),
      false,
      `listed tool should not be deprecated: ${listedName}`
    );
    assert.equal(
      removedToolNameSet.has(listedName),
      false,
      `listed tool should not be removed: ${listedName}`
    );
    assert.equal(
      disabledToolNameSet.has(listedName),
      false,
      `listed tool should not be disabled: ${listedName}`
    );
  }

  assert.deepEqual(
    Array.from(listedToolNameSet).sort(),
    Array.from(expectedVisibleToolNameSet).sort(),
    "tools/list should be frozen to planner entry + control/support-plane"
  );
});

test("deprecated/removed tools are hidden from tools/list and blocked by tools/call", async () => {
  const registry = getMcpCommandRegistry();
  const server = createServerWithRegistry(registry);
  const tools = await server.getToolDefinitions();
  const listedToolNameSet = new Set(
    tools.map((item) => normalizeToolName(item && item.name)).filter((item) => !!item)
  );

  const blockedNames = Array.from(
    new Set([
      ...toToolSet(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.deprecated_tool_names),
      ...toToolSet(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.removed_tool_names),
    ])
  );
  assert.equal(blockedNames.length > 0, true, "blocked tool set should not be empty");

  for (const blockedName of blockedNames) {
    assert.equal(
      listedToolNameSet.has(blockedName),
      false,
      `blocked tool leaked into tools/list: ${blockedName}`
    );
    await assert.rejects(
      async () =>
        server.callTool({
          name: blockedName,
          arguments: {},
        }),
      new RegExp(`Tool removed in phase6: ${blockedName}`)
    );
  }
});

test("disabled tools are filtered from tools/list and rejected by tools/call", async () => {
  const mockedContract = createMockVisibilityContract({
    active_tool_names: ["alpha_tool", "beta_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["alpha_tool", "beta_tool", "gamma_tool"],
    local_static_tool_names: [],
    disabled_tools: ["beta_tool"],
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: false,
    mode: "legacy",
  });

  await withMockedVisibilityContract(
    mockedContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["alpha_tool", "beta_tool", "gamma_tool"];
        },
        getToolsListCache() {
          return [
            { name: "alpha_tool", description: "a", inputSchema: {} },
            { name: "beta_tool", description: "b", inputSchema: {} },
            { name: "gamma_tool", description: "g", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };

      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      const tools = await server.getToolDefinitions();
      const listedNames = tools.map((item) => String(item && item.name || "").trim());
      assert.deepEqual(listedNames, []);

      await assert.rejects(
        async () =>
          server.callTool({
            name: "beta_tool",
            arguments: {},
          }),
        /Tool not enabled by visibility policy: beta_tool/
      );
      await assert.rejects(
        async () =>
          server.callTool({
            name: "gamma_tool",
            arguments: {},
          }),
        /Tool not enabled by visibility policy: gamma_tool/
      );

      const allowed = await server.callTool({
        name: "alpha_tool",
        arguments: {},
      });
      assert.deepEqual(allowed, { ok: true, dispatched_tool: "alpha_tool" });
      assert.deepEqual(calls, ["alpha_tool"]);
    },
    {
      mockedEntryGovernanceContract,
    }
  );
});

test("Step C planner_first hides managed tool set from tools/list but keeps direct call path for uncovered tools", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    local_static_tool_names: [],
    disabled_tools: [],
  });
  const mockedPlannerProfileContract = createMockPlannerVisibilityProfileContract({
    requested_profile: "planner_first",
    covered_family_keys: ["mutate.set_active"],
    managed_tool_names: ["planner_managed_tool"],
    enable_gate: {
      metrics: {
        covered_family_ratio: 0.95,
        planner_path_failure_rate: 0.002,
        planner_path_p95_regression: 0.05,
      },
    },
    rollback_trigger: {
      metrics: {
        planner_path_failure_rate_1h: 0.005,
        planner_path_p95_regression_1h: 0.03,
      },
    },
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: false,
    mode: "legacy",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_managed_tool", "uncovered_direct_tool"];
        },
        getToolsListCache() {
          return [
            { name: "planner_managed_tool", description: "m", inputSchema: {} },
            { name: "uncovered_direct_tool", description: "u", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };

      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;
      const state = server.getVisibilityProfileState();
      assert.equal(state.active_profile, "planner_first");

      const tools = await server.getToolDefinitions();
      const listedNames = tools.map((item) => String(item && item.name || "").trim());
      assert.deepEqual(listedNames, []);

      const directManaged = await server.callTool({
        name: "planner_managed_tool",
        arguments: {},
      });
      const directUncovered = await server.callTool({
        name: "uncovered_direct_tool",
        arguments: {},
      });
      assert.deepEqual(directManaged, { ok: true, dispatched_tool: "planner_managed_tool" });
      assert.deepEqual(directUncovered, {
        ok: true,
        dispatched_tool: "uncovered_direct_tool",
      });
      assert.deepEqual(calls, ["planner_managed_tool", "uncovered_direct_tool"]);
    },
    {
      mockedPlannerProfileContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("Step C planner_first request falls back to legacy_full when enable gate is not satisfied", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    local_static_tool_names: [],
    disabled_tools: [],
  });
  const mockedPlannerProfileContract = createMockPlannerVisibilityProfileContract({
    requested_profile: "planner_first",
    managed_tool_names: ["planner_managed_tool"],
    enable_gate: {
      metrics: {
        covered_family_ratio: 0.6,
        planner_path_failure_rate: 0.002,
        planner_path_p95_regression: 0.05,
      },
    },
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_managed_tool", "uncovered_direct_tool"];
        },
        getToolsListCache() {
          return [
            { name: "planner_managed_tool", description: "m", inputSchema: {} },
            { name: "uncovered_direct_tool", description: "u", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          return { ok: true, dispatched_tool: params && params.name };
        },
      };

      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;
      const state = server.getVisibilityProfileState();
      assert.equal(state.active_profile, "legacy_full");
      assert.equal(state.reason, "enable_gate_not_satisfied");

      const tools = await server.getToolDefinitions();
      const listedNames = tools.map((item) => String(item && item.name || "").trim());
      assert.deepEqual(listedNames, []);
    },
    {
      mockedPlannerProfileContract,
    }
  );
});

test("Step C planner_first falls back to legacy_full when rollback trigger is exceeded", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    local_static_tool_names: [],
    disabled_tools: [],
  });
  const mockedPlannerProfileContract = createMockPlannerVisibilityProfileContract({
    requested_profile: "planner_first",
    managed_tool_names: ["planner_managed_tool"],
    enable_gate: {
      metrics: {
        covered_family_ratio: 0.92,
        planner_path_failure_rate: 0.004,
        planner_path_p95_regression: 0.08,
      },
    },
    rollback_trigger: {
      metrics: {
        planner_path_failure_rate_1h: 0.03,
        planner_path_p95_regression_1h: 0.08,
      },
    },
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_managed_tool", "uncovered_direct_tool"];
        },
        getToolsListCache() {
          return [
            { name: "planner_managed_tool", description: "m", inputSchema: {} },
            { name: "uncovered_direct_tool", description: "u", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;
      const state = server.getVisibilityProfileState();
      assert.equal(state.active_profile, "legacy_full");
      assert.equal(state.reason, "rollback_triggered");
    },
    {
      mockedPlannerProfileContract,
    }
  );
});

test("Step D warn mode keeps direct call available for managed tools and records warnings", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    local_static_tool_names: [],
    disabled_tools: [],
  });
  const mockedPlannerProfileContract = createMockPlannerVisibilityProfileContract({
    requested_profile: "planner_first",
    managed_tool_names: ["planner_managed_tool"],
    enable_gate: {
      metrics: {
        covered_family_ratio: 0.95,
        planner_path_failure_rate: 0.002,
        planner_path_p95_regression: 0.05,
      },
    },
  });
  const mockedDirectCompatibilityContract =
    createMockPlannerDirectCompatibilityContract({
      requested_mode: "warn",
      managed_tool_names: ["planner_managed_tool"],
      managed_tool_family_map: {
        planner_managed_tool: "mutate.component_properties",
      },
    });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: false,
    mode: "legacy",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_managed_tool", "uncovered_direct_tool"];
        },
        getToolsListCache() {
          return [
            { name: "planner_managed_tool", description: "m", inputSchema: {} },
            { name: "uncovered_direct_tool", description: "u", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      const managed = await server.callTool({
        name: "planner_managed_tool",
        arguments: {},
      });
      const uncovered = await server.callTool({
        name: "uncovered_direct_tool",
        arguments: {},
      });
      assert.deepEqual(managed.ok, true);
      assert.deepEqual(managed.dispatched_tool, "planner_managed_tool");
      assert.equal(
        managed &&
          managed.planner_direct_compatibility &&
          managed.planner_direct_compatibility.mode,
        "warn"
      );
      assert.equal(
        managed.planner_direct_compatibility.suggested_action,
        "planner_execute_mcp"
      );
      assert.deepEqual(uncovered, { ok: true, dispatched_tool: "uncovered_direct_tool" });
      assert.deepEqual(calls, ["planner_managed_tool", "uncovered_direct_tool"]);

      const directState = server.getDirectCompatibilityState();
      assert.equal(directState.active_mode, "warn");
      assert.equal(directState.counters.warn_total >= 1, true);
      assert.equal(directState.counters.allow_total >= 1, true);
    },
    {
      mockedPlannerProfileContract,
      mockedPlannerDirectCompatibilityContract: mockedDirectCompatibilityContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("Step D deny mode blocks managed direct calls when deny gate is satisfied", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_managed_tool", "uncovered_direct_tool"],
    local_static_tool_names: [],
    disabled_tools: [],
  });
  const mockedDirectCompatibilityContract =
    createMockPlannerDirectCompatibilityContract({
      requested_mode: "deny",
      managed_tool_names: ["planner_managed_tool"],
      managed_tool_family_map: {
        planner_managed_tool: "mutate.component_properties",
      },
      deny_gate: {
        metrics: {
          direct_warn_soak_days: 9,
          planner_success_rate_for_deny: 0.995,
          direct_share_for_deny: 0.05,
        },
      },
      rollback_trigger: {
        metrics: {
          deny_incident_count_24h: 0,
          deny_failure_rate_24h: 0.01,
        },
      },
    });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: false,
    mode: "legacy",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_managed_tool", "uncovered_direct_tool"];
        },
        getToolsListCache() {
          return [
            { name: "planner_managed_tool", description: "m", inputSchema: {} },
            { name: "uncovered_direct_tool", description: "u", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;
      const directState = server.getDirectCompatibilityState();
      assert.equal(directState.active_mode, "deny");
      assert.equal(directState.reason, "deny_enabled");

      await assert.rejects(
        async () =>
          server.callTool({
            name: "planner_managed_tool",
            arguments: {},
          }),
        /Tool blocked by planner direct compatibility policy: planner_managed_tool/
      );
      const uncovered = await server.callTool({
        name: "uncovered_direct_tool",
        arguments: {},
      });
      assert.deepEqual(uncovered, { ok: true, dispatched_tool: "uncovered_direct_tool" });
      assert.deepEqual(calls, ["uncovered_direct_tool"]);
      const counters = server.getDirectCompatibilityState().counters;
      assert.equal(counters.deny_total >= 1, true);
    },
    {
      mockedPlannerDirectCompatibilityContract: mockedDirectCompatibilityContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("Step D requested deny falls back to warn when gate or rollback trigger does not satisfy", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_managed_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_managed_tool"],
    local_static_tool_names: [],
    disabled_tools: [],
  });

  const gateNotSatisfiedContract = createMockPlannerDirectCompatibilityContract({
    requested_mode: "deny",
    managed_tool_names: ["planner_managed_tool"],
    managed_tool_family_map: {
      planner_managed_tool: "mutate.component_properties",
    },
    deny_gate: {
      metrics: {
        direct_warn_soak_days: 3,
        planner_success_rate_for_deny: 0.97,
        direct_share_for_deny: 0.25,
      },
    },
  });

  const rollbackTriggeredContract = createMockPlannerDirectCompatibilityContract({
    requested_mode: "deny",
    managed_tool_names: ["planner_managed_tool"],
    managed_tool_family_map: {
      planner_managed_tool: "mutate.component_properties",
    },
    deny_gate: {
      metrics: {
        direct_warn_soak_days: 8,
        planner_success_rate_for_deny: 0.995,
        direct_share_for_deny: 0.05,
      },
    },
    rollback_trigger: {
      metrics: {
        deny_incident_count_24h: 1,
        deny_failure_rate_24h: 0.01,
      },
    },
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: false,
    mode: "legacy",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_managed_tool"];
        },
        getToolsListCache() {
          return [{ name: "planner_managed_tool", description: "m", inputSchema: {} }];
        },
        async dispatchMcpTool(params) {
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;
      const directState = server.getDirectCompatibilityState();
      assert.equal(directState.active_mode, "warn");
      assert.equal(directState.reason, "deny_gate_not_satisfied");
      const out = await server.callTool({
        name: "planner_managed_tool",
        arguments: {},
      });
      assert.equal(out.ok, true);
      assert.equal(out.dispatched_tool, "planner_managed_tool");
      assert.equal(
        out &&
          out.planner_direct_compatibility &&
          out.planner_direct_compatibility.mode,
        "warn"
      );
    },
    {
      mockedPlannerDirectCompatibilityContract: gateNotSatisfiedContract,
      mockedEntryGovernanceContract,
    }
  );

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_managed_tool"];
        },
        getToolsListCache() {
          return [{ name: "planner_managed_tool", description: "m", inputSchema: {} }];
        },
        async dispatchMcpTool(params) {
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;
      const directState = server.getDirectCompatibilityState();
      assert.equal(directState.active_mode, "warn");
      assert.equal(directState.reason, "deny_rollback_triggered");
      const out = await server.callTool({
        name: "planner_managed_tool",
        arguments: {},
      });
      assert.equal(out.ok, true);
      assert.equal(out.dispatched_tool, "planner_managed_tool");
      assert.equal(
        out &&
          out.planner_direct_compatibility &&
          out.planner_direct_compatibility.mode,
        "warn"
      );
    },
    {
      mockedPlannerDirectCompatibilityContract: rollbackTriggeredContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("Step D warn mode appends structured warning into MCP text envelope", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_managed_tool"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_managed_tool"],
    local_static_tool_names: [],
    disabled_tools: [],
  });
  const mockedDirectCompatibilityContract =
    createMockPlannerDirectCompatibilityContract({
      requested_mode: "warn",
      managed_tool_names: ["planner_managed_tool"],
      managed_tool_family_map: {
        planner_managed_tool: "mutate.component_properties",
      },
    });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: false,
    mode: "legacy",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_managed_tool"];
        },
        getToolsListCache() {
          return [{ name: "planner_managed_tool", description: "m", inputSchema: {} }];
        },
        async dispatchMcpTool() {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: true, status: "succeeded" }),
              },
            ],
          };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;
      const out = await server.callTool({
        name: "planner_managed_tool",
        arguments: {},
      });
      const text = out && Array.isArray(out.content) ? out.content[0].text : "";
      const parsed = JSON.parse(String(text || "{}"));
      assert.equal(parsed.ok, true);
      assert.equal(
        parsed &&
          parsed.planner_direct_compatibility &&
          parsed.planner_direct_compatibility.mode,
        "warn"
      );
      assert.equal(
        parsed.planner_direct_compatibility.suggested_action,
        "planner_execute_mcp"
      );
    },
    {
      mockedPlannerDirectCompatibilityContract: mockedDirectCompatibilityContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("PLNR-002 planner_execute_mcp is visible as primary entry while execute_block_spec_mvp stays callable alias", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
      "get_tool_schema",
    ],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
      "get_tool_schema",
    ],
    local_static_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "get_tool_schema",
    ],
    disabled_tools: [],
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: true,
    mode: "legacy",
    planner_alias_tool_name: "execute_block_spec_mvp",
  });
  const mockedPlannerProfileContract = createMockPlannerVisibilityProfileContract({
    requested_profile: "legacy_full",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return [
            "planner_execute_mcp",
            "execute_block_spec_mvp",
            "set_parent",
            "get_tool_schema",
          ];
        },
        getToolsListCache() {
          return [
            { name: "planner_execute_mcp", description: "planner", inputSchema: {} },
            { name: "execute_block_spec_mvp", description: "alias", inputSchema: {} },
            { name: "set_parent", description: "runtime", inputSchema: {} },
            { name: "get_tool_schema", description: "control", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      const tools = await server.getToolDefinitions();
      const listedNames = tools.map((item) => String(item && item.name || "").trim());
      assert.equal(listedNames.includes("planner_execute_mcp"), true);
      assert.equal(listedNames.includes("execute_block_spec_mvp"), false);
      assert.equal(listedNames.includes("set_parent"), false);
      assert.equal(listedNames.includes("get_tool_schema"), true);

      const plannerResult = await server.callTool({
        name: "planner_execute_mcp",
        arguments: {},
      });
      const aliasResult = await server.callTool({
        name: "execute_block_spec_mvp",
        arguments: {},
      });
      assert.deepEqual(plannerResult, {
        ok: true,
        dispatched_tool: "planner_execute_mcp",
      });
      assert.deepEqual(aliasResult, {
        ok: true,
        dispatched_tool: "execute_block_spec_mvp",
      });
      assert.deepEqual(calls, ["planner_execute_mcp", "execute_block_spec_mvp"]);
    },
    {
      mockedPlannerProfileContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("PLNR-011 MCP_ENTRY_MODE=legacy no longer allows external direct runtime passthrough", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_execute_mcp", "execute_block_spec_mvp", "set_parent"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_execute_mcp", "execute_block_spec_mvp", "set_parent"],
    local_static_tool_names: ["planner_execute_mcp", "execute_block_spec_mvp"],
    disabled_tools: [],
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: true,
    mode: "legacy",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_execute_mcp", "execute_block_spec_mvp", "set_parent"];
        },
        getToolsListCache() {
          return [
            { name: "planner_execute_mcp", description: "planner", inputSchema: {} },
            { name: "execute_block_spec_mvp", description: "alias", inputSchema: {} },
            { name: "set_parent", description: "runtime", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      await assert.rejects(
        async () =>
          server.callTool({
            name: "set_parent",
            arguments: {},
          }),
        /E_USE_PLANNER_ENTRY/
      );

      const plannerOut = await server.callTool({
        name: "planner_execute_mcp",
        arguments: {},
      });
      assert.deepEqual(plannerOut, {
        ok: true,
        dispatched_tool: "planner_execute_mcp",
      });
      assert.deepEqual(calls, ["planner_execute_mcp"]);
    },
    {
      mockedEntryGovernanceContract,
    }
  );
});

test("PLNR-011 MCP_ENTRY_MODE=observe also hard-rejects external direct runtime calls through unified error outlet", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: ["planner_execute_mcp", "execute_block_spec_mvp", "set_parent"],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: ["planner_execute_mcp", "execute_block_spec_mvp", "set_parent"],
    local_static_tool_names: ["planner_execute_mcp", "execute_block_spec_mvp"],
    disabled_tools: [],
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: true,
    mode: "observe",
  });
  const mockedPlannerProfileContract = createMockPlannerVisibilityProfileContract({
    requested_profile: "legacy_full",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_execute_mcp", "execute_block_spec_mvp", "set_parent"];
        },
        getToolsListCache() {
          return [
            { name: "planner_execute_mcp", description: "planner", inputSchema: {} },
            { name: "execute_block_spec_mvp", description: "alias", inputSchema: {} },
            { name: "set_parent", description: "runtime", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      await assert.rejects(
        async () =>
          server.callTool({
            name: "set_parent",
            arguments: {},
          }),
        /E_USE_PLANNER_ENTRY/
      );
      const plannerOut = await server.callTool({
        name: "planner_execute_mcp",
        arguments: {},
      });
      assert.deepEqual(plannerOut, {
        ok: true,
        dispatched_tool: "planner_execute_mcp",
      });
      assert.deepEqual(calls, ["planner_execute_mcp"]);
    },
    {
      mockedPlannerProfileContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("PLNR-001 MCP_ENTRY_MODE=reject hard-rejects external direct runtime calls with E_USE_PLANNER_ENTRY", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
      "get_tool_schema",
    ],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
      "get_tool_schema",
    ],
    local_static_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "get_tool_schema",
    ],
    disabled_tools: [],
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: true,
    mode: "reject",
    planner_alias_tool_name: "execute_block_spec_mvp",
  });
  const mockedPlannerProfileContract = createMockPlannerVisibilityProfileContract({
    requested_profile: "legacy_full",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return [
            "planner_execute_mcp",
            "execute_block_spec_mvp",
            "set_parent",
            "get_tool_schema",
          ];
        },
        getToolsListCache() {
          return [
            { name: "planner_execute_mcp", description: "planner", inputSchema: {} },
            { name: "execute_block_spec_mvp", description: "alias", inputSchema: {} },
            { name: "set_parent", description: "runtime", inputSchema: {} },
            { name: "get_tool_schema", description: "control", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      await assert.rejects(
        async () =>
          server.callTool({
            name: "set_parent",
            arguments: {},
          }),
        /E_USE_PLANNER_ENTRY/
      );
      const plannerOut = await server.callTool({
        name: "planner_execute_mcp",
        arguments: {},
      });
      const controlOut = await server.callTool({
        name: "get_tool_schema",
        arguments: {},
      });
      assert.deepEqual(plannerOut, {
        ok: true,
        dispatched_tool: "planner_execute_mcp",
      });
      assert.deepEqual(controlOut, {
        ok: true,
        dispatched_tool: "get_tool_schema",
      });
      assert.deepEqual(calls, ["planner_execute_mcp", "get_tool_schema"]);
    },
    {
      mockedPlannerProfileContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("PLNR-005 reject stage hard-rejects external direct runtime via plannerOnlyExposurePolicy and keeps control/support-plane callable", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
      "get_tool_schema",
    ],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
      "get_tool_schema",
    ],
    local_static_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "get_tool_schema",
    ],
    disabled_tools: [],
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: true,
    mode: "reject",
  });
  const mockedDirectCompatibilityContract =
    createMockPlannerDirectCompatibilityContract({
      requested_mode: "allow",
      managed_tool_names: ["set_parent"],
      managed_tool_family_map: {
        set_parent: "write.hierarchy.parent",
      },
    });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const calls = [];
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return [
            "planner_execute_mcp",
            "execute_block_spec_mvp",
            "set_parent",
            "get_tool_schema",
          ];
        },
        getToolsListCache() {
          return [
            { name: "planner_execute_mcp", description: "planner", inputSchema: {} },
            { name: "execute_block_spec_mvp", description: "alias", inputSchema: {} },
            { name: "set_parent", description: "runtime", inputSchema: {} },
            { name: "get_tool_schema", description: "control", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          calls.push(params && params.name);
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      await assert.rejects(
        async () =>
          server.callTool({
            name: "set_parent",
            arguments: {
              _meta: {
                client_version: "legacy-client",
              },
            },
          }),
        /E_USE_PLANNER_ENTRY: external direct runtime tool is blocked by MCP entry governance: set_parent; use planner_execute_mcp/
      );

      const controlOut = await server.callTool({
        name: "get_tool_schema",
        arguments: {
          _meta: {
            client_version: "legacy-client",
          },
        },
      });
      assert.deepEqual(controlOut, {
        ok: true,
        dispatched_tool: "get_tool_schema",
      });
      assert.deepEqual(calls, ["get_tool_schema"]);

      const exposure = server.getPlannerOnlyExposureState();
      assert.equal(exposure.metrics.external_direct_runtime_call_total, 1);
      assert.equal(exposure.metrics.external_direct_runtime_unique_clients, 1);
      assert.equal(exposure.metrics.external_direct_runtime_error_rate, 1);
      assert.equal(exposure.counters.observe_prompt_total, 0);
    },
    {
      mockedPlannerDirectCompatibilityContract: mockedDirectCompatibilityContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("PLNR-011 observe mode keeps metrics observable while external direct runtime calls are uniformly rejected", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
    ],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
    ],
    local_static_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
    ],
    disabled_tools: [],
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: true,
    mode: "observe",
  });
  const mockedDirectCompatibilityContract =
    createMockPlannerDirectCompatibilityContract({
      requested_mode: "allow",
      managed_tool_names: ["set_parent"],
      managed_tool_family_map: {
        set_parent: "write.hierarchy.parent",
      },
    });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return ["planner_execute_mcp", "execute_block_spec_mvp", "set_parent"];
        },
        getToolsListCache() {
          return [
            { name: "planner_execute_mcp", description: "planner", inputSchema: {} },
            { name: "execute_block_spec_mvp", description: "alias", inputSchema: {} },
            { name: "set_parent", description: "runtime", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      await assert.rejects(
        async () =>
          server.callTool({
            name: "set_parent",
            arguments: {
              _meta: {
                client_version: "client-A",
              },
            },
          }),
        /E_USE_PLANNER_ENTRY/
      );

      await assert.rejects(
        async () =>
          server.callTool({
            name: "set_parent",
            arguments: {
              _meta: {
                client_version: "client-B",
              },
            },
          }),
        /E_USE_PLANNER_ENTRY/
      );

      const plannerOut = await server.callTool({
        name: "planner_execute_mcp",
        arguments: {
          _meta: {
            client_version: "client-A",
          },
        },
      });
      assert.equal(plannerOut.ok, true);

      const exposure = server.getPlannerOnlyExposureState();
      assert.equal(
        exposure.metrics.external_direct_runtime_call_total,
        2
      );
      assert.equal(
        exposure.metrics.external_direct_runtime_unique_clients,
        2
      );
      assert.equal(
        exposure.metrics.external_direct_runtime_error_rate,
        1
      );
      assert.equal(
        exposure.metrics.planner_redirect_adoption_rate,
        0
      );
      assert.equal(exposure.counters.observe_prompt_total, 0);

      const byTool = Array.isArray(exposure.breakdown.by_tool)
        ? exposure.breakdown.by_tool
        : [];
      const setParentMetrics = byTool.find((item) => item.tool_name === "set_parent");
      assert.ok(setParentMetrics);
      assert.equal(setParentMetrics.external_direct_runtime_call_total, 2);
      assert.equal(setParentMetrics.external_direct_runtime_error_total, 2);
    },
    {
      mockedPlannerDirectCompatibilityContract: mockedDirectCompatibilityContract,
      mockedEntryGovernanceContract,
    }
  );
});

test("PLNR-009 planner-only exposure metrics split planner primary/alias entry calls", async () => {
  const mockedVisibilityContract = createMockVisibilityContract({
    active_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
    ],
    deprecated_tool_names: [],
    removed_tool_names: [],
    exposed_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
      "set_parent",
    ],
    local_static_tool_names: [
      "planner_execute_mcp",
      "execute_block_spec_mvp",
    ],
    disabled_tools: [],
  });
  const mockedEntryGovernanceContract = createMockEntryGovernanceContract({
    enabled: true,
    mode: "legacy",
    planner_alias_tool_name: "execute_block_spec_mvp",
  });

  await withMockedVisibilityContract(
    mockedVisibilityContract,
    async (MockedUnityMcpServer) => {
      const fakeRegistry = {
        listExposedMcpToolNames() {
          return [
            "planner_execute_mcp",
            "execute_block_spec_mvp",
            "set_parent",
          ];
        },
        getToolsListCache() {
          return [
            { name: "planner_execute_mcp", description: "planner", inputSchema: {} },
            { name: "execute_block_spec_mvp", description: "alias", inputSchema: {} },
            { name: "set_parent", description: "runtime", inputSchema: {} },
          ];
        },
        async dispatchMcpTool(params) {
          return { ok: true, dispatched_tool: params && params.name };
        },
      };
      const server = Object.create(MockedUnityMcpServer.prototype);
      server.commandRegistry = fakeRegistry;

      await server.callTool({
        name: "planner_execute_mcp",
        arguments: {
          _meta: {
            client_version: "client-1",
          },
        },
      });
      await server.callTool({
        name: "planner_execute_mcp",
        arguments: {
          _meta: {
            client_version: "client-1",
          },
        },
      });
      await server.callTool({
        name: "execute_block_spec_mvp",
        arguments: {
          _meta: {
            client_version: "client-1",
          },
        },
      });

      const exposure = server.getPlannerOnlyExposureState();
      assert.equal(exposure.counters.planner_entry_call_total, 3);
      assert.equal(exposure.counters.planner_entry_primary_call_total, 2);
      assert.equal(exposure.counters.planner_entry_alias_call_total, 1);
      assert.equal(exposure.metrics.planner_alias_call_share, 1 / 3);

      const byTool = Array.isArray(exposure.breakdown.by_tool)
        ? exposure.breakdown.by_tool
        : [];
      const plannerPrimaryMetrics = byTool.find(
        (item) => item && item.tool_name === "planner_execute_mcp"
      );
      const plannerAliasMetrics = byTool.find(
        (item) => item && item.tool_name === "execute_block_spec_mvp"
      );
      assert.ok(plannerPrimaryMetrics);
      assert.ok(plannerAliasMetrics);
      assert.equal(plannerPrimaryMetrics.planner_entry_primary_call_total, 2);
      assert.equal(plannerAliasMetrics.planner_entry_alias_call_total, 1);
    },
    {
      mockedEntryGovernanceContract,
    }
  );
});

test("PLNR-012 execute_block_spec_mvp alias is no longer exposed or callable from runtime manifest", async () => {
  const registry = getMcpCommandRegistry();
  const server = Object.create(UnityMcpServer.prototype);
  server.commandRegistry = registry;

  const tools = await server.getToolDefinitions();
  const names = tools.map((item) => String(item && item.name || "").trim());
  assert.equal(names.includes("execute_block_spec_mvp"), false);

  await assert.rejects(
    async () =>
      server.callTool({
        name: "execute_block_spec_mvp",
        arguments: {
          block_spec: {
            block_id: "retired_alias_probe",
            block_type: "READ_STATE",
            intent_key: "read.snapshot_for_write",
            input: {},
          },
        },
      }),
    /Tool not enabled by visibility policy: execute_block_spec_mvp/
  );
});

"use strict";

const PLANNER_ONLY_EXPOSURE_POLICY_VERSION = "phase1_step6_plnr009_v1";

function normalizeToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeClientVersion(value) {
  const normalized = normalizeToolName(value);
  return normalized || "unknown";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toNonNegativeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function normalizeMapObject(value) {
  const source = value && typeof value === "object" ? value : {};
  const out = {};
  for (const [key, raw] of Object.entries(source)) {
    const normalizedKey = normalizeToolName(key);
    const normalizedValue = normalizeToolName(raw);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    out[normalizedKey] = normalizedValue;
  }
  return out;
}

function toSortedCounterRows(counterMap, keyName) {
  return Object.entries(counterMap)
    .map(([key, counters]) => ({
      [keyName]: key,
      external_direct_runtime_call_total: toNonNegativeNumber(
        counters && counters.external_direct_runtime_call_total
      ),
      external_direct_runtime_error_total: toNonNegativeNumber(
        counters && counters.external_direct_runtime_error_total
      ),
      observe_prompt_total: toNonNegativeNumber(
        counters && counters.observe_prompt_total
      ),
      planner_entry_call_total: toNonNegativeNumber(
        counters && counters.planner_entry_call_total
      ),
      planner_entry_primary_call_total: toNonNegativeNumber(
        counters && counters.planner_entry_primary_call_total
      ),
      planner_entry_alias_call_total: toNonNegativeNumber(
        counters && counters.planner_entry_alias_call_total
      ),
      redirected_after_observe_total: toNonNegativeNumber(
        counters && counters.redirected_after_observe_total
      ),
    }))
    .sort((a, b) => {
      if (
        b.external_direct_runtime_call_total !== a.external_direct_runtime_call_total
      ) {
        return (
          b.external_direct_runtime_call_total - a.external_direct_runtime_call_total
        );
      }
      return String(a[keyName]).localeCompare(String(b[keyName]));
    });
}

function createEmptyCounter() {
  return {
    external_direct_runtime_call_total: 0,
    external_direct_runtime_error_total: 0,
    observe_prompt_total: 0,
    planner_entry_call_total: 0,
    planner_entry_primary_call_total: 0,
    planner_entry_alias_call_total: 0,
    redirected_after_observe_total: 0,
  };
}

function ensureCounterEntry(counterMap, key) {
  const normalizedKey = normalizeToolName(key) || "unknown";
  if (!counterMap[normalizedKey]) {
    counterMap[normalizedKey] = createEmptyCounter();
  }
  return counterMap[normalizedKey];
}

function extractClientVersion(args) {
  const source = normalizeObject(args);
  if (typeof source.client_version === "string" && source.client_version.trim()) {
    return normalizeClientVersion(source.client_version);
  }
  if (typeof source.clientVersion === "string" && source.clientVersion.trim()) {
    return normalizeClientVersion(source.clientVersion);
  }
  const meta = normalizeObject(source._meta);
  if (typeof meta.client_version === "string" && meta.client_version.trim()) {
    return normalizeClientVersion(meta.client_version);
  }
  if (typeof meta.clientVersion === "string" && meta.clientVersion.trim()) {
    return normalizeClientVersion(meta.clientVersion);
  }
  const requestMeta = normalizeObject(source.request_meta);
  if (
    typeof requestMeta.client_version === "string" &&
    requestMeta.client_version.trim()
  ) {
    return normalizeClientVersion(requestMeta.client_version);
  }
  return "unknown";
}

function isFailedDispatchResult(result) {
  const source = normalizeObject(result);
  const status = normalizeToolName(source.status).toLowerCase();
  if (status === "failed" || status === "error" || status === "rejected") {
    return true;
  }
  if (source.ok === false) {
    return true;
  }
  return (
    typeof source.error_code === "string" &&
    source.error_code.trim().length > 0
  );
}

function buildExternalDirectRejectErrorEnvelope({
  toolName,
  plannerPrimaryToolName,
}) {
  const normalizedToolName = normalizeToolName(toolName);
  const normalizedPlannerEntry =
    normalizeToolName(plannerPrimaryToolName) || "planner_execute_mcp";
  return {
    error_code: "E_USE_PLANNER_ENTRY",
    error_message:
      `E_USE_PLANNER_ENTRY: external direct runtime tool is blocked by MCP entry governance: ` +
      `${normalizedToolName}; use ${normalizedPlannerEntry}`,
    suggested_action: normalizedPlannerEntry,
    reason: "external_direct_runtime_rejected",
    tool_name: normalizedToolName,
  };
}

function createPlannerOnlyExposurePolicy(options = {}) {
  const source = normalizeObject(options);
  const nowIso =
    typeof source.nowIso === "function"
      ? source.nowIso
      : () => new Date().toISOString();
  const entryGovernanceState = normalizeObject(source.entry_governance_state);
  const localStaticToolNameSet =
    source.local_static_tool_name_set instanceof Set
      ? source.local_static_tool_name_set
      : new Set();
  const managedToolFamilyMap = normalizeMapObject(source.managed_tool_family_map);
  const plannerPrimaryToolName =
    normalizeToolName(entryGovernanceState.planner_primary_tool_name) ||
    "planner_execute_mcp";
  const plannerAliasToolName =
    normalizeToolName(entryGovernanceState.planner_alias_tool_name) || "";

  const state = {
    totals: createEmptyCounter(),
    by_tool: {},
    by_family: {},
    by_client_version: {},
    clients: new Map(),
  };

  function resolveFamilyKey(toolName) {
    const normalizedToolName = normalizeToolName(toolName);
    if (!normalizedToolName) {
      return "unmanaged";
    }
    return managedToolFamilyMap[normalizedToolName] || "unmanaged";
  }

  function isPlannerEntryTool(toolName) {
    const normalizedToolName = normalizeToolName(toolName);
    return (
      normalizedToolName === plannerPrimaryToolName ||
      normalizedToolName === plannerAliasToolName
    );
  }

  function isControlSupportPlaneTool(toolName) {
    const normalizedToolName = normalizeToolName(toolName);
    return normalizedToolName ? localStaticToolNameSet.has(normalizedToolName) : false;
  }

  function ensureClientState(clientVersion) {
    const key = normalizeClientVersion(clientVersion);
    if (!state.clients.has(key)) {
      state.clients.set(key, {
        pending_redirect_after_observe: 0,
      });
    }
    return state.clients.get(key);
  }

  function resolvePlannerEntryKind(toolName) {
    const normalizedToolName = normalizeToolName(toolName);
    if (normalizedToolName === plannerPrimaryToolName) {
      return "primary";
    }
    if (normalizedToolName === plannerAliasToolName) {
      return "alias";
    }
    return "unknown";
  }

  function recordPlannerEntryCall(toolName, clientVersion) {
    const normalizedToolName = normalizeToolName(toolName);
    const normalizedClientVersion = normalizeClientVersion(clientVersion);
    const plannerEntryKind = resolvePlannerEntryKind(normalizedToolName);
    const plannerEntryFamilyKey = "planner.entry";

    state.totals.planner_entry_call_total += 1;
    ensureCounterEntry(state.by_tool, normalizedToolName).planner_entry_call_total += 1;
    ensureCounterEntry(state.by_family, plannerEntryFamilyKey).planner_entry_call_total += 1;
    ensureCounterEntry(state.by_client_version, normalizedClientVersion).planner_entry_call_total +=
      1;

    if (plannerEntryKind === "primary") {
      state.totals.planner_entry_primary_call_total += 1;
      ensureCounterEntry(state.by_tool, normalizedToolName).planner_entry_primary_call_total += 1;
      ensureCounterEntry(
        state.by_family,
        plannerEntryFamilyKey
      ).planner_entry_primary_call_total += 1;
      ensureCounterEntry(
        state.by_client_version,
        normalizedClientVersion
      ).planner_entry_primary_call_total += 1;
    } else if (plannerEntryKind === "alias") {
      state.totals.planner_entry_alias_call_total += 1;
      ensureCounterEntry(state.by_tool, normalizedToolName).planner_entry_alias_call_total += 1;
      ensureCounterEntry(
        state.by_family,
        plannerEntryFamilyKey
      ).planner_entry_alias_call_total += 1;
      ensureCounterEntry(
        state.by_client_version,
        normalizedClientVersion
      ).planner_entry_alias_call_total += 1;
    }

    const clientState = ensureClientState(normalizedClientVersion);
    if (clientState.pending_redirect_after_observe > 0) {
      clientState.pending_redirect_after_observe -= 1;
      state.totals.redirected_after_observe_total += 1;
      ensureCounterEntry(
        state.by_client_version,
        normalizedClientVersion
      ).redirected_after_observe_total += 1;
    }
  }

  function beginToolCall(input = {}) {
    const payload = normalizeObject(input);
    const toolName = normalizeToolName(payload.tool_name);
    const entryDecision = normalizeObject(payload.entry_decision);
    const decision = normalizeToolName(entryDecision.decision).toLowerCase();
    const clientVersion = extractClientVersion(payload.args);

    if (!toolName) {
      return {
        tracked_external_runtime_call: false,
        tool_name: "",
        family_key: "unmanaged",
        client_version: clientVersion,
      };
    }

    if (isPlannerEntryTool(toolName)) {
      recordPlannerEntryCall(toolName, clientVersion);
      return {
        tracked_external_runtime_call: false,
        tool_name: toolName,
        family_key: "planner.entry",
        client_version: clientVersion,
      };
    }

    if (isControlSupportPlaneTool(toolName)) {
      return {
        tracked_external_runtime_call: false,
        tool_name: toolName,
        family_key: "control.support",
        client_version: clientVersion,
      };
    }

    if (entryGovernanceState.enabled !== true) {
      return {
        tracked_external_runtime_call: false,
        tool_name: toolName,
        family_key: resolveFamilyKey(toolName),
        client_version: clientVersion,
      };
    }

    const familyKey = resolveFamilyKey(toolName);
    state.totals.external_direct_runtime_call_total += 1;
    ensureCounterEntry(state.by_tool, toolName).external_direct_runtime_call_total += 1;
    ensureCounterEntry(state.by_family, familyKey).external_direct_runtime_call_total += 1;
    ensureCounterEntry(
      state.by_client_version,
      clientVersion
    ).external_direct_runtime_call_total += 1;

    if (decision === "observe") {
      state.totals.observe_prompt_total += 1;
      ensureCounterEntry(state.by_tool, toolName).observe_prompt_total += 1;
      ensureCounterEntry(state.by_family, familyKey).observe_prompt_total += 1;
      ensureCounterEntry(state.by_client_version, clientVersion).observe_prompt_total += 1;
      const clientState = ensureClientState(clientVersion);
      clientState.pending_redirect_after_observe += 1;
    }

    return {
      tracked_external_runtime_call: true,
      tool_name: toolName,
      family_key: familyKey,
      client_version: clientVersion,
    };
  }

  function completeToolCall(trackingContext = {}, completion = {}) {
    const context = normalizeObject(trackingContext);
    if (context.tracked_external_runtime_call !== true) {
      return;
    }

    const completionPayload = normalizeObject(completion);
    const failed =
      completionPayload.error === true ||
      isFailedDispatchResult(completionPayload.dispatch_result);
    if (!failed) {
      return;
    }

    const toolName = normalizeToolName(context.tool_name);
    const familyKey = normalizeToolName(context.family_key) || "unmanaged";
    const clientVersion = normalizeClientVersion(context.client_version);

    state.totals.external_direct_runtime_error_total += 1;
    ensureCounterEntry(state.by_tool, toolName).external_direct_runtime_error_total += 1;
    ensureCounterEntry(state.by_family, familyKey).external_direct_runtime_error_total += 1;
    ensureCounterEntry(
      state.by_client_version,
      clientVersion
    ).external_direct_runtime_error_total += 1;
  }

  function getSnapshot() {
    const externalTotal = toNonNegativeNumber(
      state.totals.external_direct_runtime_call_total
    );
    const externalErrors = toNonNegativeNumber(
      state.totals.external_direct_runtime_error_total
    );
    const observePromptTotal = toNonNegativeNumber(state.totals.observe_prompt_total);
    const redirectedAfterObserveTotal = toNonNegativeNumber(
      state.totals.redirected_after_observe_total
    );
    const plannerEntryTotal = toNonNegativeNumber(state.totals.planner_entry_call_total);
    const plannerAliasTotal = toNonNegativeNumber(
      state.totals.planner_entry_alias_call_total
    );
    const uniqueClientTotal = Object.values(state.by_client_version).filter(
      (entry) =>
        toNonNegativeNumber(entry && entry.external_direct_runtime_call_total) > 0
    ).length;

    return {
      schema_version: "planner_only_exposure_metrics.v1",
      policy_version: PLANNER_ONLY_EXPOSURE_POLICY_VERSION,
      generated_at: nowIso(),
      policy_state: {
        enabled: entryGovernanceState.enabled === true,
        requested_mode:
          normalizeToolName(entryGovernanceState.requested_mode) || "legacy",
        active_mode: normalizeToolName(entryGovernanceState.active_mode) || "legacy",
        planner_primary_tool_name: plannerPrimaryToolName,
        planner_alias_tool_name: plannerAliasToolName,
      },
      metrics: {
        external_direct_runtime_call_total: externalTotal,
        external_direct_runtime_unique_clients: uniqueClientTotal,
        external_direct_runtime_error_rate:
          externalTotal > 0 ? externalErrors / externalTotal : 0,
        planner_redirect_adoption_rate:
          observePromptTotal > 0
            ? redirectedAfterObserveTotal / observePromptTotal
            : 0,
        planner_alias_call_share:
          plannerEntryTotal > 0 ? plannerAliasTotal / plannerEntryTotal : 0,
      },
      counters: {
        external_direct_runtime_call_total: externalTotal,
        external_direct_runtime_error_total: externalErrors,
        external_direct_runtime_unique_clients: uniqueClientTotal,
        observe_prompt_total: observePromptTotal,
        planner_entry_call_total: toNonNegativeNumber(
          state.totals.planner_entry_call_total
        ),
        planner_entry_primary_call_total: toNonNegativeNumber(
          state.totals.planner_entry_primary_call_total
        ),
        planner_entry_alias_call_total: plannerAliasTotal,
        redirected_after_observe_total: redirectedAfterObserveTotal,
      },
      breakdown: {
        by_tool: toSortedCounterRows(state.by_tool, "tool_name"),
        by_family: toSortedCounterRows(state.by_family, "family_key"),
        by_client_version: toSortedCounterRows(
          state.by_client_version,
          "client_version"
        ),
      },
    };
  }

  function getExternalDirectRejectError(toolName) {
    return buildExternalDirectRejectErrorEnvelope({
      toolName,
      plannerPrimaryToolName,
    });
  }

  function resetForTests() {
    state.totals = createEmptyCounter();
    state.by_tool = {};
    state.by_family = {};
    state.by_client_version = {};
    state.clients = new Map();
  }

  return {
    version: PLANNER_ONLY_EXPOSURE_POLICY_VERSION,
    getExternalDirectRejectError,
    beginToolCall,
    completeToolCall,
    getSnapshot,
    resetForTests,
  };
}

module.exports = {
  PLANNER_ONLY_EXPOSURE_POLICY_VERSION,
  createPlannerOnlyExposurePolicy,
};

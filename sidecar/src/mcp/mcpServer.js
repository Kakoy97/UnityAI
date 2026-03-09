#!/usr/bin/env node
"use strict";

/**
 * MCP Server Wrapper for Unity Sidecar
 * This server bridges Cursor MCP protocol to Sidecar HTTP APIs.
 */
/**
 * R11-ARCH-01 Responsibility boundary:
 * - This module only exposes MCP stdio protocol, tool metadata, and tool dispatch.
 * - This module must not own HTTP route branching or request schema validation rules.
 * - Command onboarding must follow contract/registry gates instead of ad-hoc switch growth.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");
const readline = require("readline");
const { getMcpCommandRegistry } = require("./commandRegistry");
const {
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
  MCP_ENTRY_GOVERNANCE_CONTRACT,
  MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT,
  MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT,
} = require("../ports/contracts");
const {
  createPlannerVisibilityProfileRuntime,
} = require("../application/blockRuntime/visibility/PlannerVisibilityProfileRuntime");
const {
  DIRECT_COMPATIBILITY_MODE,
  createPlannerDirectCompatibilityRuntime,
} = require("../application/blockRuntime/visibility/PlannerDirectCompatibilityRuntime");
const {
  getPlannerDirectCompatibilityMetricsCollectorSingleton,
} = require("../application/blockRuntime/visibility/plannerDirectCompatibilityMetricsCollector");
const {
  createPlannerOnlyExposurePolicy,
} = require("./plannerOnlyExposurePolicy");

function normalizeToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

const MCP_ACTIVE_TOOL_NAMES = Object.freeze(
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT &&
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.active_tool_names)
    ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.active_tool_names
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    : []
);
const MCP_ACTIVE_TOOL_NAME_SET = new Set(MCP_ACTIVE_TOOL_NAMES);
const MCP_DEPRECATED_TOOL_NAMES = Object.freeze(
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT &&
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.deprecated_tool_names)
    ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.deprecated_tool_names
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    : []
);
const MCP_DEPRECATED_TOOL_NAME_SET = new Set(MCP_DEPRECATED_TOOL_NAMES);
const MCP_REMOVED_TOOL_NAMES = Object.freeze(
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT &&
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.removed_tool_names)
    ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.removed_tool_names
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    : []
);
const MCP_REMOVED_TOOL_NAME_SET = new Set(MCP_REMOVED_TOOL_NAMES);
const MCP_DISABLED_TOOL_NAMES = Object.freeze(
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT &&
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools)
    ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    : []
);
const MCP_DISABLED_TOOL_NAME_SET = new Set(MCP_DISABLED_TOOL_NAMES);
const MCP_LOCAL_STATIC_TOOL_NAMES = Object.freeze(
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT &&
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.local_static_tool_names)
    ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.local_static_tool_names
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    : []
);
const MCP_LOCAL_STATIC_TOOL_NAME_SET = new Set(MCP_LOCAL_STATIC_TOOL_NAMES);

const ENTRY_MODE = Object.freeze({
  LEGACY: "legacy",
  OBSERVE: "observe",
  REJECT: "reject",
});

function resolveEntryGovernanceState(contract) {
  const source = contract && typeof contract === "object" ? contract : {};
  const mode = normalizeToolName(source.mode).toLowerCase();
  const normalizedMode =
    mode === ENTRY_MODE.LEGACY ||
    mode === ENTRY_MODE.OBSERVE ||
    mode === ENTRY_MODE.REJECT
      ? mode
      : ENTRY_MODE.LEGACY;
  const enabled = source.enabled === true;
  return Object.freeze({
    enabled,
    requested_mode: normalizedMode,
    active_mode: enabled ? normalizedMode : ENTRY_MODE.LEGACY,
    observe_shadow: source.observe_shadow === true,
    planner_primary_tool_name:
      normalizeToolName(source.planner_primary_tool_name) || "planner_execute_mcp",
    planner_alias_tool_name:
      normalizeToolName(source.planner_alias_tool_name) || "",
    supported_modes: Array.isArray(source.supported_modes)
      ? source.supported_modes
      : [ENTRY_MODE.LEGACY, ENTRY_MODE.OBSERVE, ENTRY_MODE.REJECT],
  });
}

const MCP_ENTRY_GOVERNANCE_STATE = resolveEntryGovernanceState(
  MCP_ENTRY_GOVERNANCE_CONTRACT
);

function isToolLifecycleBlocked(name) {
  const normalized = normalizeToolName(name);
  if (!normalized) {
    return false;
  }
  return (
    MCP_DEPRECATED_TOOL_NAME_SET.has(normalized) ||
    MCP_REMOVED_TOOL_NAME_SET.has(normalized)
  );
}

function isToolEnabledByBaseVisibilityContract(name) {
  const normalized = normalizeToolName(name);
  if (!normalized) {
    return false;
  }
  if (isToolLifecycleBlocked(normalized)) {
    return false;
  }
  if (MCP_DISABLED_TOOL_NAME_SET.has(normalized)) {
    return false;
  }
  if (MCP_ACTIVE_TOOL_NAME_SET.size <= 0) {
    return false;
  }
  return MCP_ACTIVE_TOOL_NAME_SET.has(normalized);
}

const PLANNER_VISIBILITY_PROFILE_RUNTIME = createPlannerVisibilityProfileRuntime(
  MCP_PLANNER_VISIBILITY_PROFILE_CONTRACT
);
const PLANNER_DIRECT_COMPATIBILITY_METRICS_COLLECTOR =
  getPlannerDirectCompatibilityMetricsCollectorSingleton();
const PLANNER_DIRECT_COMPATIBILITY_RUNTIME = createPlannerDirectCompatibilityRuntime(
  MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT,
  {
    metricsCollector: PLANNER_DIRECT_COMPATIBILITY_METRICS_COLLECTOR,
  }
);
const PLANNER_ONLY_EXPOSURE_POLICY = createPlannerOnlyExposurePolicy({
  entry_governance_state: MCP_ENTRY_GOVERNANCE_STATE,
  local_static_tool_name_set: MCP_LOCAL_STATIC_TOOL_NAME_SET,
  managed_tool_family_map:
    MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT &&
    typeof MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT === "object"
      ? MCP_PLANNER_DIRECT_COMPATIBILITY_POLICY_CONTRACT.managed_tool_family_map
      : {},
});

function isPlannerEntryToolName(name) {
  const normalized = normalizeToolName(name);
  if (!normalized) {
    return false;
  }
  return (
    normalized === MCP_ENTRY_GOVERNANCE_STATE.planner_primary_tool_name ||
    normalized === MCP_ENTRY_GOVERNANCE_STATE.planner_alias_tool_name
  );
}

function isControlSupportPlaneToolName(name) {
  const normalized = normalizeToolName(name);
  if (!normalized) {
    return false;
  }
  if (isPlannerEntryToolName(normalized)) {
    return false;
  }
  return MCP_LOCAL_STATIC_TOOL_NAME_SET.has(normalized);
}

function attachWarningPayloadToMcpResult(result, fieldName, warningPayload) {
  const source = result && typeof result === "object" ? result : {};
  const warning =
    warningPayload && typeof warningPayload === "object" ? warningPayload : null;
  const key = normalizeToolName(fieldName);
  if (!warning || !key) {
    return source;
  }

  if (Array.isArray(source.content)) {
    const content = source.content.map((item) =>
      item && typeof item === "object" ? { ...item } : item
    );
    const firstTextIndex = content.findIndex((item) => {
      return (
        item &&
        typeof item === "object" &&
        item.type === "text" &&
        typeof item.text === "string"
      );
    });
    if (firstTextIndex >= 0) {
      const entry = content[firstTextIndex];
      let parsed = null;
      try {
        parsed = JSON.parse(entry.text);
      } catch {
        parsed = null;
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
          parsed[key] = warning;
        }
        content[firstTextIndex] = {
          ...entry,
          text: JSON.stringify(parsed, null, 2),
        };
      } else {
        content.push({
          type: "text",
          text: JSON.stringify(
            {
              [key]: warning,
            },
            null,
            2
          ),
        });
      }
      return {
        ...source,
        content,
      };
    }
  }

  if (
    source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    !Object.prototype.hasOwnProperty.call(source, key)
  ) {
    return {
      ...source,
      [key]: warning,
    };
  }
  return source;
}

function buildDirectCompatibilityWarningPayload(decision) {
  const source = decision && typeof decision === "object" ? decision : {};
  const toolName = normalizeToolName(source.tool_name);
  const familyKey = normalizeToolName(source.family_key);
  return {
    schema_version: "planner_direct_compatibility_warning.v1",
    mode: "warn",
    tool_name: toolName,
    family_key: familyKey,
    reason: normalizeToolName(source.reason) || "managed_tool_warned_in_warn_mode",
    suggested_action: MCP_ENTRY_GOVERNANCE_STATE.planner_primary_tool_name,
    guidance:
      "Managed direct tool is in warn mode. Prefer planner block entry for this capability family.",
  };
}

function attachDirectCompatibilityWarningToMcpResult(result, warningPayload) {
  return attachWarningPayloadToMcpResult(
    result,
    "planner_direct_compatibility",
    warningPayload
  );
}

function buildEntryGovernanceObserveWarningPayload(toolName) {
  return {
    schema_version: "mcp_entry_governance_warning.v1",
    mode: ENTRY_MODE.OBSERVE,
    tool_name: normalizeToolName(toolName),
    reason: "external_direct_runtime_observed",
    suggested_action: MCP_ENTRY_GOVERNANCE_STATE.planner_primary_tool_name,
    guidance:
      "External direct runtime call observed. Use planner_execute_mcp for MCP planner-first entry.",
  };
}

function attachEntryGovernanceObserveWarning(result, warningPayload) {
  return attachWarningPayloadToMcpResult(
    result,
    "mcp_entry_governance",
    warningPayload
  );
}

class UnityMcpServer {
  constructor(sidecarBaseUrl) {
    this.sidecarBaseUrl =
      sidecarBaseUrl || process.env.SIDECAR_BASE_URL || "http://127.0.0.1:46321";
    this.commandRegistry = getMcpCommandRegistry();
    this.setupStdioHandlers();
  }

  getCommandRegistry() {
    if (!this.commandRegistry) {
      this.commandRegistry = getMcpCommandRegistry();
    }
    return this.commandRegistry;
  }

  getExposedToolNameSet() {
    const registry = this.getCommandRegistry();
    if (!registry || typeof registry !== "object") {
      return new Set();
    }

    let names = [];
    if (typeof registry.listExposedMcpToolNames === "function") {
      names = registry.listExposedMcpToolNames();
    } else if (typeof registry.listMcpToolNames === "function") {
      names = registry.listMcpToolNames();
    } else if (typeof registry.getToolsListCache === "function") {
      const tools = registry.getToolsListCache({});
      names = Array.isArray(tools) ? tools.map((item) => item && item.name) : [];
    }

    return new Set(
      (Array.isArray(names) ? names : [])
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    );
  }

  isToolVisibleByPolicy(name) {
    const normalized = normalizeToolName(name);
    if (!normalized) {
      return false;
    }
    const exposedToolNameSet = this.getExposedToolNameSet();
    if (!exposedToolNameSet.has(normalized)) {
      return false;
    }
    if (!isToolEnabledByBaseVisibilityContract(normalized)) {
      return false;
    }
    // PLNR-010: freeze tools/list to planner entry + control/support-plane only.
    if (isPlannerEntryToolName(normalized)) {
      if (
        MCP_ENTRY_GOVERNANCE_STATE.enabled &&
        normalized === MCP_ENTRY_GOVERNANCE_STATE.planner_alias_tool_name
      ) {
        return false;
      }
      return true;
    }
    return isControlSupportPlaneToolName(normalized);
  }

  isToolCallableByPolicy(name) {
    const normalized = normalizeToolName(name);
    if (!normalized) {
      return false;
    }
    const exposedToolNameSet = this.getExposedToolNameSet();
    if (!exposedToolNameSet.has(normalized)) {
      return false;
    }
    return isToolEnabledByBaseVisibilityContract(normalized);
  }

  getEntryGovernanceState() {
    return MCP_ENTRY_GOVERNANCE_STATE;
  }

  evaluateEntryGovernanceDecision(toolName) {
    const normalized = normalizeToolName(toolName);
    const state = MCP_ENTRY_GOVERNANCE_STATE;
    if (!normalized) {
      return {
        mode: state.active_mode,
        decision: "allow",
        reason: "empty_tool_name",
      };
    }
    if (!state.enabled) {
      return {
        mode: state.active_mode,
        decision: "allow",
        reason: "governance_disabled",
      };
    }
    if (isPlannerEntryToolName(normalized)) {
      return {
        mode: state.active_mode,
        decision: "allow",
        reason: "planner_entry_tool",
      };
    }
    if (MCP_LOCAL_STATIC_TOOL_NAME_SET.has(normalized)) {
      return {
        mode: state.active_mode,
        decision: "allow",
        reason: "control_support_plane_tool",
      };
    }
    if (state.active_mode === ENTRY_MODE.REJECT) {
      return {
        mode: state.active_mode,
        decision: "deny",
        reason: "external_direct_runtime_rejected",
      };
    }
    if (state.active_mode === ENTRY_MODE.OBSERVE) {
      return {
        mode: state.active_mode,
        decision: "observe",
        reason: "external_direct_runtime_observed",
      };
    }
    return {
      mode: state.active_mode,
      decision: "allow",
      reason: "legacy_mode_allow",
    };
  }

  getVisibilityProfileState() {
    return PLANNER_VISIBILITY_PROFILE_RUNTIME.getState();
  }

  getDirectCompatibilityState() {
    return {
      ...PLANNER_DIRECT_COMPATIBILITY_RUNTIME.getState(),
      counters: PLANNER_DIRECT_COMPATIBILITY_RUNTIME.getDecisionMetricsSnapshot(),
      planner_only_exposure: PLANNER_ONLY_EXPOSURE_POLICY.getSnapshot(),
    };
  }

  getPlannerOnlyExposureState() {
    return PLANNER_ONLY_EXPOSURE_POLICY.getSnapshot();
  }

  setupStdioHandlers() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", (line) => {
      if (!line || line.trim() === "") {
        return;
      }
      try {
        const message = JSON.parse(line);
        this.handleMessage(message);
      } catch (err) {
        this.sendError(err, line, null);
      }
    });

    rl.on("close", () => {
      process.exit(0);
    });

    process.on("SIGINT", () => {
      process.exit(0);
    });
  }

  async handleMessage(message) {
    try {
      const isNotification = !("id" in message);
      const response = await this.processRequest(message);
      if (!isNotification && response) {
        this.sendResponse(response);
      }
    } catch (err) {
      if ("id" in message) {
        this.sendError(
          err,
          typeof message === "string" ? message : JSON.stringify(message),
          message.id
        );
      } else {
        process.stderr.write(`Notification handling error: ${err.message}\n`);
      }
    }
  }

  async processRequest(request) {
    const { method, params, id } = request;

    try {
      switch (method) {
        case "initialize": {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
              },
              serverInfo: {
                name: "unity-sidecar",
                version: "0.1.0",
              },
            },
          };
        }

        case "notifications/initialized":
          return null;

        case "ping":
          return {
            jsonrpc: "2.0",
            id,
            result: {},
          };

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              tools: await this.getToolDefinitions(),
            },
          };

        case "tools/call": {
          const toolResult = await this.callTool(params);
          return {
            jsonrpc: "2.0",
            id,
            result: toolResult,
          };
        }

        case "resources/list":
          throw new Error("resources/list is removed; use MCP read tools");

        case "resources/read":
          throw new Error("resources/read is removed; use MCP read tools");

        default:
          if (!id) {
            return null;
          }
          throw new Error(`Method not found: ${method}`);
      }
    } catch (err) {
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32601,
          message: err.message || "Method not found",
        },
      };
    }
  }

  async getToolDefinitions() {
    const toolDefinitions = this.getCommandRegistry().getToolsListCache({});
    if (!Array.isArray(toolDefinitions)) {
      return [];
    }
    return toolDefinitions.filter((item) =>
      this.isToolVisibleByPolicy(item && item.name)
    );
  }

  async callTool(params) {
    const { name, arguments: args } = params || {};
    const normalizedName = normalizeToolName(name);
    if (isToolLifecycleBlocked(normalizedName)) {
      throw new Error(`Tool removed in phase6: ${normalizedName}`);
    }
    if (!this.isToolCallableByPolicy(normalizedName)) {
      throw new Error(`Tool not enabled by visibility policy: ${normalizedName}`);
    }

    const isExternalDirectRuntimeTool =
      !isPlannerEntryToolName(normalizedName) &&
      !isControlSupportPlaneToolName(normalizedName);
    let entryGovernanceDecision = this.evaluateEntryGovernanceDecision(normalizedName);
    // PLNR-011: remove callTool legacy passthrough branch. Under entry governance,
    // external direct runtime calls always fail through one unified reject outlet.
    if (MCP_ENTRY_GOVERNANCE_STATE.enabled && isExternalDirectRuntimeTool) {
      entryGovernanceDecision = {
        mode: MCP_ENTRY_GOVERNANCE_STATE.active_mode,
        decision: "deny",
        reason: "external_direct_runtime_rejected_unified",
      };
    }
    const plannerOnlyExposureTracking = PLANNER_ONLY_EXPOSURE_POLICY.beginToolCall({
      tool_name: normalizedName,
      args: args && typeof args === "object" ? args : {},
      entry_decision: entryGovernanceDecision,
    });
    if (entryGovernanceDecision.decision === "deny") {
      const rejectError =
        PLANNER_ONLY_EXPOSURE_POLICY.getExternalDirectRejectError(
          normalizedName
        );
      PLANNER_ONLY_EXPOSURE_POLICY.completeToolCall(plannerOnlyExposureTracking, {
        error: true,
        dispatch_result: {
          status: "failed",
          error_code:
            rejectError &&
            typeof rejectError.error_code === "string" &&
            rejectError.error_code.trim()
              ? rejectError.error_code.trim()
              : "E_USE_PLANNER_ENTRY",
        },
      });
      throw new Error(
        rejectError &&
          typeof rejectError.error_message === "string" &&
          rejectError.error_message.trim()
          ? rejectError.error_message.trim()
          : `E_USE_PLANNER_ENTRY: external direct runtime tool is blocked by MCP entry governance: ${normalizedName}; use ${MCP_ENTRY_GOVERNANCE_STATE.planner_primary_tool_name}`
      );
    }

    let directCompatibilityDecision = null;
    if (entryGovernanceDecision.mode === ENTRY_MODE.LEGACY) {
      directCompatibilityDecision =
        PLANNER_DIRECT_COMPATIBILITY_RUNTIME.evaluateDirectCall(normalizedName);
      PLANNER_DIRECT_COMPATIBILITY_RUNTIME.recordDecision(
        directCompatibilityDecision
      );
      if (directCompatibilityDecision.mode === DIRECT_COMPATIBILITY_MODE.DENY) {
        const familyKey = normalizeToolName(directCompatibilityDecision.family_key);
        PLANNER_ONLY_EXPOSURE_POLICY.completeToolCall(plannerOnlyExposureTracking, {
          error: true,
          dispatch_result: {
            status: "failed",
            error_code: "E_PRECONDITION_FAILED",
          },
        });
        throw new Error(
          `Tool blocked by planner direct compatibility policy: ${normalizedName}` +
            (familyKey ? ` (family=${familyKey})` : "")
        );
      }
    }

    let dispatchResult = null;
    try {
      dispatchResult = await this.getCommandRegistry().dispatchMcpTool({
        name: normalizedName,
        args: args && typeof args === "object" ? args : {},
        server: this,
      });

      if (entryGovernanceDecision.decision === "observe") {
        dispatchResult = attachEntryGovernanceObserveWarning(
          dispatchResult,
          buildEntryGovernanceObserveWarningPayload(normalizedName)
        );
      }
      if (
        directCompatibilityDecision &&
        directCompatibilityDecision.mode === DIRECT_COMPATIBILITY_MODE.WARN
      ) {
        dispatchResult = attachDirectCompatibilityWarningToMcpResult(
          dispatchResult,
          buildDirectCompatibilityWarningPayload(directCompatibilityDecision)
        );
      }
      PLANNER_ONLY_EXPOSURE_POLICY.completeToolCall(plannerOnlyExposureTracking, {
        dispatch_result: dispatchResult,
      });
      return dispatchResult;
    } catch (error) {
      PLANNER_ONLY_EXPOSURE_POLICY.completeToolCall(plannerOnlyExposureTracking, {
        error: true,
      });
      throw error;
    }
  }

  async callToolByName(name, args) {
    return this.callTool({
      name,
      arguments: args && typeof args === "object" ? args : {},
    });
  }

  async submitUnityTask(args) {
    return this.callToolByName("submit_unity_task", args);
  }

  async getUnityTaskStatus(args) {
    return this.callToolByName("get_unity_task_status", args);
  }

  async cancelUnityTask(args) {
    return this.callToolByName("cancel_unity_task", args);
  }

  async applyScriptActions(args) {
    return this.callToolByName("apply_script_actions", args);
  }

  async applyVisualActions(args) {
    return this.callToolByName("apply_visual_actions", args);
  }

  async setUiProperties(args) {
    return this.callToolByName("set_ui_properties", args);
  }

  async setSerializedProperty(args) {
    return this.callToolByName("set_serialized_property", args);
  }

  async getCurrentSelection(args) {
    return this.callToolByName("get_current_selection", args);
  }

  async getGameObjectComponents(args) {
    return this.callToolByName("get_gameobject_components", args);
  }

  async getHierarchySubtree(args) {
    return this.callToolByName("get_hierarchy_subtree", args);
  }

  async listAssetsInFolder(args) {
    return this.callToolByName("list_assets_in_folder", args);
  }

  async getSceneRoots(args) {
    return this.callToolByName("get_scene_roots", args);
  }

  async findObjectsByComponent(args) {
    return this.callToolByName("find_objects_by_component", args);
  }

  async queryPrefabInfo(args) {
    return this.callToolByName("query_prefab_info", args);
  }

  async getActionCatalog(args) {
    return this.callToolByName("get_action_catalog", args);
  }

  async getActionSchema(args) {
    return this.callToolByName("get_action_schema", args);
  }

  async getToolSchema(args) {
    return this.callToolByName("get_tool_schema", args);
  }

  async getWriteContractBundle(args) {
    return this.callToolByName("get_write_contract_bundle", args);
  }

  async preflightValidateWritePayload(args) {
    return this.callToolByName("preflight_validate_write_payload", args);
  }

  async setupCursorMcp(args) {
    return this.callToolByName("setup_cursor_mcp", args);
  }

  async verifyMcpSetup(args) {
    return this.callToolByName("verify_mcp_setup", args);
  }

  async captureSceneScreenshot(args) {
    return this.callToolByName("capture_scene_screenshot", args);
  }

  async getUiTree(args) {
    return this.callToolByName("get_ui_tree", args);
  }

  async getUiOverlayReport(args) {
    return this.callToolByName("get_ui_overlay_report", args);
  }

  async getSerializedPropertyTree(args) {
    return this.callToolByName("get_serialized_property_tree", args);
  }

  async hitTestUiAtViewportPoint(args) {
    return this.callToolByName("hit_test_ui_at_viewport_point", args);
  }

  async validateUiLayout(args) {
    return this.callToolByName("validate_ui_layout", args);
  }

  async hitTestUiAtScreenPoint(args) {
    return this.callToolByName("hit_test_ui_at_screen_point", args);
  }

  httpRequest(method, url, body = null) {
    return new Promise((resolve, reject) => {
      const options = {
        method,
        headers: {
          "Content-Type": "application/json",
        },
      };

      if (body && method !== "GET") {
        options.headers["Content-Length"] = Buffer.byteLength(
          JSON.stringify(body)
        );
      }

      const client = url.protocol === "https:" ? https : http;
      const req = client.request(url, options, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          const statusCode =
            Number.isFinite(Number(res.statusCode)) && Number(res.statusCode) > 0
              ? Math.floor(Number(res.statusCode))
              : 0;
          let parsed = null;
          if (!data) {
            parsed = {};
          } else {
            try {
              parsed = JSON.parse(data);
            } catch (err) {
              if (statusCode >= 200 && statusCode < 300) {
                reject(new Error(`Failed to parse response: ${err.message}`));
                return;
              }
            }
          }

          if (statusCode >= 200 && statusCode < 300) {
            resolve(parsed && typeof parsed === "object" ? parsed : {});
            return;
          }

          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            resolve(parsed);
            return;
          }

          const fallbackMessage =
            typeof data === "string" && data.trim()
              ? data.trim()
              : `HTTP ${statusCode || 0}`;
          resolve({
            status: "rejected",
            error_code: statusCode > 0 ? `E_HTTP_${statusCode}` : "E_HTTP_ERROR",
            error_message: fallbackMessage,
            message: fallbackMessage,
            suggestion:
              "Inspect sidecar HTTP response and retry with a valid payload.",
            recoverable: statusCode >= 500,
          });
        });
      });

      req.on("error", (err) => {
        reject(new Error(`HTTP request failed: ${err.message}`));
      });

      if (body && method !== "GET") {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  sendResponse(response) {
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  sendError(err, originalMessage, requestId) {
    if (requestId === null || requestId === undefined) {
      return;
    }
    const errorResponse = {
      jsonrpc: "2.0",
      id: requestId,
      error: {
        code: err.code || -32601,
        message: err.message || "Parse error",
      },
    };
    process.stderr.write(
      `MCP Server Error: ${err.message}\nOriginal: ${originalMessage || ""}\n`
    );
    process.stdout.write(JSON.stringify(errorResponse) + "\n");
  }
}

if (require.main === module) {
  const sidecarBaseUrl =
    process.env.SIDECAR_BASE_URL || "http://127.0.0.1:46321";
  const server = new UnityMcpServer(sidecarBaseUrl);
  void server;
  process.stderr.write(
    `Unity MCP Server started (Sidecar: ${sidecarBaseUrl})\n`
  );
}

module.exports = { UnityMcpServer };

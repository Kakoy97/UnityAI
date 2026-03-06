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
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT,
} = require("../ports/contracts");

function normalizeToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

const MCP_DEPRECATED_TOOL_NAMES = Object.freeze(
  ROUTER_PROTOCOL_FREEZE_CONTRACT &&
    Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names)
    ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    : []
);
const MCP_DEPRECATED_TOOL_NAME_SET = new Set(MCP_DEPRECATED_TOOL_NAMES);
const MCP_SECURITY_ALLOWLIST_TOOL_NAMES = Object.freeze(
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT &&
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.security_allowlist)
    ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.security_allowlist
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    : []
);
const MCP_SECURITY_ALLOWLIST_TOOL_NAME_SET = new Set(
  MCP_SECURITY_ALLOWLIST_TOOL_NAMES
);
const MCP_DISABLED_TOOL_NAMES = Object.freeze(
  MCP_TOOL_VISIBILITY_FREEZE_CONTRACT &&
    Array.isArray(MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools)
    ? MCP_TOOL_VISIBILITY_FREEZE_CONTRACT.disabled_tools
        .map((item) => normalizeToolName(item))
        .filter((item) => !!item)
    : []
);
const MCP_DISABLED_TOOL_NAME_SET = new Set(MCP_DISABLED_TOOL_NAMES);

function isToolAllowedByVisibilityContract(name) {
  const normalized = normalizeToolName(name);
  if (!normalized) {
    return false;
  }
  if (MCP_DEPRECATED_TOOL_NAME_SET.has(normalized)) {
    return false;
  }
  if (
    MCP_SECURITY_ALLOWLIST_TOOL_NAME_SET.size > 0 &&
    !MCP_SECURITY_ALLOWLIST_TOOL_NAME_SET.has(normalized)
  ) {
    return false;
  }
  return !MCP_DISABLED_TOOL_NAME_SET.has(normalized);
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
    return isToolAllowedByVisibilityContract(normalized);
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
    if (MCP_DEPRECATED_TOOL_NAME_SET.has(normalizedName)) {
      throw new Error(`Tool removed in phase6: ${normalizedName}`);
    }
    if (!this.isToolVisibleByPolicy(normalizedName)) {
      throw new Error(`Tool not enabled by visibility policy: ${normalizedName}`);
    }
    return this.getCommandRegistry().dispatchMcpTool({
      name: normalizedName,
      args: args && typeof args === "object" ? args : {},
      server: this,
    });
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

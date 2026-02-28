#!/usr/bin/env node
"use strict";

/**
 * MCP Server Wrapper for Unity Sidecar
 * * This server bridges Cursor's MCP protocol to the existing Sidecar HTTP REST API.
 * It uses stdio for communication with Cursor using JSON-Lines format.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");
const readline = require("readline");
const {
  ROUTER_PROTOCOL_FREEZE_CONTRACT,
} = require("../ports/contracts");

const MCP_WRITE_TOOL_ENDPOINTS = Object.freeze({
  submit_unity_task: "/mcp/submit_unity_task",
  apply_script_actions: "/mcp/apply_script_actions",
  apply_visual_actions: "/mcp/apply_visual_actions",
});
const MCP_WRITE_TOOL_NAMES = Object.freeze(
  Object.keys(MCP_WRITE_TOOL_ENDPOINTS)
);
const MCP_READ_TOOL_ENDPOINTS = Object.freeze({
  list_assets_in_folder: "/mcp/list_assets_in_folder",
  get_scene_roots: "/mcp/get_scene_roots",
  find_objects_by_component: "/mcp/find_objects_by_component",
  query_prefab_info: "/mcp/query_prefab_info",
});
const MCP_DEPRECATED_TOOL_NAMES = Object.freeze(
  ROUTER_PROTOCOL_FREEZE_CONTRACT &&
  Array.isArray(ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names)
    ? ROUTER_PROTOCOL_FREEZE_CONTRACT.deprecated_mcp_tool_names
    : []
);

class UnityMcpServer {
  constructor(sidecarBaseUrl) {
    this.sidecarBaseUrl = sidecarBaseUrl || process.env.SIDECAR_BASE_URL || "http://127.0.0.1:46321";
    this.setupStdioHandlers();
  }

  setupStdioHandlers() {
    // MCP Stdio transport uses newline-delimited JSON (JSON-Lines), not Content-Length framing.
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });

    rl.on("line", (line) => {
      if (!line || line.trim() === "") return;
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

    // 错误处理
    process.on("SIGINT", () => {
      process.exit(0);
    });
  }

  async handleMessage(message) {
    try {
      const isNotification = !('id' in message);
      const response = await this.processRequest(message);
      
      // JSON-RPC 要求：只对包含 id 的 request 进行响应，不响应 notification
      if (!isNotification && response) {
        this.sendResponse(response);
      }
    } catch (err) {
      if ('id' in message) {
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
        case "initialize":
          {
            const capabilities = {
              tools: {},
            };
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities,
              serverInfo: {
                name: "unity-sidecar",
                version: "0.1.0",
              },
            },
          };
          }
        
        case "notifications/initialized":
          // 客户端初始化完成后的通知，直接忽略
          return null;

        case "ping":
          // Cursor 保持心跳的请求
          return {
            jsonrpc: "2.0",
            id,
            result: {}
          };

        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              tools: this.getToolDefinitions(),
            },
          };

        case "tools/call":
          const toolResult = await this.callTool(params);
          return {
            jsonrpc: "2.0",
            id,
            result: toolResult,
          };

        case "resources/list":
          throw new Error("resources/list is removed; use MCP read tools");

        case "resources/read":
          throw new Error("resources/read is removed; use MCP read tools");

        default:
          if (!id) return null; // 忽略未知的通知
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

  getToolDefinitions() {
    const tools = [
      {
        name: "submit_unity_task",
        description:
          "Submit an asynchronous Unity write job. You must provide based_on_read_token and top-level write_anchor (object_id + path). This endpoint only accepts explicit file_actions/visual_layer_actions; task_allocation is not supported.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            thread_id: {
              type: "string",
              description: "Thread identifier for conversation context",
            },
            idempotency_key: {
              type: "string",
              description:
                "Idempotency key for deduplication. Required. If a job with the same key exists, the existing job_id will be returned.",
            },
            approval_mode: {
              type: "string",
              enum: ["auto", "require_user"],
              default: "auto",
              description:
                "Approval mode: 'auto' for automatic execution (recommended for MCP), 'require_user' for manual confirmation (may cause deadlock).",
            },
            user_intent: {
              type: "string",
              description: "Natural language description of what the user wants to accomplish",
            },
            based_on_read_token: {
              type: "string",
              description:
                "Read token from MCP eyes tools. Required for every write submission.",
            },
            write_anchor: {
              type: "object",
              description:
                "Top-level write anchor. Must contain both object_id and path.",
              additionalProperties: false,
              properties: {
                object_id: { type: "string" },
                path: { type: "string" },
              },
              required: ["object_id", "path"],
            },
            context: {
              type: "object",
              description:
                "Optional explicit Unity context. If omitted, sidecar uses latest reported selection context.",
            },
            file_actions: {
              type: "array",
              description:
                "Optional file actions. At least one of file_actions or visual_layer_actions must be non-empty.",
              items: { type: "object" },
            },
            visual_layer_actions: {
              type: "array",
              description:
                "Optional visual actions. At least one of file_actions or visual_layer_actions must be non-empty.",
              items: { type: "object" },
            },
          },
          required: [
            "thread_id",
            "idempotency_key",
            "user_intent",
            "based_on_read_token",
            "write_anchor",
          ],
          oneOf: [{ required: ["file_actions"] }, { required: ["visual_layer_actions"] }],
        },
      },
      {
        name: "get_unity_task_status",
        description:
          "Get the current status of a Unity task. This is a fallback query endpoint. For real-time updates, use the SSE stream endpoint. Use this only when SSE is unavailable or for reconnection recovery.",
        inputSchema: {
          type: "object",
          properties: {
            job_id: {
              type: "string",
              description: "Job identifier returned from submit_unity_task",
            },
          },
          required: ["job_id"],
        },
      },
      {
        name: "cancel_unity_task",
        description: "Cancel a running or queued Unity task",
        inputSchema: {
          type: "object",
          properties: {
            job_id: {
              type: "string",
              description: "Job identifier to cancel",
            },
          },
          required: ["job_id"],
        },
      },
      {
        name: "apply_script_actions",
        description:
          "Apply structured script/file actions. Hard requirements: based_on_read_token + top-level write_anchor(object_id+path). This endpoint does not accept task_allocation.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            based_on_read_token: {
              type: "string",
              description:
                "Read token from MCP eyes tools. Required for every write request.",
            },
            write_anchor: {
              type: "object",
              description:
                "Top-level write anchor. Must contain both object_id and path.",
              additionalProperties: false,
              properties: {
                object_id: { type: "string" },
                path: { type: "string" },
              },
              required: ["object_id", "path"],
            },
            actions: {
              type: "array",
              description: "Script/file actions (create/update/rename/delete).",
              items: {
                type: "object",
              },
            },
            preconditions: {
              type: "array",
              description:
                "Optional preconditions: object_exists/component_exists/compile_idle.",
              items: {
                type: "object",
              },
            },
            dry_run: {
              type: "boolean",
              description: "If true, only validate and report plan without executing.",
            },
            thread_id: {
              type: "string",
              description: "Optional thread id override.",
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key override.",
            },
            user_intent: {
              type: "string",
              description: "Optional user intent for async job traceability.",
            },
            approval_mode: {
              type: "string",
              enum: ["auto", "require_user"],
              description: "Optional approval mode. Default auto.",
            },
          },
          required: ["based_on_read_token", "write_anchor", "actions"],
        },
      },
      {
        name: "apply_visual_actions",
        description:
          "Apply structured Unity visual actions. Hard requirements: based_on_read_token + top-level write_anchor(object_id+path). Actions follow strict oneOf anchor rules: mutation requires target_anchor; create_gameobject requires parent_anchor.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            based_on_read_token: {
              type: "string",
              description:
                "Read token from MCP eyes tools. Required for every write request.",
            },
            write_anchor: {
              type: "object",
              description:
                "Top-level write anchor. Must contain both object_id and path.",
              additionalProperties: false,
              properties: {
                object_id: { type: "string" },
                path: { type: "string" },
              },
              required: ["object_id", "path"],
            },
            actions: {
              type: "array",
              description: "Visual actions with strict anchor union schema.",
              items: {
                type: "object",
                oneOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      type: {
                        type: "string",
                        enum: ["add_component", "remove_component", "replace_component"],
                      },
                      target: { type: "string" },
                      target_anchor: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          object_id: { type: "string" },
                          path: { type: "string" },
                        },
                        required: ["object_id", "path"],
                      },
                      component_name: { type: "string" },
                      component_assembly_qualified_name: { type: "string" },
                      source_component_assembly_qualified_name: { type: "string" },
                      remove_mode: { type: "string" },
                      expected_count: { type: "integer" },
                    },
                    required: ["type", "target_anchor"],
                  },
                  {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      type: { type: "string", const: "create_gameobject" },
                      target: { type: "string" },
                      parent_anchor: {
                        type: "object",
                        additionalProperties: false,
                        properties: {
                          object_id: { type: "string" },
                          path: { type: "string" },
                        },
                        required: ["object_id", "path"],
                      },
                      name: { type: "string" },
                      primitive_type: { type: "string" },
                      ui_type: { type: "string" },
                    },
                    required: ["type", "parent_anchor", "name"],
                  },
                ],
              },
            },
            preconditions: {
              type: "array",
              description:
                "Optional preconditions: object_exists/component_exists/compile_idle.",
              items: {
                type: "object",
              },
            },
            dry_run: {
              type: "boolean",
              description: "If true, only validate and report plan without executing.",
            },
            thread_id: {
              type: "string",
              description: "Optional thread id override.",
            },
            idempotency_key: {
              type: "string",
              description: "Optional idempotency key override.",
            },
            user_intent: {
              type: "string",
              description: "Optional user intent for async job traceability.",
            },
            approval_mode: {
              type: "string",
              enum: ["auto", "require_user"],
              description: "Optional approval mode. Default auto.",
            },
          },
          required: ["based_on_read_token", "write_anchor", "actions"],
        },
      },
    ];

    tools.push(
      {
        name: "list_assets_in_folder",
        description:
          "List project assets under a folder path in Unity AssetDatabase. Use this before guessing file paths or prefab/script locations. When you need to discover candidate assets, call this first instead of assuming names.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            folder_path: {
              type: "string",
              description:
                "Required Unity project folder path, e.g. Assets/Prefabs or Assets/Scripts.",
            },
            recursive: {
              type: "boolean",
              description:
                "Whether to traverse subfolders recursively. Default false if omitted.",
            },
            include_meta: {
              type: "boolean",
              description:
                "Whether .meta files should be included. Usually false.",
            },
            limit: {
              type: "integer",
              description:
                "Optional max number of returned entries. Must be >= 1.",
            },
          },
          required: ["folder_path"],
        },
      },
      {
        name: "get_scene_roots",
        description:
          "Get root GameObjects of a loaded scene, including object_id/path anchors. Use this to establish reliable hierarchy anchors before downstream reads or writes.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            scene_path: {
              type: "string",
              description:
                "Optional scene asset path. If omitted, returns roots across currently loaded scenes.",
            },
            include_inactive: {
              type: "boolean",
              description:
                "Whether inactive roots are included. Default true if omitted.",
            },
          },
        },
      },
      {
        name: "find_objects_by_component",
        description:
          "Find scene objects by component type/name match. When you need objects with specific behavior, use this tool instead of guessing object names from hierarchy text.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            component_query: {
              type: "string",
              description:
                "Required component search term, e.g. Rigidbody, Button, UnityEngine.UI.Image.",
            },
            scene_path: {
              type: "string",
              description:
                "Optional scene asset path to narrow search scope.",
            },
            under_path: {
              type: "string",
              description:
                "Optional hierarchy path prefix to constrain search subtree.",
            },
            include_inactive: {
              type: "boolean",
              description:
                "Whether inactive objects are included. Default true if omitted.",
            },
            limit: {
              type: "integer",
              description:
                "Optional max number of matches. Must be >= 1.",
            },
          },
          required: ["component_query"],
        },
      },
      {
        name: "query_prefab_info",
        description:
          "Inspect prefab tree structure and components with explicit depth budget. When parsing nested prefab hierarchies, call this tool and pass max_depth deliberately based on complexity. Do not guess deep structure without querying it.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            prefab_path: {
              type: "string",
              description:
                "Required prefab asset path, e.g. Assets/Prefabs/UI/MainPanel.prefab.",
            },
            max_depth: {
              type: "integer",
              description:
                "Required traversal depth budget (>=0). Must be explicitly provided each call.",
            },
            node_budget: {
              type: "integer",
              description:
                "Optional max node budget (>=1).",
            },
            char_budget: {
              type: "integer",
              description:
                "Optional output character budget (>=256).",
            },
            include_components: {
              type: "boolean",
              description:
                "Whether component descriptors are included. Default true if omitted.",
            },
            include_missing_scripts: {
              type: "boolean",
              description:
                "Whether missing-script placeholders are included. Default true if omitted.",
            },
          },
          required: ["prefab_path", "max_depth"],
        },
      }
    );

    return tools;
  }

  async callTool(params) {
    const { name, arguments: args } = params || {};
    if (MCP_DEPRECATED_TOOL_NAMES.includes(name)) {
      throw new Error(`Tool removed in phase6: ${name}`);
    }

    switch (name) {
      case "submit_unity_task":
        return await this.submitUnityTask(args);
      case "get_unity_task_status":
        return await this.getUnityTaskStatus(args);
      case "cancel_unity_task":
        return await this.cancelUnityTask(args);
      case "apply_script_actions":
        return await this.applyScriptActions(args);
      case "apply_visual_actions":
        return await this.applyVisualActions(args);
      case "list_assets_in_folder":
        return await this.listAssetsInFolder(args);
      case "get_scene_roots":
        return await this.getSceneRoots(args);
      case "find_objects_by_component":
        return await this.findObjectsByComponent(args);
      case "query_prefab_info":
        return await this.queryPrefabInfo(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async submitUnityTask(args) {
    return this.callMcpWriteTool("submit_unity_task", args);
  }

  async getUnityTaskStatus(args) {
    const { job_id } = args;
    const url = new URL(`${this.sidecarBaseUrl}/mcp/get_unity_task_status`);
    url.searchParams.set("job_id", job_id);
    const response = await this.httpRequest("GET", url);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async cancelUnityTask(args) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/cancel_unity_task`);
    const response = await this.httpRequest("POST", url, args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async applyScriptActions(args) {
    return this.callMcpWriteTool("apply_script_actions", args);
  }

  async applyVisualActions(args) {
    return this.callMcpWriteTool("apply_visual_actions", args);
  }

  async callMcpWriteTool(toolName, args) {
    if (!MCP_WRITE_TOOL_NAMES.includes(toolName)) {
      throw new Error(`Unknown MCP write tool mapping: ${toolName}`);
    }
    const endpoint = MCP_WRITE_TOOL_ENDPOINTS[toolName];
    const url = new URL(`${this.sidecarBaseUrl}${endpoint}`);
    const payload = args && typeof args === "object" ? args : {};
    const response = await this.httpRequest("POST", url, payload);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async getCurrentSelection(args) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/get_current_selection`);
    const response = await this.httpRequest("POST", url, args || {});
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async listAssetsInFolder(args) {
    return this.callMcpReadTool("list_assets_in_folder", args);
  }

  async getSceneRoots(args) {
    return this.callMcpReadTool("get_scene_roots", args);
  }

  async findObjectsByComponent(args) {
    return this.callMcpReadTool("find_objects_by_component", args);
  }

  async queryPrefabInfo(args) {
    return this.callMcpReadTool("query_prefab_info", args);
  }

  async callMcpReadTool(toolName, args) {
    const endpoint = MCP_READ_TOOL_ENDPOINTS[toolName];
    if (!endpoint) {
      throw new Error(`Unknown MCP read tool mapping: ${toolName}`);
    }
    const url = new URL(`${this.sidecarBaseUrl}${endpoint}`);
    const payload = args && typeof args === "object" ? args : {};
    const response = await this.httpRequest("POST", url, payload);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async getGameObjectComponents(args) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/get_gameobject_components`);
    const payload = args && typeof args === "object" ? args : {};
    const response = await this.httpRequest("POST", url, payload);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async getHierarchySubtree(args) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/get_hierarchy_subtree`);
    const payload = args && typeof args === "object" ? args : {};
    const response = await this.httpRequest("POST", url, payload);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async getPrefabInfo(args) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/get_prefab_info`);
    const payload = args && typeof args === "object" ? args : {};
    const response = await this.httpRequest("POST", url, payload);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async getCompileState(args) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/get_compile_state`);
    const payload = args && typeof args === "object" ? args : {};
    const response = await this.httpRequest("POST", url, payload);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async getConsoleErrors(args) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/get_console_errors`);
    const payload = args && typeof args === "object" ? args : {};
    const response = await this.httpRequest("POST", url, payload);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }

  async listResources() {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/resources/list`);
    const response = await this.httpRequest("GET", url);
    if (response && Array.isArray(response.resources)) {
      return {
        resources: response.resources,
      };
    }
    return {
      resources: [],
    };
  }

  async readResource(params) {
    const uri =
      params && typeof params.uri === "string" ? params.uri.trim() : "";
    if (!uri) {
      throw new Error("resources/read requires params.uri");
    }
    const url = new URL(`${this.sidecarBaseUrl}/mcp/resources/read`);
    url.searchParams.set("uri", uri);
    const response = await this.httpRequest("GET", url);
    if (response && Array.isArray(response.contents)) {
      return {
        contents: response.contents,
      };
    }
    return {
      contents: [],
    };
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
    // 改为使用换行符分隔的 JSON
    process.stdout.write(JSON.stringify(response) + "\n");
  }

  sendError(err, originalMessage, requestId) {
    if (requestId === null || requestId === undefined) return;
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

// 主入口
if (require.main === module) {
  const sidecarBaseUrl =
    process.env.SIDECAR_BASE_URL || "http://127.0.0.1:46321";
  const server = new UnityMcpServer(sidecarBaseUrl);
  process.stderr.write(
    `Unity MCP Server started (Sidecar: ${sidecarBaseUrl})\n`
  );
}

module.exports = { UnityMcpServer };

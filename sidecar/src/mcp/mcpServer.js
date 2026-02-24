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
    return [
      {
        name: "submit_unity_task",
        description:
          "Submit a Unity task for execution. This includes file actions (create/update/rename/delete scripts) and visual actions (add/remove/replace components, create GameObjects). The task will be executed asynchronously, and progress will be pushed via SSE stream.",
        inputSchema: {
          type: "object",
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
            task_allocation: {
              type: "object",
              description: "Structured task allocation with reasoning and actions",
              properties: {
                reasoning_and_plan: {
                  type: "string",
                  description: "Reasoning and plan for the task",
                },
                file_actions: {
                  type: "array",
                  description: "File actions to execute",
                  items: {
                    type: "object",
                    properties: {
                      type: {
                        type: "string",
                        enum: ["create_file", "update_file", "rename_file", "delete_file"],
                      },
                      path: { type: "string" },
                      content: { type: "string" },
                      new_path: { type: "string" },
                    },
                  },
                },
                visual_actions: {
                  type: "array",
                  description: "Visual actions to execute in Unity",
                  items: {
                    type: "object",
                    properties: {
                      type: {
                        type: "string",
                        enum: [
                          "add_component",
                          "remove_component",
                          "replace_component",
                          "create_gameobject",
                        ],
                      },
                      target_path: { type: "string" },
                      component_type: { type: "string" },
                      source_component_type: { type: "string" },
                    },
                  },
                },
              },
              required: ["reasoning_and_plan"],
            },
          },
          required: ["thread_id", "idempotency_key", "user_intent"],
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
    ];
  }

  async callTool(params) {
    const { name, arguments: args } = params;

    switch (name) {
      case "submit_unity_task":
        return await this.submitUnityTask(args);
      case "get_unity_task_status":
        return await this.getUnityTaskStatus(args);
      case "cancel_unity_task":
        return await this.cancelUnityTask(args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  async submitUnityTask(args) {
    const url = new URL(`${this.sidecarBaseUrl}/mcp/submit_unity_task`);
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
          try {
            const parsed = data ? JSON.parse(data) : {};
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(
                new Error(
                  `HTTP ${res.statusCode}: ${parsed.message || parsed.error || data}`
                )
              );
            }
          } catch (err) {
            reject(new Error(`Failed to parse response: ${err.message}`));
          }
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
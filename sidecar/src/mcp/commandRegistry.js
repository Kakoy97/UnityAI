"use strict";

const { MCP_COMMAND_DEFINITIONS } = require("./commands");

function normalizeMethod(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toUpperCase();
}

function normalizePath(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeName(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return value;
  }
  for (const key of Object.keys(value)) {
    deepFreeze(value[key]);
  }
  return value;
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function validateCommandDefinitionContract(command) {
  if (!command || typeof command !== "object") {
    throw new Error("Invalid MCP command definition: definition must be an object");
  }
  const name = normalizeName(command.name) || "<unknown>";
  const turnServiceMethod =
    typeof command.turnServiceMethod === "string"
      ? command.turnServiceMethod.trim()
      : "";
  if (!turnServiceMethod) {
    throw new Error(
      `Invalid MCP command definition '${name}': turnServiceMethod is required`
    );
  }
  if (typeof command.validate !== "function") {
    throw new Error(
      `Invalid MCP command definition '${name}': validate function is required`
    );
  }
  if (hasOwn(command, "execute") || hasOwn(command, "handler")) {
    throw new Error(
      `Invalid MCP command definition '${name}': legacy execute/handler entry is not allowed`
    );
  }
}

class McpCommandRegistry {
  constructor(definitions) {
    const source = Array.isArray(definitions) ? definitions : [];
    this._commands = source
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        validateCommandDefinitionContract(item);
        return Object.freeze({ ...item });
      });
    this._byName = new Map();
    this._byHttpSignature = new Map();
    for (const command of this._commands) {
      const name = normalizeName(command.name);
      if (!name || this._byName.has(name)) {
        continue;
      }
      this._byName.set(name, command);
      const method = normalizeMethod(command.http && command.http.method);
      const path = normalizePath(command.http && command.http.path);
      if (method && path) {
        this._byHttpSignature.set(`${method} ${path}`, command);
      }
    }
    this._toolTemplateByName = new Map();
    this._toolsListTemplateCache = Object.freeze(
      this._commands
        .filter((command) => command.mcp && command.mcp.expose === true)
        .map((command) => {
          const fullSchema =
            command.mcp && command.mcp.inputSchema
              ? deepFreeze(cloneJson(command.mcp.inputSchema))
              : deepFreeze({ type: "object", properties: {} });
          const template = Object.freeze({
            name: command.name,
            kind: normalizeName(command.kind).toLowerCase(),
            lifecycle: normalizeName(command.lifecycle).toLowerCase(),
            http:
              command.http && typeof command.http === "object"
                ? Object.freeze({
                    method: normalizeMethod(command.http.method),
                    path: normalizePath(command.http.path),
                    source: normalizeName(command.http.source).toLowerCase(),
                    queryKey:
                      typeof command.http.queryKey === "string"
                        ? command.http.queryKey.trim()
                        : "",
                  })
                : Object.freeze({
                    method: "",
                    path: "",
                    source: "",
                    queryKey: "",
                  }),
            descriptionSource: command.mcp.description,
            fullSchema,
          });
          this._toolTemplateByName.set(template.name, template);
          return template;
        })
    );
  }

  listCommands() {
    return [...this._commands];
  }

  listMcpToolNames() {
    return this._commands
      .filter((item) => item.mcp && item.mcp.expose === true)
      .map((item) => normalizeName(item.name))
      .filter((item) => !!item);
  }

  listExposedMcpToolNames() {
    return this.listMcpToolNames();
  }

  listHttpRoutes() {
    return this._commands
      .map((item) => ({
        method: normalizeMethod(item.http && item.http.method),
        path: normalizePath(item.http && item.http.path),
      }))
      .filter((item) => !!item.method && !!item.path);
  }

  getCommandByName(name) {
    const normalized = normalizeName(name);
    if (!normalized) {
      return null;
    }
    return this._byName.get(normalized) || null;
  }

  getCommandByHttp(method, path) {
    const signature = `${normalizeMethod(method)} ${normalizePath(path)}`;
    if (!signature.trim()) {
      return null;
    }
    return this._byHttpSignature.get(signature) || null;
  }

  getToolsListCache(context) {
    const ctx = context && typeof context === "object" ? context : {};
    return this._toolsListTemplateCache.map((template) => {
      const descriptionSource = template.descriptionSource;
      const description =
        typeof descriptionSource === "function"
          ? descriptionSource(ctx)
          : String(descriptionSource || "");
      return {
        name: template.name,
        description:
          typeof description === "string" ? description : String(description || ""),
        inputSchema: template.fullSchema,
      };
    });
  }

  getMcpToolDefinitions(context) {
    return this.getToolsListCache(context);
  }

  getToolMetadataByName(name, context) {
    const normalizedName = normalizeName(name);
    if (!normalizedName) {
      return null;
    }
    const template = this._toolTemplateByName.get(normalizedName);
    if (!template) {
      return null;
    }
    const command = this.getCommandByName(normalizedName);
    if (!command || !command.mcp || command.mcp.expose !== true) {
      return null;
    }
    const ctx = context && typeof context === "object" ? context : {};
    const descriptionSource = template.descriptionSource;
    const description =
      typeof descriptionSource === "function"
        ? descriptionSource(ctx)
        : String(descriptionSource || "");
    return {
      name: template.name,
      kind: template.kind,
      lifecycle: template.lifecycle,
      description: typeof description === "string" ? description : String(description || ""),
      transport: {
        method: template.http.method,
        path: template.http.path,
        source: template.http.source,
        query_key: template.http.queryKey,
      },
      input_schema: template.fullSchema,
      tools_list_input_schema: template.fullSchema,
    };
  }

  async dispatchHttpCommand(params) {
    const p = params && typeof params === "object" ? params : {};
    const command = this.getCommandByHttp(p.method, p.path);
    if (!command) {
      return null;
    }

    const turnService = p.turnService;
    if (!turnService || typeof turnService !== "object") {
      return {
        statusCode: 500,
        body: {
          error_code: "E_INTERNAL",
          message: "turnService is unavailable",
        },
      };
    }

    const httpConfig = command.http && typeof command.http === "object"
      ? command.http
      : {};
    const source = normalizeName(httpConfig.source) || "body";
    let payload = {};
    if (source === "query") {
      const queryKey =
        typeof httpConfig.queryKey === "string" ? httpConfig.queryKey.trim() : "";
      payload = queryKey
        ? { [queryKey]: p.url && p.url.searchParams ? p.url.searchParams.get(queryKey) : "" }
        : {};
    } else {
      const readJsonBody = p.readJsonBody;
      if (typeof readJsonBody !== "function") {
        return {
          statusCode: 500,
          body: {
            error_code: "E_INTERNAL",
            message: "readJsonBody is unavailable",
          },
        };
      }
      payload = await readJsonBody(p.req);
    }

    if (typeof turnService.recordMcpToolInvocation === "function") {
      turnService.recordMcpToolInvocation({
        command_name: command.name,
        command_kind: command.kind,
        command_lifecycle: command.lifecycle,
        payload,
        request_meta: {
          method: normalizeMethod(p.method),
          path: normalizePath(p.path),
        },
      });
    }

    if (typeof command.validate === "function") {
      const validation = command.validate(payload);
      if (!validation || validation.ok !== true) {
        if (typeof turnService.validationError === "function") {
          return turnService.validationError(validation || {});
        }
        return {
          statusCode:
            validation && Number.isFinite(Number(validation.statusCode))
              ? Math.floor(Number(validation.statusCode))
              : 400,
          body: {
            error_code:
              validation && typeof validation.errorCode === "string"
                ? validation.errorCode
                : "E_SSOT_SCHEMA_INVALID",
            message:
              validation && typeof validation.message === "string"
                ? validation.message
                : "Request schema invalid",
          },
        };
      }
      if (
        validation &&
        typeof validation === "object" &&
        Object.prototype.hasOwnProperty.call(validation, "value") &&
        validation.value !== undefined
      ) {
        payload = validation.value;
      }
    }

    const args = source === "query"
      ? payload[
          typeof httpConfig.queryKey === "string"
            ? httpConfig.queryKey.trim()
            : ""
        ]
      : payload;
    const methodName =
      typeof command.turnServiceMethod === "string"
        ? command.turnServiceMethod.trim()
        : "";
    const serviceHandler =
      methodName && typeof turnService[methodName] === "function"
        ? turnService[methodName].bind(turnService)
        : null;
    if (!serviceHandler) {
      return {
        statusCode: 500,
        body: {
          error_code: "E_INTERNAL",
          message: `turnService handler not found for command: ${command.name}`,
        },
      };
    }
    const outcome = await Promise.resolve(serviceHandler(args));
    if (
      outcome &&
      typeof outcome === "object" &&
      Number.isFinite(Number(outcome.statusCode))
    ) {
      return outcome;
    }
    return {
      statusCode: 500,
      body: {
        error_code: "E_INTERNAL",
        message: `Invalid command outcome for: ${command.name}`,
      },
    };
  }

  async dispatchMcpTool(params) {
    const p = params && typeof params === "object" ? params : {};
    const command = this.getCommandByName(p.name);
    if (!command || !command.mcp || command.mcp.expose !== true) {
      throw new Error(`Unknown tool: ${p.name}`);
    }
    const server = p.server;
    if (!server || typeof server !== "object") {
      throw new Error("MCP server context is unavailable");
    }

    const args = p.args && typeof p.args === "object" ? p.args : {};
    const httpConfig = command.http && typeof command.http === "object"
      ? command.http
      : {};
    const method = normalizeMethod(httpConfig.method);
    const path = normalizePath(httpConfig.path);
    if (!method || !path) {
      throw new Error(`Tool transport mapping is invalid: ${command.name}`);
    }

    const url = new URL(`${server.sidecarBaseUrl}${path}`);
    let response = null;
    if (method === "GET") {
      const queryKey =
        typeof httpConfig.queryKey === "string" ? httpConfig.queryKey.trim() : "";
      if (queryKey && Object.prototype.hasOwnProperty.call(args, queryKey)) {
        url.searchParams.set(queryKey, String(args[queryKey]));
      }
      response = await server.httpRequest("GET", url);
    } else {
      response = await server.httpRequest(method, url, args);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(response, null, 2),
        },
      ],
    };
  }
}

let singletonRegistry = null;

function getMcpCommandRegistry() {
  if (!singletonRegistry) {
    singletonRegistry = new McpCommandRegistry(MCP_COMMAND_DEFINITIONS);
  }
  return singletonRegistry;
}

module.exports = {
  McpCommandRegistry,
  getMcpCommandRegistry,
};

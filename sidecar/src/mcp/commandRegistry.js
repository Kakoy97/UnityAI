"use strict";

const { MCP_COMMAND_DEFINITIONS } = require("./commands");
const TOOLS_LIST_SCHEMA_COMPACT_GUIDANCE =
  "Input schema is compact in tools/list. Use get_tool_schema for full schema.";
const SCHEMA_STRIP_KEYS = new Set([
  "description",
  "default",
  "examples",
  "example",
  "title",
  "$schema",
  "$id",
  "$defs",
  "definitions",
  "deprecated",
  "readOnly",
  "writeOnly",
]);
const SCHEMA_BASE_KEYS = Object.freeze([
  "type",
  "additionalProperties",
  "required",
  "enum",
  "const",
  "format",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

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

function isObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
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

function copySchemaScalarValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item));
  }
  if (isObject(value)) {
    return cloneJson(value);
  }
  return value;
}

function compactSchemaNode(node, options, depth) {
  if (!isObject(node)) {
    return undefined;
  }
  const opts = options && typeof options === "object" ? options : {};
  const maxDepth =
    Number.isFinite(Number(opts.maxDepth)) && Number(opts.maxDepth) >= 1
      ? Math.floor(Number(opts.maxDepth))
      : 3;
  const maxPropertiesPerObject =
    Number.isFinite(Number(opts.maxPropertiesPerObject)) &&
    Number(opts.maxPropertiesPerObject) >= 1
      ? Math.floor(Number(opts.maxPropertiesPerObject))
      : 12;
  const maxCombinatorItems =
    Number.isFinite(Number(opts.maxCombinatorItems)) &&
    Number(opts.maxCombinatorItems) >= 1
      ? Math.floor(Number(opts.maxCombinatorItems))
      : 4;
  const result = {};

  for (const key of SCHEMA_BASE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(node, key)) {
      continue;
    }
    result[key] = copySchemaScalarValue(node[key]);
  }

  if (depth >= maxDepth) {
    return result;
  }

  if (isObject(node.properties)) {
    const rawKeys = Object.keys(node.properties);
    const required = Array.isArray(result.required) ? result.required : [];
    const importantKeySet = new Set(
      required.filter((item) => typeof item === "string")
    );
    for (const combinatorKey of ["oneOf", "anyOf", "allOf"]) {
      if (!Array.isArray(node[combinatorKey])) {
        continue;
      }
      for (const branch of node[combinatorKey]) {
        if (!isObject(branch) || !Array.isArray(branch.required)) {
          continue;
        }
        for (const item of branch.required) {
          if (typeof item === "string" && item.trim()) {
            importantKeySet.add(item.trim());
          }
        }
      }
    }
    const prioritizedKeys = [
      ...rawKeys.filter((key) => importantKeySet.has(key)),
      ...rawKeys.filter((key) => !importantKeySet.has(key)),
    ];
    const selectedKeys = prioritizedKeys.slice(0, maxPropertiesPerObject);
    const compactProperties = {};
    for (const propertyName of selectedKeys) {
      const compactProperty = compactSchemaNode(
        node.properties[propertyName],
        opts,
        depth + 1
      );
      if (compactProperty && typeof compactProperty === "object") {
        compactProperties[propertyName] = compactProperty;
      }
    }
    if (Object.keys(compactProperties).length > 0) {
      result.properties = compactProperties;
    }
  }

  if (Object.prototype.hasOwnProperty.call(node, "items")) {
    if (isObject(node.items)) {
      const compactItems = compactSchemaNode(node.items, opts, depth + 1);
      if (compactItems && typeof compactItems === "object") {
        result.items = compactItems;
      }
    } else {
      result.items = copySchemaScalarValue(node.items);
    }
  }

  for (const combinatorKey of ["oneOf", "anyOf", "allOf"]) {
    if (!Array.isArray(node[combinatorKey])) {
      continue;
    }
    const compactCombinator = node[combinatorKey]
      .slice(0, maxCombinatorItems)
      .map((entry) =>
        isObject(entry)
          ? compactSchemaNode(entry, opts, depth + 1)
          : copySchemaScalarValue(entry)
      )
      .filter((entry) => !!entry);
    if (compactCombinator.length > 0) {
      result[combinatorKey] = compactCombinator;
    }
  }

  for (const [key, value] of Object.entries(node)) {
    if (
      SCHEMA_BASE_KEYS.includes(key) ||
      key === "properties" ||
      key === "items" ||
      key === "oneOf" ||
      key === "anyOf" ||
      key === "allOf" ||
      SCHEMA_STRIP_KEYS.has(key)
    ) {
      continue;
    }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      result[key] = value;
    }
  }

  return result;
}

function buildToolsListSchema(command, fullSchema) {
  const kind = normalizeName(command && command.kind).toLowerCase();
  const profile =
    kind === "write"
      ? {
          maxDepth: 3,
          maxPropertiesPerObject: 8,
          maxCombinatorItems: 3,
        }
      : {
          maxDepth: 3,
          maxPropertiesPerObject: 12,
          maxCombinatorItems: 4,
        };
  const compact =
    compactSchemaNode(fullSchema, profile, 0) || { type: "object", properties: {} };
  return deepFreeze(compact);
}

class McpCommandRegistry {
  constructor(definitions) {
    const source = Array.isArray(definitions) ? definitions : [];
    this._commands = source
      .filter((item) => item && typeof item === "object")
      .map((item) => Object.freeze({ ...item }));
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
          const toolsListSchema = buildToolsListSchema(command, fullSchema);
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
            toolsListSchema,
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
    const schemaMode = ctx.toolsListSchemaMode === "full" ? "full" : "compact";
    const includeCompactSchemaGuidance =
      ctx.includeCompactSchemaGuidance !== false && schemaMode !== "full";
    return this._toolsListTemplateCache.map((template) => {
      const descriptionSource = template.descriptionSource;
      const description =
        typeof descriptionSource === "function"
          ? descriptionSource(ctx)
          : String(descriptionSource || "");
      const withGuidance =
        includeCompactSchemaGuidance &&
        template.kind === "write" &&
        template.name !== "get_tool_schema"
          ? `${description} ${TOOLS_LIST_SCHEMA_COMPACT_GUIDANCE}`.trim()
          : description;
      return {
        name: template.name,
        description:
          typeof withGuidance === "string"
            ? withGuidance
            : String(withGuidance || ""),
        inputSchema:
          schemaMode === "full" ? template.fullSchema : template.toolsListSchema,
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
      tools_list_input_schema: template.toolsListSchema,
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
                : "E_SCHEMA_INVALID",
            message:
              validation && typeof validation.message === "string"
                ? validation.message
                : "Request schema invalid",
          },
        };
      }
    }

    const args = source === "query"
      ? payload[
          typeof httpConfig.queryKey === "string"
            ? httpConfig.queryKey.trim()
            : ""
        ]
      : payload;
    const execute =
      typeof command.execute === "function" ? command.execute : null;
    const methodName =
      typeof command.turnServiceMethod === "string"
        ? command.turnServiceMethod.trim()
        : "";
    const serviceHandler =
      methodName && typeof turnService[methodName] === "function"
        ? turnService[methodName].bind(turnService)
        : null;
    if (!execute && !serviceHandler) {
      return {
        statusCode: 500,
        body: {
          error_code: "E_INTERNAL",
          message: `turnService handler not found for command: ${command.name}`,
        },
      };
    }

    const context = {
      command,
      commandName: command.name,
      commandRegistry: this,
      turnService,
      capabilityStore: turnService.capabilityStore,
      queryCoordinator: turnService.queryCoordinator,
      snapshotService: turnService.unitySnapshotService,
      nowIso:
        typeof turnService.nowIso === "function"
          ? turnService.nowIso.bind(turnService)
          : () => new Date().toISOString(),
      logger: p.logger && typeof p.logger === "object" ? p.logger : console,
      requestMeta: {
        method: normalizeMethod(p.method),
        path: normalizePath(p.path),
      },
      requestUrl: p.url || null,
    };
    const outcome = execute
      ? await Promise.resolve(execute(context, args))
      : await Promise.resolve(serviceHandler(args));
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

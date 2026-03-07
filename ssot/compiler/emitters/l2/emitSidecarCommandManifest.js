"use strict";

const LOCAL_STATIC_TOOL_NAMES = new Set([
  "get_action_catalog",
  "get_action_schema",
  "get_tool_schema",
  "get_write_contract_bundle",
  "preflight_validate_write_payload",
  "setup_cursor_mcp",
  "verify_mcp_setup",
]);

function normalizeToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildHttpTransport(toolName) {
  if (toolName === "get_unity_task_status") {
    return {
      method: "GET",
      path: "/mcp/get_unity_task_status",
      source: "query",
      queryKey: "job_id",
    };
  }
  return {
    method: "POST",
    path: `/mcp/${toolName}`,
    source: "body",
  };
}

function buildDispatchMode(toolName) {
  return LOCAL_STATIC_TOOL_NAMES.has(toolName) ? "local_static" : "ssot_query";
}

function normalizeTransactionPolicy(tool) {
  const source =
    tool && tool.transaction && typeof tool.transaction === "object" && !Array.isArray(tool.transaction)
      ? tool.transaction
      : {};
  return {
    enabled: source.enabled === true,
    undo_safe: source.undo_safe === true,
  };
}

function emitSidecarCommandManifest(dictionary) {
  const tools = Array.isArray(dictionary && dictionary.tools)
    ? dictionary.tools
    : [];
  return {
    version: dictionary && dictionary.version,
    commands: tools
      .map((tool) => {
        const toolName = normalizeToolName(tool && tool.name);
        if (!toolName) {
          return null;
        }
        return {
          name: toolName,
          kind: normalizeToolName(tool && tool.kind) || "write",
          lifecycle: normalizeToolName(tool && tool.lifecycle) || "stable",
          dispatch_mode: buildDispatchMode(toolName),
          http: buildHttpTransport(toolName),
          transaction: normalizeTransactionPolicy(tool),
        };
      })
      .filter((item) => !!item),
  };
}

module.exports = {
  emitSidecarCommandManifest,
};

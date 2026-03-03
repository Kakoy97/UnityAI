"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_SIDECAR_BASE_URL = "http://127.0.0.1:46321";
const UNITY_SERVER_NAME = "unity-sidecar";
const SUPPORTED_MODES = new Set(["native", "cline", "auto"]);

function createError(errorCode, message, statusCode = 400) {
  const err = new Error(message || "cursor mcp setup failed");
  err.errorCode = errorCode || "E_CURSOR_MCP_SETUP_FAILED";
  err.statusCode =
    Number.isFinite(Number(statusCode)) && Number(statusCode) > 0
      ? Math.floor(Number(statusCode))
      : 400;
  return err;
}

function normalizeMode(value, fallback = "native") {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (!SUPPORTED_MODES.has(normalized)) {
    return fallback;
  }
  return normalized;
}

function normalizeSidecarBaseUrl(value) {
  const candidate =
    typeof value === "string" && value.trim()
      ? value.trim()
      : DEFAULT_SIDECAR_BASE_URL;
  let parsed = null;
  try {
    parsed = new URL(candidate);
  } catch {
    throw createError(
      "E_SCHEMA_INVALID",
      "sidecar_base_url must be a valid http(s) URL",
      400
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw createError(
      "E_SCHEMA_INVALID",
      "sidecar_base_url must use http or https protocol",
      400
    );
  }
  return parsed.toString().replace(/\/+$/, "");
}

function isAbsolutePathString(value) {
  return typeof value === "string" && value.trim() && path.isAbsolute(value);
}

function getSidecarRoot(options) {
  const opts = options && typeof options === "object" ? options : {};
  if (typeof opts.sidecarRoot === "string" && opts.sidecarRoot.trim()) {
    return path.resolve(opts.sidecarRoot.trim());
  }
  return path.resolve(__dirname, "..", "..");
}

function getCursorConfigPath(options) {
  const opts = options && typeof options === "object" ? options : {};
  const mode = normalizeMode(opts.mode, "native");
  if (mode !== "native" && mode !== "cline") {
    throw createError(
      "E_SCHEMA_INVALID",
      "mode must be 'native' or 'cline' for setup",
      400
    );
  }
  const platform =
    typeof opts.platform === "string" && opts.platform.trim()
      ? opts.platform.trim()
      : os.platform();
  const homeDir =
    typeof opts.homeDir === "string" && opts.homeDir.trim()
      ? opts.homeDir.trim()
      : os.homedir();
  const appData =
    typeof opts.appData === "string" && opts.appData.trim()
      ? opts.appData.trim()
      : process.env.APPDATA ||
        path.join(homeDir, "AppData", "Roaming");

  if (mode === "native") {
    if (platform === "win32") {
      return path.join(appData, "Cursor", "mcp.json");
    }
    return path.join(homeDir, ".cursor", "mcp.json");
  }

  if (platform === "win32") {
    return path.join(
      appData,
      "Cursor",
      "User",
      "globalStorage",
      "saoudrizwan.claude-dev",
      "settings",
      "cline_mcp_settings.json"
    );
  }

  return path.join(
    homeDir,
    ".config",
    "Cursor",
    "User",
    "globalStorage",
    "saoudrizwan.claude-dev",
    "settings",
    "cline_mcp_settings.json"
  );
}

function getMcpServerPath(options) {
  const sidecarRoot = getSidecarRoot(options);
  return path.join(sidecarRoot, "src", "mcp", "mcpServer.js");
}

function getNodePath(options) {
  const opts = options && typeof options === "object" ? options : {};
  if (typeof opts.nodePath === "string" && opts.nodePath.trim()) {
    return opts.nodePath.trim();
  }
  return process.execPath;
}

function decodeJsonText(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    return String(buffer || "");
  }
  if (buffer.length >= 2) {
    // UTF-16 LE BOM
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
      return buffer.slice(2).toString("utf16le");
    }
    // UTF-16 BE BOM
    if (buffer[0] === 0xfe && buffer[1] === 0xff) {
      const swapped = Buffer.allocUnsafe(buffer.length - 2);
      for (let i = 2, j = 0; i + 1 < buffer.length; i += 2, j += 2) {
        swapped[j] = buffer[i + 1];
        swapped[j + 1] = buffer[i];
      }
      return swapped.toString("utf16le");
    }
  }
  // UTF-8 BOM
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return buffer.slice(3).toString("utf8");
  }
  return buffer.toString("utf8");
}

function stripLeadingBom(text) {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }
  if (text.charCodeAt(0) === 0xfeff) {
    return text.slice(1);
  }
  return text;
}

function readJsonFile(filePath) {
  const buffer = fs.readFileSync(filePath);
  const content = decodeJsonText(buffer);
  const normalized = stripLeadingBom(content);
  return JSON.parse(normalized);
}

function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function safeReadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { exists: false, data: {}, parseError: "" };
  }
  try {
    return {
      exists: true,
      data: readJsonFile(configPath),
      parseError: "",
    };
  } catch (error) {
    return {
      exists: true,
      data: {},
      parseError: error && error.message ? String(error.message) : "invalid json",
    };
  }
}

function buildUnityServerConfig(options) {
  const opts = options && typeof options === "object" ? options : {};
  const sidecarBaseUrl = normalizeSidecarBaseUrl(opts.sidecarBaseUrl);
  const nodePath = getNodePath(opts);
  const mcpServerPath = getMcpServerPath(opts);
  return {
    [UNITY_SERVER_NAME]: {
      command: nodePath,
      args: [mcpServerPath],
      env: {
        SIDECAR_BASE_URL: sidecarBaseUrl,
      },
    },
  };
}

function generateConfig(options) {
  const opts = options && typeof options === "object" ? options : {};
  const existingConfig =
    opts.existingConfig && typeof opts.existingConfig === "object"
      ? opts.existingConfig
      : {};
  const servers = buildUnityServerConfig(opts);
  return {
    ...existingConfig,
    mcpServers: {
      ...(existingConfig.mcpServers &&
      typeof existingConfig.mcpServers === "object"
        ? existingConfig.mcpServers
        : {}),
      ...servers,
    },
  };
}

function validateModeWhitelist(mode, configPath) {
  const normalizedPath = path.normalize(configPath);
  const nativePath = path.normalize(getCursorConfigPath({ mode: "native" }));
  const clinePath = path.normalize(getCursorConfigPath({ mode: "cline" }));
  if (mode === "native" && normalizedPath !== nativePath) {
    return false;
  }
  if (mode === "cline" && normalizedPath !== clinePath) {
    return false;
  }
  return true;
}

function setupCursorMcp(options) {
  const opts = options && typeof options === "object" ? options : {};
  const mode = normalizeMode(opts.mode, "native");
  if (mode !== "native" && mode !== "cline") {
    throw createError(
      "E_SCHEMA_INVALID",
      "mode must be native or cline",
      400
    );
  }

  const sidecarBaseUrl = normalizeSidecarBaseUrl(opts.sidecarBaseUrl);
  const configPath = getCursorConfigPath({ mode });
  if (!validateModeWhitelist(mode, configPath)) {
    throw createError(
      "E_CURSOR_MCP_PATH_NOT_ALLOWED",
      "resolved cursor config path is outside whitelist",
      409
    );
  }

  const mcpServerPath = getMcpServerPath(opts);
  if (!fs.existsSync(mcpServerPath)) {
    throw createError(
      "E_CURSOR_MCP_SERVER_NOT_FOUND",
      `mcp server script not found: ${mcpServerPath}`,
      500
    );
  }

  const nodePath = getNodePath(opts);
  const existing = safeReadConfig(configPath);
  const mergedConfig = generateConfig({
    ...opts,
    sidecarBaseUrl,
    existingConfig: existing.data,
    nodePath,
    mcpServerPath,
  });
  const nextJson = JSON.stringify(mergedConfig);
  const prevJson = JSON.stringify(existing.data || {});
  const changed = nextJson !== prevJson;
  const dryRun = opts.dryRun === true;

  const dirPath = path.dirname(configPath);
  if (!dryRun && !fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  if (!dryRun) {
    writeJsonFile(configPath, mergedConfig);
  }

  return {
    mode,
    dry_run: dryRun,
    changed,
    config_path: configPath,
    config_dir: dirPath,
    sidecar_base_url: sidecarBaseUrl,
    node_path: nodePath,
    mcp_server_path: mcpServerPath,
    config_existed_before: existing.exists,
    config_parse_error_ignored: existing.parseError || "",
  };
}

function inspectConfigMode(mode, options) {
  const opts = options && typeof options === "object" ? options : {};
  const configPath = getCursorConfigPath({ mode });
  const info = {
    mode,
    config_path: configPath,
    exists: fs.existsSync(configPath),
    valid: false,
    issues: [],
    sidecar_base_url: "",
    node_command: "",
    mcp_server_path: "",
  };

  if (!info.exists) {
    info.issues.push("config_missing");
    return info;
  }

  let parsed = null;
  try {
    parsed = readJsonFile(configPath);
  } catch (error) {
    info.issues.push("config_parse_failed");
    info.parse_error =
      error && error.message ? String(error.message) : "invalid_json";
    return info;
  }

  const serverConfig =
    parsed &&
    parsed.mcpServers &&
    typeof parsed.mcpServers === "object" &&
    parsed.mcpServers[UNITY_SERVER_NAME] &&
    typeof parsed.mcpServers[UNITY_SERVER_NAME] === "object"
      ? parsed.mcpServers[UNITY_SERVER_NAME]
      : null;
  if (!serverConfig) {
    info.issues.push("unity_sidecar_entry_missing");
    return info;
  }

  const command =
    typeof serverConfig.command === "string" ? serverConfig.command.trim() : "";
  const args = Array.isArray(serverConfig.args) ? serverConfig.args : [];
  const firstArg = typeof args[0] === "string" ? args[0].trim() : "";
  const env =
    serverConfig.env && typeof serverConfig.env === "object"
      ? serverConfig.env
      : {};
  const baseUrl =
    typeof env.SIDECAR_BASE_URL === "string"
      ? env.SIDECAR_BASE_URL.trim()
      : "";

  info.node_command = command;
  info.mcp_server_path = firstArg;
  info.sidecar_base_url = baseUrl;

  if (!command) {
    info.issues.push("command_missing");
  }
  if (!firstArg) {
    info.issues.push("mcp_server_arg_missing");
  } else {
    if (!isAbsolutePathString(firstArg)) {
      info.issues.push("mcp_server_arg_not_absolute");
    }
    if (!fs.existsSync(firstArg)) {
      info.issues.push("mcp_server_arg_missing_on_disk");
    }
  }
  if (baseUrl) {
    try {
      const parsedUrl = new URL(baseUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        info.issues.push("base_url_protocol_invalid");
      }
    } catch {
      info.issues.push("base_url_invalid");
    }
  } else {
    info.issues.push("base_url_missing");
  }

  info.valid = info.issues.length === 0;
  return info;
}

function verifyCursorMcpSetup(options) {
  const opts = options && typeof options === "object" ? options : {};
  const mode = normalizeMode(opts.mode, "auto");
  if (!SUPPORTED_MODES.has(mode)) {
    throw createError("E_SCHEMA_INVALID", "mode must be auto/native/cline", 400);
  }

  const checks = [];
  if (mode === "auto") {
    checks.push(inspectConfigMode("native", opts));
    checks.push(inspectConfigMode("cline", opts));
  } else {
    checks.push(inspectConfigMode(mode, opts));
  }

  const active = checks.find((item) => item.valid) || null;
  const mcpServerPath = getMcpServerPath(opts);
  const nodeVersion = process.version;
  const nodeMajor = Number(String(nodeVersion).replace(/^v/, "").split(".")[0]);
  const nodeVersionOk = Number.isFinite(nodeMajor) && nodeMajor >= 16;

  return {
    mode_requested: mode,
    ready: nodeVersionOk && !!active && fs.existsSync(mcpServerPath),
    node_version: nodeVersion,
    node_version_ok: nodeVersionOk,
    mcp_server_path: mcpServerPath,
    mcp_server_exists: fs.existsSync(mcpServerPath),
    checks,
    active_mode: active ? active.mode : "",
    recommended_setup_command:
      "npm run mcp:setup-cursor -- --native http://127.0.0.1:46321",
  };
}

module.exports = {
  DEFAULT_SIDECAR_BASE_URL,
  UNITY_SERVER_NAME,
  getCursorConfigPath,
  getMcpServerPath,
  getNodePath,
  generateConfig,
  setupCursorMcp,
  verifyCursorMcpSetup,
  createError,
};

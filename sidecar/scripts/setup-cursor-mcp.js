#!/usr/bin/env node
"use strict";

const {
  setupCursorMcp,
  getCursorConfigPath,
  generateConfig,
  DEFAULT_SIDECAR_BASE_URL,
} = require("../src/application/cursorMcpSetupService");

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let mode = "cline";
  let sidecarBaseUrl = DEFAULT_SIDECAR_BASE_URL;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "");
    if (token === "--native") {
      mode = "native";
      continue;
    }
    if (token === "--cline") {
      mode = "cline";
      continue;
    }
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token.startsWith("http://") || token.startsWith("https://")) {
      sidecarBaseUrl = token;
    }
  }

  return {
    mode,
    sidecarBaseUrl,
    dryRun,
  };
}

function printResult(result) {
  const info = result && typeof result === "object" ? result : {};
  console.log("Cursor MCP setup helper");
  console.log("=======================");
  console.log(`mode: ${info.mode || "unknown"}`);
  console.log(`Sidecar URL: ${info.sidecar_base_url || ""}`);
  console.log(`config path: ${info.config_path || ""}`);
  console.log(`MCP server: ${info.mcp_server_path || ""}`);
  console.log(`Node.js: ${info.node_path || process.execPath}`);
  if (info.config_parse_error_ignored) {
    console.log(
      `note: ignored existing config parse error -> ${info.config_parse_error_ignored}`
    );
  }
  if (info.dry_run === true) {
    console.log("result: dry-run completed, no file was written");
  } else if (info.changed === true) {
    console.log("result: config updated");
  } else {
    console.log("result: config unchanged");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = setupCursorMcp({
    mode: options.mode,
    sidecarBaseUrl: options.sidecarBaseUrl,
    dryRun: options.dryRun,
  });
  printResult(result);
}

if (require.main === module) {
  main().catch((error) => {
    const code =
      error && typeof error.errorCode === "string" && error.errorCode.trim()
        ? error.errorCode.trim()
        : "E_CURSOR_MCP_SETUP_FAILED";
    console.error(`[${code}] ${error && error.message ? error.message : "setup failed"}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  setupCursorMcp,
  getCursorConfigPath,
  generateConfig,
};

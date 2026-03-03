#!/usr/bin/env node
"use strict";

const {
  verifyCursorMcpSetup,
} = require("../src/application/cursorMcpSetupService");

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let mode = "auto";
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
    if (token === "--auto") {
      mode = "auto";
    }
  }
  return { mode };
}

function printCheck(item) {
  const check = item && typeof item === "object" ? item : {};
  const title = `[${check.mode || "unknown"}] ${check.config_path || ""}`;
  if (check.valid) {
    console.log(`[OK] ${title}`);
    console.log(`  - SIDECAR_BASE_URL: ${check.sidecar_base_url || ""}`);
    console.log(`  - command: ${check.node_command || ""}`);
    console.log(`  - args[0]: ${check.mcp_server_path || ""}`);
    return;
  }
  console.log(`[FAIL] ${title}`);
  const issues = Array.isArray(check.issues) ? check.issues : [];
  if (issues.length === 0) {
    console.log("  - issues: unknown");
    return;
  }
  console.log(`  - issues: ${issues.join(", ")}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = verifyCursorMcpSetup({
    mode: options.mode,
  });

  console.log("MCP setup verification");
  console.log("======================");
  console.log(`mode_requested: ${report.mode_requested}`);
  console.log(`node_version: ${report.node_version}`);
  console.log(`node_version_ok: ${report.node_version_ok}`);
  console.log(`mcp_server_exists: ${report.mcp_server_exists}`);
  console.log(`active_mode: ${report.active_mode || "none"}`);
  console.log("");

  const checks = Array.isArray(report.checks) ? report.checks : [];
  for (const item of checks) {
    printCheck(item);
  }

  console.log("");
  if (report.ready) {
    console.log("[OK] all checks passed");
    process.exit(0);
    return;
  }

  console.log("[FAIL] setup checks not passed");
  console.log(`recommended command: ${report.recommended_setup_command}`);
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    const code =
      error && typeof error.errorCode === "string" && error.errorCode.trim()
        ? error.errorCode.trim()
        : "E_CURSOR_MCP_VERIFY_FAILED";
    console.error(`[${code}] ${error && error.message ? error.message : "verify failed"}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  verifyCursorMcpSetup,
};

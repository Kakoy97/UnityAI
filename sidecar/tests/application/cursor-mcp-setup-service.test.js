"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  setupCursorMcp,
  UNITY_SERVER_NAME,
} = require("../../src/application/cursorMcpSetupService");

test("setupCursorMcp accepts UTF-8 BOM config and preserves existing mcp servers", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "codex-cursor-mcp-setup-")
  );
  const appData = path.join(tempRoot, "appdata");
  const configPath = path.join(appData, "Cursor", "mcp.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  const existingConfig = {
    mcpServers: {
      existing_server: {
        command: "node",
        args: ["existing.js"],
      },
    },
  };
  const utf8Bom = "\ufeff";
  fs.writeFileSync(
    configPath,
    utf8Bom + JSON.stringify(existingConfig, null, 2),
    "utf8"
  );

  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = appData;

  try {
    const result = setupCursorMcp({
      mode: "native",
      sidecarBaseUrl: "http://127.0.0.1:46321",
      dryRun: false,
    });

    assert.equal(result.config_parse_error_ignored, "");
    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(typeof updated.mcpServers, "object");
    assert.ok(updated.mcpServers.existing_server);
    assert.ok(updated.mcpServers[UNITY_SERVER_NAME]);
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("setupCursorMcp accepts UTF-16 LE BOM config and preserves existing mcp servers", () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "codex-cursor-mcp-setup-")
  );
  const appData = path.join(tempRoot, "appdata");
  const configPath = path.join(appData, "Cursor", "mcp.json");
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  const existingConfig = {
    mcpServers: {
      utf16_existing: {
        command: "node",
        args: ["existing-utf16.js"],
      },
    },
  };
  fs.writeFileSync(
    configPath,
    Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from(JSON.stringify(existingConfig, null, 2), "utf16le"),
    ])
  );

  const previousAppData = process.env.APPDATA;
  process.env.APPDATA = appData;

  try {
    const result = setupCursorMcp({
      mode: "native",
      sidecarBaseUrl: "http://127.0.0.1:46321",
      dryRun: false,
    });

    assert.equal(result.config_parse_error_ignored, "");
    const updated = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(typeof updated.mcpServers, "object");
    assert.ok(updated.mcpServers.utf16_existing);
    assert.ok(updated.mcpServers[UNITY_SERVER_NAME]);
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

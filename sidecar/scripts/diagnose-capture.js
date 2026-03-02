#!/usr/bin/env node
"use strict";

const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const DEFAULT_BASE_URL = "http://127.0.0.1:46321";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.baseUrl || DEFAULT_BASE_URL;
  const captureBody = {
    view_mode: args.viewMode || "game",
    capture_mode: "render_output",
    output_mode: "artifact_uri",
    include_ui: true,
    ...(args.width > 0 ? { width: args.width } : {}),
    ...(args.height > 0 ? { height: args.height } : {}),
  };

  const capture = await postJson(baseUrl, "/mcp/capture_scene_screenshot", captureBody);
  const uiTree = await postJson(baseUrl, "/mcp/get_ui_tree", {
    ui_system: "ugui",
    include_inactive: true,
    include_components: false,
    include_layout: false,
    max_depth: 6,
    node_budget: 400,
    char_budget: 24000,
  });

  const report = {
    timestamp: new Date().toISOString(),
    base_url: baseUrl,
    requests: {
      capture_scene_screenshot: captureBody,
      get_ui_tree: {
        ui_system: "ugui",
        include_inactive: true,
      },
    },
    responses: {
      capture_scene_screenshot: capture.body,
      get_ui_tree: uiTree.body,
    },
    checks: buildChecks(capture, uiTree),
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function buildChecks(captureResponse, uiTreeResponse) {
  const captureBody = captureResponse && captureResponse.body ? captureResponse.body : {};
  const uiTreeBody = uiTreeResponse && uiTreeResponse.body ? uiTreeResponse.body : {};
  const captureData =
    captureBody && captureBody.ok === true && captureBody.data
      ? captureBody.data
      : {};
  const uiTreeData =
    uiTreeBody && uiTreeBody.ok === true && uiTreeBody.data ? uiTreeBody.data : {};
  const roots = Array.isArray(uiTreeData.roots) ? uiTreeData.roots : [];
  const canvases = Array.isArray(uiTreeData.canvases) ? uiTreeData.canvases : [];
  const captureReadToken =
    captureBody && captureBody.read_token && typeof captureBody.read_token.token === "string"
      ? captureBody.read_token.token.trim()
      : "";
  const treeReadToken =
    uiTreeBody && uiTreeBody.read_token && typeof uiTreeBody.read_token.token === "string"
      ? uiTreeBody.read_token.token.trim()
      : "";

  return {
    capture_http_ok: captureResponse.statusCode >= 200 && captureResponse.statusCode < 300,
    ui_tree_http_ok: uiTreeResponse.statusCode >= 200 && uiTreeResponse.statusCode < 300,
    capture_ok: captureBody.ok === true,
    ui_tree_ok: uiTreeBody.ok === true,
    capture_mode_render_output_only:
      String(captureData.capture_mode_effective || "") === "render_output",
    capture_not_all_black:
      !!(captureData.pixel_sanity && captureData.pixel_sanity.is_all_black === false),
    diagnosis_tags: Array.isArray(captureData.diagnosis_tags)
      ? captureData.diagnosis_tags
      : [],
    ui_tree_has_roots: roots.length > 0,
    ui_tree_has_canvases: canvases.length > 0,
    capture_read_token_present: captureReadToken.length > 0,
    ui_tree_read_token_present: treeReadToken.length > 0,
    effective_mode: captureData.capture_mode_effective || "",
    capture_error_code: captureBody.error_code || "",
    ui_tree_error_code: uiTreeBody.error_code || "",
  };
}

async function postJson(baseUrl, path, body) {
  const url = new URL(path, ensureSlash(baseUrl));
  const payload = JSON.stringify(body || {});
  const response = await request({
    method: "POST",
    url,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
    payload,
  });
  return response;
}

function request({ method, url, headers, payload }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method,
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let body = {};
          try {
            body = raw ? JSON.parse(raw) : {};
          } catch {
            body = { raw };
          }
          resolve({
            statusCode: Number.isFinite(Number(res.statusCode))
              ? Math.floor(Number(res.statusCode))
              : 0,
            body,
          });
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

function parseArgs(argv) {
  const parsed = {
    baseUrl: "",
    viewMode: "game",
    width: 0,
    height: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    const next = i + 1 < argv.length ? String(argv[i + 1]) : "";
    if (token === "--base-url" && next) {
      parsed.baseUrl = next;
      i += 1;
      continue;
    }
    if (token === "--view-mode" && next) {
      parsed.viewMode = next;
      i += 1;
      continue;
    }
    if (token === "--x" && next) {
      parsed.x = safeNumber(next, parsed.x);
      i += 1;
      continue;
    }
    if (token === "--y" && next) {
      parsed.y = safeNumber(next, parsed.y);
      i += 1;
      continue;
    }
    if (token === "--width" && next) {
      parsed.width = safeNumber(next, parsed.width);
      i += 1;
      continue;
    }
    if (token === "--height" && next) {
      parsed.height = safeNumber(next, parsed.height);
      i += 1;
      continue;
    }
  }
  return parsed;
}

function safeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.floor(n);
}

function ensureSlash(baseUrl) {
  if (typeof baseUrl !== "string" || !baseUrl.trim()) {
    return DEFAULT_BASE_URL;
  }
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

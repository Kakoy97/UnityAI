#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const DEFAULT_BASE_URL = "http://127.0.0.1:46321";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args.baseUrl || DEFAULT_BASE_URL;
  const nowIso = new Date().toISOString();
  const captureBody = {
    view_mode: args.viewMode || "game",
    capture_mode: "render_output",
    output_mode: "artifact_uri",
    include_ui: true,
    ...(args.width > 0 ? { width: args.width } : {}),
    ...(args.height > 0 ? { height: args.height } : {}),
  };
  const uiTreeBody = compactUndefined({
    ui_system: "ugui",
    ...(args.scopeRoot ? { root_path: args.scopeRoot } : {}),
    include_inactive: true,
    include_components: true,
    include_layout: true,
    include_interaction: true,
    include_text_metrics: true,
    max_depth: args.maxDepth,
    node_budget: args.nodeBudget,
    char_budget: args.charBudget,
    resolution: {
      width: args.width,
      height: args.height,
    },
  });
  const overlayBody = compactUndefined({
    ...(args.scopeRoot
      ? {
          scope: {
            root_path: args.scopeRoot,
          },
        }
      : {}),
    include_inactive: true,
    include_children_summary: true,
    max_nodes: args.overlayMaxNodes,
    max_children_per_canvas: args.overlayMaxChildren,
  });
  const validateBody = compactUndefined({
    ...(args.scopeRoot
      ? {
          scope: {
            root_path: args.scopeRoot,
          },
        }
      : {}),
    resolutions: [
      {
        name: "primary",
        width: args.width,
        height: args.height,
      },
    ],
    checks: ["OUT_OF_BOUNDS", "OVERLAP", "NOT_CLICKABLE", "TEXT_OVERFLOW"],
    max_issues: args.maxIssues,
    time_budget_ms: args.timeBudgetMs,
    layout_refresh_mode: "scoped_roots_only",
  });

  const [capture, uiTree, overlayReport, validateLayout] = await Promise.all([
    postJson(baseUrl, "/mcp/capture_scene_screenshot", captureBody),
    postJson(baseUrl, "/mcp/get_ui_tree", uiTreeBody),
    postJson(baseUrl, "/mcp/get_ui_overlay_report", overlayBody),
    postJson(baseUrl, "/mcp/validate_ui_layout", validateBody),
  ]);

  const report = {
    timestamp: nowIso,
    base_url: baseUrl,
    requests: {
      capture_scene_screenshot: captureBody,
      get_ui_tree: uiTreeBody,
      get_ui_overlay_report: overlayBody,
      validate_ui_layout: validateBody,
    },
    responses: {
      capture_scene_screenshot: capture.body,
      get_ui_tree: uiTree.body,
      get_ui_overlay_report: overlayReport.body,
      validate_ui_layout: validateLayout.body,
    },
    status_codes: {
      capture_scene_screenshot: capture.statusCode,
      get_ui_tree: uiTree.statusCode,
      get_ui_overlay_report: overlayReport.statusCode,
      validate_ui_layout: validateLayout.statusCode,
    },
    checks: buildChecks(capture, uiTree, overlayReport, validateLayout),
    summary: buildSummary(capture, uiTree, overlayReport, validateLayout),
  };

  const outputPath = path.resolve(process.cwd(), args.output);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`diagnose-capture report written: ${outputPath}\n`);
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
}

function buildChecks(captureResponse, uiTreeResponse, overlayResponse, validateResponse) {
  const captureBody = captureResponse && captureResponse.body ? captureResponse.body : {};
  const uiTreeBody = uiTreeResponse && uiTreeResponse.body ? uiTreeResponse.body : {};
  const overlayBody = overlayResponse && overlayResponse.body ? overlayResponse.body : {};
  const validateBody = validateResponse && validateResponse.body ? validateResponse.body : {};
  const captureData =
    captureBody && captureBody.ok === true && captureBody.data
      ? captureBody.data
      : {};
  const uiTreeData =
    uiTreeBody && uiTreeBody.ok === true && uiTreeBody.data ? uiTreeBody.data : {};
  const overlayData =
    overlayBody && overlayBody.ok === true && overlayBody.data
      ? overlayBody.data
      : {};
  const validateData =
    validateBody && validateBody.ok === true && validateBody.data
      ? validateBody.data
      : {};
  const roots = Array.isArray(uiTreeData.roots) ? uiTreeData.roots : [];
  const canvases = Array.isArray(uiTreeData.canvases) ? uiTreeData.canvases : [];
  const overlayCanvases = Array.isArray(overlayData.overlay_canvases)
    ? overlayData.overlay_canvases
    : [];
  const captureReadToken =
    captureBody && captureBody.read_token && typeof captureBody.read_token.token === "string"
      ? captureBody.read_token.token.trim()
      : "";
  const treeReadToken =
    uiTreeBody && uiTreeBody.read_token && typeof uiTreeBody.read_token.token === "string"
      ? uiTreeBody.read_token.token.trim()
      : "";
  const overlayReadToken =
    overlayBody &&
    overlayBody.read_token &&
    typeof overlayBody.read_token.token === "string"
      ? overlayBody.read_token.token.trim()
      : "";
  const validateReadToken =
    validateBody &&
    validateBody.read_token &&
    typeof validateBody.read_token.token === "string"
      ? validateBody.read_token.token.trim()
      : "";

  return {
    capture_http_ok: captureResponse.statusCode >= 200 && captureResponse.statusCode < 300,
    ui_tree_http_ok: uiTreeResponse.statusCode >= 200 && uiTreeResponse.statusCode < 300,
    overlay_http_ok: overlayResponse.statusCode >= 200 && overlayResponse.statusCode < 300,
    validate_http_ok: validateResponse.statusCode >= 200 && validateResponse.statusCode < 300,
    capture_ok: captureBody.ok === true,
    ui_tree_ok: uiTreeBody.ok === true,
    overlay_ok: overlayBody.ok === true,
    validate_ok: validateBody.ok === true,
    capture_mode_render_output_only:
      String(captureData.capture_mode_effective || "") === "render_output",
    capture_not_all_black:
      !!(captureData.pixel_sanity && captureData.pixel_sanity.is_all_black === false),
    diagnosis_tags: Array.isArray(captureData.diagnosis_tags)
      ? captureData.diagnosis_tags
      : [],
    ui_tree_has_roots: roots.length > 0,
    ui_tree_has_canvases: canvases.length > 0,
    overlay_has_canvases_array: Array.isArray(overlayData.overlay_canvases),
    overlay_total_coverage_known:
      Number.isFinite(Number(overlayData.overlay_total_coverage_percent)),
    overlay_recommendation_present:
      typeof overlayData.recommended_capture_mode === "string" &&
      overlayData.recommended_capture_mode.trim().length > 0,
    validate_issues_present: Array.isArray(validateData.issues),
    capture_read_token_present: captureReadToken.length > 0,
    ui_tree_read_token_present: treeReadToken.length > 0,
    overlay_read_token_present: overlayReadToken.length > 0,
    validate_read_token_present: validateReadToken.length > 0,
    combined_diagnosis_ready:
      captureBody.ok === true &&
      uiTreeBody.ok === true &&
      overlayBody.ok === true &&
      validateBody.ok === true &&
      roots.length > 0 &&
      Array.isArray(validateData.issues),
    effective_mode: captureData.capture_mode_effective || "",
    overlay_canvas_count: overlayCanvases.length,
    overlay_total_coverage_percent: Number(overlayData.overlay_total_coverage_percent || 0),
    overlay_recommended_capture_mode: overlayData.recommended_capture_mode || "",
    capture_error_code: captureBody.error_code || "",
    ui_tree_error_code: uiTreeBody.error_code || "",
    overlay_error_code: overlayBody.error_code || "",
    validate_error_code: validateBody.error_code || "",
  };
}

function buildSummary(captureResponse, uiTreeResponse, overlayResponse, validateResponse) {
  const captureBody = captureResponse && captureResponse.body ? captureResponse.body : {};
  const uiTreeBody = uiTreeResponse && uiTreeResponse.body ? uiTreeResponse.body : {};
  const overlayBody = overlayResponse && overlayResponse.body ? overlayResponse.body : {};
  const validateBody = validateResponse && validateResponse.body ? validateResponse.body : {};

  const captureData = captureBody.ok === true && captureBody.data ? captureBody.data : {};
  const uiTreeData = uiTreeBody.ok === true && uiTreeBody.data ? uiTreeBody.data : {};
  const overlayData = overlayBody.ok === true && overlayBody.data ? overlayBody.data : {};
  const validateData = validateBody.ok === true && validateBody.data ? validateBody.data : {};

  return {
    capture_mode_effective: String(captureData.capture_mode_effective || ""),
    capture_diagnosis_tags: Array.isArray(captureData.diagnosis_tags)
      ? captureData.diagnosis_tags
      : [],
    ui_tree_returned_node_count: Number(uiTreeData.returned_node_count || 0),
    overlay_canvas_count: Array.isArray(overlayData.overlay_canvases)
      ? overlayData.overlay_canvases.length
      : 0,
    overlay_total_coverage_percent: Number(overlayData.overlay_total_coverage_percent || 0),
    overlay_recommended_capture_mode: String(overlayData.recommended_capture_mode || ""),
    validate_issue_count: Number(validateData.issue_count || 0),
    error_codes: {
      capture_scene_screenshot: String(captureBody.error_code || ""),
      get_ui_tree: String(uiTreeBody.error_code || ""),
      get_ui_overlay_report: String(overlayBody.error_code || ""),
      validate_ui_layout: String(validateBody.error_code || ""),
    },
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
    scopeRoot: "",
    width: 1280,
    height: 720,
    maxDepth: 6,
    nodeBudget: 1000,
    charBudget: 120000,
    overlayMaxNodes: 256,
    overlayMaxChildren: 12,
    maxIssues: 200,
    timeBudgetMs: 1200,
    output: "diagnose-capture-report.json",
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
    if (token === "--scope-root" && next) {
      parsed.scopeRoot = next;
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
    if (token === "--max-depth" && next) {
      parsed.maxDepth = safeNumber(next, parsed.maxDepth);
      i += 1;
      continue;
    }
    if (token === "--node-budget" && next) {
      parsed.nodeBudget = safeNumber(next, parsed.nodeBudget);
      i += 1;
      continue;
    }
    if (token === "--char-budget" && next) {
      parsed.charBudget = safeNumber(next, parsed.charBudget);
      i += 1;
      continue;
    }
    if (token === "--overlay-max-nodes" && next) {
      parsed.overlayMaxNodes = safeNumber(next, parsed.overlayMaxNodes);
      i += 1;
      continue;
    }
    if (token === "--overlay-max-children" && next) {
      parsed.overlayMaxChildren = safeNumber(next, parsed.overlayMaxChildren);
      i += 1;
      continue;
    }
    if (token === "--max-issues" && next) {
      parsed.maxIssues = safeNumber(next, parsed.maxIssues);
      i += 1;
      continue;
    }
    if (token === "--time-budget-ms" && next) {
      parsed.timeBudgetMs = safeNumber(next, parsed.timeBudgetMs);
      i += 1;
      continue;
    }
    if (token === "--output" && next) {
      parsed.output = next;
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

function compactUndefined(value) {
  if (Array.isArray(value)) {
    return value.map((item) => compactUndefined(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue;
    }
    out[key] = compactUndefined(item);
  }
  return out;
}

main().catch((error) => {
  process.stderr.write(`${error && error.message ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

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

  const uiTreeRequest = {
    ui_system: "ugui",
    scope: args.scopeRoot ? { root_path: args.scopeRoot } : undefined,
    include_inactive: true,
    include_components: true,
    include_layout: true,
    include_interaction: true,
    include_text_metrics: true,
    max_depth: 6,
    node_budget: 1000,
    char_budget: 120000,
    resolution: {
      width: args.width,
      height: args.height,
    },
    timeout_ms: 10000,
  };

  const hitTestRequest = {
    view: "game",
    coord_space: "viewport_px",
    coord_origin: "bottom_left",
    x: args.x,
    y: args.y,
    resolution: {
      width: args.width,
      height: args.height,
    },
    scope: args.scopeRoot ? { root_path: args.scopeRoot } : undefined,
    max_results: 8,
    include_non_interactable: true,
    timeout_ms: 5000,
  };

  const validateRequest = {
    scope: args.scopeRoot ? { root_path: args.scopeRoot } : undefined,
    resolutions: [
      { name: "landscape_primary", width: args.width, height: args.height },
      { name: "portrait_primary", width: args.height, height: args.width },
    ],
    checks: [
      "OUT_OF_BOUNDS",
      "OVERLAP",
      "NOT_CLICKABLE",
      "TEXT_OVERFLOW",
    ],
    max_issues: 200,
    time_budget_ms: 1200,
    layout_refresh_mode: "scoped_roots_only",
    timeout_ms: 15000,
  };

  const uiTree = await postJson(baseUrl, "/mcp/get_ui_tree", compactUndefined(uiTreeRequest));
  const hitTest = await postJson(
    baseUrl,
    "/mcp/hit_test_ui_at_viewport_point",
    compactUndefined(hitTestRequest)
  );
  const validate = await postJson(
    baseUrl,
    "/mcp/validate_ui_layout",
    compactUndefined(validateRequest)
  );

  const setRequest = buildSetUiRequest(args, uiTree, hitTest);
  let setResult = {
    skipped: true,
    reason: "disabled_by_flag",
    statusCode: 0,
    body: {},
    request: {},
  };
  if (!args.skipSet) {
    setResult = await postJson(baseUrl, "/mcp/set_ui_properties", setRequest);
  }

  const report = {
    timestamp: nowIso,
    base_url: baseUrl,
    requests: {
      get_ui_tree: compactUndefined(uiTreeRequest),
      hit_test_ui_at_viewport_point: compactUndefined(hitTestRequest),
      validate_ui_layout: compactUndefined(validateRequest),
      set_ui_properties: args.skipSet ? { skipped: true } : setRequest,
    },
    responses: {
      get_ui_tree: uiTree.body,
      hit_test_ui_at_viewport_point: hitTest.body,
      validate_ui_layout: validate.body,
      set_ui_properties: setResult.body,
    },
    status_codes: {
      get_ui_tree: uiTree.statusCode,
      hit_test_ui_at_viewport_point: hitTest.statusCode,
      validate_ui_layout: validate.statusCode,
      set_ui_properties: setResult.statusCode,
    },
    checks: buildChecks({
      uiTree,
      hitTest,
      validate,
      setResult,
      skipSet: args.skipSet,
      setCommit: args.setCommit,
    }),
    summary: buildSummary({
      uiTree,
      hitTest,
      validate,
      setResult,
    }),
  };

  const outputPath = path.resolve(process.cwd(), args.output);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`diagnose-ui report written: ${outputPath}\n`);
  process.stdout.write(`${JSON.stringify(report.summary, null, 2)}\n`);
}

function buildSetUiRequest(args, uiTreeResult, hitTestResult) {
  const treeBody = uiTreeResult && uiTreeResult.body ? uiTreeResult.body : {};
  const treeData = treeBody && treeBody.ok && treeBody.data ? treeBody.data : {};
  const hitBody = hitTestResult && hitTestResult.body ? hitTestResult.body : {};
  const hitData = hitBody && hitBody.ok && hitBody.data ? hitBody.data : {};
  const firstRoot = findFirstTreeNode(treeData.roots);
  const firstHit =
    hitData && Array.isArray(hitData.hits) && hitData.hits.length > 0
      ? hitData.hits[0]
      : null;

  const writeAnchor =
    (firstRoot && firstRoot.anchor) || (firstHit && firstHit.anchor) || {
      object_id: "",
      path: "",
    };
  const targetAnchor =
    (firstHit && firstHit.anchor) || (firstRoot && firstRoot.anchor) || {
      object_id: "",
      path: "",
    };
  const token =
    treeBody &&
    treeBody.read_token &&
    typeof treeBody.read_token.token === "string"
      ? treeBody.read_token.token
      : "";

  return {
    based_on_read_token: token,
    write_anchor: normalizeAnchor(writeAnchor),
    operations: [
      {
        target_anchor: normalizeAnchor(targetAnchor),
        rect_transform: {
          anchored_position: {
            x: 0,
            y: 0,
          },
        },
      },
    ],
    atomic: true,
    dry_run: !args.setCommit,
  };
}

function normalizeAnchor(anchor) {
  const value = anchor && typeof anchor === "object" ? anchor : {};
  return {
    object_id:
      typeof value.object_id === "string" ? value.object_id.trim() : "",
    path: typeof value.path === "string" ? value.path.trim() : "",
  };
}

function findFirstTreeNode(roots) {
  if (!Array.isArray(roots) || roots.length === 0) {
    return null;
  }
  const stack = [...roots];
  while (stack.length > 0) {
    const node = stack.shift();
    if (!node || typeof node !== "object") {
      continue;
    }
    if (node.anchor && typeof node.anchor === "object") {
      return node;
    }
    if (Array.isArray(node.children)) {
      stack.unshift(...node.children);
    }
  }
  return null;
}

function buildChecks(ctx) {
  const uiTreeBody = ctx.uiTree && ctx.uiTree.body ? ctx.uiTree.body : {};
  const uiTreeData = uiTreeBody.ok && uiTreeBody.data ? uiTreeBody.data : {};
  const hitBody = ctx.hitTest && ctx.hitTest.body ? ctx.hitTest.body : {};
  const hitData = hitBody.ok && hitBody.data ? hitBody.data : {};
  const validateBody = ctx.validate && ctx.validate.body ? ctx.validate.body : {};
  const validateData =
    validateBody.ok && validateBody.data ? validateBody.data : {};
  const setBody =
    ctx.setResult && ctx.setResult.body ? ctx.setResult.body : {};

  const runtime = hitData.runtime_resolution || {};
  const mapped = hitData.mapped_point || {};
  const mappedInRange =
    Number.isFinite(Number(runtime.width)) &&
    Number.isFinite(Number(runtime.height)) &&
    Number.isFinite(Number(mapped.x)) &&
    Number.isFinite(Number(mapped.y)) &&
    Number(mapped.x) >= 0 &&
    Number(mapped.y) >= 0 &&
    Number(mapped.x) <= Number(runtime.width) - 1 &&
    Number(mapped.y) <= Number(runtime.height) - 1;

  return {
    get_ui_tree_ok: uiTreeBody.ok === true,
    hit_test_ok: hitBody.ok === true,
    validate_ok: validateBody.ok === true,
    set_ok_or_skipped: ctx.skipSet || setBody.ok === true,
    tree_runtime_resolution_present:
      !!(uiTreeData.runtime_resolution && uiTreeData.runtime_source),
    hit_runtime_resolution_present:
      !!(hitData.runtime_resolution && hitData.runtime_source),
    validate_runtime_resolution_present:
      !!(validateData.runtime_resolution && validateData.runtime_source),
    hit_coord_origin_bottom_left:
      String(hitData.coord_origin || "") === "bottom_left",
    hit_mapped_point_in_runtime_range: mappedInRange,
    hit_approximate_flag_present:
      typeof hitData.approximate === "boolean",
    validate_partial_flag_present:
      typeof validateData.partial === "boolean",
    validate_truncated_reason_present_when_partial:
      validateData.partial !== true || !!String(validateData.truncated_reason || ""),
    set_dry_run_when_not_commit:
      ctx.skipSet || ctx.setCommit || setBody.dry_run === true,
    set_has_planning_payload:
      ctx.skipSet ||
      (Number.isFinite(Number(setBody.planned_actions_count)) &&
        Array.isArray(setBody.mapped_actions)),
  };
}

function buildSummary(ctx) {
  const uiTreeBody = ctx.uiTree && ctx.uiTree.body ? ctx.uiTree.body : {};
  const uiTreeData = uiTreeBody.ok && uiTreeBody.data ? uiTreeBody.data : {};
  const hitBody = ctx.hitTest && ctx.hitTest.body ? ctx.hitTest.body : {};
  const hitData = hitBody.ok && hitBody.data ? hitBody.data : {};
  const validateBody = ctx.validate && ctx.validate.body ? ctx.validate.body : {};
  const validateData =
    validateBody.ok && validateBody.data ? validateBody.data : {};
  const setBody = ctx.setResult && ctx.setResult.body ? ctx.setResult.body : {};

  return {
    ui_tree_nodes: Number(uiTreeData.returned_node_count || 0),
    ui_tree_truncated: uiTreeData.truncated === true,
    hit_count: Number(hitData.hit_count || 0),
    hit_runtime_source: String(hitData.runtime_source || ""),
    validate_issue_count: Number(validateData.issue_count || 0),
    validate_partial: validateData.partial === true,
    validate_runtime_source: String(validateData.runtime_source || ""),
    set_status: setBody.status || (ctx.setResult && ctx.setResult.skipped ? "skipped" : ""),
    set_planned_actions_count: Number(setBody.planned_actions_count || 0),
    error_codes: {
      get_ui_tree: String(uiTreeBody.error_code || ""),
      hit_test_ui_at_viewport_point: String(hitBody.error_code || ""),
      validate_ui_layout: String(validateBody.error_code || ""),
      set_ui_properties: String(setBody.error_code || ""),
    },
  };
}

async function postJson(baseUrl, routePath, body) {
  const url = new URL(routePath, ensureSlash(baseUrl));
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

function parseArgs(argv) {
  const parsed = {
    baseUrl: "",
    scopeRoot: "",
    x: 960,
    y: 540,
    width: 1920,
    height: 1080,
    skipSet: false,
    setCommit: false,
    output: "diagnose-ui-report.json",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || "");
    const next = i + 1 < argv.length ? String(argv[i + 1]) : "";
    if (token === "--base-url" && next) {
      parsed.baseUrl = next;
      i += 1;
      continue;
    }
    if (token === "--scope-root" && next) {
      parsed.scopeRoot = next;
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
    if (token === "--output" && next) {
      parsed.output = next;
      i += 1;
      continue;
    }
    if (token === "--skip-set") {
      parsed.skipSet = true;
      continue;
    }
    if (token === "--set-commit") {
      parsed.setCommit = true;
      continue;
    }
  }

  if (parsed.skipSet) {
    parsed.setCommit = false;
  }

  if (parsed.width < 1) {
    parsed.width = 1920;
  }
  if (parsed.height < 1) {
    parsed.height = 1080;
  }
  if (parsed.x < 0) {
    parsed.x = 0;
  }
  if (parsed.y < 0) {
    parsed.y = 0;
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
  process.stderr.write(
    `${error && error.message ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});

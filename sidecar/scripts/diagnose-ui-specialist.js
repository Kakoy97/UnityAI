#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const DEFAULT_BASE_URL = "http://127.0.0.1:46321";
const DEFAULT_OUTPUT = "diagnose-ui-specialist-report.json";
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_REPAIR_STYLE = "balanced";
const DEFAULT_REPAIR_SUGGESTION_LIMIT = 6;

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }

  const nowIso = new Date().toISOString();
  const baseUrl = args.baseUrl || DEFAULT_BASE_URL;
  const validatePayload = compactUndefined({
    scope: args.scopeRoot ? { root_path: args.scopeRoot } : undefined,
    resolutions: [
      {
        name: "landscape_primary",
        width: args.width,
        height: args.height,
      },
      {
        name: "portrait_primary",
        width: args.height,
        height: args.width,
      },
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
    include_repair_plan: true,
    max_repair_suggestions: args.maxRepairSuggestions,
    repair_style: args.repairStyle,
    timeout_ms: args.timeoutMs,
  });

  const validateResponse = await postJson(
    baseUrl,
    "/mcp/validate_ui_layout",
    validatePayload
  );

  const validateBody =
    validateResponse && validateResponse.body && typeof validateResponse.body === "object"
      ? validateResponse.body
      : {};
  const validateData =
    validateBody.ok === true &&
    validateBody.data &&
    typeof validateBody.data === "object"
      ? validateBody.data
      : {};
  const repairPlan = Array.isArray(validateData.repair_plan)
    ? validateData.repair_plan
    : [];
  const generatedBy = normalizeText(validateData.repair_plan_generated_by);

  let catalogResponse = null;
  let catalogActionTypes = [];
  if (!args.skipCatalog) {
    catalogResponse = await postJson(baseUrl, "/mcp/get_action_catalog", {
      page: 1,
      page_size: 500,
    });
    const body =
      catalogResponse && catalogResponse.body && typeof catalogResponse.body === "object"
        ? catalogResponse.body
        : {};
    const data = body.ok === true && body.data && typeof body.data === "object" ? body.data : {};
    const actions = Array.isArray(data.actions) ? data.actions : [];
    catalogActionTypes = actions
      .map((item) =>
        normalizeText(item && typeof item === "object" ? item.action_type : "")
      )
      .filter(Boolean);
  }

  const actionTypeSet = new Set(catalogActionTypes);
  const repairActionTypes = repairPlan
    .map((item) =>
      normalizeText(
        item && typeof item === "object" ? item.recommended_action_type : ""
      )
    )
    .filter(Boolean);
  const missingActionTypes = [...new Set(repairActionTypes)].filter(
    (type) => !args.skipCatalog && !actionTypeSet.has(type)
  );

  const checks = {
    validate_ok: validateResponse.statusCode === 200 && validateBody.ok === true,
    specialist_summary_present:
      validateBody.ok === true &&
      !!(validateData.specialist_summary && typeof validateData.specialist_summary === "object"),
    repair_plan_present_when_requested:
      validateBody.ok !== true || Array.isArray(validateData.repair_plan),
    repair_plan_generated_by_known:
      validateBody.ok !== true ||
      generatedBy === "unity" ||
      generatedBy === "sidecar",
    action_catalog_ok_or_skipped:
      args.skipCatalog ||
      (catalogResponse &&
        catalogResponse.statusCode === 200 &&
        catalogResponse.body &&
        catalogResponse.body.ok === true),
    all_recommended_actions_registered:
      args.skipCatalog || missingActionTypes.length === 0,
  };

  const summary = {
    issue_count: toInt(validateData.issue_count),
    repair_plan_count: repairPlan.length,
    repair_plan_generated_by: generatedBy,
    repair_style: normalizeText(
      validateData.specialist_summary &&
        typeof validateData.specialist_summary === "object"
        ? validateData.specialist_summary.repair_style
        : ""
    ),
    top_repair_strategies: summarizeTopStrategies(repairPlan),
    missing_action_types: missingActionTypes,
    error_codes: {
      validate_ui_layout: normalizeText(validateBody.error_code),
      get_action_catalog: normalizeText(
        catalogResponse &&
          catalogResponse.body &&
          typeof catalogResponse.body === "object"
          ? catalogResponse.body.error_code
          : ""
      ),
    },
  };

  const report = {
    timestamp: nowIso,
    base_url: baseUrl,
    requests: {
      validate_ui_layout: validatePayload,
      get_action_catalog: args.skipCatalog ? { skipped: true } : { page: 1, page_size: 500 },
    },
    responses: {
      validate_ui_layout: validateBody,
      get_action_catalog:
        args.skipCatalog || !catalogResponse ? { skipped: true } : catalogResponse.body,
    },
    status_codes: {
      validate_ui_layout: validateResponse.statusCode,
      get_action_catalog: args.skipCatalog || !catalogResponse ? 0 : catalogResponse.statusCode,
    },
    checks,
    summary,
  };

  const outputPath = path.resolve(process.cwd(), args.output);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(`diagnose-ui-specialist report written: ${outputPath}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  const hasFailure = Object.values(checks).some((value) => value !== true);
  if (args.strict && hasFailure) {
    return 1;
  }
  return 0;
}

function summarizeTopStrategies(repairPlan) {
  const counts = new Map();
  const items = Array.isArray(repairPlan) ? repairPlan : [];
  for (const item of items) {
    const strategy = normalizeText(
      item && typeof item === "object" ? item.strategy : ""
    );
    if (!strategy) {
      continue;
    }
    counts.set(strategy, (counts.get(strategy) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([strategy, count]) => ({ strategy, count }));
}

async function postJson(baseUrl, routePath, body) {
  const url = new URL(routePath, ensureSlash(baseUrl));
  const payload = JSON.stringify(body || {});
  return request({
    method: "POST",
    url,
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    },
    payload,
  });
}

function request({ method, url, headers, payload }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      { method, headers },
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
    req.write(payload);
    req.end();
  });
}

function compactUndefined(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => compactUndefined(item))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const compacted = compactUndefined(item);
    if (compacted !== undefined) {
      out[key] = compacted;
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    scopeRoot: "",
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    maxRepairSuggestions: DEFAULT_REPAIR_SUGGESTION_LIMIT,
    repairStyle: DEFAULT_REPAIR_STYLE,
    timeoutMs: 15000,
    output: DEFAULT_OUTPUT,
    strict: false,
    skipCatalog: false,
    help: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || "");
    const next = i + 1 < args.length ? args[i + 1] : "";

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    if (token === "--strict") {
      options.strict = true;
      continue;
    }
    if (token === "--skip-catalog") {
      options.skipCatalog = true;
      continue;
    }
    if (token === "--base-url" && next) {
      options.baseUrl = String(next).trim() || DEFAULT_BASE_URL;
      i += 1;
      continue;
    }
    if (token === "--scope-root" && next) {
      options.scopeRoot = String(next).trim();
      i += 1;
      continue;
    }
    if (token === "--output" && next) {
      options.output = String(next).trim() || DEFAULT_OUTPUT;
      i += 1;
      continue;
    }
    if (token === "--repair-style" && next) {
      const style = normalizeRepairStyle(next);
      if (style) {
        options.repairStyle = style;
      }
      i += 1;
      continue;
    }
    if (token === "--width" && next) {
      options.width = toPositiveInt(next, DEFAULT_WIDTH);
      i += 1;
      continue;
    }
    if (token === "--height" && next) {
      options.height = toPositiveInt(next, DEFAULT_HEIGHT);
      i += 1;
      continue;
    }
    if (token === "--max-repair-suggestions" && next) {
      options.maxRepairSuggestions = toPositiveInt(
        next,
        DEFAULT_REPAIR_SUGGESTION_LIMIT
      );
      i += 1;
      continue;
    }
    if (token === "--timeout-ms" && next) {
      options.timeoutMs = toPositiveInt(next, 15000);
      i += 1;
      continue;
    }
  }

  if (options.maxRepairSuggestions > 20) {
    options.maxRepairSuggestions = 20;
  }

  return options;
}

function normalizeRepairStyle(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (
    normalized === "conservative" ||
    normalized === "balanced" ||
    normalized === "aggressive"
  ) {
    return normalized;
  }
  return "";
}

function toPositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const rounded = Math.floor(numeric);
  return rounded > 0 ? rounded : fallback;
}

function toInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
}

function ensureSlash(urlText) {
  const value = String(urlText || "").trim();
  if (!value) {
    return DEFAULT_BASE_URL;
  }
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function printUsage() {
  process.stdout.write(
    [
      "Usage: node scripts/diagnose-ui-specialist.js [options]",
      "",
      "Options:",
      "  --base-url <url>                 Sidecar base URL (default http://127.0.0.1:46321)",
      "  --scope-root <path>              Optional UI root path, e.g. Scene/Canvas/HUD",
      "  --width <int>                    Runtime width (default 1920)",
      "  --height <int>                   Runtime height (default 1080)",
      "  --repair-style <style>           conservative|balanced|aggressive (default balanced)",
      "  --max-repair-suggestions <int>   Repair suggestion limit, capped at 20 (default 6)",
      "  --timeout-ms <int>               validate_ui_layout timeout (default 15000)",
      "  --skip-catalog                   Skip get_action_catalog compatibility check",
      "  --strict                         Exit with code 1 when any check is false",
      "  --output <file>                  Report path (default diagnose-ui-specialist-report.json)",
      "  --help                           Show this help",
      "",
    ].join("\n")
  );
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = Number.isInteger(exitCode) ? exitCode : 0;
    })
    .catch((error) => {
      const message =
        error && typeof error.message === "string" ? error.message : String(error);
      process.stderr.write(`diagnose-ui-specialist failed: ${message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  summarizeTopStrategies,
  main,
};

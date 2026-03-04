#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const REQUIRED_WIRE_MARKERS = Object.freeze([
  {
    file: "sidecar/src/ports/contracts.js",
    markers: [
      '"action_data_json"',
      '"action_data_marshaled"',
      '"steps[*].action_data_json"',
      '"steps[*].action_data_marshaled"',
      'internal_wire_field: "action_data_marshaled"',
      'internal_wire_fallback_field: "action_data_json"',
    ],
  },
  {
    // Validator implementation moved from legacyValidators.js to split module.
    file: "sidecar/src/domain/validators/_mcpWriteValidatorsImpl.js",
    markers: [
      "action_data_json is not allowed in external payload",
      "action_data_marshaled is not allowed in external payload",
      "E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED",
    ],
  },
  {
    file: "sidecar/src/application/unityDispatcher/runtimeUtils.js",
    markers: [
      "payload.action_data_json = actionDataBridge.action_data_json;",
      "payload.action_data_marshaled = actionDataBridge.action_data_marshaled;",
    ],
  },
  {
    file: "Assets/Editor/Codex/Domain/Contracts/SidecarContracts.Action.cs",
    markers: [
      "public string action_data_json;",
      "public string action_data_marshaled;",
    ],
  },
  {
    file: "Assets/Editor/Codex/Infrastructure/Actions/McpVisualActionContext.cs",
    markers: [
      "ResolveActionDataJson",
      "TryDecodeMarshaledActionData",
      "rawAction.action_data_marshaled",
      "rawAction.action_data_json",
    ],
  },
]);

const WIRE_TOKEN_SCAN = Object.freeze({
  includeDir: "sidecar/src",
  tokenPattern: /\baction_data_(?:json|marshaled)\b/g,
  allowFiles: new Set([
    "sidecar/src/application/turnPayloadBuilders.js",
    "sidecar/src/application/unityDispatcher/runtimeUtils.js",
    "sidecar/src/domain/validators/legacyValidators.js",
    "sidecar/src/domain/validators/_mcpWriteValidatorsImpl.js",
    "sidecar/src/ports/contracts.js",
    "sidecar/src/mcp/commands/set_serialized_property/validator.js",
  ]),
});

const REGISTRY_FILE =
  "Assets/Editor/Codex/Infrastructure/Actions/McpActionRegistryBootstrap.cs";
const EDIT_MODE_TEST_DIR = "Assets/Editor/Codex/Tests/EditMode";
const ATOMIC_BASE_FILE = "Assets/Editor/Codex/Tests/EditMode/AtomicActionTestBase.cs";
const COMPOSITE_ACTION_TYPE = "composite_visual_action";

function readSource(relativePath) {
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return {
      ok: false,
      source: "",
      error: `file missing: ${relativePath}`,
    };
  }

  return {
    ok: true,
    source: fs.readFileSync(absolutePath, "utf8"),
    error: "",
  };
}

function listFilesRecursive(relativeDir, extension) {
  const baseDir = path.resolve(REPO_ROOT, relativeDir);
  if (!fs.existsSync(baseDir)) {
    return [];
  }

  const ext = typeof extension === "string" ? extension : "";
  const files = [];
  const queue = [baseDir];
  while (queue.length > 0) {
    const current = queue.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (ext && !entry.name.endsWith(ext)) {
        continue;
      }
      files.push(path.relative(REPO_ROOT, entryPath).replace(/\\/g, "/"));
    }
  }

  files.sort();
  return files;
}

function checkWireMarkers() {
  const failures = [];
  const checks = [];

  for (const rule of REQUIRED_WIRE_MARKERS) {
    const loaded = readSource(rule.file);
    if (!loaded.ok) {
      failures.push(`[wire-marker] ${loaded.error}`);
      checks.push({
        file: rule.file,
        ok: false,
        missing_markers: ["<file-missing>"],
      });
      continue;
    }

    const missing = [];
    for (const marker of rule.markers || []) {
      if (!loaded.source.includes(marker)) {
        missing.push(marker);
      }
    }

    checks.push({
      file: rule.file,
      ok: missing.length === 0,
      missing_markers: missing,
    });
    if (missing.length > 0) {
      failures.push(
        `[wire-marker] ${rule.file} missing marker(s): ${missing.join(" | ")}`
      );
    }
  }

  return {
    failures,
    checks,
  };
}

function checkErrorSuggestionLeak() {
  const failures = [];
  let suggestion = "";
  try {
    // eslint-disable-next-line global-require
    const { MCP_ERROR_FEEDBACK_TEMPLATES } = require("../src/application/turnPolicies");
    const item =
      MCP_ERROR_FEEDBACK_TEMPLATES &&
      MCP_ERROR_FEEDBACK_TEMPLATES.E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED;
    suggestion = item && typeof item.suggestion === "string" ? item.suggestion : "";
  } catch (error) {
    const message =
      error && typeof error.message === "string" ? error.message : String(error || "");
    failures.push(`[error-suggestion] failed to load turnPolicies: ${message}`);
  }

  if (/\baction_data_json\b|\baction_data_marshaled\b/.test(suggestion)) {
    failures.push(
      "[error-suggestion] E_ACTION_DATA_STRINGIFIED_NOT_ALLOWED suggestion still leaks internal wire field names."
    );
  }

  return {
    failures,
    suggestion,
  };
}

function scanUnexpectedWireTokenFiles() {
  const files = listFilesRecursive(WIRE_TOKEN_SCAN.includeDir, ".js");
  const unexpected = [];

  for (const file of files) {
    const loaded = readSource(file);
    if (!loaded.ok) {
      continue;
    }
    WIRE_TOKEN_SCAN.tokenPattern.lastIndex = 0;
    if (!WIRE_TOKEN_SCAN.tokenPattern.test(loaded.source)) {
      continue;
    }
    if (WIRE_TOKEN_SCAN.allowFiles.has(file)) {
      continue;
    }
    unexpected.push(file);
  }

  unexpected.sort();
  return unexpected;
}

function parseRegisteredActionTypes() {
  const loaded = readSource(REGISTRY_FILE);
  if (!loaded.ok) {
    return {
      ok: false,
      registeredActions: [],
      nonAtomicActions: [],
      error: loaded.error,
    };
  }

  const source = loaded.source;
  const registerRegex = /registry\.Register(?:<[^>]+>)?\(\s*"([a-z][a-z0-9_]{2,63})"/g;
  const registered = new Set();
  let match = registerRegex.exec(source);
  while (match) {
    registered.add(match[1]);
    match = registerRegex.exec(source);
  }

  const nonAtomicRegex =
    /"([a-z][a-z0-9_]{2,63})"[\s\S]{0,800}?McpActionGovernance\.UndoSafetyNonAtomic/g;
  const nonAtomic = new Set();
  match = nonAtomicRegex.exec(source);
  while (match) {
    nonAtomic.add(match[1]);
    match = nonAtomicRegex.exec(source);
  }

  return {
    ok: true,
    registeredActions: [...registered].sort(),
    nonAtomicActions: [...nonAtomic].sort(),
    error: "",
  };
}

function parseAtomicBaseCoverageActionTypes() {
  const files = listFilesRecursive(EDIT_MODE_TEST_DIR, ".cs");
  const covered = new Set();
  const coverageFiles = [];

  const classRegex =
    /class\s+[A-Za-z0-9_]+\s*:\s*AtomicActionTestBase[\s\S]*?protected\s+override\s+string\s+ActionType[\s\S]*?(?:=>\s*"([^"]+)"|return\s+"([^"]+)")/g;

  for (const file of files) {
    const loaded = readSource(file);
    if (!loaded.ok) {
      continue;
    }

    let hasCoverage = false;
    classRegex.lastIndex = 0;
    let match = classRegex.exec(loaded.source);
    while (match) {
      const actionType = (match[1] || match[2] || "").trim();
      if (actionType) {
        covered.add(actionType);
        hasCoverage = true;
      }
      match = classRegex.exec(loaded.source);
    }
    if (hasCoverage) {
      coverageFiles.push(file);
    }
  }

  coverageFiles.sort();
  return {
    coveredActions: [...covered].sort(),
    coverageFiles,
  };
}

function buildAtomicCoverageReport() {
  const baseLoaded = readSource(ATOMIC_BASE_FILE);
  const registry = parseRegisteredActionTypes();
  const coverage = parseAtomicBaseCoverageActionTypes();

  const failures = [];
  if (!baseLoaded.ok) {
    failures.push(`[atomic-base] ${baseLoaded.error}`);
  }
  if (!registry.ok) {
    failures.push(`[atomic-registry] ${registry.error}`);
  }

  const registeredAtomic = new Set();
  for (const actionType of registry.registeredActions || []) {
    if (actionType === COMPOSITE_ACTION_TYPE) {
      continue;
    }
    if ((registry.nonAtomicActions || []).includes(actionType)) {
      continue;
    }
    registeredAtomic.add(actionType);
  }

  const covered = new Set(coverage.coveredActions || []);
  const missing = [...registeredAtomic].filter((item) => !covered.has(item)).sort();

  return {
    failures,
    hasAtomicBase: baseLoaded.ok,
    atomicActionTypes: [...registeredAtomic].sort(),
    coveredActionTypes: [...covered].sort(),
    missingActionTypes: missing,
    coverageFiles: coverage.coverageFiles || [],
    nonAtomicActionTypes: registry.nonAtomicActions || [],
  };
}

function runGuard(options) {
  const opts = options && typeof options === "object" ? options : {};
  const strictAtomic = opts.strictAtomic === true;

  const failures = [];
  const warnings = [];

  const wireMarkerReport = checkWireMarkers();
  failures.push(...wireMarkerReport.failures);

  const suggestionReport = checkErrorSuggestionLeak();
  failures.push(...suggestionReport.failures);

  const unexpectedTokenFiles = scanUnexpectedWireTokenFiles();
  if (unexpectedTokenFiles.length > 0) {
    failures.push(
      `[wire-leak] unexpected wire token references outside allowlist: ${unexpectedTokenFiles.join(
        ", "
      )}`
    );
  }

  const atomicReport = buildAtomicCoverageReport();
  failures.push(...atomicReport.failures);
  if (atomicReport.missingActionTypes.length > 0) {
    const message =
      `[atomic-coverage] missing AtomicActionTestBase coverage for: ${atomicReport.missingActionTypes.join(
        ", "
      )}`;
    if (strictAtomic) {
      failures.push(message);
    } else {
      warnings.push(message);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    strict_atomic: strictAtomic,
    wire: {
      marker_checks: wireMarkerReport.checks,
      unexpected_token_files: unexpectedTokenFiles,
      error_feedback_suggestion: suggestionReport.suggestion,
    },
    atomic_coverage: {
      has_atomic_base: atomicReport.hasAtomicBase,
      atomic_action_types: atomicReport.atomicActionTypes,
      covered_action_types: atomicReport.coveredActionTypes,
      missing_action_types: atomicReport.missingActionTypes,
      non_atomic_action_types: atomicReport.nonAtomicActionTypes,
      coverage_files: atomicReport.coverageFiles,
    },
    failures,
    warnings,
  };

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    report,
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const strictAtomic = args.includes("--strict-atomic");
  const jsonOnly = args.includes("--json");
  const result = runGuard({ strictAtomic });

  if (jsonOnly) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    // eslint-disable-next-line no-console
    console.log("[r16-wire-guard] generated_at:", result.report.generated_at);
    // eslint-disable-next-line no-console
    console.log(
      "[r16-wire-guard] atomic coverage:",
      `${result.report.atomic_coverage.covered_action_types.length}/` +
        `${result.report.atomic_coverage.atomic_action_types.length}`
    );
    if (result.warnings.length > 0) {
      for (const warning of result.warnings) {
        // eslint-disable-next-line no-console
        console.warn("[r16-wire-guard] WARN", warning);
      }
    }
    if (result.failures.length > 0) {
      for (const failure of result.failures) {
        // eslint-disable-next-line no-console
        console.error("[r16-wire-guard] FAIL", failure);
      }
    } else {
      // eslint-disable-next-line no-console
      console.log("[r16-wire-guard] PASS");
    }
  }

  process.exitCode = result.ok ? 0 : 1;
}

module.exports = {
  REQUIRED_WIRE_MARKERS,
  WIRE_TOKEN_SCAN,
  REGISTRY_FILE,
  EDIT_MODE_TEST_DIR,
  ATOMIC_BASE_FILE,
  COMPOSITE_ACTION_TYPE,
  runGuard,
};

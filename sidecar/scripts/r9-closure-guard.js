#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const GUARD_RULES = Object.freeze([
  {
    file: "sidecar/src/application/unityDispatcher/runtimeUtils.js",
    forbidden: [
      {
        pattern: /\btask_allocation\b/,
        reason: "legacy task_allocation fallback must not re-enter runtime dispatcher",
      },
    ],
  },
  {
    file: "sidecar/src/application/mcpGateway/mcpGateway.js",
    forbidden: [
      {
        pattern: /payload\.action\.type/,
        reason: "legacy payload.action.type -> action_type compatibility bridge is forbidden",
      },
      {
        pattern: /\bmcpJobsById\b/,
        reason: "legacy mcpJobsById fallback map must not be used",
      },
    ],
  },
  {
    file: "Assets/Editor/Codex/Infrastructure/UnityVisualActionExecutor.cs",
    forbidden: [
      {
        pattern: /switch\s*\(\s*actionType\s*\)/,
        reason: "legacy switch(actionType) executor branch is forbidden",
      },
      {
        pattern:
          /ExecuteAddComponent\s*\(|ExecuteRemoveComponent\s*\(|ExecuteReplaceComponent\s*\(|ExecuteCreateGameObject\s*\(/,
        reason: "legacy ExecuteAdd/Remove/Replace/Create entry methods must not exist",
      },
    ],
  },
  {
    file: "Assets/Editor/Codex/Application/ConversationController.cs",
    forbidden: [
      {
        pattern:
          /string\.Equals\(action\.type,\s*"(add_component|remove_component|replace_component|create_gameobject)"/,
        reason: "hardcoded action-type payload validation branches are forbidden",
      },
    ],
  },
]);

function scanRule(rule) {
  const relativePath = String(rule && rule.file ? rule.file : "");
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return [
      {
        file: relativePath,
        error: `file missing: ${relativePath}`,
      },
    ];
  }

  const source = fs.readFileSync(absolutePath, "utf8");
  const issues = [];
  const forbidden = Array.isArray(rule && rule.forbidden) ? rule.forbidden : [];
  for (const entry of forbidden) {
    const pattern = entry && entry.pattern;
    if (!(pattern instanceof RegExp)) {
      continue;
    }
    if (pattern.test(source)) {
      issues.push({
        file: relativePath,
        pattern: String(pattern),
        reason: entry.reason || "forbidden legacy fragment detected",
      });
    }
  }
  return issues;
}

function runGuard() {
  const failures = [];
  for (const rule of GUARD_RULES) {
    const issues = scanRule(rule);
    for (const issue of issues) {
      failures.push(issue);
    }
  }
  return {
    ok: failures.length === 0,
    failures,
  };
}

function printFailures(failures) {
  for (const item of failures) {
    const file = item && item.file ? item.file : "<unknown>";
    if (item && item.error) {
      // eslint-disable-next-line no-console
      console.error(`[r9-closure-guard] FAIL ${file} :: ${item.error}`);
      continue;
    }
    const pattern = item && item.pattern ? item.pattern : "<unknown-pattern>";
    const reason = item && item.reason ? item.reason : "forbidden fragment found";
    // eslint-disable-next-line no-console
    console.error(`[r9-closure-guard] FAIL ${file} :: ${pattern} :: ${reason}`);
  }
}

if (require.main === module) {
  const result = runGuard();
  if (!result.ok) {
    printFailures(result.failures);
    process.exitCode = 1;
  } else {
    // eslint-disable-next-line no-console
    console.log("[r9-closure-guard] PASS");
  }
}

module.exports = {
  GUARD_RULES,
  runGuard,
};

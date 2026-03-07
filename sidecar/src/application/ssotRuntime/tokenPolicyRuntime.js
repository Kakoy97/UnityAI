"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_TOKEN_POLICY_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/token-policy.generated.json"
);

let tokenPolicyRuntimeSingleton = null;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readJsonFileStrict(filePath, label) {
  let rawText = "";
  try {
    rawText = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `[ssot.token.policy] missing ${label} artifact: ${filePath} (${error.message})`
    );
  }
  if (!rawText.trim()) {
    throw new Error(
      `[ssot.token.policy] empty ${label} artifact: ${filePath}`
    );
  }
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `[ssot.token.policy] invalid JSON for ${label} artifact: ${filePath} (${error.message})`
    );
  }
}

function readNonEmptyUniqueStringArray(value, fieldName, filePath) {
  if (!Array.isArray(value)) {
    throw new Error(
      `[ssot.token.policy] invalid token-policy artifact: "${fieldName}" must be an array (${filePath})`
    );
  }
  const output = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = normalizeString(item);
    if (!normalized) {
      throw new Error(
        `[ssot.token.policy] invalid token-policy artifact: "${fieldName}" contains empty value (${filePath})`
      );
    }
    if (seen.has(normalized)) {
      throw new Error(
        `[ssot.token.policy] invalid token-policy artifact: "${fieldName}" contains duplicated value '${normalized}' (${filePath})`
      );
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function normalizeTokenPolicyContract(rawContract, filePath) {
  const source =
    rawContract && typeof rawContract === "object" && !Array.isArray(rawContract)
      ? rawContract
      : {};
  const tokenFamilies = readNonEmptyUniqueStringArray(
    source.token_families,
    "contract.token_families",
    filePath
  );
  const successContinuation = readNonEmptyUniqueStringArray(
    source.success_continuation,
    "contract.success_continuation",
    filePath
  );
  const autoRetrySafeFamily = readNonEmptyUniqueStringArray(
    source.auto_retry_safe_family,
    "contract.auto_retry_safe_family",
    filePath
  );
  const tokenFamilySet = new Set(tokenFamilies);
  for (const familyName of autoRetrySafeFamily) {
    if (!tokenFamilySet.has(familyName)) {
      throw new Error(
        `[ssot.token.policy] invalid token-policy artifact: auto_retry_safe_family references unknown family '${familyName}' (${filePath})`
      );
    }
  }

  const driftRecovery =
    source.drift_recovery &&
    typeof source.drift_recovery === "object" &&
    !Array.isArray(source.drift_recovery)
      ? source.drift_recovery
      : {};
  const redactionPolicy =
    source.redaction_policy &&
    typeof source.redaction_policy === "object" &&
    !Array.isArray(source.redaction_policy)
      ? source.redaction_policy
      : {};
  const autoRetryPolicy =
    source.auto_retry_policy &&
    typeof source.auto_retry_policy === "object" &&
    !Array.isArray(source.auto_retry_policy)
      ? source.auto_retry_policy
      : {};

  const stripFields = readNonEmptyUniqueStringArray(
    redactionPolicy.strip_fields,
    "contract.redaction_policy.strip_fields",
    filePath
  );

  return {
    issuance_authority: normalizeString(source.issuance_authority),
    token_families: tokenFamilies,
    success_continuation: successContinuation,
    drift_recovery: {
      enabled: driftRecovery.enabled === true,
      error_code: normalizeString(driftRecovery.error_code),
      max_retry:
        Number.isFinite(Number(driftRecovery.max_retry)) &&
        Number(driftRecovery.max_retry) >= 0
          ? Math.floor(Number(driftRecovery.max_retry))
          : 0,
      requires_idempotency: driftRecovery.requires_idempotency === true,
      refresh_tool_name: normalizeString(driftRecovery.refresh_tool_name),
    },
    redaction_policy: {
      strip_fields: stripFields,
    },
    auto_retry_policy: {
      max_retry:
        Number.isFinite(Number(autoRetryPolicy.max_retry)) &&
        Number(autoRetryPolicy.max_retry) >= 0
          ? Math.floor(Number(autoRetryPolicy.max_retry))
          : 0,
      requires_idempotency_key:
        autoRetryPolicy.requires_idempotency_key === true,
      on_retry_failure: normalizeString(autoRetryPolicy.on_retry_failure),
    },
    auto_retry_safe_family: autoRetrySafeFamily,
  };
}

function normalizeToolPolicyRow(rawRow, index, filePath, tokenFamilySet) {
  const source =
    rawRow && typeof rawRow === "object" && !Array.isArray(rawRow) ? rawRow : {};
  const name = normalizeString(source.name);
  if (!name) {
    throw new Error(
      `[ssot.token.policy] invalid token-policy artifact: tools[${index}].name is required (${filePath})`
    );
  }
  const kind = normalizeString(source.kind).toLowerCase();
  if (kind !== "read" && kind !== "write") {
    throw new Error(
      `[ssot.token.policy] invalid token-policy artifact: tools[${index}].kind must be read/write (${filePath})`
    );
  }
  const tokenFamily = normalizeString(source.token_family);
  if (!tokenFamily || !tokenFamilySet.has(tokenFamily)) {
    throw new Error(
      `[ssot.token.policy] invalid token-policy artifact: tools[${index}].token_family is unknown (${filePath})`
    );
  }
  const sceneRevisionCapable = source.scene_revision_capable === true;
  const requiresBasedOnReadToken = source.requires_based_on_read_token === true;
  const declaresBasedOnReadToken = source.declares_based_on_read_token === true;
  if (tokenFamily === "write_requires_token" && requiresBasedOnReadToken !== true) {
    throw new Error(
      `[ssot.token.policy] invalid token-policy artifact: write_requires_token tool '${name}' must require based_on_read_token (${filePath})`
    );
  }
  if (tokenFamily !== "local_static_no_token" && sceneRevisionCapable !== true) {
    throw new Error(
      `[ssot.token.policy] invalid token-policy artifact: scene revision capable flag is required for tool '${name}' (${filePath})`
    );
  }
  return {
    name,
    kind,
    lifecycle: normalizeString(source.lifecycle).toLowerCase() || "stable",
    dispatch_mode:
      normalizeString(source.dispatch_mode).toLowerCase() || "ssot_query",
    token_family: tokenFamily,
    scene_revision_capable: sceneRevisionCapable,
    auto_retry_safe: source.auto_retry_safe === true,
    requires_based_on_read_token: requiresBasedOnReadToken,
    declares_based_on_read_token: declaresBasedOnReadToken,
  };
}

function normalizeTokenPolicyManifest(rawManifest, filePath) {
  const source =
    rawManifest && typeof rawManifest === "object" && !Array.isArray(rawManifest)
      ? rawManifest
      : null;
  if (!source) {
    throw new Error(
      `[ssot.token.policy] invalid token-policy artifact: root must be an object (${filePath})`
    );
  }
  const contract = normalizeTokenPolicyContract(source.contract, filePath);
  const tokenFamilySet = new Set(contract.token_families);
  const toolRows = Array.isArray(source.tools) ? source.tools : null;
  if (!toolRows || toolRows.length <= 0) {
    throw new Error(
      `[ssot.token.policy] invalid token-policy artifact: tools must be a non-empty array (${filePath})`
    );
  }

  const tools = [];
  const toolsByName = new Map();
  for (let index = 0; index < toolRows.length; index += 1) {
    const normalized = normalizeToolPolicyRow(
      toolRows[index],
      index,
      filePath,
      tokenFamilySet
    );
    if (toolsByName.has(normalized.name)) {
      throw new Error(
        `[ssot.token.policy] invalid token-policy artifact: duplicated tool '${normalized.name}' (${filePath})`
      );
    }
    toolsByName.set(normalized.name, normalized);
    tools.push(normalized);
  }

  return {
    version:
      Number.isFinite(Number(source.version)) && Number(source.version) > 0
        ? Math.floor(Number(source.version))
        : 1,
    generated_at: normalizeString(source.generated_at),
    source:
      source.source && typeof source.source === "object" && !Array.isArray(source.source)
        ? { ...source.source }
        : {},
    contract,
    tools,
    tools_by_name: toolsByName,
  };
}

function loadTokenPolicyManifest(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const artifactPath = path.resolve(
    String(opts.artifactPath || DEFAULT_TOKEN_POLICY_PATH)
  );
  const parsed = normalizeTokenPolicyManifest(
    readJsonFileStrict(artifactPath, "token-policy"),
    artifactPath
  );
  return {
    artifactPath,
    manifest: parsed,
  };
}

function createTokenPolicyRuntime(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const loaded =
    opts.manifest && typeof opts.manifest === "object"
      ? {
          artifactPath: path.resolve(
            String(opts.artifactPath || DEFAULT_TOKEN_POLICY_PATH)
          ),
          manifest: normalizeTokenPolicyManifest(
            opts.manifest,
            path.resolve(String(opts.artifactPath || DEFAULT_TOKEN_POLICY_PATH))
          ),
        }
      : loadTokenPolicyManifest({
          artifactPath: opts.artifactPath,
        });
  const manifest = loaded.manifest;
  const contract = manifest.contract;
  const continuationKindSet = new Set(contract.success_continuation);

  function getToolPolicy(toolName) {
    const normalized = normalizeString(toolName);
    if (!normalized) {
      return null;
    }
    const row = manifest.tools_by_name.get(normalized);
    return row ? { ...row } : null;
  }

  function listToolNames() {
    return manifest.tools.map((row) => row.name);
  }

  function isToolConfigured(toolName) {
    return !!getToolPolicy(toolName);
  }

  function doesToolRequireWriteToken(toolName) {
    const row = getToolPolicy(toolName);
    return !!(row && row.token_family === "write_requires_token");
  }

  function isToolContinuationEligible(toolName) {
    const row = getToolPolicy(toolName);
    if (!row) {
      return false;
    }
    if (!row.scene_revision_capable) {
      return false;
    }
    if (!continuationKindSet.has(row.kind)) {
      return false;
    }
    return (
      row.token_family === "read_issues_token" ||
      row.token_family === "write_requires_token"
    );
  }

  function getContract() {
    return {
      ...contract,
      token_families: [...contract.token_families],
      success_continuation: [...contract.success_continuation],
      auto_retry_safe_family: [...contract.auto_retry_safe_family],
      drift_recovery: { ...contract.drift_recovery },
      redaction_policy: {
        strip_fields: [...contract.redaction_policy.strip_fields],
      },
      auto_retry_policy: { ...contract.auto_retry_policy },
    };
  }

  return {
    artifactPath: loaded.artifactPath,
    version: manifest.version,
    getContract,
    listToolNames,
    getToolPolicy,
    isToolConfigured,
    doesToolRequireWriteToken,
    isToolContinuationEligible,
  };
}

function getTokenPolicyRuntimeSingleton(options = {}) {
  const hasCustomOptions =
    options && typeof options === "object" && Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return createTokenPolicyRuntime(options);
  }
  if (!tokenPolicyRuntimeSingleton) {
    tokenPolicyRuntimeSingleton = createTokenPolicyRuntime();
  }
  return tokenPolicyRuntimeSingleton;
}

function resetTokenPolicyRuntimeSingletonForTests() {
  tokenPolicyRuntimeSingleton = null;
}

module.exports = {
  DEFAULT_TOKEN_POLICY_PATH,
  normalizeTokenPolicyManifest,
  loadTokenPolicyManifest,
  createTokenPolicyRuntime,
  getTokenPolicyRuntimeSingleton,
  resetTokenPolicyRuntimeSingletonForTests,
};

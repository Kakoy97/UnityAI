"use strict";

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringArray(value) {
  const source = Array.isArray(value) ? value : [];
  const output = [];
  const seen = new Set();
  for (const item of source) {
    const normalized = normalizeString(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  return !!fallback;
}

function normalizeTokenPolicyContract(definitions) {
  const source =
    definitions &&
    definitions.token_automation_contract &&
    typeof definitions.token_automation_contract === "object" &&
    !Array.isArray(definitions.token_automation_contract)
      ? definitions.token_automation_contract
      : {};
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

  return {
    issuance_authority: normalizeString(source.issuance_authority),
    token_families: normalizeStringArray(source.token_families),
    success_continuation: normalizeStringArray(source.success_continuation),
    drift_recovery: {
      enabled: normalizeBoolean(driftRecovery.enabled, false),
      error_code: normalizeString(driftRecovery.error_code),
      max_retry: Number.isFinite(Number(driftRecovery.max_retry))
        ? Math.max(0, Math.floor(Number(driftRecovery.max_retry)))
        : 0,
      requires_idempotency: normalizeBoolean(
        driftRecovery.requires_idempotency,
        false
      ),
      refresh_tool_name: normalizeString(driftRecovery.refresh_tool_name),
    },
    redaction_policy: {
      strip_fields: normalizeStringArray(redactionPolicy.strip_fields),
    },
    auto_retry_policy: {
      max_retry: Number.isFinite(Number(autoRetryPolicy.max_retry))
        ? Math.max(0, Math.floor(Number(autoRetryPolicy.max_retry)))
        : 0,
      requires_idempotency_key: normalizeBoolean(
        autoRetryPolicy.requires_idempotency_key,
        false
      ),
      on_retry_failure: normalizeString(autoRetryPolicy.on_retry_failure),
    },
    auto_retry_safe_family: normalizeStringArray(source.auto_retry_safe_family),
  };
}

function buildManifestCommandMap(sidecarManifest) {
  const commands =
    sidecarManifest && Array.isArray(sidecarManifest.commands)
      ? sidecarManifest.commands
      : [];
  const map = new Map();
  for (const command of commands) {
    const name = normalizeString(command && command.name);
    if (!name) {
      continue;
    }
    map.set(name, {
      dispatch_mode: normalizeString(command && command.dispatch_mode) || "ssot_query",
      kind: normalizeString(command && command.kind) || "write",
      lifecycle: normalizeString(command && command.lifecycle) || "stable",
    });
  }
  return map;
}

function deriveDefaultTokenFamily(toolKind) {
  const normalizedKind = normalizeString(toolKind).toLowerCase();
  if (normalizedKind === "read") {
    return "read_issues_token";
  }
  return "write_requires_token";
}

function resolveToolTokenFamily(tool, contract) {
  const explicit = normalizeString(tool && tool.token_family);
  if (explicit) {
    return explicit;
  }
  const fallback = deriveDefaultTokenFamily(tool && tool.kind);
  const allowedFamilies = new Set(
    Array.isArray(contract && contract.token_families) ? contract.token_families : []
  );
  if (allowedFamilies.size <= 0 || allowedFamilies.has(fallback)) {
    return fallback;
  }
  return "";
}

function toolDeclaresBasedOnReadToken(tool, definitions) {
  const source = tool && typeof tool === "object" ? tool : {};
  const input =
    source.input && typeof source.input === "object" && !Array.isArray(source.input)
      ? source.input
      : {};
  const required = Array.isArray(input.required) ? input.required : [];
  const properties =
    input.properties && typeof input.properties === "object" && !Array.isArray(input.properties)
      ? input.properties
      : {};
  if (
    required.includes("based_on_read_token") &&
    Object.prototype.hasOwnProperty.call(properties, "based_on_read_token")
  ) {
    return true;
  }

  const mixins = Array.isArray(source.mixins) ? source.mixins : [];
  if (!mixins.includes("write_envelope")) {
    return false;
  }
  const writeEnvelope =
    definitions &&
    definitions.mixins &&
    definitions.mixins.write_envelope &&
    typeof definitions.mixins.write_envelope === "object"
      ? definitions.mixins.write_envelope
      : null;
  const writeEnvelopeInput =
    writeEnvelope &&
    writeEnvelope.input &&
    typeof writeEnvelope.input === "object" &&
    !Array.isArray(writeEnvelope.input)
      ? writeEnvelope.input
      : null;
  if (!writeEnvelopeInput) {
    return false;
  }
  const envelopeRequired = Array.isArray(writeEnvelopeInput.required)
    ? writeEnvelopeInput.required
    : [];
  const envelopeProperties =
    writeEnvelopeInput.properties &&
    typeof writeEnvelopeInput.properties === "object" &&
    !Array.isArray(writeEnvelopeInput.properties)
      ? writeEnvelopeInput.properties
      : {};
  return (
    envelopeRequired.includes("based_on_read_token") &&
    Object.prototype.hasOwnProperty.call(envelopeProperties, "based_on_read_token")
  );
}

function emitTokenPolicyManifest(dictionary, sidecarManifest) {
  const sourceDictionary =
    dictionary && typeof dictionary === "object" ? dictionary : {};
  const definitions =
    sourceDictionary._definitions &&
    typeof sourceDictionary._definitions === "object" &&
    !Array.isArray(sourceDictionary._definitions)
      ? sourceDictionary._definitions
      : {};
  const tools = Array.isArray(sourceDictionary.tools) ? sourceDictionary.tools : [];
  const contract = normalizeTokenPolicyContract(definitions);
  const sidecarCommandMap = buildManifestCommandMap(sidecarManifest);
  const autoRetrySafeFamilySet = new Set(contract.auto_retry_safe_family);

  const toolRows = [];
  const familyCounts = {};

  for (const tool of tools) {
    const toolName = normalizeString(tool && tool.name);
    if (!toolName) {
      continue;
    }
    const command = sidecarCommandMap.get(toolName) || null;
    const tokenFamily = resolveToolTokenFamily(tool, contract);
    familyCounts[tokenFamily] = (familyCounts[tokenFamily] || 0) + 1;
    const row = {
      name: toolName,
      kind: normalizeString(tool && tool.kind) || "write",
      lifecycle: normalizeString(tool && tool.lifecycle) || "stable",
      dispatch_mode: command ? command.dispatch_mode : "ssot_query",
      token_family: tokenFamily,
      scene_revision_capable: normalizeBoolean(
        tool && tool.scene_revision_capable,
        tokenFamily !== "local_static_no_token"
      ),
      auto_retry_safe: autoRetrySafeFamilySet.has(tokenFamily),
      requires_based_on_read_token: tokenFamily === "write_requires_token",
      declares_based_on_read_token: toolDeclaresBasedOnReadToken(tool, definitions),
    };
    toolRows.push(row);
  }

  return {
    version:
      Number.isFinite(Number(sourceDictionary.version))
        ? Number(sourceDictionary.version)
        : 1,
    generated_at: "",
    source: {
      dictionary_path: "ssot/dictionary/tools.json",
      sidecar_manifest_path: "ssot/artifacts/l2/sidecar-command-manifest.generated.json",
    },
    contract,
    tools: toolRows,
    summary: {
      total_tools: toolRows.length,
      family_counts: familyCounts,
      auto_retry_safe_tools: toolRows
        .filter((item) => item.auto_retry_safe)
        .map((item) => item.name),
      write_requires_token_missing_based_on_read_token: toolRows
        .filter(
          (item) =>
            item.token_family === "write_requires_token" &&
            item.declares_based_on_read_token !== true
        )
        .map((item) => item.name),
      scene_revision_ineligible_tools: toolRows
        .filter(
          (item) =>
            (item.token_family === "read_issues_token" ||
              item.token_family === "write_requires_token") &&
            item.scene_revision_capable !== true
        )
        .map((item) => item.name),
    },
  };
}

module.exports = {
  emitTokenPolicyManifest,
};


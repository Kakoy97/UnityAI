"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SSOT_TOOL_CATALOG_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/mcp-tools.generated.json"
);

const DEFAULT_SSOT_AJV_SCHEMAS_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/ajv-schemas.generated.json"
);

const DEFAULT_SIDECAR_COMMAND_MANIFEST_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/sidecar-command-manifest.generated.json"
);

const DEFAULT_VISIBILITY_POLICY_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/visibility-policy.generated.json"
);

function readJsonFileStrict(filePath, label) {
  let rawText = "";
  try {
    rawText = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `[ssot.startup.guard] missing ${label} artifact: ${filePath} (${error.message})`
    );
  }
  if (!rawText.trim()) {
    throw new Error(
      `[ssot.startup.guard] empty ${label} artifact: ${filePath}`
    );
  }
  try {
    return JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `[ssot.startup.guard] invalid JSON for ${label} artifact: ${filePath} (${error.message})`
    );
  }
}

function normalizeToolName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readNonEmptyUniqueStringArray(value, fieldName, filePath) {
  if (!Array.isArray(value)) {
    throw new Error(
      `[ssot.startup.guard] invalid visibility-policy artifact: "${fieldName}" must be an array (${filePath})`
    );
  }

  const output = [];
  const seen = new Set();
  for (const item of value) {
    const normalized = normalizeToolName(item);
    if (!normalized) {
      throw new Error(
        `[ssot.startup.guard] invalid visibility-policy artifact: "${fieldName}" contains empty tool name (${filePath})`
      );
    }
    if (seen.has(normalized)) {
      throw new Error(
        `[ssot.startup.guard] invalid visibility-policy artifact: "${fieldName}" contains duplicated tool name '${normalized}' (${filePath})`
      );
    }
    seen.add(normalized);
    output.push(normalized);
  }

  return output;
}

function parseVisibilityPolicyArtifact(rawPolicy, visibilityPolicyPath) {
  if (!rawPolicy || typeof rawPolicy !== "object" || Array.isArray(rawPolicy)) {
    throw new Error(
      `[ssot.startup.guard] invalid visibility-policy artifact: root must be an object (${visibilityPolicyPath})`
    );
  }

  const removedToolNames = readNonEmptyUniqueStringArray(
    rawPolicy.removed_tool_names,
    "removed_tool_names",
    visibilityPolicyPath
  );
  const exposedToolNames = readNonEmptyUniqueStringArray(
    rawPolicy.exposed_tool_names,
    "exposed_tool_names",
    visibilityPolicyPath
  );
  const deprecatedToolNames = readNonEmptyUniqueStringArray(
    rawPolicy.deprecated_tool_names,
    "deprecated_tool_names",
    visibilityPolicyPath
  );
  const activeToolNames = readNonEmptyUniqueStringArray(
    rawPolicy.active_tool_names,
    "active_tool_names",
    visibilityPolicyPath
  );
  const localStaticToolNames = readNonEmptyUniqueStringArray(
    rawPolicy.local_static_tool_names,
    "local_static_tool_names",
    visibilityPolicyPath
  );

  const deprecatedToolNameSet = new Set(deprecatedToolNames);
  const removedToolNameSet = new Set(removedToolNames);
  for (const toolName of activeToolNames) {
    if (deprecatedToolNameSet.has(toolName)) {
      throw new Error(
        `[ssot.startup.guard] invalid visibility-policy artifact: active tool cannot be deprecated (${toolName}) (${visibilityPolicyPath})`
      );
    }
    if (removedToolNameSet.has(toolName)) {
      throw new Error(
        `[ssot.startup.guard] invalid visibility-policy artifact: active tool cannot be removed (${toolName}) (${visibilityPolicyPath})`
      );
    }
  }

  return {
    ...rawPolicy,
    removed_tool_names: removedToolNames,
    exposed_tool_names: exposedToolNames,
    deprecated_tool_names: deprecatedToolNames,
    active_tool_names: activeToolNames,
    local_static_tool_names: localStaticToolNames,
  };
}

function loadVisibilityPolicyArtifact(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const visibilityPolicyPath = path.resolve(
    String(opts.visibilityPolicyPath || DEFAULT_VISIBILITY_POLICY_PATH)
  );
  const rawPolicy = readJsonFileStrict(visibilityPolicyPath, "visibility-policy");
  const visibilityPolicy = parseVisibilityPolicyArtifact(
    rawPolicy,
    visibilityPolicyPath
  );
  return {
    visibilityPolicyPath,
    visibilityPolicy,
  };
}

function parseSidecarCommandManifestArtifact(rawManifest, manifestPath) {
  if (
    !rawManifest ||
    typeof rawManifest !== "object" ||
    Array.isArray(rawManifest)
  ) {
    throw new Error(
      `[ssot.startup.guard] invalid sidecar-command-manifest artifact: root must be an object (${manifestPath})`
    );
  }

  const rawCommands = Array.isArray(rawManifest.commands)
    ? rawManifest.commands
    : [];
  if (rawCommands.length <= 0) {
    throw new Error(
      `[ssot.startup.guard] invalid sidecar-command-manifest artifact: "commands" must be a non-empty array (${manifestPath})`
    );
  }

  const output = [];
  const seen = new Set();
  for (const item of rawCommands) {
    const source = item && typeof item === "object" ? item : {};
    const name = normalizeToolName(source.name);
    if (!name) {
      throw new Error(
        `[ssot.startup.guard] invalid sidecar-command-manifest artifact: command name must be non-empty (${manifestPath})`
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `[ssot.startup.guard] invalid sidecar-command-manifest artifact: duplicated command name '${name}' (${manifestPath})`
      );
    }
    seen.add(name);

    const kind = normalizeToolName(source.kind).toLowerCase();
    if (kind !== "read" && kind !== "write") {
      throw new Error(
        `[ssot.startup.guard] invalid sidecar-command-manifest artifact: command '${name}' kind must be read/write (${manifestPath})`
      );
    }

    const transaction =
      source.transaction && typeof source.transaction === "object"
        ? source.transaction
        : null;
    if (
      !transaction ||
      typeof transaction.enabled !== "boolean" ||
      typeof transaction.undo_safe !== "boolean"
    ) {
      throw new Error(
        `[ssot.startup.guard] invalid sidecar-command-manifest artifact: command '${name}' transaction.enabled/transaction.undo_safe must be booleans (${manifestPath})`
      );
    }

    if (transaction.enabled === true && kind !== "write") {
      throw new Error(
        `[ssot.startup.guard] invalid sidecar-command-manifest artifact: read command '${name}' cannot be transaction-enabled (${manifestPath})`
      );
    }

    output.push({
      name,
      kind,
      lifecycle: normalizeToolName(source.lifecycle).toLowerCase() || "stable",
      dispatch_mode:
        normalizeToolName(source.dispatch_mode).toLowerCase() || "ssot_query",
      transaction: {
        enabled: transaction.enabled === true,
        undo_safe: transaction.undo_safe === true,
      },
    });
  }

  return {
    ...rawManifest,
    commands: output,
  };
}

function loadSidecarCommandManifestArtifact(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const sidecarCommandManifestPath = path.resolve(
    String(
      opts.sidecarCommandManifestPath || DEFAULT_SIDECAR_COMMAND_MANIFEST_PATH
    )
  );
  const rawManifest = readJsonFileStrict(
    sidecarCommandManifestPath,
    "sidecar-command-manifest"
  );
  const sidecarCommandManifest = parseSidecarCommandManifestArtifact(
    rawManifest,
    sidecarCommandManifestPath
  );
  return {
    sidecarCommandManifestPath,
    sidecarCommandManifest,
  };
}

function assertSsotArtifactsAvailable(options = {}) {
  const opts = options && typeof options === "object" ? options : {};
  const toolCatalogPath = path.resolve(
    String(opts.toolCatalogPath || DEFAULT_SSOT_TOOL_CATALOG_PATH)
  );
  const ajvSchemasPath = path.resolve(
    String(opts.ajvSchemasPath || DEFAULT_SSOT_AJV_SCHEMAS_PATH)
  );

  const toolCatalog = readJsonFileStrict(toolCatalogPath, "mcp-tools");
  const tools = Array.isArray(toolCatalog && toolCatalog.tools)
    ? toolCatalog.tools
    : [];
  if (tools.length <= 0) {
    throw new Error(
      `[ssot.startup.guard] invalid mcp-tools artifact: "tools" must be a non-empty array (${toolCatalogPath})`
    );
  }

  const compiledSchemas = readJsonFileStrict(ajvSchemasPath, "ajv-schemas");
  const schemas = Array.isArray(compiledSchemas && compiledSchemas.schemas)
    ? compiledSchemas.schemas
    : [];
  if (schemas.length <= 0) {
    throw new Error(
      `[ssot.startup.guard] invalid ajv-schemas artifact: "schemas" must be a non-empty array (${ajvSchemasPath})`
    );
  }

  const { visibilityPolicyPath, visibilityPolicy } = loadVisibilityPolicyArtifact({
    visibilityPolicyPath: opts.visibilityPolicyPath,
  });
  const { sidecarCommandManifestPath, sidecarCommandManifest } =
    loadSidecarCommandManifestArtifact({
      sidecarCommandManifestPath: opts.sidecarCommandManifestPath,
    });

  return {
    toolCatalogPath,
    ajvSchemasPath,
    visibilityPolicyPath,
    sidecarCommandManifestPath,
    toolCount: tools.length,
    schemaCount: schemas.length,
    visibilityPolicyActiveToolCount: visibilityPolicy.active_tool_names.length,
    visibilityPolicyDeprecatedToolCount:
      visibilityPolicy.deprecated_tool_names.length,
    visibilityPolicyRemovedToolCount: visibilityPolicy.removed_tool_names.length,
    sidecarCommandCount: sidecarCommandManifest.commands.length,
  };
}

module.exports = {
  DEFAULT_SSOT_TOOL_CATALOG_PATH,
  DEFAULT_SSOT_AJV_SCHEMAS_PATH,
  DEFAULT_SIDECAR_COMMAND_MANIFEST_PATH,
  DEFAULT_VISIBILITY_POLICY_PATH,
  loadVisibilityPolicyArtifact,
  loadSidecarCommandManifestArtifact,
  assertSsotArtifactsAvailable,
};

"use strict";

const DEPRECATED_LIFECYCLE_SET = new Set(["deprecated", "retired"]);

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLifecycle(value) {
  return normalizeString(value).toLowerCase();
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

function deriveDeprecatedToolNames(dictionary) {
  const tools = Array.isArray(dictionary && dictionary.tools)
    ? dictionary.tools
    : [];
  const output = [];
  const seen = new Set();
  for (const tool of tools) {
    const toolName = normalizeString(tool && tool.name);
    if (!toolName || seen.has(toolName)) {
      continue;
    }
    const lifecycle = normalizeLifecycle(tool && tool.lifecycle);
    if (!DEPRECATED_LIFECYCLE_SET.has(lifecycle)) {
      continue;
    }
    seen.add(toolName);
    output.push(toolName);
  }
  return output;
}

function deriveRemovedToolNames(dictionary) {
  const defs =
    dictionary &&
    dictionary._definitions &&
    typeof dictionary._definitions === "object"
      ? dictionary._definitions
      : {};
  return normalizeStringArray(defs.removed_tool_names);
}

function deriveExposedToolNames(sidecarManifest) {
  const commands =
    sidecarManifest &&
    Array.isArray(sidecarManifest.commands)
      ? sidecarManifest.commands
      : [];
  return normalizeStringArray(commands.map((command) => command && command.name));
}

function deriveLocalStaticToolNames(sidecarManifest) {
  const commands =
    sidecarManifest &&
    Array.isArray(sidecarManifest.commands)
      ? sidecarManifest.commands
      : [];
  return normalizeStringArray(
    commands
      .filter(
        (command) =>
          normalizeLifecycle(command && command.dispatch_mode) === "local_static"
      )
      .map((command) => command && command.name)
  );
}

function buildActiveToolNames(exposedToolNames, deprecatedToolNames, removedToolNames) {
  const deprecatedSet = new Set(deprecatedToolNames);
  const removedSet = new Set(removedToolNames);
  return exposedToolNames.filter(
    (toolName) => !deprecatedSet.has(toolName) && !removedSet.has(toolName)
  );
}

function emitVisibilityPolicyManifest(dictionary, sidecarManifest) {
  const tools = Array.isArray(dictionary && dictionary.tools) ? dictionary.tools : [];
  const exposedToolNames = deriveExposedToolNames(sidecarManifest);
  const deprecatedToolNames = deriveDeprecatedToolNames(dictionary);
  const removedToolNames = deriveRemovedToolNames(dictionary);
  const localStaticToolNames = deriveLocalStaticToolNames(sidecarManifest);
  const activeToolNames = buildActiveToolNames(
    exposedToolNames,
    deprecatedToolNames,
    removedToolNames
  );

  const exposedSet = new Set(exposedToolNames);
  const deprecatedSet = new Set(deprecatedToolNames);
  const removedSet = new Set(removedToolNames);
  const excludedDeprecated = [...deprecatedSet].filter((name) =>
    exposedSet.has(name)
  ).length;
  const excludedRemoved = [...removedSet].filter((name) =>
    exposedSet.has(name)
  ).length;

  return {
    version:
      Number.isFinite(Number(dictionary && dictionary.version))
        ? Number(dictionary.version)
        : 1,
    generated_at: "",
    source: {
      dictionary_path: "ssot/dictionary/tools.json",
      sidecar_manifest_path: "ssot/artifacts/l2/sidecar-command-manifest.generated.json",
    },
    removed_tool_names: removedToolNames,
    exposed_tool_names: exposedToolNames,
    deprecated_tool_names: deprecatedToolNames,
    active_tool_names: activeToolNames,
    local_static_tool_names: localStaticToolNames,
    metadata: {
      total_dictionary_tools: tools.length,
      total_exposed_tools: exposedToolNames.length,
      excluded_removed: excludedRemoved,
      excluded_deprecated: excludedDeprecated,
    },
  };
}

module.exports = {
  emitVisibilityPolicyManifest,
};


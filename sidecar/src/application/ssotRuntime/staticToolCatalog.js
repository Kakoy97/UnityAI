"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_SSOT_MCP_TOOLS_PATH = path.resolve(
  __dirname,
  "../../../../ssot/artifacts/l2/mcp-tools.generated.json"
);

let staticToolCatalogSingleton = null;

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateQuickFixSemantic({
  fix,
  label,
  errorCode,
  nameMap,
  allowNestedRoutes = true,
}) {
  if (!isPlainObject(fix)) {
    return;
  }
  const suggestedAction =
    typeof fix.suggested_action === "string" ? fix.suggested_action.trim() : "";
  if (suggestedAction && !nameMap.has(suggestedAction)) {
    throw new Error(
      `${label} common_error_fixes.${errorCode}.suggested_action references unknown tool '${suggestedAction}'`
    );
  }
  const suggestedTool =
    typeof fix.suggested_tool === "string" ? fix.suggested_tool.trim() : "";
  if (suggestedTool && !nameMap.has(suggestedTool)) {
    throw new Error(
      `${label} common_error_fixes.${errorCode}.suggested_tool references unknown tool '${suggestedTool}'`
    );
  }

  const fixSteps = Array.isArray(fix.fix_steps) ? fix.fix_steps : [];
  let lastStepIndex = 0;
  for (let index = 0; index < fixSteps.length; index += 1) {
    const step = fixSteps[index];
    if (!isPlainObject(step)) {
      throw new Error(
        `${label} common_error_fixes.${errorCode}.fix_steps[${index}] must be an object`
      );
    }
    const stepOrder = Number(step.step);
    if (!Number.isFinite(stepOrder) || stepOrder < 1) {
      throw new Error(
        `${label} common_error_fixes.${errorCode}.fix_steps[${index}].step must be >= 1`
      );
    }
    const normalizedStepOrder = Math.floor(stepOrder);
    if (normalizedStepOrder <= lastStepIndex) {
      throw new Error(
        `${label} common_error_fixes.${errorCode}.fix_steps[${index}].step must be strictly increasing`
      );
    }
    lastStepIndex = normalizedStepOrder;
    const stepToolName = typeof step.tool === "string" ? step.tool.trim() : "";
    if (!stepToolName || !nameMap.has(stepToolName)) {
      throw new Error(
        `${label} common_error_fixes.${errorCode}.fix_steps[${index}].tool references unknown tool '${step.tool}'`
      );
    }
  }
  if (fix.auto_fixable === true && fixSteps.length <= 0) {
    throw new Error(
      `${label} common_error_fixes.${errorCode} requires fix_steps when auto_fixable=true`
    );
  }

  if (Object.prototype.hasOwnProperty.call(fix, "nested_error_routes")) {
    if (!allowNestedRoutes) {
      throw new Error(
        `${label} common_error_fixes.${errorCode}.nested_error_routes is only allowed on top-level fix entries`
      );
    }
    const nestedRouteMap = fix.nested_error_routes;
    if (!isPlainObject(nestedRouteMap)) {
      throw new Error(
        `${label} common_error_fixes.${errorCode}.nested_error_routes must be an object`
      );
    }
    for (const [nestedErrorCode, nestedFix] of Object.entries(nestedRouteMap)) {
      validateQuickFixSemantic({
        fix: nestedFix,
        label: `${label} common_error_fixes.${errorCode}.nested_error_routes`,
        errorCode: nestedErrorCode,
        nameMap,
        allowNestedRoutes: false,
      });
    }
  }
}

function validateCatalogSemanticContracts({ tools, byName, sourceLabel }) {
  const toolList = Array.isArray(tools) ? tools : [];
  const nameMap = byName instanceof Map ? byName : new Map();
  for (const tool of toolList) {
    if (!tool || typeof tool !== "object") {
      continue;
    }
    const label = `static tool '${tool.name}' at ${sourceLabel}`;
    const relatedTools = Array.isArray(tool.related_tools) ? tool.related_tools : [];
    for (const relatedToolName of relatedTools) {
      if (!nameMap.has(relatedToolName)) {
        throw new Error(
          `${label} related_tools references unknown tool '${relatedToolName}'`
        );
      }
    }

    const quickFixMap =
      tool.common_error_fixes && typeof tool.common_error_fixes === "object"
        ? tool.common_error_fixes
        : {};
    for (const [errorCode, fix] of Object.entries(quickFixMap)) {
      validateQuickFixSemantic({
        fix,
        label,
        errorCode,
        nameMap,
        allowNestedRoutes: true,
      });
    }

    const combinations = Array.isArray(tool.tool_combinations) ? tool.tool_combinations : [];
    for (let index = 0; index < combinations.length; index += 1) {
      const combination = combinations[index];
      if (!isPlainObject(combination)) {
        continue;
      }
      const failureHandling = isPlainObject(combination.failure_handling)
        ? combination.failure_handling
        : null;
      if (!failureHandling) {
        continue;
      }
      if (isPlainObject(failureHandling.after_write_failure)) {
        const requiredAction =
          typeof failureHandling.after_write_failure.required_action === "string"
            ? failureHandling.after_write_failure.required_action.trim()
            : "";
        if (requiredAction && !nameMap.has(requiredAction)) {
          throw new Error(
            `${label} tool_combinations[${index}].failure_handling.after_write_failure.required_action references unknown tool '${requiredAction}'`
          );
        }
      }
    }
  }
}

function validateErrorFeedbackContract(contract, sourceLabel) {
  if (!isPlainObject(contract)) {
    return;
  }
  const label = `global error_feedback_contract at ${sourceLabel}`;
  if (
    typeof contract.catalog_version !== "string" ||
    !contract.catalog_version.trim()
  ) {
    throw new Error(`${label} catalog_version must be a non-empty string`);
  }
  const defaults = isPlainObject(contract.defaults) ? contract.defaults : null;
  if (!defaults) {
    throw new Error(`${label} defaults must be an object`);
  }
  if (
    typeof defaults.fallback_suggestion !== "string" ||
    !defaults.fallback_suggestion.trim()
  ) {
    throw new Error(`${label} defaults.fallback_suggestion must be a non-empty string`);
  }
  if (
    typeof defaults.timeout_suggestion !== "string" ||
    !defaults.timeout_suggestion.trim()
  ) {
    throw new Error(`${label} defaults.timeout_suggestion must be a non-empty string`);
  }

  const anchorCodes = Array.isArray(contract.anchor_error_codes)
    ? contract.anchor_error_codes
    : null;
  if (!anchorCodes || anchorCodes.length <= 0) {
    throw new Error(`${label} anchor_error_codes must be a non-empty array`);
  }

  const templates = isPlainObject(contract.error_templates)
    ? contract.error_templates
    : null;
  if (!templates || Object.keys(templates).length <= 0) {
    throw new Error(`${label} error_templates must be a non-empty object`);
  }

  const templateCodeSet = new Set();
  for (const [rawCode, template] of Object.entries(templates)) {
    const code = String(rawCode || "").trim().toUpperCase();
    if (!code) {
      throw new Error(`${label} error_templates contains empty error code key`);
    }
    if (!isPlainObject(template)) {
      throw new Error(`${label} error_templates.${code} must be an object`);
    }
    if (typeof template.recoverable !== "boolean") {
      throw new Error(`${label} error_templates.${code}.recoverable must be boolean`);
    }
    if (typeof template.suggestion !== "string" || !template.suggestion.trim()) {
      throw new Error(
        `${label} error_templates.${code}.suggestion must be a non-empty string`
      );
    }
    templateCodeSet.add(code);
  }

  for (const rawAnchorCode of anchorCodes) {
    const code = String(rawAnchorCode || "").trim().toUpperCase();
    if (!code) {
      throw new Error(`${label} anchor_error_codes includes empty code`);
    }
    if (!templateCodeSet.has(code)) {
      throw new Error(
        `${label} anchor_error_codes requires error_templates entry for '${code}'`
      );
    }
  }
}

function normalizeToolRecord(entry, index, sourceLabel) {
  const record = entry && typeof entry === "object" ? entry : {};
  const toolName =
    typeof record.name === "string" && record.name.trim()
      ? record.name.trim()
      : "";
  if (!toolName) {
    throw new Error(
      `Invalid static tool record at ${sourceLabel} tools[${index}]: missing name`
    );
  }
  const inputSchema =
    record.inputSchema && typeof record.inputSchema === "object"
      ? cloneJson(record.inputSchema)
      : { type: "object", additionalProperties: false, properties: {} };
  const required = Array.isArray(inputSchema.required)
    ? inputSchema.required.filter((item) => typeof item === "string")
    : [];
  const normalizeToolPriority = (value) => {
    const token = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (token === "P0" || token === "P1" || token === "P2") {
      return token;
    }
    return "P2";
  };
  return {
    name: toolName,
    kind:
      typeof record.kind === "string" && record.kind.trim()
        ? record.kind.trim()
        : "read",
    lifecycle:
      typeof record.lifecycle === "string" && record.lifecycle.trim()
        ? record.lifecycle.trim()
        : "stable",
    description:
      typeof record.description === "string" ? record.description : "",
    inputSchema,
    required,
    examples: Array.isArray(record.examples) ? cloneJson(record.examples) : [],
    tool_priority: normalizeToolPriority(record.tool_priority),
    must_configure: record.must_configure === true,
    priority_score: Number.isFinite(Number(record.priority_score))
      ? Number(record.priority_score)
      : 0,
    usage_notes:
      typeof record.usage_notes === "string" ? record.usage_notes : "",
    examples_positive: Array.isArray(record.examples_positive)
      ? cloneJson(record.examples_positive)
      : [],
    examples_negative: Array.isArray(record.examples_negative)
      ? cloneJson(record.examples_negative)
      : [],
    common_error_fixes:
      record.common_error_fixes &&
      typeof record.common_error_fixes === "object" &&
      !Array.isArray(record.common_error_fixes)
        ? cloneJson(record.common_error_fixes)
        : {},
    related_tools: Array.isArray(record.related_tools)
      ? record.related_tools
          .filter((item) => typeof item === "string" && item.trim())
          .map((item) => item.trim())
      : [],
    tool_combinations: Array.isArray(record.tool_combinations)
      ? cloneJson(record.tool_combinations)
      : [],
    property_path_rules:
      record.property_path_rules &&
      typeof record.property_path_rules === "object" &&
      !Array.isArray(record.property_path_rules)
        ? cloneJson(record.property_path_rules)
        : null,
    ux_contract:
      record.ux_contract &&
      typeof record.ux_contract === "object" &&
      !Array.isArray(record.ux_contract)
        ? cloneJson(record.ux_contract)
        : null,
    high_frequency_properties:
      record.high_frequency_properties &&
      typeof record.high_frequency_properties === "object" &&
      !Array.isArray(record.high_frequency_properties)
        ? cloneJson(record.high_frequency_properties)
        : {},
  };
}

function normalizeStaticToolCatalog(payload, sourceLabel = "<memory>") {
  const source = payload && typeof payload === "object" ? payload : {};
  const tools = Array.isArray(source.tools) ? source.tools : null;
  if (!tools) {
    throw new Error(
      `Invalid static tool catalog at ${sourceLabel}: "tools" must be an array`
    );
  }
  const byName = new Map();
  for (let index = 0; index < tools.length; index += 1) {
    const normalized = normalizeToolRecord(tools[index], index, sourceLabel);
    byName.set(normalized.name, normalized);
  }
  const normalizedTools = Array.from(byName.values());
  validateCatalogSemanticContracts({
    tools: normalizedTools,
    byName,
    sourceLabel,
  });
  const globalContracts =
    source.global_contracts &&
    typeof source.global_contracts === "object" &&
    !Array.isArray(source.global_contracts)
      ? cloneJson(source.global_contracts)
      : {};
  validateErrorFeedbackContract(globalContracts.error_feedback_contract, sourceLabel);
  return {
    version: source.version,
    globalContracts,
    tools: normalizedTools,
    byName,
  };
}

function loadStaticToolCatalog(options = {}) {
  const artifactPath = options.artifactPath
    ? path.resolve(String(options.artifactPath))
    : DEFAULT_SSOT_MCP_TOOLS_PATH;
  let rawText = "";
  try {
    rawText = fs.readFileSync(artifactPath, "utf8");
  } catch (error) {
    throw new Error(
      `Failed to read static tool catalog artifact at ${artifactPath}: ${error.message}`
    );
  }
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(
      `Invalid JSON in static tool catalog artifact ${artifactPath}: ${error.message}`
    );
  }
  const normalized = normalizeStaticToolCatalog(parsed, artifactPath);
  return {
    artifactPath,
    version: normalized.version,
    globalContracts: normalized.globalContracts,
    tools: normalized.tools,
    byName: normalized.byName,
  };
}

function getStaticToolCatalogSingleton(options = {}) {
  const hasCustomOptions =
    options &&
    typeof options === "object" &&
    Object.keys(options).length > 0;
  if (hasCustomOptions) {
    return loadStaticToolCatalog(options);
  }
  if (!staticToolCatalogSingleton) {
    staticToolCatalogSingleton = loadStaticToolCatalog();
  }
  return staticToolCatalogSingleton;
}

function resetStaticToolCatalogSingletonForTests() {
  staticToolCatalogSingleton = null;
}

module.exports = {
  DEFAULT_SSOT_MCP_TOOLS_PATH,
  normalizeStaticToolCatalog,
  loadStaticToolCatalog,
  getStaticToolCatalogSingleton,
  resetStaticToolCatalogSingletonForTests,
};

"use strict";

const { buildRetryPolicyForErrorCode } = require("../retryPolicy");
const {
  getStaticToolCatalogSingleton,
} = require("../ssotRuntime/staticToolCatalog");
const templateCatalog = require("./mcpErrorFeedbackTemplates.json");

const DEFAULT_TIMEOUT_SUGGESTION =
  "Retry once after backoff. If timeout persists, reduce task scope or inspect sidecar logs.";
const DEFAULT_FALLBACK_SUGGESTION =
  "Inspect error_code/error_message, adjust task payload, then retry if safe.";
const DEFAULT_ANCHOR_ERROR_CODES = Object.freeze([
  "E_ACTION_SCHEMA_INVALID",
  "E_TARGET_ANCHOR_CONFLICT",
  "E_TARGET_CONFLICT",
]);

function normalizeFeedbackErrorCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return code || "E_INTERNAL";
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function freezeTemplateMap(rawCatalog) {
  const source = normalizeObject(rawCatalog);
  const output = {};
  for (const [errorCode, template] of Object.entries(source)) {
    const normalizedCode = normalizeFeedbackErrorCode(errorCode);
    const templateSource = normalizeObject(template);
    const suggestion = normalizeString(templateSource.suggestion);
    if (!suggestion) {
      continue;
    }
    output[normalizedCode] = Object.freeze({
      recoverable: templateSource.recoverable === true,
      suggestion,
    });
  }
  return Object.freeze(output);
}

function freezeCodeList(rawCodes, fallbackCodes) {
  const fallback = Array.isArray(fallbackCodes) ? fallbackCodes : [];
  const source = Array.isArray(rawCodes) ? rawCodes : [];
  const output = [];
  const seen = new Set();
  const append = (value) => {
    const normalized = normalizeFeedbackErrorCode(value);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    output.push(normalized);
  };
  for (const code of source) {
    append(code);
  }
  if (output.length <= 0) {
    for (const code of fallback) {
      append(code);
    }
  }
  return Object.freeze(output);
}

function freezeDefaultSuggestions(rawDefaults) {
  const source = normalizeObject(rawDefaults);
  const timeoutSuggestion =
    normalizeString(source.timeout_suggestion) || DEFAULT_TIMEOUT_SUGGESTION;
  const fallbackSuggestion =
    normalizeString(source.fallback_suggestion) || DEFAULT_FALLBACK_SUGGESTION;
  return Object.freeze({
    timeoutSuggestion,
    fallbackSuggestion,
  });
}

function loadContractOverrides() {
  try {
    const catalog = getStaticToolCatalogSingleton();
    const globalContracts = normalizeObject(catalog && catalog.globalContracts);
    const contract = normalizeObject(globalContracts.error_feedback_contract);
    return {
      defaults: freezeDefaultSuggestions(contract.defaults),
      anchorErrorCodes: freezeCodeList(
        contract.anchor_error_codes,
        DEFAULT_ANCHOR_ERROR_CODES
      ),
      templates: freezeTemplateMap(contract.error_templates),
    };
  } catch {
    return {
      defaults: freezeDefaultSuggestions({}),
      anchorErrorCodes: freezeCodeList([], DEFAULT_ANCHOR_ERROR_CODES),
      templates: Object.freeze({}),
    };
  }
}

function mergeTemplateMaps(baseMap, overrideMap) {
  const base = normalizeObject(baseMap);
  const override = normalizeObject(overrideMap);
  return Object.freeze({
    ...base,
    ...override,
  });
}

const LOCAL_TEMPLATES = freezeTemplateMap(templateCatalog);
const CONTRACT_OVERRIDES = loadContractOverrides();

const MCP_ERROR_FEEDBACK_DEFAULT = Object.freeze({
  recoverable: false,
  timeoutSuggestion: CONTRACT_OVERRIDES.defaults.timeoutSuggestion,
  fallbackSuggestion: CONTRACT_OVERRIDES.defaults.fallbackSuggestion,
});

const MCP_ERROR_FEEDBACK_TEMPLATES = mergeTemplateMaps(
  LOCAL_TEMPLATES,
  CONTRACT_OVERRIDES.templates
);

const ANCHOR_ERROR_CODES = CONTRACT_OVERRIDES.anchorErrorCodes;

function suggestionForCode(errorCode) {
  const code = normalizeFeedbackErrorCode(errorCode);
  const template = MCP_ERROR_FEEDBACK_TEMPLATES[code];
  if (template && typeof template === "object" && normalizeString(template.suggestion)) {
    return template.suggestion;
  }
  return MCP_ERROR_FEEDBACK_DEFAULT.fallbackSuggestion;
}

const ANCHOR_RETRY_SUGGESTION = suggestionForCode("E_TARGET_ANCHOR_CONFLICT");
const OCC_STALE_SNAPSHOT_SUGGESTION = suggestionForCode("E_STALE_SNAPSHOT");

function isAnchorValidationErrorCode(value) {
  const code = normalizeFeedbackErrorCode(value);
  return ANCHOR_ERROR_CODES.includes(code);
}

function getMcpErrorFeedbackTemplate(errorCode, errorMessage) {
  const code = normalizeFeedbackErrorCode(errorCode);
  const message = typeof errorMessage === "string" ? errorMessage : "";
  const retryPolicy = buildRetryPolicyForErrorCode(code);
  if (isAnchorValidationErrorCode(code)) {
    return {
      recoverable: true,
      suggestion: suggestionForCode(code),
      retry_policy: retryPolicy,
    };
  }

  const template = MCP_ERROR_FEEDBACK_TEMPLATES[code];
  if (template && typeof template === "object") {
    return {
      recoverable: template.recoverable === true,
      suggestion: template.suggestion || MCP_ERROR_FEEDBACK_DEFAULT.fallbackSuggestion,
      retry_policy: retryPolicy,
    };
  }

  if (message.toLowerCase().includes("timeout")) {
    return {
      recoverable: MCP_ERROR_FEEDBACK_DEFAULT.recoverable,
      suggestion: MCP_ERROR_FEEDBACK_DEFAULT.timeoutSuggestion,
      retry_policy: retryPolicy,
    };
  }

  return {
    recoverable: MCP_ERROR_FEEDBACK_DEFAULT.recoverable,
    suggestion: MCP_ERROR_FEEDBACK_DEFAULT.fallbackSuggestion,
    retry_policy: retryPolicy,
  };
}

function getErrorFeedbackContractSnapshot() {
  return {
    defaults: {
      timeoutSuggestion: MCP_ERROR_FEEDBACK_DEFAULT.timeoutSuggestion,
      fallbackSuggestion: MCP_ERROR_FEEDBACK_DEFAULT.fallbackSuggestion,
    },
    anchor_error_codes: [...ANCHOR_ERROR_CODES],
    template_count: Object.keys(MCP_ERROR_FEEDBACK_TEMPLATES).length,
  };
}

module.exports = {
  ANCHOR_RETRY_SUGGESTION,
  OCC_STALE_SNAPSHOT_SUGGESTION,
  ANCHOR_ERROR_CODES,
  MCP_ERROR_FEEDBACK_TEMPLATES,
  getMcpErrorFeedbackTemplate,
  getErrorFeedbackContractSnapshot,
};

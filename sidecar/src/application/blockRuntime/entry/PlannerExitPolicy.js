"use strict";

const {
  FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE,
  LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE,
} = require("../execution/BlockToToolPlanMapper");

const PLANNER_EXIT_POLICY_VERSION = "phase1_step4_plnr007_v1";
const ESCAPE_TOOL_NAME = "get_unity_task_status";

const EXIT_ACTION = Object.freeze({
  PASSTHROUGH: "passthrough",
  FAIL_CLOSED: "fail_closed",
  ESCAPE: "escape",
});

const EXIT_REASON = Object.freeze({
  NO_FAMILY: "no_family",
  NO_TOOL: "no_tool",
  NO_SAFE_FALLBACK: "no_safe_fallback",
  EXIT_NOT_ALLOWED: "exit_not_allowed",
});

const EXIT_REASON_TO_ERROR_CODE = Object.freeze({
  [EXIT_REASON.NO_FAMILY]: "E_PLANNER_UNSUPPORTED_FAMILY",
  [EXIT_REASON.NO_TOOL]: "E_PLANNER_NO_TOOL_MAPPING",
  [EXIT_REASON.NO_SAFE_FALLBACK]: "E_PLANNER_NO_SAFE_FALLBACK",
  [EXIT_REASON.EXIT_NOT_ALLOWED]: "E_PLANNER_EXIT_NOT_ALLOWED",
});

const EXIT_REASON_TO_MESSAGE = Object.freeze({
  [EXIT_REASON.NO_FAMILY]:
    "planner fail-fast: capability family is unsupported for this block request",
  [EXIT_REASON.NO_TOOL]:
    "planner fail-fast: no concrete tool mapping is available for requested family",
  [EXIT_REASON.NO_SAFE_FALLBACK]:
    "planner fail-fast: no safe fallback path is available for requested action",
  [EXIT_REASON.EXIT_NOT_ALLOWED]:
    "planner exit backend is not allowed for requested family/tool",
});

const DEFAULT_CONTRACT = Object.freeze({
  enabled: true,
  escape_family_allowlist: Object.freeze(["write.async_ops"]),
  escape_tool_allowlist: Object.freeze([ESCAPE_TOOL_NAME]),
  never_escape_family_prefixes: Object.freeze([
    "write.hierarchy",
    "write.component_lifecycle",
    "write.object_lifecycle",
    "write.transform",
    "write.rect_layout",
    "write.ui_style",
  ]),
});

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => normalizeString(item))
    .filter((item) => !!item);
}

function familyMatchesPrefix(familyKey, familyPrefix) {
  const normalizedFamilyKey = normalizeString(familyKey).toLowerCase();
  const normalizedPrefix = normalizeString(familyPrefix).toLowerCase();
  if (!normalizedFamilyKey || !normalizedPrefix) {
    return false;
  }
  return (
    normalizedFamilyKey === normalizedPrefix ||
    normalizedFamilyKey.startsWith(`${normalizedPrefix}.`)
  );
}

function isFamilyCoveredByList(familyKey, prefixList) {
  const list = normalizeStringArray(prefixList);
  for (const prefix of list) {
    if (familyMatchesPrefix(familyKey, prefix)) {
      return true;
    }
  }
  return false;
}

function resolveBlockError(blockResult) {
  const result = normalizeObject(blockResult);
  return normalizeObject(result.error);
}

function resolveMappingMeta(blockResult) {
  const result = normalizeObject(blockResult);
  const executionMeta = normalizeObject(result.execution_meta);
  return normalizeObject(executionMeta.mapping_meta);
}

function classifyFailFastReason(blockResult) {
  const error = resolveBlockError(blockResult);
  const mappingMeta = resolveMappingMeta(blockResult);
  const blockErrorCode = normalizeString(error.block_error_code);
  if (blockErrorCode === "E_BLOCK_INTENT_KEY_UNSUPPORTED") {
    return EXIT_REASON.NO_FAMILY;
  }
  if (blockErrorCode === "E_BLOCK_FALLBACK_NOT_ALLOWED") {
    return EXIT_REASON.NO_SAFE_FALLBACK;
  }
  if (
    mappingMeta.fallback_attempted === true &&
    mappingMeta.fallback_used !== true
  ) {
    return EXIT_REASON.NO_SAFE_FALLBACK;
  }
  if (blockErrorCode === "E_BLOCK_NOT_IMPLEMENTED") {
    return EXIT_REASON.NO_TOOL;
  }
  return "";
}

function resolveFamilyKey(blockSpec, blockResult) {
  const mappingMeta = resolveMappingMeta(blockResult);
  const mappedFamilyKey = normalizeString(mappingMeta.family_key);
  if (mappedFamilyKey) {
    return mappedFamilyKey;
  }

  const block = normalizeObject(blockSpec);
  const blockType = normalizeString(block.block_type);
  const intentKey = normalizeString(block.intent_key);
  if (!blockType || !intentKey) {
    return "";
  }

  const familyMap = normalizeObject(FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[blockType]);
  if (normalizeString(familyMap[intentKey])) {
    return intentKey;
  }

  const legacyMap = normalizeObject(
    LEGACY_CONCRETE_KEY_TO_FAMILY_KEY_BY_BLOCK_TYPE[blockType]
  );
  return normalizeString(legacyMap[intentKey]);
}

function resolvePrimaryToolName(blockSpec, blockResult, familyKey) {
  const mappingMeta = resolveMappingMeta(blockResult);
  const mappedPrimaryToolName = normalizeString(mappingMeta.primary_tool_name);
  if (mappedPrimaryToolName) {
    return mappedPrimaryToolName;
  }
  const block = normalizeObject(blockSpec);
  const blockType = normalizeString(block.block_type);
  if (!blockType || !familyKey) {
    return "";
  }
  const familyMap = normalizeObject(FAMILY_KEY_TO_TOOL_BY_BLOCK_TYPE[blockType]);
  return normalizeString(familyMap[familyKey]);
}

function buildEscapePayload(toolName, blockSpec) {
  if (normalizeString(toolName) !== ESCAPE_TOOL_NAME) {
    return {
      ok: false,
      reason: "unsupported_escape_tool",
    };
  }
  const block = normalizeObject(blockSpec);
  const input = normalizeObject(block.input);
  const jobId = normalizeString(input.job_id);
  if (!jobId) {
    return {
      ok: false,
      reason: "missing_job_id",
    };
  }
  const payload = {
    job_id: jobId,
  };
  const threadId = normalizeString(input.thread_id);
  if (threadId) {
    payload.thread_id = threadId;
  }
  return {
    ok: true,
    payload,
  };
}

function buildFailClosedDecision(reason, details = {}) {
  const normalizedReason = normalizeString(reason);
  return {
    applied: true,
    action: EXIT_ACTION.FAIL_CLOSED,
    reason: normalizedReason || EXIT_REASON.EXIT_NOT_ALLOWED,
    error_code:
      EXIT_REASON_TO_ERROR_CODE[normalizedReason] ||
      EXIT_REASON_TO_ERROR_CODE[EXIT_REASON.EXIT_NOT_ALLOWED],
    error_message:
      EXIT_REASON_TO_MESSAGE[normalizedReason] ||
      EXIT_REASON_TO_MESSAGE[EXIT_REASON.EXIT_NOT_ALLOWED],
    details: normalizeObject(details),
  };
}

function createPlannerExitPolicy(contract = {}) {
  const source = normalizeObject(contract);
  const fallback = DEFAULT_CONTRACT;
  const enabled =
    typeof source.enabled === "boolean" ? source.enabled : fallback.enabled;
  const escapeFamilyAllowlist =
    normalizeStringArray(source.escape_family_allowlist).length > 0
      ? normalizeStringArray(source.escape_family_allowlist)
      : normalizeStringArray(fallback.escape_family_allowlist);
  const escapeToolAllowlist =
    normalizeStringArray(source.escape_tool_allowlist).length > 0
      ? normalizeStringArray(source.escape_tool_allowlist)
      : normalizeStringArray(fallback.escape_tool_allowlist);
  const neverEscapeFamilyPrefixes =
    normalizeStringArray(source.never_escape_family_prefixes).length > 0
      ? normalizeStringArray(source.never_escape_family_prefixes)
      : normalizeStringArray(fallback.never_escape_family_prefixes);

  return {
    version: PLANNER_EXIT_POLICY_VERSION,
    evaluate(input = {}) {
      if (enabled !== true) {
        return {
          applied: false,
          action: EXIT_ACTION.PASSTHROUGH,
          reason: "policy_disabled",
          error_code: "",
          error_message: "",
          details: {},
        };
      }

      const sourceInput = normalizeObject(input);
      const blockSpec = normalizeObject(sourceInput.block_spec);
      const blockResult = normalizeObject(sourceInput.block_result);
      if (normalizeString(blockResult.status) !== "failed") {
        return {
          applied: false,
          action: EXIT_ACTION.PASSTHROUGH,
          reason: "block_not_failed",
          error_code: "",
          error_message: "",
          details: {},
        };
      }

      const failFastReason = classifyFailFastReason(blockResult);
      if (!failFastReason) {
        return {
          applied: false,
          action: EXIT_ACTION.PASSTHROUGH,
          reason: "not_exit_policy_failure",
          error_code: "",
          error_message: "",
          details: {},
        };
      }
      if (failFastReason === EXIT_REASON.NO_FAMILY) {
        return buildFailClosedDecision(EXIT_REASON.NO_FAMILY);
      }
      if (failFastReason === EXIT_REASON.NO_SAFE_FALLBACK) {
        return buildFailClosedDecision(EXIT_REASON.NO_SAFE_FALLBACK);
      }

      const familyKey = resolveFamilyKey(blockSpec, blockResult);
      const primaryToolName = resolvePrimaryToolName(
        blockSpec,
        blockResult,
        familyKey
      );
      if (!familyKey) {
        return buildFailClosedDecision(EXIT_REASON.NO_TOOL);
      }
      if (isFamilyCoveredByList(familyKey, neverEscapeFamilyPrefixes)) {
        return buildFailClosedDecision(EXIT_REASON.EXIT_NOT_ALLOWED, {
          family_key: familyKey,
          primary_tool_name: primaryToolName,
          denied_by: "never_escape_family_prefixes",
        });
      }
      if (!isFamilyCoveredByList(familyKey, escapeFamilyAllowlist)) {
        return buildFailClosedDecision(EXIT_REASON.EXIT_NOT_ALLOWED, {
          family_key: familyKey,
          primary_tool_name: primaryToolName,
          denied_by: "escape_family_allowlist",
        });
      }
      if (!primaryToolName) {
        return buildFailClosedDecision(EXIT_REASON.NO_TOOL, {
          family_key: familyKey,
        });
      }
      if (!escapeToolAllowlist.includes(primaryToolName)) {
        return buildFailClosedDecision(EXIT_REASON.EXIT_NOT_ALLOWED, {
          family_key: familyKey,
          primary_tool_name: primaryToolName,
          denied_by: "escape_tool_allowlist",
        });
      }

      const escapePayloadOutcome = buildEscapePayload(primaryToolName, blockSpec);
      if (!escapePayloadOutcome.ok) {
        return buildFailClosedDecision(EXIT_REASON.NO_SAFE_FALLBACK, {
          family_key: familyKey,
          primary_tool_name: primaryToolName,
          payload_reason: escapePayloadOutcome.reason,
        });
      }

      return {
        applied: true,
        action: EXIT_ACTION.ESCAPE,
        reason: EXIT_REASON.NO_TOOL,
        error_code: "",
        error_message: "",
        escape_tool_name: primaryToolName,
        escape_payload: escapePayloadOutcome.payload,
        details: {
          family_key: familyKey,
          primary_tool_name: primaryToolName,
          fail_fast_reason: failFastReason,
        },
      };
    },
  };
}

module.exports = {
  PLANNER_EXIT_POLICY_VERSION,
  EXIT_ACTION,
  EXIT_REASON,
  EXIT_REASON_TO_ERROR_CODE,
  createPlannerExitPolicy,
};

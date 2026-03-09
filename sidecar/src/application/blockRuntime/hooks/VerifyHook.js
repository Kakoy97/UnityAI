"use strict";

const { BLOCK_TYPE } = require("../contracts");

const VERIFY_HOOK_VERSION = "phase1_step5_t1_v1";

const VERIFY_STATUS = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  SKIPPED: "skipped",
});

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeBlockResult(result) {
  const source = isPlainObject(result) ? result : {};
  const executionMeta = isPlainObject(source.execution_meta)
    ? { ...source.execution_meta }
    : {};
  const outputData = isPlainObject(source.output_data) ? source.output_data : {};
  return {
    ...source,
    block_id: normalizeString(source.block_id) || "unknown_block",
    status: normalizeString(source.status) || "failed",
    output_data: outputData,
    execution_meta: executionMeta,
  };
}

function normalizeBlockType(blockSpec) {
  if (!isPlainObject(blockSpec)) {
    return "";
  }
  return normalizeString(blockSpec.block_type);
}

function hasNonEmptyString(value) {
  return normalizeString(value).length > 0;
}

function buildVerifyFailure({
  normalizedResult,
  verifyFailureReason,
  verifyFailureMessage,
}) {
  const reason = normalizeString(verifyFailureReason) || "verify_rule_failed";
  const message =
    normalizeString(verifyFailureMessage) ||
    "Block verification failed by verify hook";
  return {
    ...normalizedResult,
    status: "failed",
    execution_meta: {
      ...normalizedResult.execution_meta,
      verify_status: VERIFY_STATUS.FAILED,
      verify_failure_reason: reason,
    },
    error: {
      error_code: "E_PRECONDITION_FAILED",
      block_error_code: "E_BLOCK_VERIFY_FAILED",
      error_message: message,
      recoverable: false,
      retry_policy: {
        allow_auto_retry: false,
        max_attempts: 0,
      },
      suggested_action: "inspect_block_output_data",
    },
  };
}

function buildVerifySkipped({ normalizedResult, skippedReason }) {
  const reason = normalizeString(skippedReason);
  const executionMeta = {
    ...normalizedResult.execution_meta,
    verify_status: VERIFY_STATUS.SKIPPED,
  };
  if (reason) {
    executionMeta.verify_failure_reason = reason;
  } else {
    delete executionMeta.verify_failure_reason;
  }
  return {
    ...normalizedResult,
    execution_meta: executionMeta,
  };
}

function buildVerifyPassed({ normalizedResult }) {
  return {
    ...normalizedResult,
    execution_meta: {
      ...normalizedResult.execution_meta,
      verify_status: VERIFY_STATUS.PASSED,
    },
  };
}

function evaluateVerifyRule(blockType, normalizedResult) {
  if (blockType === BLOCK_TYPE.CREATE) {
    const outputData = normalizedResult.output_data;
    if (!hasNonEmptyString(outputData.target_object_id)) {
      return {
        ok: false,
        reason: "create_target_object_id_missing",
        message:
          "Block verification failed: CREATE requires output_data.target_object_id",
      };
    }
    if (!hasNonEmptyString(outputData.target_path)) {
      return {
        ok: false,
        reason: "create_target_path_missing",
        message:
          "Block verification failed: CREATE requires output_data.target_path",
      };
    }
    return {
      ok: true,
      reason: "",
      message: "",
    };
  }

  if (blockType === BLOCK_TYPE.MUTATE) {
    const outputData = normalizedResult.output_data;
    if (Object.keys(outputData).length === 0) {
      return {
        ok: false,
        reason: "mutate_output_empty",
        message:
          "Block verification failed: MUTATE requires non-empty output_data",
      };
    }
    return {
      ok: true,
      reason: "",
      message: "",
    };
  }

  return {
    ok: true,
    reason: "",
    message: "",
  };
}

function createVerifyHook() {
  return {
    runVerify({ blockSpec, blockResult } = {}) {
      const blockType = normalizeBlockType(blockSpec);
      const normalizedResult = normalizeBlockResult(blockResult);

      if (normalizedResult.status !== "succeeded") {
        return {
          ok: true,
          verify_status: VERIFY_STATUS.SKIPPED,
          verify_failure_reason: "block_result_not_succeeded",
          block_result: buildVerifySkipped({
            normalizedResult,
            skippedReason: "block_result_not_succeeded",
          }),
        };
      }

      if (blockType === BLOCK_TYPE.READ_STATE) {
        return {
          ok: true,
          verify_status: VERIFY_STATUS.SKIPPED,
          verify_failure_reason: "read_state_no_verify",
          block_result: buildVerifySkipped({
            normalizedResult,
            skippedReason: "read_state_no_verify",
          }),
        };
      }

      if (blockType !== BLOCK_TYPE.CREATE && blockType !== BLOCK_TYPE.MUTATE) {
        return {
          ok: true,
          verify_status: VERIFY_STATUS.SKIPPED,
          verify_failure_reason: "verify_not_required_for_block_type",
          block_result: buildVerifySkipped({
            normalizedResult,
            skippedReason: "verify_not_required_for_block_type",
          }),
        };
      }

      const verifyOutcome = evaluateVerifyRule(blockType, normalizedResult);
      if (verifyOutcome.ok !== true) {
        return {
          ok: false,
          verify_status: VERIFY_STATUS.FAILED,
          verify_failure_reason: verifyOutcome.reason,
          block_result: buildVerifyFailure({
            normalizedResult,
            verifyFailureReason: verifyOutcome.reason,
            verifyFailureMessage: verifyOutcome.message,
          }),
        };
      }

      return {
        ok: true,
        verify_status: VERIFY_STATUS.PASSED,
        verify_failure_reason: "",
        block_result: buildVerifyPassed({
          normalizedResult,
        }),
      };
    },
  };
}

module.exports = {
  VERIFY_HOOK_VERSION,
  VERIFY_STATUS,
  createVerifyHook,
};


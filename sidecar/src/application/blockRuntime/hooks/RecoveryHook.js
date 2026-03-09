"use strict";

const { BLOCK_TYPE } = require("../contracts");

const RECOVERY_HOOK_VERSION = "phase1_step5_t2_v1";

const RECOVERY_OUTCOME = Object.freeze({
  SKIPPED: "skipped",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
});

const RECOVERY_ALLOWLIST = Object.freeze(
  new Set([
    "E_SCENE_REVISION_DRIFT",
    "E_TARGET_ANCHOR_CONFLICT",
    "E_TRANSACTION_STEP_FAILED",
  ])
);

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeBoolean(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNonNegativeInt(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return fallback;
  }
  return Math.floor(n);
}

function normalizeBlockType(blockSpec) {
  if (!isPlainObject(blockSpec)) {
    return "";
  }
  return normalizeString(blockSpec.block_type);
}

function normalizeBlockResult(blockResult) {
  const source = isPlainObject(blockResult) ? blockResult : {};
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

function normalizeRetryPolicy(policy) {
  const source = isPlainObject(policy) ? policy : {};
  const allowAutoRetry = source.allow_auto_retry === true || source.can_retry === true;
  const maxAttempts = normalizeNonNegativeInt(
    source.max_attempts,
    normalizeNonNegativeInt(source.max_retries, allowAutoRetry ? 1 : 0)
  );
  return {
    allow_auto_retry: allowAutoRetry,
    max_attempts: maxAttempts,
  };
}

function extractErrorCode(blockResult) {
  if (!isPlainObject(blockResult.error)) {
    return "";
  }
  return normalizeString(blockResult.error.error_code);
}

function extractTokenAutoRetryState(blockResult) {
  const executionMeta = isPlainObject(blockResult.execution_meta)
    ? blockResult.execution_meta
    : {};
  const outputData = isPlainObject(blockResult.output_data)
    ? blockResult.output_data
    : {};
  const tokenAutomation = isPlainObject(outputData.token_automation)
    ? outputData.token_automation
    : {};

  const attempted = Boolean(
    executionMeta.auto_retry_attempted === true ||
      outputData.auto_retry_attempted === true ||
      tokenAutomation.auto_retry_attempted === true
  );
  const succeeded = Boolean(
    executionMeta.auto_retry_succeeded === true ||
      outputData.auto_retry_succeeded === true ||
      tokenAutomation.auto_retry_succeeded === true
  );
  return {
    auto_retry_attempted: attempted,
    auto_retry_succeeded: succeeded,
  };
}

function isRecoveryEligibleBlockType(blockType) {
  return blockType === BLOCK_TYPE.CREATE || blockType === BLOCK_TYPE.MUTATE;
}

function isAllowlistedErrorCode(errorCode) {
  return RECOVERY_ALLOWLIST.has(normalizeString(errorCode));
}

function withRecoveryMeta(blockResult, patch = {}) {
  const normalized = normalizeBlockResult(blockResult);
  const executionMeta = {
    ...normalized.execution_meta,
    recovery_attempted: normalizeBoolean(patch.recovery_attempted, false),
    recovery_attempt_count: normalizeNonNegativeInt(patch.recovery_attempt_count, 0),
    recovery_outcome:
      patch.recovery_outcome === RECOVERY_OUTCOME.SUCCEEDED ||
      patch.recovery_outcome === RECOVERY_OUTCOME.FAILED
        ? patch.recovery_outcome
        : RECOVERY_OUTCOME.SKIPPED,
  };
  const failureReason = normalizeString(patch.recovery_failure_reason);
  if (failureReason) {
    executionMeta.recovery_failure_reason = failureReason;
  } else {
    delete executionMeta.recovery_failure_reason;
  }
  const initialErrorCode = normalizeString(patch.recovery_initial_error_code);
  if (initialErrorCode) {
    executionMeta.recovery_initial_error_code = initialErrorCode;
  }
  const retryErrorCode = normalizeString(patch.recovery_retry_error_code);
  if (retryErrorCode) {
    executionMeta.recovery_retry_error_code = retryErrorCode;
  }
  return {
    ...normalized,
    execution_meta: executionMeta,
  };
}

function createRecoveryHook() {
  return {
    async runRecovery({
      blockSpec,
      executionContext,
      blockResult,
      retryExecutor,
      recoveryAttemptCount,
    } = {}) {
      const normalizedBlockType = normalizeBlockType(blockSpec);
      const normalizedResult = normalizeBlockResult(blockResult);
      const currentAttemptCount = normalizeNonNegativeInt(recoveryAttemptCount, 0);

      if (!isRecoveryEligibleBlockType(normalizedBlockType)) {
        return {
          ok: normalizedResult.status === "succeeded",
          recovery_attempted: false,
          recovery_attempt_count: currentAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
          recovery_failure_reason: "block_type_not_recovery_eligible",
          block_result: withRecoveryMeta(normalizedResult, {
            recovery_attempted: false,
            recovery_attempt_count: currentAttemptCount,
            recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
            recovery_failure_reason: "block_type_not_recovery_eligible",
          }),
        };
      }

      if (normalizedResult.status !== "failed") {
        return {
          ok: true,
          recovery_attempted: false,
          recovery_attempt_count: currentAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
          recovery_failure_reason: "block_result_not_failed",
          block_result: withRecoveryMeta(normalizedResult, {
            recovery_attempted: false,
            recovery_attempt_count: currentAttemptCount,
            recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
            recovery_failure_reason: "block_result_not_failed",
          }),
        };
      }

      if (currentAttemptCount >= 1) {
        return {
          ok: false,
          recovery_attempted: false,
          recovery_attempt_count: currentAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
          recovery_failure_reason: "recovery_attempt_limit_reached",
          block_result: withRecoveryMeta(normalizedResult, {
            recovery_attempted: false,
            recovery_attempt_count: currentAttemptCount,
            recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
            recovery_failure_reason: "recovery_attempt_limit_reached",
          }),
        };
      }

      const errorCode = extractErrorCode(normalizedResult);
      if (!isAllowlistedErrorCode(errorCode)) {
        return {
          ok: false,
          recovery_attempted: false,
          recovery_attempt_count: currentAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
          recovery_failure_reason: "error_code_not_allowlisted",
          block_result: withRecoveryMeta(normalizedResult, {
            recovery_attempted: false,
            recovery_attempt_count: currentAttemptCount,
            recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
            recovery_failure_reason: "error_code_not_allowlisted",
          }),
        };
      }

      const tokenAutoRetryState = extractTokenAutoRetryState(normalizedResult);
      if (
        tokenAutoRetryState.auto_retry_attempted === true &&
        tokenAutoRetryState.auto_retry_succeeded === true
      ) {
        return {
          ok: false,
          recovery_attempted: false,
          recovery_attempt_count: currentAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
          recovery_failure_reason: "token_auto_retry_already_succeeded",
          block_result: withRecoveryMeta(normalizedResult, {
            recovery_attempted: false,
            recovery_attempt_count: currentAttemptCount,
            recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
            recovery_failure_reason: "token_auto_retry_already_succeeded",
          }),
        };
      }

      const retryPolicy = normalizeRetryPolicy(
        isPlainObject(normalizedResult.error) ? normalizedResult.error.retry_policy : null
      );
      if (!(retryPolicy.allow_auto_retry === true && retryPolicy.max_attempts >= 1)) {
        return {
          ok: false,
          recovery_attempted: false,
          recovery_attempt_count: currentAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
          recovery_failure_reason: "retry_policy_disallows_auto_retry",
          block_result: withRecoveryMeta(normalizedResult, {
            recovery_attempted: false,
            recovery_attempt_count: currentAttemptCount,
            recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
            recovery_failure_reason: "retry_policy_disallows_auto_retry",
          }),
        };
      }

      if (typeof retryExecutor !== "function") {
        return {
          ok: false,
          recovery_attempted: false,
          recovery_attempt_count: currentAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
          recovery_failure_reason: "retry_executor_unavailable",
          block_result: withRecoveryMeta(normalizedResult, {
            recovery_attempted: false,
            recovery_attempt_count: currentAttemptCount,
            recovery_outcome: RECOVERY_OUTCOME.SKIPPED,
            recovery_failure_reason: "retry_executor_unavailable",
          }),
        };
      }

      const nextAttemptCount = currentAttemptCount + 1;
      let retryResult;
      try {
        retryResult = await retryExecutor({
          blockSpec,
          executionContext: isPlainObject(executionContext) ? executionContext : {},
          previousBlockResult: normalizedResult,
          recovery_attempt_count: nextAttemptCount,
          recovery_initial_error_code: errorCode,
        });
      } catch (error) {
        const errorMessage = normalizeString(error && error.message);
        const failedResult = withRecoveryMeta(normalizedResult, {
          recovery_attempted: true,
          recovery_attempt_count: nextAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.FAILED,
          recovery_failure_reason: "retry_executor_threw",
          recovery_initial_error_code: errorCode,
        });
        if (errorMessage) {
          failedResult.execution_meta.recovery_retry_error_message = errorMessage;
        }
        return {
          ok: false,
          recovery_attempted: true,
          recovery_attempt_count: nextAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.FAILED,
          recovery_failure_reason: "retry_executor_threw",
          block_result: failedResult,
        };
      }

      const normalizedRetryResult = normalizeBlockResult(retryResult);
      if (normalizedRetryResult.status === "succeeded") {
        return {
          ok: true,
          recovery_attempted: true,
          recovery_attempt_count: nextAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.SUCCEEDED,
          recovery_failure_reason: "",
          block_result: withRecoveryMeta(normalizedRetryResult, {
            recovery_attempted: true,
            recovery_attempt_count: nextAttemptCount,
            recovery_outcome: RECOVERY_OUTCOME.SUCCEEDED,
            recovery_initial_error_code: errorCode,
          }),
        };
      }

      const retryErrorCode = extractErrorCode(normalizedRetryResult);
      return {
        ok: false,
        recovery_attempted: true,
        recovery_attempt_count: nextAttemptCount,
        recovery_outcome: RECOVERY_OUTCOME.FAILED,
        recovery_failure_reason: "retry_failed",
        block_result: withRecoveryMeta(normalizedRetryResult, {
          recovery_attempted: true,
          recovery_attempt_count: nextAttemptCount,
          recovery_outcome: RECOVERY_OUTCOME.FAILED,
          recovery_failure_reason: "retry_failed",
          recovery_initial_error_code: errorCode,
          recovery_retry_error_code: retryErrorCode,
        }),
      };
    },
  };
}

module.exports = {
  RECOVERY_HOOK_VERSION,
  RECOVERY_OUTCOME,
  RECOVERY_ALLOWLIST,
  createRecoveryHook,
};


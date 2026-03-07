using System;
using UnityEngine;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Executors;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Errors
{
    internal sealed class ExecutionFailureContextBuilder
    {
        internal const string ErrorContextVersion = "2.0";

        internal SsotDispatchResponse BuildTransactionFailure(
            string toolName,
            string errorCode,
            string errorMessage,
            int failedStepIndex,
            string failedStepId,
            string failedToolName,
            string failedErrorCode,
            string failedErrorMessage,
            SsotDispatchResultData nestedContextData,
            bool rollbackApplied,
            string rollbackPolicy,
            string rollbackReason,
            int suppressedErrorCount,
            int resolvedRefCount,
            int executedStepCount,
            bool requiresContextRefresh)
        {
            var issuedAt = DateTime.UtcNow.ToString("o");
            return new SsotDispatchResponse
            {
                ok = false,
                success = false,
                tool_name = toolName,
                error_code = string.IsNullOrEmpty(errorCode)
                    ? "E_TRANSACTION_STEP_FAILED"
                    : errorCode,
                error_message = string.IsNullOrEmpty(errorMessage)
                    ? "transaction execution failed."
                    : errorMessage,
                captured_at = issuedAt,
                data = new SsotDispatchResultData
                {
                    failed_step_index = failedStepIndex,
                    failed_step_id = failedStepId ?? string.Empty,
                    failed_tool_name = failedToolName ?? string.Empty,
                    rollback_applied = rollbackApplied,
                    rollback_policy = rollbackPolicy ?? string.Empty,
                    rollback_reason = rollbackReason ?? string.Empty,
                    failed_error_code = failedErrorCode ?? string.Empty,
                    failed_error_message = failedErrorMessage ?? string.Empty,
                    nested_error_code = failedErrorCode ?? string.Empty,
                    nested_error_message = failedErrorMessage ?? string.Empty,
                    nested_context_json = SerializeNestedContext(nestedContextData),
                    suppressed_error_count = suppressedErrorCount,
                    scene_revision_at_failure = SsotExecutorCommon.BuildSceneRevision(),
                    error_context_issued_at = issuedAt,
                    error_context_version = ErrorContextVersion,
                    requires_context_refresh = requiresContextRefresh,
                    resolved_ref_count = resolvedRefCount,
                    executed_step_count = executedStepCount
                }
            };
        }

        private static string SerializeNestedContext(SsotDispatchResultData data)
        {
            if (data == null)
            {
                return string.Empty;
            }

            try
            {
                var serialized = JsonUtility.ToJson(data);
                return string.IsNullOrEmpty(serialized) ? string.Empty : serialized;
            }
            catch
            {
                return string.Empty;
            }
        }
    }
}

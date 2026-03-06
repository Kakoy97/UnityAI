using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class ExecuteUnityTransactionSsotExecutor
    {
        [Serializable]
        private sealed class TransactionStep
        {
            public string tool_name;
            public string payload_json;
        }

        [Serializable]
        private sealed class TransactionStepList
        {
            public TransactionStep[] items;
        }

        private readonly Func<string, string, SsotDispatchResponse> _stepDispatcher;

        public ExecuteUnityTransactionSsotExecutor(Func<string, string, SsotDispatchResponse> stepDispatcher)
        {
            _stepDispatcher = stepDispatcher;
        }

        public SsotDispatchResponse Execute(ExecuteUnityTransactionRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "execute_unity_transaction request payload is required.",
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            if (_stepDispatcher == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_INTERNAL",
                    "execute_unity_transaction dispatcher is unavailable.",
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            var transactionId = request.transaction_id == null ? string.Empty : request.transaction_id.Trim();
            if (string.IsNullOrEmpty(transactionId))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "execute_unity_transaction requires transaction_id.",
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            TransactionStep[] steps;
            if (!TryParseSteps(request.steps_json, out steps))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "execute_unity_transaction steps_json must be a valid JSON array string.",
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            if (steps == null || steps.Length == 0)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "execute_unity_transaction requires at least one step.",
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            Undo.IncrementCurrentGroup();
            var undoGroup = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName("SSOT execute_unity_transaction");

            try
            {
                for (var index = 0; index < steps.Length; index += 1)
                {
                    var step = steps[index];
                    var toolName = step != null && step.tool_name != null ? step.tool_name.Trim() : string.Empty;
                    var payloadJson = step != null && step.payload_json != null ? step.payload_json.Trim() : string.Empty;
                    if (string.IsNullOrEmpty(toolName) || string.IsNullOrEmpty(payloadJson))
                    {
                        Undo.RevertAllDownToGroup(undoGroup);
                        return SsotRequestDispatcher.Failure(
                            "E_SSOT_SCHEMA_INVALID",
                            "execute_unity_transaction step requires tool_name and payload_json.",
                            ExecuteUnityTransactionRequestDto.ToolName);
                    }

                    if (string.Equals(
                            toolName,
                            ExecuteUnityTransactionRequestDto.ToolName,
                            StringComparison.Ordinal))
                    {
                        Undo.RevertAllDownToGroup(undoGroup);
                        return SsotRequestDispatcher.Failure(
                            "E_SSOT_SCHEMA_INVALID",
                            "execute_unity_transaction cannot recursively invoke itself.",
                            ExecuteUnityTransactionRequestDto.ToolName);
                    }

                    var stepResult = _stepDispatcher(toolName, payloadJson);
                    if (stepResult == null || !stepResult.ok || !stepResult.success)
                    {
                        Undo.RevertAllDownToGroup(undoGroup);
                        var stepError = stepResult != null && !string.IsNullOrEmpty(stepResult.error_message)
                            ? stepResult.error_message
                            : "step execution failed";
                        return SsotRequestDispatcher.Failure(
                            "E_TRANSACTION_STEP_FAILED",
                            "execute_unity_transaction step " + (index + 1) + " failed: " + stepError,
                            ExecuteUnityTransactionRequestDto.ToolName);
                    }
                }
            }
            catch (Exception ex)
            {
                Undo.RevertAllDownToGroup(undoGroup);
                return SsotRequestDispatcher.Failure(
                    "E_TRANSACTION_EXCEPTION",
                    "execute_unity_transaction exception: " + ex.Message,
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            Undo.CollapseUndoOperations(undoGroup);
            return SsotRequestDispatcher.Success(
                ExecuteUnityTransactionRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    value_kind = "transaction",
                    value_string = "steps=" + steps.Length.ToString(),
                });
        }

        private static bool TryParseSteps(string stepsJson, out TransactionStep[] steps)
        {
            steps = null;
            var raw = stepsJson == null ? string.Empty : stepsJson.Trim();
            if (string.IsNullOrEmpty(raw))
            {
                return false;
            }

            try
            {
                var wrapped = "{\"items\":" + raw + "}";
                var parsed = JsonUtility.FromJson<TransactionStepList>(wrapped);
                if (parsed == null || parsed.items == null)
                {
                    return false;
                }

                steps = parsed.items;
                return true;
            }
            catch
            {
                return false;
            }
        }
    }
}


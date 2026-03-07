using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Executors;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction
{
    internal sealed class TransactionExecutionContext
    {
        internal TransactionExecutionContext(
            string executionMode,
            string idempotencyKey,
            string basedOnReadToken,
            string writeAnchorObjectId,
            string writeAnchorPath)
        {
            ExecutionMode = executionMode;
            IdempotencyKey = idempotencyKey;
            BasedOnReadToken = basedOnReadToken;
            WriteAnchorObjectId = writeAnchorObjectId;
            WriteAnchorPath = writeAnchorPath;
        }

        internal string ExecutionMode { get; private set; }
        internal string IdempotencyKey { get; private set; }
        internal string BasedOnReadToken { get; private set; }
        internal string WriteAnchorObjectId { get; private set; }
        internal string WriteAnchorPath { get; private set; }

        internal static bool TryCreate(
            ExecuteUnityTransactionRequestDto request,
            out TransactionExecutionContext context,
            out string errorCode,
            out string errorMessage)
        {
            context = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (request == null)
            {
                errorCode = "E_TRANSACTION_CONTEXT_INVALID";
                errorMessage = "execute_unity_transaction request payload is required.";
                return false;
            }

            var executionMode = SsotExecutorCommon.Normalize(request.execution_mode);
            var idempotencyKey = SsotExecutorCommon.Normalize(request.idempotency_key);
            var basedOnReadToken = SsotExecutorCommon.Normalize(request.based_on_read_token);
            var writeAnchorObjectId = SsotExecutorCommon.Normalize(request.write_anchor_object_id);
            var writeAnchorPath = SsotExecutorCommon.Normalize(request.write_anchor_path);

            if (string.IsNullOrEmpty(executionMode) ||
                string.IsNullOrEmpty(idempotencyKey) ||
                string.IsNullOrEmpty(basedOnReadToken) ||
                string.IsNullOrEmpty(writeAnchorObjectId) ||
                string.IsNullOrEmpty(writeAnchorPath))
            {
                errorCode = "E_TRANSACTION_CONTEXT_INVALID";
                errorMessage = "transaction execution context is incomplete.";
                return false;
            }

            context = new TransactionExecutionContext(
                executionMode,
                idempotencyKey,
                basedOnReadToken,
                writeAnchorObjectId,
                writeAnchorPath);
            return true;
        }
    }

    internal sealed class TransactionStepPlan
    {
        internal TransactionStepPlan(
            int stepIndex,
            string stepId,
            string toolName,
            Dictionary<string, object> payload,
            string saveAs,
            IReadOnlyList<string> dependsOn)
        {
            StepIndex = stepIndex;
            StepId = stepId;
            ToolName = toolName;
            Payload = payload;
            SaveAs = saveAs;
            DependsOn = dependsOn ?? Array.Empty<string>();
        }

        internal int StepIndex { get; private set; }
        internal string StepId { get; private set; }
        internal string ToolName { get; private set; }
        internal Dictionary<string, object> Payload { get; private set; }
        internal string SaveAs { get; private set; }
        internal IReadOnlyList<string> DependsOn { get; private set; }
    }

    internal sealed class TransactionPlan
    {
        internal TransactionPlan(
            string transactionId,
            IReadOnlyList<TransactionStepPlan> steps,
            IReadOnlyDictionary<string, int> stepIdToIndex)
        {
            TransactionId = transactionId;
            Steps = steps ?? Array.Empty<TransactionStepPlan>();
            StepIdToIndex = stepIdToIndex ??
                new Dictionary<string, int>(StringComparer.Ordinal);
        }

        internal string TransactionId { get; private set; }
        internal IReadOnlyList<TransactionStepPlan> Steps { get; private set; }
        internal IReadOnlyDictionary<string, int> StepIdToIndex { get; private set; }
    }

    internal static class TransactionPlanModelFactory
    {
        internal static bool TryBuild(
            ExecuteUnityTransactionRequestDto request,
            out TransactionPlan plan,
            out string errorCode,
            out string errorMessage)
        {
            plan = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (request == null)
            {
                errorCode = "E_TRANSACTION_PLAN_INVALID";
                errorMessage = "execute_unity_transaction request payload is required.";
                return false;
            }

            var transactionId = SsotExecutorCommon.Normalize(request.transaction_id);
            if (string.IsNullOrEmpty(transactionId))
            {
                errorCode = "E_TRANSACTION_PLAN_INVALID";
                errorMessage = "execute_unity_transaction requires transaction_id.";
                return false;
            }

            var sourceSteps = request.steps;
            if (sourceSteps == null || sourceSteps.Length == 0)
            {
                errorCode = "E_TRANSACTION_PLAN_INVALID";
                errorMessage = "execute_unity_transaction requires at least one structured step.";
                return false;
            }

            var steps = new List<TransactionStepPlan>(sourceSteps.Length);
            var stepIdToIndex = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var index = 0; index < sourceSteps.Length; index += 1)
            {
                var sourceStep = sourceSteps[index];
                if (sourceStep == null)
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage = "transaction step cannot be null at index " + index + ".";
                    return false;
                }

                var stepId = SsotExecutorCommon.Normalize(sourceStep.step_id);
                if (string.IsNullOrEmpty(stepId))
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage = "transaction step requires step_id at index " + index + ".";
                    return false;
                }

                var toolName = SsotExecutorCommon.Normalize(sourceStep.tool_name);
                if (string.IsNullOrEmpty(toolName))
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage = "transaction step requires tool_name at step_id '" + stepId + "'.";
                    return false;
                }

                var payloadObject = sourceStep.payload;
                if (payloadObject == null)
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage = "transaction step requires payload object at step_id '" + stepId + "'.";
                    return false;
                }

                var saveAs = SsotExecutorCommon.Normalize(sourceStep.save_as);
                var dependsOn = NormalizeDependsOn(sourceStep.depends_on);
                var stepPlan = new TransactionStepPlan(
                    index,
                    stepId,
                    toolName,
                    payloadObject,
                    saveAs,
                    dependsOn);
                steps.Add(stepPlan);
                if (!stepIdToIndex.ContainsKey(stepId))
                {
                    stepIdToIndex[stepId] = index;
                }
            }

            plan = new TransactionPlan(transactionId, steps, stepIdToIndex);
            return true;
        }

        private static IReadOnlyList<string> NormalizeDependsOn(string[] dependsOn)
        {
            if (dependsOn == null || dependsOn.Length == 0)
            {
                return Array.Empty<string>();
            }

            var output = new List<string>(dependsOn.Length);
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < dependsOn.Length; i += 1)
            {
                var normalized = SsotExecutorCommon.Normalize(dependsOn[i]);
                if (string.IsNullOrEmpty(normalized) || seen.Contains(normalized))
                {
                    continue;
                }

                seen.Add(normalized);
                output.Add(normalized);
            }

            return output;
        }
    }
}

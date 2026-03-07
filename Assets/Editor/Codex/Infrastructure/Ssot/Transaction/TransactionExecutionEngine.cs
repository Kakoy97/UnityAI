using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Errors;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Executors;
using UnityEditor;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction
{
    internal sealed class TransactionExecutionEngine
    {
        private readonly Func<string, string, SsotDispatchResponse> _stepDispatcher;
        private readonly TransactionPlanValidator _planValidator;
        private readonly TransactionSafetyPolicy _safetyPolicy;
        private readonly TransactionReferenceResolver _referenceResolver;
        private readonly ExecutionFailureContextBuilder _failureContextBuilder;

        internal TransactionExecutionEngine(
            Func<string, string, SsotDispatchResponse> stepDispatcher,
            TransactionPlanValidator planValidator,
            TransactionSafetyPolicy safetyPolicy,
            TransactionReferenceResolver referenceResolver)
        {
            _stepDispatcher = stepDispatcher;
            _planValidator = planValidator ?? new TransactionPlanValidator();
            _safetyPolicy = safetyPolicy ?? new TransactionSafetyPolicy();
            _referenceResolver = referenceResolver ?? new TransactionReferenceResolver();
            _failureContextBuilder = new ExecutionFailureContextBuilder();
        }

        internal SsotDispatchResponse Execute(TransactionExecutionContext context, TransactionPlan plan)
        {
            if (_stepDispatcher == null)
            {
                return BuildFailureResponse(
                    "E_INTERNAL",
                    "execute_unity_transaction dispatcher is unavailable.",
                    failedStepIndex: -1,
                    failedStepId: string.Empty,
                    failedToolName: string.Empty,
                    failedErrorCode: string.Empty,
                    failedErrorMessage: string.Empty,
                    nestedContextData: null,
                    rollbackApplied: false,
                    rollbackPolicy: "rollback_none",
                    rollbackReason: "dispatcher_unavailable",
                    suppressedErrorCount: 0,
                    resolvedRefCount: 0,
                    executedStepCount: 0,
                    requiresContextRefresh: false);
            }

            if (context == null)
            {
                return BuildFailureResponse(
                    "E_TRANSACTION_CONTEXT_INVALID",
                    "transaction execution context is required.",
                    failedStepIndex: -1,
                    failedStepId: string.Empty,
                    failedToolName: string.Empty,
                    failedErrorCode: string.Empty,
                    failedErrorMessage: string.Empty,
                    nestedContextData: null,
                    rollbackApplied: false,
                    rollbackPolicy: "rollback_none",
                    rollbackReason: "transaction_context_invalid",
                    suppressedErrorCount: 0,
                    resolvedRefCount: 0,
                    executedStepCount: 0,
                    requiresContextRefresh: false);
            }

            if (!_planValidator.Validate(plan, out var planErrorCode, out var planErrorMessage))
            {
                return BuildFailureResponse(
                    planErrorCode,
                    planErrorMessage,
                    failedStepIndex: -1,
                    failedStepId: string.Empty,
                    failedToolName: string.Empty,
                    failedErrorCode: string.Empty,
                    failedErrorMessage: string.Empty,
                    nestedContextData: null,
                    rollbackApplied: false,
                    rollbackPolicy: "rollback_none",
                    rollbackReason: "transaction_plan_invalid",
                    suppressedErrorCount: 0,
                    resolvedRefCount: 0,
                    executedStepCount: 0,
                    requiresContextRefresh: false);
            }

            if (!_safetyPolicy.Validate(
                    plan,
                    out var safetyErrorCode,
                    out var safetyErrorMessage,
                    out var safetyFailedStepIndex,
                    out var safetyFailedStepId,
                    out var safetyFailedToolName))
            {
                return BuildFailureResponse(
                    safetyErrorCode,
                    safetyErrorMessage,
                    failedStepIndex: safetyFailedStepIndex,
                    failedStepId: safetyFailedStepId,
                    failedToolName: safetyFailedToolName,
                    failedErrorCode: string.Empty,
                    failedErrorMessage: string.Empty,
                    nestedContextData: null,
                    rollbackApplied: false,
                    rollbackPolicy: "rollback_none",
                    rollbackReason: "transaction_safety_policy_rejected",
                    suppressedErrorCount: 0,
                    resolvedRefCount: 0,
                    executedStepCount: 0,
                    requiresContextRefresh: false);
            }

            Undo.IncrementCurrentGroup();
            var undoGroup = Undo.GetCurrentGroup();
            Undo.SetCurrentGroupName("SSOT execute_unity_transaction");

            var aliasStore = new TransactionAliasStore();
            var executedStepCount = 0;
            var resolvedRefCountTotal = 0;
            var executedStepIds = new HashSet<string>(StringComparer.Ordinal);

            try
            {
                for (var index = 0; index < plan.Steps.Count; index += 1)
                {
                    var step = plan.Steps[index];
                    if (!DependenciesSatisfied(step, executedStepIds))
                    {
                        Undo.RevertAllDownToGroup(undoGroup);
                        return BuildFailureResponse(
                            "E_TRANSACTION_DEPENDENCY_ORDER_INVALID",
                            "step dependencies are not satisfied at runtime for step '" + step.StepId + "'.",
                            failedStepIndex: step.StepIndex,
                            failedStepId: step.StepId,
                            failedToolName: step.ToolName,
                            failedErrorCode: string.Empty,
                            failedErrorMessage: string.Empty,
                            nestedContextData: null,
                            rollbackApplied: true,
                            rollbackPolicy: "rollback_all",
                            rollbackReason: "runtime_dependency_unsatisfied",
                            suppressedErrorCount: 0,
                            resolvedRefCount: resolvedRefCountTotal,
                            executedStepCount: executedStepCount,
                            requiresContextRefresh: false);
                    }

                    if (!_referenceResolver.TryResolvePayload(
                            step.Payload,
                            aliasStore,
                            out var resolvedPayload,
                            out var resolvedRefCount,
                            out var resolveErrorCode,
                            out var resolveErrorMessage))
                    {
                        Undo.RevertAllDownToGroup(undoGroup);
                        return BuildFailureResponse(
                            resolveErrorCode,
                            resolveErrorMessage,
                            failedStepIndex: step.StepIndex,
                            failedStepId: step.StepId,
                            failedToolName: step.ToolName,
                            failedErrorCode: string.Empty,
                            failedErrorMessage: string.Empty,
                            nestedContextData: null,
                            rollbackApplied: true,
                            rollbackPolicy: "rollback_all",
                            rollbackReason: "reference_resolution_failed",
                            suppressedErrorCount: 0,
                            resolvedRefCount: resolvedRefCountTotal,
                            executedStepCount: executedStepCount,
                            requiresContextRefresh: false);
                    }

                    resolvedRefCountTotal += resolvedRefCount;
                    var finalPayload = InjectExecutionContext(resolvedPayload, context);
                    var finalPayloadJson = TransactionJson.Serialize(finalPayload);
                    var stepResponse = _stepDispatcher(step.ToolName, finalPayloadJson);
                    if (stepResponse == null || !stepResponse.ok || !stepResponse.success)
                    {
                        Undo.RevertAllDownToGroup(undoGroup);
                        var failedErrorCode =
                            stepResponse == null ? "E_SSOT_EXECUTION_FAILED" : stepResponse.error_code;
                        var failedErrorMessage =
                            stepResponse == null
                                ? "step dispatcher returned null response."
                                : stepResponse.error_message;
                        return BuildFailureResponse(
                            "E_TRANSACTION_STEP_FAILED",
                            "transaction step failed: " + step.StepId,
                            failedStepIndex: step.StepIndex,
                            failedStepId: step.StepId,
                            failedToolName: step.ToolName,
                            failedErrorCode: failedErrorCode,
                            failedErrorMessage: failedErrorMessage,
                            nestedContextData: stepResponse == null ? null : stepResponse.data,
                            rollbackApplied: true,
                            rollbackPolicy: "rollback_all",
                            rollbackReason: "nested_step_failed",
                            suppressedErrorCount: 0,
                            resolvedRefCount: resolvedRefCountTotal,
                            executedStepCount: executedStepCount,
                            requiresContextRefresh: false);
                    }

                    executedStepCount += 1;
                    executedStepIds.Add(step.StepId);
                    if (!aliasStore.TryBind(step.SaveAs, stepResponse.data, out var aliasErrorCode, out var aliasErrorMessage))
                    {
                        Undo.RevertAllDownToGroup(undoGroup);
                        return BuildFailureResponse(
                            aliasErrorCode,
                            aliasErrorMessage,
                            failedStepIndex: step.StepIndex,
                            failedStepId: step.StepId,
                            failedToolName: step.ToolName,
                            failedErrorCode: string.Empty,
                            failedErrorMessage: string.Empty,
                            nestedContextData: null,
                            rollbackApplied: true,
                            rollbackPolicy: "rollback_all",
                            rollbackReason: "alias_bind_failed",
                            suppressedErrorCount: 0,
                            resolvedRefCount: resolvedRefCountTotal,
                            executedStepCount: executedStepCount,
                            requiresContextRefresh: false);
                    }
                }
            }
            catch (Exception ex)
            {
                Undo.RevertAllDownToGroup(undoGroup);
                return BuildFailureResponse(
                    "E_TRANSACTION_STEP_FAILED",
                    "transaction execution exception: " + ex.Message,
                    failedStepIndex: -1,
                    failedStepId: string.Empty,
                    failedToolName: string.Empty,
                    failedErrorCode: "E_TRANSACTION_EXCEPTION",
                    failedErrorMessage: ex.Message,
                    nestedContextData: null,
                    rollbackApplied: true,
                    rollbackPolicy: "rollback_all",
                    rollbackReason: "transaction_exception",
                    suppressedErrorCount: 0,
                    resolvedRefCount: resolvedRefCountTotal,
                    executedStepCount: executedStepCount,
                    requiresContextRefresh: false);
            }

            Undo.CollapseUndoOperations(undoGroup);
            return SsotRequestDispatcher.Success(
                ExecuteUnityTransactionRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    value_kind = "transaction",
                    value_string = "succeeded",
                    resolved_ref_count = resolvedRefCountTotal,
                    executed_step_count = executedStepCount
                });
        }

        private static bool DependenciesSatisfied(
            TransactionStepPlan step,
            ISet<string> executedStepIds)
        {
            for (var index = 0; index < step.DependsOn.Count; index += 1)
            {
                if (!executedStepIds.Contains(step.DependsOn[index]))
                {
                    return false;
                }
            }

            return true;
        }

        private static Dictionary<string, object> InjectExecutionContext(
            Dictionary<string, object> payload,
            TransactionExecutionContext context)
        {
            var output = payload == null
                ? new Dictionary<string, object>(StringComparer.Ordinal)
                : new Dictionary<string, object>(payload, StringComparer.Ordinal);
            output["execution_mode"] = context.ExecutionMode;
            output["idempotency_key"] = context.IdempotencyKey;
            output["based_on_read_token"] = context.BasedOnReadToken;
            output["write_anchor_object_id"] = context.WriteAnchorObjectId;
            output["write_anchor_path"] = context.WriteAnchorPath;
            return output;
        }

        private SsotDispatchResponse BuildFailureResponse(
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
            return _failureContextBuilder.BuildTransactionFailure(
                ExecuteUnityTransactionRequestDto.ToolName,
                errorCode,
                errorMessage,
                failedStepIndex,
                failedStepId,
                failedToolName,
                failedErrorCode,
                failedErrorMessage,
                nestedContextData,
                rollbackApplied,
                rollbackPolicy,
                rollbackReason,
                suppressedErrorCount,
                resolvedRefCount,
                executedStepCount,
                requiresContextRefresh);
        }
    }
}

using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class ExecuteUnityTransactionSsotExecutor
    {
        private readonly TransactionExecutionEngine _executionEngine;

        public ExecuteUnityTransactionSsotExecutor(Func<string, string, SsotDispatchResponse> stepDispatcher)
        {
            _executionEngine = new TransactionExecutionEngine(
                stepDispatcher,
                new TransactionPlanValidator(),
                new TransactionSafetyPolicy(),
                new TransactionReferenceResolver());
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

            if (!TransactionExecutionContext.TryCreate(
                    request,
                    out var context,
                    out var contextErrorCode,
                    out var contextErrorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    contextErrorCode,
                    contextErrorMessage,
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            if (!TransactionPlanModelFactory.TryBuild(
                    request,
                    out var plan,
                    out var planErrorCode,
                    out var planErrorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    planErrorCode,
                    planErrorMessage,
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            return _executionEngine.Execute(context, plan);
        }
    }
}

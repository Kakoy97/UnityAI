using System;
using System.Collections.Generic;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    public sealed class CompositeTransactionRunner
    {
        private readonly UndoGuard _undoGuard;
        private readonly RollbackVerifier _rollbackVerifier;

        public CompositeTransactionRunner(UndoGuard undoGuard, RollbackVerifier rollbackVerifier)
        {
            _undoGuard = undoGuard ?? new UndoGuard();
            _rollbackVerifier = rollbackVerifier ?? new RollbackVerifier();
        }

        public CompositeTransactionRunner()
            : this(new UndoGuard(), new RollbackVerifier())
        {
        }

        public McpVisualActionExecutionResult ExecuteAtomic(
            string transactionName,
            Func<McpVisualActionExecutionResult> executeAction,
            IEnumerable<int> expectedDestroyedInstanceIds = null)
        {
            if (executeAction == null)
            {
                return McpVisualActionExecutionResult.Fail(
                    "E_COMPOSITE_EXECUTION_FAILED",
                    "Composite transaction body is required.");
            }

            var groupId = _undoGuard.BeginGroup(
                string.IsNullOrWhiteSpace(transactionName)
                    ? "Codex Composite Transaction"
                    : transactionName);
            var baseline = _rollbackVerifier.CaptureBaseline();
            try
            {
                var actionResult = executeAction();
                if (actionResult == null)
                {
                    _undoGuard.Rollback(groupId);
                    return McpVisualActionExecutionResult.Fail(
                        "E_COMPOSITE_EXECUTION_FAILED",
                        "Composite transaction body returned null.");
                }

                if (actionResult.Success)
                {
                    _undoGuard.Commit(groupId);
                    return actionResult;
                }

                _undoGuard.Rollback(groupId);
                var verification = _rollbackVerifier.VerifyAfterRollback(
                    baseline,
                    expectedDestroyedInstanceIds);
                if (!verification.Ok)
                {
                    return McpVisualActionExecutionResult.Fail(
                        "E_COMPOSITE_ROLLBACK_INCOMPLETE",
                        verification.Message);
                }

                return actionResult;
            }
            catch (Exception ex)
            {
                _undoGuard.Rollback(groupId);
                var verification = _rollbackVerifier.VerifyAfterRollback(
                    baseline,
                    expectedDestroyedInstanceIds);
                if (!verification.Ok)
                {
                    return McpVisualActionExecutionResult.Fail(
                        "E_COMPOSITE_ROLLBACK_INCOMPLETE",
                        verification.Message);
                }

                return McpVisualActionExecutionResult.Fail(
                    "E_COMPOSITE_EXECUTION_FAILED",
                    NormalizeExceptionMessage(ex));
            }
        }

        private static string NormalizeExceptionMessage(Exception ex)
        {
            if (ex == null || string.IsNullOrWhiteSpace(ex.Message))
            {
                return "Composite transaction failed.";
            }

            var lines = ex.Message.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return lines.Length == 0 ? ex.Message.Trim() : lines[0].Trim();
        }
    }
}

using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    public sealed class McpVisualActionExecutionResult
    {
        private McpVisualActionExecutionResult(
            bool success,
            string errorCode,
            string errorMessage,
            UnityActionExecutionResult executionResult)
        {
            Success = success;
            ErrorCode = string.IsNullOrWhiteSpace(errorCode) ? string.Empty : errorCode.Trim();
            ErrorMessage = string.IsNullOrWhiteSpace(errorMessage) ? string.Empty : errorMessage.Trim();
            ExecutionResult = executionResult;
        }

        public bool Success { get; private set; }
        public string ErrorCode { get; private set; }
        public string ErrorMessage { get; private set; }
        public UnityActionExecutionResult ExecutionResult { get; private set; }

        public static McpVisualActionExecutionResult Ok()
        {
            return new McpVisualActionExecutionResult(true, string.Empty, string.Empty, null);
        }

        public static McpVisualActionExecutionResult Fail(string errorCode, string errorMessage)
        {
            return new McpVisualActionExecutionResult(false, errorCode, errorMessage, null);
        }

        public static McpVisualActionExecutionResult FromExecutionResult(UnityActionExecutionResult executionResult)
        {
            if (executionResult == null)
            {
                return Fail("E_ACTION_EXECUTION_FAILED", "Action handler returned null execution result.");
            }

            return new McpVisualActionExecutionResult(
                executionResult.success,
                executionResult.errorCode,
                executionResult.errorMessage,
                executionResult);
        }
    }
}

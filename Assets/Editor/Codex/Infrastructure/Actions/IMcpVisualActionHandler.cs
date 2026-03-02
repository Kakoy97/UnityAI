namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    public interface IMcpVisualActionHandler
    {
        string ActionType { get; }
        McpVisualActionExecutionResult Execute(McpVisualActionContext context);
    }

    public abstract class McpVisualActionHandler<TActionData> : IMcpVisualActionHandler
        where TActionData : class, new()
    {
        public abstract string ActionType { get; }

        public McpVisualActionExecutionResult Execute(McpVisualActionContext context)
        {
            if (context == null)
            {
                return McpVisualActionExecutionResult.Fail(
                    "E_ACTION_EXECUTION_FAILED",
                    "Action context is required.");
            }

            TActionData dto;
            string error;
            if (!context.TryDeserializeActionData(out dto, out error))
            {
                return McpVisualActionExecutionResult.Fail("E_ACTION_DESERIALIZE_FAILED", error);
            }

            return ExecuteTyped(context, dto);
        }

        protected abstract McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            TActionData data);
    }
}

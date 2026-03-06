using System.Threading.Tasks;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class SsotRequestQueryHandler : IUnityQueryHandler
    {
        private readonly SsotRequestDispatcher _dispatcher;

        public SsotRequestQueryHandler()
            : this(new SsotRequestDispatcher())
        {
        }

        internal SsotRequestQueryHandler(SsotRequestDispatcher dispatcher)
        {
            _dispatcher = dispatcher ?? new SsotRequestDispatcher();
        }

        public string QueryType
        {
            get { return UnityQueryTypes.SsotRequest; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityAI.Editor.Codex.Domain.UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "ssot.request execution context is null.");
            }

            var envelope = context.GetQueryPayloadOrDefault<SsotToolEnvelopeDto>(pulledQuery);
            var toolName = context.NormalizeQueryField(envelope == null ? string.Empty : envelope.tool_name);
            var payloadJson = envelope == null ? string.Empty : envelope.payload_json;
            var response = await context.RunOnEditorMainThreadAsync(
                () => _dispatcher.Dispatch(toolName, payloadJson));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "ssot.request dispatcher returned null.");
            }

            return UnityQueryHandlerResult.Success(
                response,
                response.ok
                    ? string.Empty
                    : context.NormalizeQueryField(response.error_code));
        }
    }
}

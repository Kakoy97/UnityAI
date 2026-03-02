using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class GetUiTreeQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.GetUiTree; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_ui_tree execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityGetUiTreePayload>(pulledQuery);
            var request = new UnityGetUiTreeRequest
            {
                @event = "unity.query.get_ui_tree.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityGetUiTreePayload
                {
                    ui_system = context.NormalizeQueryField(payload.ui_system),
                    root_path = context.NormalizeQueryField(payload.root_path),
                    include_inactive = payload.include_inactive,
                    include_components = payload.include_components,
                    include_layout = payload.include_layout,
                    include_interaction = payload.include_interaction,
                    include_text_metrics = payload.include_text_metrics,
                    max_depth = payload.max_depth,
                    node_budget = payload.node_budget,
                    char_budget = payload.char_budget,
                    resolution = payload.resolution,
                    timeout_ms = payload.timeout_ms
                }
            };
            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.GetUiTree(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_ui_tree handler returned null.");
            }

            if (string.IsNullOrEmpty(response.request_id))
            {
                response.request_id = request.request_id;
            }

            return UnityQueryHandlerResult.Success(
                response,
                string.IsNullOrEmpty(response.error_code) ? string.Empty : response.error_code);
        }
    }
}

using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class GetSerializedPropertyTreeQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.GetSerializedPropertyTree; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_serialized_property_tree execution context is null.");
            }

            var payload =
                context.GetQueryPayloadOrDefault<UnityGetSerializedPropertyTreePayload>(pulledQuery);
            var request = new UnityGetSerializedPropertyTreeRequest
            {
                @event = "unity.query.get_serialized_property_tree.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityGetSerializedPropertyTreePayload
                {
                    target_anchor = payload.target_anchor,
                    component_selector = payload.component_selector,
                    root_property_path = context.NormalizeQueryField(payload.root_property_path),
                    depth = payload.depth,
                    after_property_path = context.NormalizeQueryField(payload.after_property_path),
                    page_size = payload.page_size,
                    node_budget = payload.node_budget,
                    char_budget = payload.char_budget,
                    include_value_summary = payload.include_value_summary,
                    include_non_visible = payload.include_non_visible,
                    timeout_ms = payload.timeout_ms
                }
            };

            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.GetSerializedPropertyTree(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_serialized_property_tree handler returned null.");
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

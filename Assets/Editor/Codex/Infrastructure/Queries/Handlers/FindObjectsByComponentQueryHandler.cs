using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class FindObjectsByComponentQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.FindObjectsByComponent; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "find_objects_by_component execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityFindObjectsByComponentPayload>(pulledQuery);
            var request = new UnityFindObjectsByComponentRequest
            {
                @event = "unity.query.find_objects_by_component.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityFindObjectsByComponentPayload
                {
                    component_query = context.NormalizeQueryField(payload.component_query),
                    scene_path = context.NormalizeQueryField(payload.scene_path),
                    under_path = context.NormalizeQueryField(payload.under_path),
                    include_inactive = payload.include_inactive,
                    limit = payload.limit
                }
            };
            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.FindObjectsByComponent(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "find_objects_by_component handler returned null.");
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

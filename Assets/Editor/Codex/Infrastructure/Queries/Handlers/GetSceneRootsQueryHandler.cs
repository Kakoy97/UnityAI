using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class GetSceneRootsQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.GetSceneRoots; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_scene_roots execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityGetSceneRootsPayload>(pulledQuery);
            var request = new UnityGetSceneRootsRequest
            {
                @event = "unity.query.get_scene_roots.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityGetSceneRootsPayload
                {
                    scene_path = context.NormalizeQueryField(payload.scene_path),
                    include_inactive = payload.include_inactive
                }
            };
            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.GetSceneRoots(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_scene_roots handler returned null.");
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

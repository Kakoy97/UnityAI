using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class HitTestUiAtViewportPointQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.HitTestUiAtViewportPoint; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "hit_test_ui_at_viewport_point execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityHitTestUiAtViewportPointPayload>(pulledQuery);
            var request = new UnityHitTestUiAtViewportPointRequest
            {
                @event = "unity.query.hit_test_ui_at_viewport_point.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityHitTestUiAtViewportPointPayload
                {
                    view = context.NormalizeQueryField(payload.view),
                    coord_space = context.NormalizeQueryField(payload.coord_space),
                    coord_origin = context.NormalizeQueryField(payload.coord_origin),
                    x = payload.x,
                    y = payload.y,
                    resolution = payload.resolution,
                    scope = payload.scope,
                    max_results = payload.max_results,
                    include_non_interactable = payload.include_non_interactable,
                    timeout_ms = payload.timeout_ms
                }
            };

            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.HitTestUiAtViewportPoint(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "hit_test_ui_at_viewport_point handler returned null.");
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

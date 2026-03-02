using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class HitTestUiAtScreenPointDisabledQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.HitTestUiAtScreenPoint; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "hit_test_ui_at_screen_point execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityHitTestUiAtScreenPointPayload>(pulledQuery);
            var request = new UnityHitTestUiAtScreenPointRequest
            {
                @event = "unity.query.hit_test_ui_at_screen_point.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityHitTestUiAtScreenPointPayload
                {
                    view_mode = context.NormalizeQueryField(payload.view_mode),
                    x = payload.x,
                    y = payload.y,
                    reference_width = payload.reference_width,
                    reference_height = payload.reference_height,
                    max_results = payload.max_results,
                    timeout_ms = payload.timeout_ms
                }
            };
            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.HitTestUiAtScreenPoint(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "hit_test_ui_at_screen_point handler returned null.");
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

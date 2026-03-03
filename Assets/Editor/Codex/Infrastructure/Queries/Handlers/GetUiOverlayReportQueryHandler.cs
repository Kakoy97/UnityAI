using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class GetUiOverlayReportQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.GetUiOverlayReport; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_ui_overlay_report execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityGetUiOverlayReportPayload>(pulledQuery);
            var request = new UnityGetUiOverlayReportRequest
            {
                @event = "unity.query.get_ui_overlay_report.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityGetUiOverlayReportPayload
                {
                    root_path = context.NormalizeQueryField(payload.root_path),
                    scope = payload.scope,
                    include_inactive = payload.include_inactive,
                    include_children_summary = payload.include_children_summary,
                    max_nodes = payload.max_nodes,
                    max_children_per_canvas = payload.max_children_per_canvas,
                    timeout_ms = payload.timeout_ms
                }
            };
            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.GetUiOverlayReport(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_ui_overlay_report handler returned null.");
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

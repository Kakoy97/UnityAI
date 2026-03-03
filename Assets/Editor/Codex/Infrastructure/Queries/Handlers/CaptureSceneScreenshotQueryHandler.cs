using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class CaptureSceneScreenshotQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.CaptureSceneScreenshot; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "capture_scene_screenshot execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityCaptureSceneScreenshotPayload>(pulledQuery);
            var request = new UnityCaptureSceneScreenshotRequest
            {
                @event = "unity.query.capture_scene_screenshot.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityCaptureSceneScreenshotPayload
                {
                    view_mode = context.NormalizeQueryField(payload.view_mode),
                    capture_mode = context.NormalizeQueryField(payload.capture_mode),
                    output_mode = context.NormalizeQueryField(payload.output_mode),
                    image_format = context.NormalizeQueryField(payload.image_format),
                    width = payload.width,
                    height = payload.height,
                    jpeg_quality = payload.jpeg_quality,
                    max_base64_bytes = payload.max_base64_bytes,
                    timeout_ms = payload.timeout_ms,
                    include_ui = payload.include_ui
                }
            };
            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.CaptureSceneScreenshot(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "capture_scene_screenshot handler returned null.");
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

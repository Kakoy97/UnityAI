using System;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Generated.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class CaptureSceneScreenshotSsotExecutor
    {
        private readonly UnityRagReadService _readService;

        public CaptureSceneScreenshotSsotExecutor()
            : this(new UnityRagReadService())
        {
        }

        internal CaptureSceneScreenshotSsotExecutor(UnityRagReadService readService)
        {
            _readService = readService ?? new UnityRagReadService();
        }

        public SsotDispatchResponse Execute(CaptureSceneScreenshotRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "capture_scene_screenshot request payload is required.",
                    CaptureSceneScreenshotRequestDto.ToolName);
            }

            var readRequest = new UnityCaptureSceneScreenshotRequest
            {
                @event = "unity.query.capture_scene_screenshot.request",
                request_id = "ssot_" + Guid.NewGuid().ToString("N"),
                thread_id = SsotExecutorCommon.Normalize(request.thread_id),
                turn_id = string.Empty,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityCaptureSceneScreenshotPayload
                {
                    view_mode = SsotExecutorCommon.Normalize(request.view_mode),
                    capture_mode = SsotExecutorCommon.Normalize(request.capture_mode),
                    output_mode = SsotExecutorCommon.Normalize(request.output_mode),
                    image_format = SsotExecutorCommon.Normalize(request.image_format),
                    width = request.width,
                    height = request.height,
                    jpeg_quality = request.jpeg_quality,
                    max_base64_bytes = request.max_base64_bytes,
                    timeout_ms = request.timeout_ms,
                    include_ui = request.include_ui
                }
            };

            var response = _readService.CaptureSceneScreenshot(readRequest);
            if (response == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "capture_scene_screenshot returned null response.",
                    CaptureSceneScreenshotRequestDto.ToolName);
            }

            if (!response.ok)
            {
                return SsotRequestDispatcher.Failure(
                    SsotExecutorCommon.Normalize(response.error_code),
                    SsotExecutorCommon.Normalize(response.error_message),
                    CaptureSceneScreenshotRequestDto.ToolName);
            }

            var responseData = response.data ?? new UnityCaptureSceneScreenshotData();
            return SsotRequestDispatcher.Success(
                CaptureSceneScreenshotRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    view = SsotExecutorCommon.Normalize(responseData.view_mode),
                    capture_mode_effective =
                        SsotExecutorCommon.Normalize(responseData.capture_mode_effective),
                    output_mode = SsotExecutorCommon.Normalize(responseData.output_mode),
                    image_format = SsotExecutorCommon.Normalize(responseData.image_format),
                    mime_type = SsotExecutorCommon.Normalize(responseData.mime_type),
                    width = responseData.width,
                    height = responseData.height,
                    byte_size = responseData.byte_size,
                    artifact_uri = SsotExecutorCommon.Normalize(responseData.artifact_uri),
                    image_base64 = SsotExecutorCommon.Normalize(responseData.image_base64),
                    fallback_reason = SsotExecutorCommon.Normalize(responseData.fallback_reason),
                    diagnosis_tags = NormalizeDiagnosisTags(responseData.diagnosis_tags),
                    read_token_candidate =
                        response.read_token != null &&
                        !string.IsNullOrWhiteSpace(response.read_token.token)
                            ? response.read_token.token
                            : SsotExecutorCommon.BuildReadTokenCandidate()
                });
        }

        private static string[] NormalizeDiagnosisTags(string[] source)
        {
            if (source == null || source.Length <= 0)
            {
                return Array.Empty<string>();
            }

            var values = new string[source.Length];
            for (var i = 0; i < source.Length; i += 1)
            {
                values[i] = SsotExecutorCommon.Normalize(source[i]);
            }

            return values;
        }
    }
}

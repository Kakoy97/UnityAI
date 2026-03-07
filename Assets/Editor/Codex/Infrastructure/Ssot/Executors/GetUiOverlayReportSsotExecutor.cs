using System;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class GetUiOverlayReportSsotExecutor
    {
        private readonly UnityRagReadService _readService;

        public GetUiOverlayReportSsotExecutor()
            : this(new UnityRagReadService())
        {
        }

        internal GetUiOverlayReportSsotExecutor(UnityRagReadService readService)
        {
            _readService = readService ?? new UnityRagReadService();
        }

        public SsotDispatchResponse Execute(GetUiOverlayReportRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "get_ui_overlay_report request payload is required.",
                    GetUiOverlayReportRequestDto.ToolName);
            }

            var scope = ParseScope(request.scope);
            var rootPath = ResolveRootPath(request.root_path, scope);
            var readRequest = new UnityGetUiOverlayReportRequest
            {
                @event = "unity.query.get_ui_overlay_report.request",
                request_id = "ssot_" + Guid.NewGuid().ToString("N"),
                thread_id = SsotExecutorCommon.Normalize(request.thread_id),
                turn_id = string.Empty,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityGetUiOverlayReportPayload
                {
                    root_path = rootPath,
                    scope = scope,
                    include_inactive = request.include_inactive,
                    include_children_summary = request.include_children_summary,
                    max_nodes = request.max_nodes,
                    max_children_per_canvas = request.max_children_per_canvas,
                    timeout_ms = request.timeout_ms
                }
            };

            var response = _readService.GetUiOverlayReport(readRequest);
            if (response == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_ui_overlay_report returned null response.",
                    GetUiOverlayReportRequestDto.ToolName);
            }

            if (!response.ok)
            {
                return SsotRequestDispatcher.Failure(
                    SsotExecutorCommon.Normalize(response.error_code),
                    SsotExecutorCommon.Normalize(response.error_message),
                    GetUiOverlayReportRequestDto.ToolName);
            }

            var responseData = response.data ?? new UnityGetUiOverlayReportData();
            return SsotRequestDispatcher.Success(
                GetUiOverlayReportRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    root_path = rootPath,
                    include_inactive = responseData.include_inactive,
                    returned_canvas_count = responseData.returned_canvas_count,
                    overlay_total_coverage_percent = responseData.overlay_total_coverage_percent,
                    diagnosis = SsotExecutorCommon.Normalize(responseData.diagnosis),
                    recommended_capture_mode = SsotExecutorCommon.Normalize(responseData.recommended_capture_mode),
                    overlay_canvases = ConvertCanvases(responseData.overlay_canvases),
                    truncated = responseData.truncated,
                    truncated_reason = SsotExecutorCommon.Normalize(responseData.truncated_reason),
                    read_token_candidate =
                        response.read_token != null &&
                        !string.IsNullOrWhiteSpace(response.read_token.token)
                            ? response.read_token.token
                            : SsotExecutorCommon.BuildReadTokenCandidate()
                });
        }

        private static UnityQueryScope ParseScope(object raw)
        {
            if (raw == null)
            {
                return null;
            }

            if (raw is UnityQueryScope scope)
            {
                return scope;
            }

            if (raw is string rawJson)
            {
                return ParseJsonScope(rawJson);
            }

            try
            {
                var json = JsonUtility.ToJson(raw);
                return ParseJsonScope(json);
            }
            catch
            {
                return null;
            }
        }

        private static UnityQueryScope ParseJsonScope(string rawJson)
        {
            var normalized = SsotExecutorCommon.Normalize(rawJson);
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            try
            {
                return JsonUtility.FromJson<UnityQueryScope>(normalized);
            }
            catch
            {
                return null;
            }
        }

        private static string ResolveRootPath(string rootPath, UnityQueryScope scope)
        {
            var normalizedRootPath = SsotExecutorCommon.Normalize(rootPath);
            if (!string.IsNullOrEmpty(normalizedRootPath))
            {
                return normalizedRootPath;
            }

            return scope == null ? string.Empty : SsotExecutorCommon.Normalize(scope.root_path);
        }

        private static SsotUiOverlayCanvasSummary[] ConvertCanvases(UnityUiOverlayCanvasSummary[] canvases)
        {
            if (canvases == null || canvases.Length <= 0)
            {
                return Array.Empty<SsotUiOverlayCanvasSummary>();
            }

            var mapped = new SsotUiOverlayCanvasSummary[canvases.Length];
            for (var i = 0; i < canvases.Length; i += 1)
            {
                var canvas = canvases[i] ?? new UnityUiOverlayCanvasSummary();
                mapped[i] = new SsotUiOverlayCanvasSummary
                {
                    object_id = SsotExecutorCommon.Normalize(canvas.object_id),
                    path = SsotExecutorCommon.Normalize(canvas.path),
                    name = SsotExecutorCommon.Normalize(canvas.name),
                    active = canvas.active,
                    render_mode = SsotExecutorCommon.Normalize(canvas.render_mode),
                    sorting_order = canvas.sorting_order,
                    interactable_elements = canvas.interactable_elements,
                    screen_coverage_percent = canvas.screen_coverage_percent
                };
            }

            return mapped;
        }
    }
}

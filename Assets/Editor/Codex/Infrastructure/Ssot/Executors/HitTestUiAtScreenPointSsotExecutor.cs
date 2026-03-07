using System;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Generated.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class HitTestUiAtScreenPointSsotExecutor
    {
        private readonly UnityRagReadService _readService;

        public HitTestUiAtScreenPointSsotExecutor()
            : this(new UnityRagReadService())
        {
        }

        internal HitTestUiAtScreenPointSsotExecutor(UnityRagReadService readService)
        {
            _readService = readService ?? new UnityRagReadService();
        }

        public SsotDispatchResponse Execute(HitTestUiAtScreenPointRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "hit_test_ui_at_screen_point request payload is required.",
                    HitTestUiAtScreenPointRequestDto.ToolName);
            }

            // Screen-point tool is normalized to viewport-px hit test to avoid legacy disabled query path.
            var resolution = BuildResolution(request.reference_width, request.reference_height);
            var readRequest = new UnityHitTestUiAtViewportPointRequest
            {
                @event = "unity.query.hit_test_ui_at_viewport_point.request",
                request_id = "ssot_" + Guid.NewGuid().ToString("N"),
                thread_id = SsotExecutorCommon.Normalize(request.thread_id),
                turn_id = string.Empty,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityHitTestUiAtViewportPointPayload
                {
                    view = SsotExecutorCommon.Normalize(request.view_mode),
                    coord_space = "viewport_px",
                    coord_origin = "top_left",
                    x = request.x,
                    y = request.y,
                    resolution = resolution,
                    scope = null,
                    max_results = request.max_results,
                    include_non_interactable = false,
                    timeout_ms = request.timeout_ms
                }
            };

            var response = _readService.HitTestUiAtViewportPoint(readRequest);
            if (response == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "hit_test_ui_at_screen_point returned null response.",
                    HitTestUiAtScreenPointRequestDto.ToolName);
            }

            if (!response.ok)
            {
                return SsotRequestDispatcher.Failure(
                    SsotExecutorCommon.Normalize(response.error_code),
                    SsotExecutorCommon.Normalize(response.error_message),
                    HitTestUiAtScreenPointRequestDto.ToolName);
            }

            var responseData = response.data ?? new UnityHitTestUiAtViewportPointData();
            var hits = ConvertHits(responseData.hits);
            var primaryHit = responseData.hits != null && responseData.hits.Length > 0
                ? responseData.hits[0]
                : null;
            var requestedPoint = responseData.requested_point ?? new UnityViewportPoint
            {
                x = request.x,
                y = request.y
            };
            var mappedPoint = responseData.mapped_point ?? requestedPoint;
            var responseResolution = responseData.resolution ?? resolution ?? new UnityQueryResolution();
            var runtimeResolution = responseData.runtime_resolution ?? new UnityQueryResolution();
            var hitCount = responseData.hit_count > 0 ? responseData.hit_count : hits.Length;

            return SsotRequestDispatcher.Success(
                HitTestUiAtScreenPointRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    root_path = string.Empty,
                    target_object_id =
                        primaryHit == null ? string.Empty : SsotExecutorCommon.Normalize(primaryHit.object_id),
                    target_path =
                        primaryHit == null ? string.Empty : SsotExecutorCommon.Normalize(primaryHit.path),
                    view = SsotExecutorCommon.Normalize(responseData.view),
                    coord_space = SsotExecutorCommon.Normalize(responseData.coord_space),
                    coord_origin = SsotExecutorCommon.Normalize(responseData.coord_origin),
                    requested_x = requestedPoint.x,
                    requested_y = requestedPoint.y,
                    mapped_x = mappedPoint.x,
                    mapped_y = mappedPoint.y,
                    resolution_width = responseResolution.width,
                    resolution_height = responseResolution.height,
                    runtime_resolution_width = runtimeResolution.width,
                    runtime_resolution_height = runtimeResolution.height,
                    runtime_source = SsotExecutorCommon.Normalize(responseData.runtime_source),
                    approximate = responseData.approximate,
                    approx_reason = SsotExecutorCommon.Normalize(responseData.approx_reason),
                    confidence = SsotExecutorCommon.Normalize(responseData.confidence),
                    hit_count = hitCount,
                    total_count = hitCount,
                    hits = hits,
                });
        }

        private static UnityQueryResolution BuildResolution(int width, int height)
        {
            if (width <= 0 || height <= 0)
            {
                return null;
            }

            return new UnityQueryResolution
            {
                width = width,
                height = height
            };
        }

        private static SsotUiHitSummary[] ConvertHits(UnityUiHitTestStackItem[] hits)
        {
            if (hits == null || hits.Length <= 0)
            {
                return Array.Empty<SsotUiHitSummary>();
            }

            var mapped = new SsotUiHitSummary[hits.Length];
            for (var i = 0; i < hits.Length; i += 1)
            {
                var hit = hits[i] ?? new UnityUiHitTestStackItem();
                mapped[i] = new SsotUiHitSummary
                {
                    rank = hit.rank,
                    object_id = SsotExecutorCommon.Normalize(hit.object_id),
                    path = SsotExecutorCommon.Normalize(hit.path),
                    name = SsotExecutorCommon.Normalize(hit.name),
                    component = SsotExecutorCommon.Normalize(hit.component),
                    interactable = hit.interactable,
                    raycast_target = hit.raycast_target,
                    z_order_hint = hit.z_order_hint
                };
            }

            return mapped;
        }
    }
}

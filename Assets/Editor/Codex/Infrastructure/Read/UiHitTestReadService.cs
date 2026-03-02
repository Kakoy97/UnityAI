using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        public UnityHitTestUiAtScreenPointResponse HitTestUiAtScreenPoint(UnityHitTestUiAtScreenPointRequest request)
        {
            return UiHitTestReadService.ExecuteScreenPoint(request);
        }

        public UnityHitTestUiAtViewportPointResponse HitTestUiAtViewportPoint(UnityHitTestUiAtViewportPointRequest request)
        {
            return UiHitTestReadService.ExecuteViewportPoint(request);
        }

        private static class UiHitTestReadService
        {
            internal static UnityHitTestUiAtScreenPointResponse ExecuteScreenPoint(UnityHitTestUiAtScreenPointRequest request)
            {
                var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
                return BuildHitTestFailure(
                    requestId,
                    "E_COMMAND_DISABLED",
                    "hit_test_ui_at_screen_point is disabled in screenshot stabilization closure.");
            }

            internal static UnityHitTestUiAtViewportPointResponse ExecuteViewportPoint(UnityHitTestUiAtViewportPointRequest request)
            {
                var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
                var payload = request == null ? null : request.payload;
                if (payload == null)
                {
                    return BuildHitTestViewportFailure(
                        requestId,
                        "E_SCHEMA_INVALID",
                        "payload is required.");
                }

                var scopePath = NormalizePath(payload.scope == null ? string.Empty : payload.scope.root_path);
                var scopeTransform = string.IsNullOrEmpty(scopePath) ? null : FindTransformByScenePath(scopePath);
                if (!string.IsNullOrEmpty(scopePath) && scopeTransform == null)
                {
                    return BuildHitTestViewportFailure(
                        requestId,
                        "E_TARGET_NOT_FOUND",
                        "scope.root_path not found: " + scopePath);
                }

                var runtimeCanvases = CollectRuntimeCanvases(scopeTransform);
                RuntimeResolutionPick runtimePick;
                if (!TryResolveRuntimeResolution(
                    scopeTransform,
                    runtimeCanvases,
                    payload.resolution,
                    out runtimePick))
                {
                    return BuildHitTestViewportFailure(
                        requestId,
                        "E_UI_RUNTIME_RESOLUTION_UNAVAILABLE",
                        "Unable to resolve runtime resolution for hit_test_ui_at_viewport_point.");
                }

                var coordSpace = NormalizeCoordSpace(payload.coord_space);
                var coordOrigin = NormalizeCoordOrigin(payload.coord_origin);
                var requestResolution = NormalizeRequestResolution(payload.resolution, runtimePick.width, runtimePick.height);
                var requestedPoint = new UnityViewportPoint
                {
                    x = payload.x,
                    y = payload.y
                };

                Vector2 mappedPoint;
                if (!TryMapViewportPoint(
                    requestedPoint,
                    coordSpace,
                    coordOrigin,
                    requestResolution.width,
                    requestResolution.height,
                    runtimePick.width,
                    runtimePick.height,
                    out mappedPoint))
                {
                    return BuildHitTestViewportFailure(
                        requestId,
                        "E_UI_COORD_MAPPING_INVALID",
                        "Invalid viewport coordinate mapping inputs.");
                }

                var maxResults = ClampInRange(payload.max_results, DefaultHitTestMaxResults, 1, MaxHitTestResults);
                var includeNonInteractable = payload.include_non_interactable;

                List<UnityUiHitTestStackItem> stackItems;
                bool usedRaycastPath;
                if (!TryBuildRaycastHitStack(
                    mappedPoint,
                    scopeTransform,
                    runtimeCanvases,
                    maxResults,
                    includeNonInteractable,
                    out stackItems))
                {
                    usedRaycastPath = false;
                    stackItems = BuildGeometryHitStack(
                        mappedPoint,
                        scopeTransform,
                        runtimeCanvases,
                        maxResults,
                        includeNonInteractable);
                }
                else
                {
                    usedRaycastPath = true;
                }

                if (stackItems == null)
                {
                    stackItems = new List<UnityUiHitTestStackItem>(0);
                }

                var tokenObjectId = stackItems.Count > 0
                    ? (stackItems[0].object_id ?? string.Empty)
                    : runtimePick.scope_object_id;
                var tokenPath = stackItems.Count > 0
                    ? (stackItems[0].path ?? string.Empty)
                    : runtimePick.scope_path;
                if (string.IsNullOrEmpty(tokenPath))
                {
                    tokenPath = string.IsNullOrEmpty(scopePath) ? "Scene/UI" : scopePath;
                }

                return new UnityHitTestUiAtViewportPointResponse
                {
                    ok = true,
                    request_id = requestId,
                    captured_at = NowIso(),
                    error_code = string.Empty,
                    error_message = string.Empty,
                    read_token = BuildReadToken("scene", tokenObjectId, tokenPath),
                    data = new UnityHitTestUiAtViewportPointData
                    {
                        view = NormalizeView(payload.view),
                        coord_space = coordSpace,
                        coord_origin = coordOrigin,
                        requested_point = requestedPoint,
                        mapped_point = new UnityViewportPoint
                        {
                            x = mappedPoint.x,
                            y = mappedPoint.y
                        },
                        resolution = requestResolution,
                        runtime_resolution = new UnityQueryResolution
                        {
                            width = runtimePick.width,
                            height = runtimePick.height
                        },
                        runtime_source = runtimePick.source,
                        approximate = !usedRaycastPath,
                        approx_reason = usedRaycastPath ? string.Empty : "NO_RAYCAST_SOURCE",
                        confidence = usedRaycastPath ? "high" : "low",
                        hit_count = stackItems.Count,
                        hits = stackItems.ToArray()
                    }
                };
            }
        }
    }
}
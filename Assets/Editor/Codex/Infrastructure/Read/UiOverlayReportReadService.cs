using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        public UnityGetUiOverlayReportResponse GetUiOverlayReport(UnityGetUiOverlayReportRequest request)
        {
            return UiOverlayReportReadService.Execute(request);
        }

        private static class UiOverlayReportReadService
        {
            private const int DefaultOverlayReportMaxNodes = 256;
            private const int MaxOverlayReportMaxNodes = 4096;
            private const int DefaultOverlayChildrenPerCanvas = 12;
            private const int MaxOverlayChildrenPerCanvas = 256;

            internal static UnityGetUiOverlayReportResponse Execute(UnityGetUiOverlayReportRequest request)
            {
                var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
                var payload = request == null ? null : request.payload;
                var rootPath = ResolveRootPath(payload);
                var includeInactive = payload == null || payload.include_inactive;
                var includeChildrenSummary = payload == null || payload.include_children_summary;
                var maxNodes = ClampInRange(
                    payload == null ? 0 : payload.max_nodes,
                    DefaultOverlayReportMaxNodes,
                    1,
                    MaxOverlayReportMaxNodes);
                var maxChildrenPerCanvas = ClampInRange(
                    payload == null ? 0 : payload.max_children_per_canvas,
                    DefaultOverlayChildrenPerCanvas,
                    1,
                    MaxOverlayChildrenPerCanvas);

                var scopeTransform = string.IsNullOrEmpty(rootPath)
                    ? null
                    : FindTransformByScenePath(rootPath);
                if (!string.IsNullOrEmpty(rootPath) && scopeTransform == null)
                {
                    return BuildGetUiOverlayReportFailure(
                        requestId,
                        "E_UI_OVERLAY_REPORT_SOURCE_NOT_FOUND",
                        "Overlay scope root_path not found: " + rootPath);
                }

                var canvases = CollectCanvases(scopeTransform, rootPath, includeInactive);
                if (canvases.Count == 0)
                {
                    return BuildGetUiOverlayReportFailure(
                        requestId,
                        "E_UI_OVERLAY_REPORT_SOURCE_NOT_FOUND",
                        string.IsNullOrEmpty(rootPath)
                            ? "No Canvas found in loaded scenes."
                            : "No Canvas found under scope root_path: " + rootPath);
                }

                var runtimeCanvases = CollectRuntimeCanvases(scopeTransform);
                RuntimeResolutionPick runtimePick;
                if (!TryResolveRuntimeResolution(scopeTransform, runtimeCanvases, null, out runtimePick))
                {
                    runtimePick = new RuntimeResolutionPick
                    {
                        width = 1,
                        height = 1,
                        source = "runtime_resolution_unavailable",
                        scope_path = rootPath,
                        scope_object_id = scopeTransform == null
                            ? string.Empty
                            : BuildObjectId(scopeTransform.gameObject),
                    };
                }

                var sortedCanvases = new List<Canvas>(canvases);
                sortedCanvases.Sort(CompareCanvasOrder);

                var overlayCanvases = new List<UnityUiOverlayCanvasSummary>();
                var remainingNodes = maxNodes;
                var truncated = false;
                var nonOverlayCanvasesCount = 0;
                var overlayCoveragePercent = 0f;
                var interactableTotal = 0;

                for (var i = 0; i < sortedCanvases.Count; i++)
                {
                    var canvas = sortedCanvases[i];
                    if (canvas == null)
                    {
                        continue;
                    }

                    if (canvas.renderMode != RenderMode.ScreenSpaceOverlay)
                    {
                        nonOverlayCanvasesCount += 1;
                        continue;
                    }

                    if (remainingNodes <= 0)
                    {
                        truncated = true;
                        break;
                    }

                    remainingNodes -= 1;
                    var overlaySummary = BuildOverlayCanvasSummary(
                        canvas,
                        includeInactive,
                        includeChildrenSummary,
                        maxChildrenPerCanvas,
                        runtimePick.width,
                        runtimePick.height,
                        ref remainingNodes,
                        ref truncated);
                    overlayCanvases.Add(overlaySummary);
                    overlayCoveragePercent += overlaySummary.screen_coverage_percent;
                    interactableTotal += Mathf.Max(0, overlaySummary.interactable_elements);
                }

                if (overlayCoveragePercent > 100f)
                {
                    overlayCoveragePercent = 100f;
                }

                var diagnosisCodes = BuildDiagnosisCodes(
                    overlayCanvases.Count,
                    overlayCoveragePercent,
                    truncated,
                    runtimePick.source);
                var recommendedCaptureMode = ResolveRecommendedCaptureMode(
                    overlayCanvases.Count,
                    overlayCoveragePercent,
                    interactableTotal,
                    diagnosisCodes);
                var diagnosis = BuildDiagnosisText(
                    overlayCanvases.Count,
                    overlayCoveragePercent,
                    recommendedCaptureMode,
                    runtimePick.source,
                    truncated);

                var firstOverlay = overlayCanvases.Count > 0 ? overlayCanvases[0] : null;
                var tokenPath = !string.IsNullOrEmpty(rootPath)
                    ? rootPath
                    : (firstOverlay == null ? "Scene/UIOverlay" : firstOverlay.path);
                var tokenObjectId = firstOverlay == null ? string.Empty : firstOverlay.object_id;

                return new UnityGetUiOverlayReportResponse
                {
                    ok = true,
                    request_id = requestId,
                    captured_at = NowIso(),
                    error_code = string.Empty,
                    error_message = string.Empty,
                    read_token = BuildReadToken("scene", tokenObjectId, tokenPath),
                    data = new UnityGetUiOverlayReportData
                    {
                        scope = string.IsNullOrEmpty(rootPath)
                            ? null
                            : new UnityQueryScope
                            {
                                root_path = rootPath
                            },
                        include_inactive = includeInactive,
                        include_children_summary = includeChildrenSummary,
                        max_nodes = maxNodes,
                        max_children_per_canvas = maxChildrenPerCanvas,
                        returned_canvas_count = overlayCanvases.Count,
                        truncated = truncated,
                        truncated_reason = truncated ? "max_nodes" : string.Empty,
                        overlay_total_coverage_percent = RoundTwoDecimal(overlayCoveragePercent),
                        non_overlay_canvases_count = nonOverlayCanvasesCount,
                        diagnosis_codes = diagnosisCodes.ToArray(),
                        diagnosis = diagnosis,
                        recommended_capture_mode = recommendedCaptureMode,
                        overlay_canvases = overlayCanvases.ToArray()
                    }
                };
            }

            private static List<Canvas> CollectCanvases(
                Transform scopeTransform,
                string rootPath,
                bool includeInactive)
            {
                var result = new List<Canvas>();
                var canvases = UnityEngine.Object.FindObjectsOfType<Canvas>(true);
                for (var i = 0; i < canvases.Length; i++)
                {
                    var canvas = canvases[i];
                    if (canvas == null || canvas.gameObject == null)
                    {
                        continue;
                    }

                    var scene = canvas.gameObject.scene;
                    if (!scene.IsValid() || !scene.isLoaded)
                    {
                        continue;
                    }

                    if (!includeInactive && !canvas.gameObject.activeInHierarchy)
                    {
                        continue;
                    }

                    if (scopeTransform != null)
                    {
                        if (!(scopeTransform == canvas.transform ||
                              scopeTransform.IsChildOf(canvas.transform) ||
                              canvas.transform.IsChildOf(scopeTransform)))
                        {
                            continue;
                        }
                    }

                    var canvasPath = BuildObjectPath(canvas.transform, "Scene");
                    if (!IsPathWithinScope(canvasPath, rootPath))
                    {
                        continue;
                    }

                    result.Add(canvas);
                }

                return result;
            }

            private static UnityUiOverlayCanvasSummary BuildOverlayCanvasSummary(
                Canvas canvas,
                bool includeInactive,
                bool includeChildrenSummary,
                int maxChildrenPerCanvas,
                int runtimeWidth,
                int runtimeHeight,
                ref int remainingNodes,
                ref bool truncated)
            {
                var coveragePercent = ComputeCanvasCoveragePercent(canvas, runtimeWidth, runtimeHeight);
                var childrenSummary = new List<UnityUiOverlayElementSummary>();
                var interactableElements = 0;
                var overlayRoot = canvas.rootCanvas != null ? canvas.rootCanvas : canvas;
                var summaryBudget = includeChildrenSummary
                    ? Mathf.Min(maxChildrenPerCanvas, Mathf.Max(0, remainingNodes))
                    : 0;

                var stack = new Stack<Transform>();
                stack.Push(canvas.transform);
                while (stack.Count > 0)
                {
                    var current = stack.Pop();
                    if (current == null || current.gameObject == null)
                    {
                        continue;
                    }

                    for (var c = current.childCount - 1; c >= 0; c--)
                    {
                        stack.Push(current.GetChild(c));
                    }

                    if (current == canvas.transform)
                    {
                        continue;
                    }

                    if (!includeInactive && !current.gameObject.activeInHierarchy)
                    {
                        continue;
                    }

                    if (!IsOverlayElementCandidate(current.gameObject))
                    {
                        continue;
                    }

                    var interactable = IsGameObjectInteractable(current.gameObject);
                    if (interactable)
                    {
                        interactableElements += 1;
                    }

                    if (!includeChildrenSummary || summaryBudget <= 0)
                    {
                        if (includeChildrenSummary)
                        {
                            truncated = true;
                        }
                        continue;
                    }

                    var rectTransform = current as RectTransform;
                    childrenSummary.Add(
                        new UnityUiOverlayElementSummary
                        {
                            object_id = BuildObjectId(current.gameObject),
                            path = BuildObjectPath(current, "Scene"),
                            name = current.gameObject.name,
                            type = BuildOverlayElementType(current.gameObject),
                            interactable = interactable,
                            rect_screen_px = BuildRectScreenPx(rectTransform, overlayRoot)
                        });
                    summaryBudget -= 1;
                    remainingNodes = Mathf.Max(0, remainingNodes - 1);
                }

                return new UnityUiOverlayCanvasSummary
                {
                    object_id = BuildObjectId(canvas.gameObject),
                    path = BuildObjectPath(canvas.transform, "Scene"),
                    name = canvas.gameObject.name,
                    active = canvas.gameObject.activeInHierarchy,
                    render_mode = canvas.renderMode.ToString(),
                    sorting_layer_id = canvas.sortingLayerID,
                    sorting_order = canvas.sortingOrder,
                    screen_coverage_percent = RoundTwoDecimal(coveragePercent),
                    interactable_elements = interactableElements,
                    children_summary = childrenSummary.ToArray()
                };
            }

            private static bool IsOverlayElementCandidate(GameObject gameObject)
            {
                if (gameObject == null)
                {
                    return false;
                }

                if (gameObject.GetComponent<Graphic>() != null)
                {
                    return true;
                }
                if (gameObject.GetComponent<Selectable>() != null)
                {
                    return true;
                }
                if (gameObject.GetComponent<Text>() != null)
                {
                    return true;
                }
                if (ResolveTmpTextComponent(gameObject) != null)
                {
                    return true;
                }

                return false;
            }

            private static string BuildOverlayElementType(GameObject gameObject)
            {
                if (gameObject == null)
                {
                    return string.Empty;
                }

                var tags = new List<string>(4);
                if (gameObject.GetComponent<Button>() != null)
                {
                    tags.Add("Button");
                }
                if (gameObject.GetComponent<Image>() != null)
                {
                    tags.Add("Image");
                }
                if (gameObject.GetComponent<Text>() != null || ResolveTmpTextComponent(gameObject) != null)
                {
                    tags.Add("Text");
                }
                if (gameObject.GetComponent<LayoutGroup>() != null)
                {
                    tags.Add("LayoutGroup");
                }

                if (tags.Count == 0)
                {
                    return "UIElement";
                }

                return string.Join("+", tags.ToArray());
            }

            private static int CompareCanvasOrder(Canvas a, Canvas b)
            {
                if (a == null && b == null)
                {
                    return 0;
                }
                if (a == null)
                {
                    return 1;
                }
                if (b == null)
                {
                    return -1;
                }

                var layerCompare = a.sortingLayerID.CompareTo(b.sortingLayerID);
                if (layerCompare != 0)
                {
                    return layerCompare;
                }

                var orderCompare = a.sortingOrder.CompareTo(b.sortingOrder);
                if (orderCompare != 0)
                {
                    return orderCompare;
                }

                var aPath = BuildObjectPath(a.transform, "Scene");
                var bPath = BuildObjectPath(b.transform, "Scene");
                return string.CompareOrdinal(aPath, bPath);
            }

            private static float ComputeCanvasCoveragePercent(Canvas canvas, int runtimeWidth, int runtimeHeight)
            {
                if (canvas == null)
                {
                    return 0f;
                }

                var width = Mathf.Max(1, runtimeWidth);
                var height = Mathf.Max(1, runtimeHeight);
                var runtimeArea = (float)width * height;
                if (runtimeArea <= 0f)
                {
                    return 0f;
                }

                var rect = canvas.pixelRect;
                if (rect.width <= 0f || rect.height <= 0f)
                {
                    return 0f;
                }

                var area = Mathf.Max(0f, rect.width * rect.height);
                return Mathf.Clamp((area / runtimeArea) * 100f, 0f, 100f);
            }

            private static List<string> BuildDiagnosisCodes(
                int overlayCanvasCount,
                float overlayCoveragePercent,
                bool truncated,
                string runtimeSource)
            {
                var codes = new List<string>(6);
                if (overlayCanvasCount > 0)
                {
                    codes.Add("OVERLAY_PRESENT");
                    codes.Add(overlayCoveragePercent >= 35f
                        ? "OVERLAY_COVERAGE_HIGH"
                        : "OVERLAY_COVERAGE_LOW");
                }
                else
                {
                    codes.Add("OVERLAY_NONE");
                }

                if (string.Equals(runtimeSource, "runtime_resolution_unavailable", StringComparison.Ordinal))
                {
                    codes.Add("RUNTIME_RESOLUTION_UNAVAILABLE");
                }

                if (truncated)
                {
                    codes.Add("OVERLAY_REPORT_TRUNCATED");
                }

                return codes;
            }

            private static string ResolveRecommendedCaptureMode(
                int overlayCanvasCount,
                float overlayCoveragePercent,
                int interactableTotal,
                List<string> diagnosisCodes)
            {
                if (diagnosisCodes != null &&
                    diagnosisCodes.Contains("RUNTIME_RESOLUTION_UNAVAILABLE"))
                {
                    return "structural_only";
                }

                if (overlayCanvasCount <= 0)
                {
                    return "render_output";
                }

                if (overlayCoveragePercent >= 35f || interactableTotal >= 8)
                {
                    return "composite";
                }

                return "render_output";
            }

            private static string BuildDiagnosisText(
                int overlayCanvasCount,
                float overlayCoveragePercent,
                string recommendedCaptureMode,
                string runtimeSource,
                bool truncated)
            {
                if (string.Equals(runtimeSource, "runtime_resolution_unavailable", StringComparison.Ordinal))
                {
                    return "Runtime resolution is unavailable. Prefer structural diagnostics for overlay UI.";
                }

                if (overlayCanvasCount <= 0)
                {
                    return "No ScreenSpaceOverlay canvas detected. render_output is typically sufficient.";
                }

                if (string.Equals(recommendedCaptureMode, "composite", StringComparison.Ordinal))
                {
                    var coverageText = RoundTwoDecimal(overlayCoveragePercent).ToString("0.##");
                    var suffix = truncated ? " Report is truncated by node budget." : string.Empty;
                    return "Overlay UI covers about " + coverageText +
                           "% of the runtime area. Prefer composite capture when enabled." + suffix;
                }

                var fallbackSuffix = truncated ? " Report is truncated by node budget." : string.Empty;
                return "Overlay UI is present but coverage is limited. render_output plus structural checks is recommended." + fallbackSuffix;
            }

            private static bool IsPathWithinScope(string candidatePath, string scopeRootPath)
            {
                if (string.IsNullOrEmpty(scopeRootPath))
                {
                    return true;
                }

                if (string.IsNullOrEmpty(candidatePath))
                {
                    return false;
                }

                if (string.Equals(candidatePath, scopeRootPath, StringComparison.Ordinal))
                {
                    return true;
                }

                if (candidatePath.StartsWith(scopeRootPath + "/", StringComparison.Ordinal))
                {
                    return true;
                }

                return scopeRootPath.StartsWith(candidatePath + "/", StringComparison.Ordinal);
            }

            private static string ResolveRootPath(UnityGetUiOverlayReportPayload payload)
            {
                if (payload == null)
                {
                    return string.Empty;
                }

                var rootPath = NormalizePath(payload.root_path);
                var scopeRootPath = payload.scope == null
                    ? string.Empty
                    : NormalizePath(payload.scope.root_path);
                if (!string.IsNullOrEmpty(scopeRootPath))
                {
                    return scopeRootPath;
                }

                return rootPath;
            }

            private static float RoundTwoDecimal(float value)
            {
                return Mathf.Round(value * 100f) / 100f;
            }
        }
    }
}

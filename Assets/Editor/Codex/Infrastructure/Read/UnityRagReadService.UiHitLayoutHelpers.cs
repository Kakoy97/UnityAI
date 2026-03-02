using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Reflection;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.UiValidation;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        private struct RuntimeResolutionPick
        {
            public int width;
            public int height;
            public string source;
            public string scope_path;
            public string scope_object_id;
        }

        private sealed class UiHitNode
        {
            public GameObject gameObject;
            public RectTransform rectTransform;
            public Canvas canvas;
            public string objectId;
            public string path;
            public bool interactable;
            public bool raycastTarget;
            public int zOrderHint;

            public UnityUiHitTestStackItem ToStackItem(int rank)
            {
                var item = new UnityUiHitTestStackItem
                {
                    rank = rank,
                    anchor = new UnityObjectAnchor
                    {
                        object_id = objectId,
                        path = path
                    },
                    object_id = objectId,
                    path = path,
                    name = gameObject == null ? string.Empty : gameObject.name,
                    component = ResolvePrimaryUiComponent(gameObject),
                    interactable = interactable,
                    raycast_target = raycastTarget,
                    rect_screen_px = BuildRectScreenPx(rectTransform, canvas),
                    z_order_hint = zOrderHint
                };
                return item;
            }
        }

        private sealed class ValidateNode
        {
            public Transform transform;
            public RectTransform rectTransform;
            public Canvas rootCanvas;
            public Rect runtimeRect;
            public string objectId;
            public string path;
            public string canvasKey;
            public bool hasGraphic;
            public bool raycastTarget;
            public bool interactiveCandidate;
            public bool componentEnabled;
            public bool interactable;
            public bool textCandidate;
            public Text textComponent;
            public Component tmpTextComponent;

            public Rect RectForResolution(int runtimeW, int runtimeH, int targetW, int targetH)
            {
                if (runtimeW <= 0 || runtimeH <= 0 || targetW <= 0 || targetH <= 0)
                {
                    return runtimeRect;
                }

                if (runtimeW == targetW && runtimeH == targetH)
                {
                    return runtimeRect;
                }

                var scaleX = (float)targetW / runtimeW;
                var scaleY = (float)targetH / runtimeH;
                var uiScale = ResolveUiScaleRatio(rootCanvas, runtimeW, runtimeH, targetW, targetH);
                return new Rect(
                    runtimeRect.x * scaleX,
                    runtimeRect.y * scaleY,
                    Mathf.Max(0f, runtimeRect.width * uiScale),
                    Mathf.Max(0f, runtimeRect.height * uiScale));
            }
        }

        private static string NormalizeView(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
            if (string.Equals(normalized, "game", StringComparison.Ordinal))
            {
                return "game";
            }

            return "game";
        }

        private static string NormalizeCoordSpace(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
            if (string.Equals(normalized, "normalized", StringComparison.Ordinal))
            {
                return "normalized";
            }

            return "viewport_px";
        }

        private static string NormalizeCoordOrigin(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
            if (string.Equals(normalized, "top_left", StringComparison.Ordinal))
            {
                return "top_left";
            }

            return "bottom_left";
        }

        private static UnityQueryResolution NormalizeRequestResolution(UnityQueryResolution resolution, int runtimeW, int runtimeH)
        {
            if (resolution != null && resolution.width > 0 && resolution.height > 0)
            {
                return new UnityQueryResolution
                {
                    width = resolution.width,
                    height = resolution.height
                };
            }

            return new UnityQueryResolution
            {
                width = runtimeW,
                height = runtimeH
            };
        }

        private static List<Canvas> CollectRuntimeCanvases(Transform scopeTransform)
        {
            var canvases = UnityEngine.Object.FindObjectsOfType<Canvas>(true);
            var result = new List<Canvas>(canvases.Length);
            var seen = new HashSet<int>();
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

                var root = canvas.rootCanvas != null ? canvas.rootCanvas : canvas;
                if (root == null || root.gameObject == null)
                {
                    continue;
                }

                if (scopeTransform != null &&
                    !(scopeTransform == root.transform ||
                      scopeTransform.IsChildOf(root.transform) ||
                      root.transform.IsChildOf(scopeTransform)))
                {
                    continue;
                }

                if (!seen.Add(root.GetInstanceID()))
                {
                    continue;
                }

                result.Add(root);
            }

            return result;
        }

        private static bool TryResolveRuntimeResolution(
            Transform scopeTransform,
            List<Canvas> rootCanvases,
            UnityQueryResolution requestedResolution,
            out RuntimeResolutionPick pick)
        {
            pick = new RuntimeResolutionPick
            {
                width = 0,
                height = 0,
                source = string.Empty,
                scope_path = string.Empty,
                scope_object_id = string.Empty
            };

            if (scopeTransform != null)
            {
                var scopeCanvas = scopeTransform.GetComponentInParent<Canvas>();
                var rootScopeCanvas = scopeCanvas == null ? null : (scopeCanvas.rootCanvas != null ? scopeCanvas.rootCanvas : scopeCanvas);
                if (rootScopeCanvas != null && rootScopeCanvas.pixelRect.width > 0f && rootScopeCanvas.pixelRect.height > 0f)
                {
                    pick.width = Mathf.RoundToInt(rootScopeCanvas.pixelRect.width);
                    pick.height = Mathf.RoundToInt(rootScopeCanvas.pixelRect.height);
                    pick.source = "canvas_pixel_rect";
                    pick.scope_path = BuildObjectPath(rootScopeCanvas.transform, "Scene");
                    pick.scope_object_id = BuildObjectId(rootScopeCanvas.gameObject);
                    return true;
                }
            }

            Canvas largest = null;
            var area = -1f;
            for (var i = 0; i < rootCanvases.Count; i++)
            {
                var canvas = rootCanvases[i];
                if (canvas == null)
                {
                    continue;
                }

                var rect = canvas.pixelRect;
                if (rect.width <= 0f || rect.height <= 0f)
                {
                    continue;
                }

                var candidateArea = rect.width * rect.height;
                if (candidateArea > area)
                {
                    area = candidateArea;
                    largest = canvas;
                }
            }

            if (largest != null)
            {
                pick.width = Mathf.RoundToInt(largest.pixelRect.width);
                pick.height = Mathf.RoundToInt(largest.pixelRect.height);
                pick.source = "largest_canvas_pixel_rect";
                pick.scope_path = BuildObjectPath(largest.transform, "Scene");
                pick.scope_object_id = BuildObjectId(largest.gameObject);
                return true;
            }

            if (requestedResolution != null && requestedResolution.width > 0 && requestedResolution.height > 0)
            {
                pick.width = requestedResolution.width;
                pick.height = requestedResolution.height;
                pick.source = "fallback_req_resolution";
                pick.scope_path = scopeTransform == null ? string.Empty : BuildObjectPath(scopeTransform, "Scene");
                pick.scope_object_id = scopeTransform == null ? string.Empty : BuildObjectId(scopeTransform.gameObject);
                return true;
            }

            return false;
        }

        private static bool TryMapViewportPoint(
            UnityViewportPoint requestedPoint,
            string coordSpace,
            string coordOrigin,
            int requestW,
            int requestH,
            int runtimeW,
            int runtimeH,
            out Vector2 mappedPoint)
        {
            mappedPoint = Vector2.zero;
            if (requestedPoint == null ||
                requestW <= 0 ||
                requestH <= 0 ||
                runtimeW <= 0 ||
                runtimeH <= 0)
            {
                return false;
            }

            var x = requestedPoint.x;
            var y = requestedPoint.y;
            if (float.IsNaN(x) || float.IsInfinity(x) || float.IsNaN(y) || float.IsInfinity(y))
            {
                return false;
            }

            var rawX = 0f;
            var rawY = 0f;
            if (string.Equals(coordSpace, "normalized", StringComparison.Ordinal))
            {
                rawX = x * runtimeW;
                rawY = y * runtimeH;
            }
            else
            {
                rawX = (x / requestW) * runtimeW;
                rawY = (y / requestH) * runtimeH;
            }

            var mappedX = Mathf.Clamp(Mathf.RoundToInt(rawX), 0, Mathf.Max(0, runtimeW - 1));
            var mappedY = Mathf.Clamp(Mathf.RoundToInt(rawY), 0, Mathf.Max(0, runtimeH - 1));
            if (string.Equals(coordOrigin, "top_left", StringComparison.Ordinal))
            {
                mappedY = Mathf.Clamp(runtimeH - 1 - mappedY, 0, Mathf.Max(0, runtimeH - 1));
            }

            mappedPoint = new Vector2(mappedX, mappedY);
            return true;
        }

        private static bool TryBuildRaycastHitStack(
            Vector2 mappedPoint,
            Transform scopeTransform,
            List<Canvas> rootCanvases,
            int maxResults,
            bool includeNonInteractable,
            out List<UnityUiHitTestStackItem> hitStack)
        {
            hitStack = null;
            if (EventSystem.current == null)
            {
                return false;
            }

            var raycasters = new List<GraphicRaycaster>(4);
            for (var i = 0; i < rootCanvases.Count; i++)
            {
                var canvas = rootCanvases[i];
                if (canvas == null || !canvas.isActiveAndEnabled)
                {
                    continue;
                }

                var raycaster = canvas.GetComponent<GraphicRaycaster>();
                if (raycaster == null || !raycaster.isActiveAndEnabled)
                {
                    continue;
                }

                raycasters.Add(raycaster);
            }

            if (raycasters.Count == 0)
            {
                return false;
            }

            var pointer = new PointerEventData(EventSystem.current)
            {
                position = mappedPoint
            };
            var results = new List<RaycastResult>(32);
            for (var i = 0; i < raycasters.Count; i++)
            {
                raycasters[i].Raycast(pointer, results);
            }

            results.Sort((a, b) => b.depth.CompareTo(a.depth));
            var dedup = new HashSet<int>();
            hitStack = new List<UnityUiHitTestStackItem>(Math.Min(maxResults, results.Count));
            for (var i = 0; i < results.Count; i++)
            {
                if (hitStack.Count >= maxResults)
                {
                    break;
                }

                var result = results[i];
                var go = result.gameObject;
                if (go == null || !dedup.Add(go.GetInstanceID()))
                {
                    continue;
                }

                if (scopeTransform != null && !go.transform.IsChildOf(scopeTransform) && go.transform != scopeTransform)
                {
                    continue;
                }

                var interactable = IsGameObjectInteractable(go);
                if (!includeNonInteractable && !interactable)
                {
                    continue;
                }

                var node = BuildUiHitNode(go, result.depth);
                if (node == null)
                {
                    continue;
                }

                hitStack.Add(node.ToStackItem(hitStack.Count + 1));
            }

            return true;
        }

        private static bool HasGraphicRaycaster(List<Canvas> rootCanvases)
        {
            if (rootCanvases == null || rootCanvases.Count == 0)
            {
                return false;
            }

            for (var i = 0; i < rootCanvases.Count; i++)
            {
                var canvas = rootCanvases[i];
                if (canvas == null || !canvas.isActiveAndEnabled)
                {
                    continue;
                }

                var raycaster = canvas.GetComponent<GraphicRaycaster>();
                if (raycaster != null && raycaster.isActiveAndEnabled)
                {
                    return true;
                }
            }

            return false;
        }

        private static List<UnityUiHitTestStackItem> BuildGeometryHitStack(
            Vector2 mappedPoint,
            Transform scopeTransform,
            List<Canvas> rootCanvases,
            int maxResults,
            bool includeNonInteractable)
        {
            var candidates = new List<UiHitNode>(64);
            for (var c = 0; c < rootCanvases.Count; c++)
            {
                var canvas = rootCanvases[c];
                if (canvas == null || canvas.transform == null)
                {
                    continue;
                }

                var roots = new List<Transform>();
                if (scopeTransform != null)
                {
                    if (scopeTransform.IsChildOf(canvas.transform) || scopeTransform == canvas.transform)
                    {
                        roots.Add(scopeTransform);
                    }
                    else if (canvas.transform.IsChildOf(scopeTransform))
                    {
                        roots.Add(canvas.transform);
                    }
                }
                else
                {
                    roots.Add(canvas.transform);
                }

                for (var r = 0; r < roots.Count; r++)
                {
                    var stack = new Stack<Transform>();
                    stack.Push(roots[r]);
                    while (stack.Count > 0)
                    {
                        var current = stack.Pop();
                        if (current == null || current.gameObject == null || !current.gameObject.activeInHierarchy)
                        {
                            continue;
                        }

                        var rectTransform = current as RectTransform;
                        if (rectTransform != null)
                        {
                            var rect = BuildRectScreenPx(rectTransform, canvas);
                            if (rect != null &&
                                mappedPoint.x >= rect.x &&
                                mappedPoint.x <= rect.x + rect.width &&
                                mappedPoint.y >= rect.y &&
                                mappedPoint.y <= rect.y + rect.height)
                            {
                                var interactable = IsGameObjectInteractable(current.gameObject);
                                if (includeNonInteractable || interactable)
                                {
                                    var node = BuildUiHitNode(current.gameObject, current.GetSiblingIndex());
                                    if (node != null)
                                    {
                                        candidates.Add(node);
                                    }
                                }
                            }
                        }

                        for (var i = current.childCount - 1; i >= 0; i--)
                        {
                            stack.Push(current.GetChild(i));
                        }
                    }
                }
            }

            candidates.Sort((a, b) => b.zOrderHint.CompareTo(a.zOrderHint));
            var resultItems = new List<UnityUiHitTestStackItem>(Math.Min(maxResults, candidates.Count));
            var seen = new HashSet<string>(StringComparer.Ordinal);
            for (var i = 0; i < candidates.Count && resultItems.Count < maxResults; i++)
            {
                var candidate = candidates[i];
                if (candidate == null || string.IsNullOrEmpty(candidate.objectId))
                {
                    continue;
                }

                if (!seen.Add(candidate.objectId))
                {
                    continue;
                }

                resultItems.Add(candidate.ToStackItem(resultItems.Count + 1));
            }

            return resultItems;
        }

        private static UiHitNode BuildUiHitNode(GameObject gameObject, int zOrderHint)
        {
            if (gameObject == null)
            {
                return null;
            }

            var rectTransform = gameObject.transform as RectTransform;
            if (rectTransform == null)
            {
                return null;
            }

            var canvas = gameObject.GetComponentInParent<Canvas>();
            var rootCanvas = canvas == null ? null : (canvas.rootCanvas != null ? canvas.rootCanvas : canvas);
            var objectId = BuildObjectId(gameObject);
            var path = BuildObjectPath(gameObject.transform, "Scene");
            return new UiHitNode
            {
                gameObject = gameObject,
                rectTransform = rectTransform,
                canvas = rootCanvas,
                objectId = objectId,
                path = path,
                interactable = IsGameObjectInteractable(gameObject),
                raycastTarget = ResolveRaycastTarget(gameObject),
                zOrderHint = zOrderHint
            };
        }

        private static bool IsGameObjectInteractable(GameObject gameObject)
        {
            if (gameObject == null || !gameObject.activeInHierarchy)
            {
                return false;
            }

            var selectable = gameObject.GetComponent<Selectable>();
            if (selectable != null)
            {
                return selectable.enabled && selectable.interactable;
            }

            var tmpInput = GetComponentByName(gameObject, "TMP_InputField");
            if (tmpInput != null)
            {
                var enabled = !(tmpInput is Behaviour) || ((Behaviour)tmpInput).enabled;
                return enabled && ReadBoolProperty(tmpInput, "interactable", true);
            }

            return true;
        }

        private static bool ResolveRaycastTarget(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return false;
            }

            var graphic = gameObject.GetComponent<Graphic>();
            if (graphic != null)
            {
                return graphic.raycastTarget;
            }

            return false;
        }

        private static string ResolvePrimaryUiComponent(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            var selectable = gameObject.GetComponent<Selectable>();
            if (selectable != null)
            {
                return selectable.GetType().Name;
            }

            var graphic = gameObject.GetComponent<Graphic>();
            if (graphic != null)
            {
                return graphic.GetType().Name;
            }

            var tmpInput = GetComponentByName(gameObject, "TMP_InputField");
            if (tmpInput != null)
            {
                return tmpInput.GetType().Name;
            }

            return "RectTransform";
        }

        private static UnityScreenshotRect BuildRectScreenPx(RectTransform rectTransform, Canvas rootCanvas)
        {
            if (rectTransform == null)
            {
                return null;
            }

            var worldCorners = new Vector3[4];
            rectTransform.GetWorldCorners(worldCorners);
            var camera = ResolveCanvasCamera(rootCanvas);
            var min = new Vector2(float.PositiveInfinity, float.PositiveInfinity);
            var max = new Vector2(float.NegativeInfinity, float.NegativeInfinity);
            for (var i = 0; i < worldCorners.Length; i++)
            {
                var point = RectTransformUtility.WorldToScreenPoint(camera, worldCorners[i]);
                min.x = Mathf.Min(min.x, point.x);
                min.y = Mathf.Min(min.y, point.y);
                max.x = Mathf.Max(max.x, point.x);
                max.y = Mathf.Max(max.y, point.y);
            }

            if (float.IsNaN(min.x) ||
                float.IsInfinity(min.x) ||
                float.IsNaN(min.y) ||
                float.IsInfinity(min.y) ||
                float.IsNaN(max.x) ||
                float.IsInfinity(max.x) ||
                float.IsNaN(max.y) ||
                float.IsInfinity(max.y))
            {
                return new UnityScreenshotRect { x = 0, y = 0, width = 0, height = 0 };
            }

            return new UnityScreenshotRect
            {
                x = Mathf.RoundToInt(min.x),
                y = Mathf.RoundToInt(min.y),
                width = Mathf.Max(0, Mathf.RoundToInt(max.x - min.x)),
                height = Mathf.Max(0, Mathf.RoundToInt(max.y - min.y))
            };
        }

        private static Camera ResolveCanvasCamera(Canvas rootCanvas)
        {
            if (rootCanvas == null)
            {
                return null;
            }

            if (rootCanvas.renderMode == RenderMode.ScreenSpaceOverlay)
            {
                return null;
            }

            if (rootCanvas.worldCamera != null)
            {
                return rootCanvas.worldCamera;
            }

            return Camera.main;
        }

        private sealed class ValidateResolutionSpec
        {
            public string name;
            public int width;
            public int height;
        }

        private sealed class ValidateIssueTracker
        {
            private readonly int _maxIssues;
            private readonly int _budgetMs;
            private readonly Stopwatch _watch;

            public ValidateIssueTracker(int maxIssues, int budgetMs)
            {
                _maxIssues = Math.Max(1, maxIssues);
                _budgetMs = Math.Max(1, budgetMs);
                _watch = Stopwatch.StartNew();
                issues = new List<UnityUiLayoutIssue>(_maxIssues);
                partial = false;
                truncatedReason = string.Empty;
            }

            public readonly List<UnityUiLayoutIssue> issues;
            public bool partial;
            public string truncatedReason;

            public bool CanContinue()
            {
                if (partial)
                {
                    return false;
                }

                if (_watch.ElapsedMilliseconds > _budgetMs)
                {
                    partial = true;
                    truncatedReason = "TIME_BUDGET_EXCEEDED";
                    return false;
                }

                return true;
            }

            public bool TryAdd(UnityUiLayoutIssue issue)
            {
                if (!CanContinue())
                {
                    return false;
                }

                if (issues.Count >= _maxIssues)
                {
                    partial = true;
                    truncatedReason = "ISSUE_BUDGET_EXCEEDED";
                    return false;
                }

                if (issue != null)
                {
                    issues.Add(issue);
                }

                return true;
            }
        }

        private static UiLayoutValidationRunResult ExecuteValidateUiLayout(UnityValidateUiLayoutRequest request)
        {
            var payload = request == null ? null : request.payload;
            if (payload == null)
            {
                return BuildValidateRunFailure("E_SCHEMA_INVALID", "payload is required.");
            }

            var scopePath = NormalizePath(payload.scope == null ? string.Empty : payload.scope.root_path);
            var scopeTransform = string.IsNullOrEmpty(scopePath) ? null : FindTransformByScenePath(scopePath);
            if (!string.IsNullOrEmpty(scopePath) && scopeTransform == null)
            {
                return BuildValidateRunFailure("E_UI_LAYOUT_SCOPE_NOT_FOUND", "scope.root_path not found: " + scopePath);
            }

            var rootCanvases = CollectRuntimeCanvases(scopeTransform);
            if (!string.IsNullOrEmpty(scopePath) && rootCanvases.Count == 0)
            {
                return BuildValidateRunFailure("E_UI_LAYOUT_SCOPE_NOT_FOUND", "scope.root_path has no loaded canvas.");
            }

            var requestedResolutions = NormalizeValidateResolutions(payload.resolutions);
            RuntimeResolutionPick runtimePick;
            if (!TryResolveRuntimeResolution(
                scopeTransform,
                rootCanvases,
                requestedResolutions.Count > 0
                    ? new UnityQueryResolution
                    {
                        width = requestedResolutions[0].width,
                        height = requestedResolutions[0].height
                    }
                    : null,
                out runtimePick))
            {
                return BuildValidateRunFailure(
                    "E_UI_RUNTIME_RESOLUTION_UNAVAILABLE",
                    "Unable to resolve runtime resolution for validate_ui_layout.");
            }

            var runtimeW = runtimePick.width;
            var runtimeH = runtimePick.height;
            var runtimeName = ResolveRuntimeResolutionName(requestedResolutions, runtimeW, runtimeH);
            if (requestedResolutions.Count == 0)
            {
                requestedResolutions.Add(
                    new ValidateResolutionSpec
                    {
                        name = runtimeName,
                        width = runtimeW,
                        height = runtimeH
                    });
            }
            else if (!ContainsResolution(requestedResolutions, runtimeW, runtimeH))
            {
                requestedResolutions.Insert(
                    0,
                    new ValidateResolutionSpec
                    {
                        name = runtimeName,
                        width = runtimeW,
                        height = runtimeH
                    });
            }

            var checks = NormalizeValidateChecks(payload.checks);
            var maxIssues = payload.max_issues > 0 ? payload.max_issues : DefaultValidateMaxIssues;
            var timeBudgetMs = payload.time_budget_ms > 0 ? payload.time_budget_ms : DefaultValidateTimeBudgetMs;
            var refreshMode = NormalizeValidateLayoutRefreshMode(payload.layout_refresh_mode);
            var roots = CollectValidateRoots(scopeTransform, rootCanvases);
            RefreshValidateLayouts(roots, refreshMode);

            var nodes = CollectValidateNodes(roots);
            var hasRaycastSource = EventSystem.current != null && HasGraphicRaycaster(rootCanvases);
            var tracker = new ValidateIssueTracker(maxIssues, timeBudgetMs);

            if (checks.Contains("OUT_OF_BOUNDS"))
            {
                EvaluateOutOfBoundsIssues(nodes, requestedResolutions, runtimeW, runtimeH, tracker);
            }

            if (!tracker.partial && checks.Contains("OVERLAP"))
            {
                EvaluateOverlapIssues(nodes, requestedResolutions, runtimeW, runtimeH, tracker);
            }

            if (!tracker.partial && checks.Contains("NOT_CLICKABLE"))
            {
                EvaluateNotClickableIssues(nodes, runtimeName, hasRaycastSource, tracker);
            }

            if (!tracker.partial && checks.Contains("TEXT_OVERFLOW"))
            {
                EvaluateTextOverflowIssues(nodes, requestedResolutions, runtimeW, runtimeH, runtimeName, tracker);
            }

            var scopePathResolved = !string.IsNullOrEmpty(scopePath) ? scopePath : runtimePick.scope_path;
            var resolutionItems = new UnityQueryResolutionItem[requestedResolutions.Count];
            for (var i = 0; i < requestedResolutions.Count; i++)
            {
                resolutionItems[i] = new UnityQueryResolutionItem
                {
                    name = requestedResolutions[i].name,
                    width = requestedResolutions[i].width,
                    height = requestedResolutions[i].height
                };
            }

            return new UiLayoutValidationRunResult
            {
                ok = true,
                error_code = string.Empty,
                error_message = string.Empty,
                scope_object_id = runtimePick.scope_object_id,
                scope_path = scopePathResolved,
                data = new UnityValidateUiLayoutData
                {
                    scope = new UnityQueryScope
                    {
                        root_path = scopePathResolved
                    },
                    resolutions = resolutionItems,
                    time_budget_ms = timeBudgetMs,
                    runtime_resolution = new UnityQueryResolution
                    {
                        width = runtimeW,
                        height = runtimeH
                    },
                    runtime_source = runtimePick.source,
                    partial = tracker.partial,
                    truncated_reason = tracker.truncatedReason,
                    issue_count = tracker.issues.Count,
                    runtime_resolution_name = runtimeName,
                    issues = tracker.issues.ToArray()
                }
            };
        }

        private static UiLayoutValidationRunResult BuildValidateRunFailure(string errorCode, string errorMessage)
        {
            return new UiLayoutValidationRunResult
            {
                ok = false,
                error_code = string.IsNullOrEmpty(errorCode) ? "E_UI_LAYOUT_VALIDATION_FAILED" : errorCode,
                error_message = string.IsNullOrEmpty(errorMessage) ? "validate_ui_layout failed." : errorMessage,
                scope_object_id = string.Empty,
                scope_path = string.Empty,
                data = null
            };
        }

        private static List<ValidateResolutionSpec> NormalizeValidateResolutions(UnityQueryResolutionItem[] resolutions)
        {
            var result = new List<ValidateResolutionSpec>();
            if (resolutions == null || resolutions.Length == 0)
            {
                return result;
            }

            for (var i = 0; i < resolutions.Length; i++)
            {
                var item = resolutions[i];
                if (item == null || item.width <= 0 || item.height <= 0)
                {
                    continue;
                }

                result.Add(
                    new ValidateResolutionSpec
                    {
                        name = string.IsNullOrWhiteSpace(item.name)
                            ? item.width + "x" + item.height
                            : item.name.Trim(),
                        width = item.width,
                        height = item.height
                    });
            }

            return result;
        }

        private static string ResolveRuntimeResolutionName(List<ValidateResolutionSpec> resolutions, int runtimeW, int runtimeH)
        {
            for (var i = 0; i < resolutions.Count; i++)
            {
                if (resolutions[i].width == runtimeW && resolutions[i].height == runtimeH)
                {
                    return resolutions[i].name;
                }
            }

            return runtimeW + "x" + runtimeH;
        }

        private static bool ContainsResolution(List<ValidateResolutionSpec> resolutions, int width, int height)
        {
            for (var i = 0; i < resolutions.Count; i++)
            {
                if (resolutions[i].width == width && resolutions[i].height == height)
                {
                    return true;
                }
            }

            return false;
        }

        private static HashSet<string> NormalizeValidateChecks(string[] checks)
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            if (checks != null)
            {
                for (var i = 0; i < checks.Length; i++)
                {
                    var normalized = string.IsNullOrWhiteSpace(checks[i]) ? string.Empty : checks[i].Trim();
                    if (string.Equals(normalized, "OUT_OF_BOUNDS", StringComparison.Ordinal) ||
                        string.Equals(normalized, "OVERLAP", StringComparison.Ordinal) ||
                        string.Equals(normalized, "NOT_CLICKABLE", StringComparison.Ordinal) ||
                        string.Equals(normalized, "TEXT_OVERFLOW", StringComparison.Ordinal))
                    {
                        result.Add(normalized);
                    }
                }
            }

            if (result.Count == 0)
            {
                result.Add("OUT_OF_BOUNDS");
                result.Add("OVERLAP");
                result.Add("NOT_CLICKABLE");
                result.Add("TEXT_OVERFLOW");
            }

            return result;
        }

        private static string NormalizeValidateLayoutRefreshMode(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
            return string.Equals(normalized, "full_tree", StringComparison.Ordinal)
                ? "full_tree"
                : "scoped_roots_only";
        }

        private static List<Transform> CollectValidateRoots(Transform scopeTransform, List<Canvas> rootCanvases)
        {
            var roots = new List<Transform>();
            if (scopeTransform != null)
            {
                roots.Add(scopeTransform);
                return roots;
            }

            for (var i = 0; i < rootCanvases.Count; i++)
            {
                if (rootCanvases[i] == null || rootCanvases[i].transform == null)
                {
                    continue;
                }

                roots.Add(rootCanvases[i].transform);
            }

            return roots;
        }

        private static void RefreshValidateLayouts(List<Transform> roots, string refreshMode)
        {
            Canvas.ForceUpdateCanvases();
            if (string.Equals(refreshMode, "full_tree", StringComparison.Ordinal))
            {
                var canvases = UnityEngine.Object.FindObjectsOfType<Canvas>(true);
                for (var i = 0; i < canvases.Length; i++)
                {
                    var rect = canvases[i] == null ? null : canvases[i].transform as RectTransform;
                    if (rect == null)
                    {
                        continue;
                    }

                    try
                    {
                        LayoutRebuilder.ForceRebuildLayoutImmediate(rect);
                    }
                    catch
                    {
                        // best effort
                    }
                }
                Canvas.ForceUpdateCanvases();
                return;
            }

            for (var i = 0; i < roots.Count; i++)
            {
                var rect = roots[i] as RectTransform;
                if (rect == null)
                {
                    continue;
                }

                try
                {
                    LayoutRebuilder.ForceRebuildLayoutImmediate(rect);
                }
                catch
                {
                    // best effort
                }
            }
            Canvas.ForceUpdateCanvases();
        }

        private static List<ValidateNode> CollectValidateNodes(List<Transform> roots)
        {
            var nodes = new List<ValidateNode>(256);
            var stack = new Stack<Transform>();
            for (var i = 0; i < roots.Count; i++)
            {
                if (roots[i] != null)
                {
                    stack.Push(roots[i]);
                }
            }

            while (stack.Count > 0)
            {
                var transform = stack.Pop();
                if (transform == null || transform.gameObject == null || !transform.gameObject.activeInHierarchy)
                {
                    continue;
                }

                var rectTransform = transform as RectTransform;
                if (rectTransform != null)
                {
                    var canvas = transform.GetComponentInParent<Canvas>();
                    var rootCanvas = canvas == null ? null : (canvas.rootCanvas != null ? canvas.rootCanvas : canvas);
                    var rectPx = BuildRectScreenPx(rectTransform, rootCanvas);
                    var runtimeRect = new Rect(
                        rectPx == null ? 0 : rectPx.x,
                        rectPx == null ? 0 : rectPx.y,
                        rectPx == null ? 0 : rectPx.width,
                        rectPx == null ? 0 : rectPx.height);
                    if (runtimeRect.width > 0f && runtimeRect.height > 0f)
                    {
                        var selectable = transform.gameObject.GetComponent<Selectable>();
                        var graphic = transform.gameObject.GetComponent<Graphic>();
                        var tmpInput = GetComponentByName(transform.gameObject, "TMP_InputField");
                        var text = transform.gameObject.GetComponent<Text>();
                        var tmpText = ResolveTmpTextComponent(transform.gameObject);

                        nodes.Add(
                            new ValidateNode
                            {
                                transform = transform,
                                rectTransform = rectTransform,
                                rootCanvas = rootCanvas,
                                runtimeRect = runtimeRect,
                                objectId = BuildObjectId(transform.gameObject),
                                path = BuildObjectPath(transform, "Scene"),
                                canvasKey = rootCanvas == null ? "none" : rootCanvas.GetInstanceID().ToString(CultureInfo.InvariantCulture),
                                hasGraphic = graphic != null,
                                raycastTarget = graphic != null && graphic.raycastTarget,
                                interactiveCandidate = selectable != null || tmpInput != null,
                                componentEnabled = (selectable == null || selectable.enabled) && (!(tmpInput is Behaviour) || ((Behaviour)tmpInput).enabled),
                                interactable = (selectable == null || selectable.interactable) && ReadBoolProperty(tmpInput, "interactable", true),
                                textCandidate = text != null || tmpText != null,
                                textComponent = text,
                                tmpTextComponent = tmpText
                            });
                    }
                }

                for (var i = transform.childCount - 1; i >= 0; i--)
                {
                    stack.Push(transform.GetChild(i));
                }
            }

            return nodes;
        }

        private static void EvaluateOutOfBoundsIssues(
            List<ValidateNode> nodes,
            List<ValidateResolutionSpec> resolutions,
            int runtimeW,
            int runtimeH,
            ValidateIssueTracker tracker)
        {
            for (var r = 0; r < resolutions.Count; r++)
            {
                var res = resolutions[r];
                var runtimeResolution = res.width == runtimeW && res.height == runtimeH;
                var bounds = new Rect(0f, 0f, res.width, res.height);
                for (var i = 0; i < nodes.Count; i++)
                {
                    if (!tracker.CanContinue())
                    {
                        return;
                    }

                    var node = nodes[i];
                    var rect = node.RectForResolution(runtimeW, runtimeH, res.width, res.height);
                    if (rect.xMin >= bounds.xMin &&
                        rect.yMin >= bounds.yMin &&
                        rect.xMax <= bounds.xMax &&
                        rect.yMax <= bounds.yMax)
                    {
                        continue;
                    }

                    tracker.TryAdd(
                        new UnityUiLayoutIssue
                        {
                            anchor = new UnityObjectAnchor
                            {
                                object_id = node.objectId,
                                path = node.path
                            },
                            issue_type = "OUT_OF_BOUNDS",
                            severity = "error",
                            resolution = res.name,
                            details = "Rect exceeds viewport bounds.",
                            suggestion = "Adjust anchors or size to keep element inside viewport.",
                            mode = runtimeResolution ? "direct_runtime" : "derived_only",
                            confidence = runtimeResolution ? "high" : "low",
                            approximate = !runtimeResolution,
                            approx_reason = runtimeResolution ? string.Empty : "DERIVED_ONLY_MODEL"
                        });
                }
            }
        }

        private static void EvaluateOverlapIssues(
            List<ValidateNode> nodes,
            List<ValidateResolutionSpec> resolutions,
            int runtimeW,
            int runtimeH,
            ValidateIssueTracker tracker)
        {
            for (var r = 0; r < resolutions.Count; r++)
            {
                var res = resolutions[r];
                var runtimeResolution = res.width == runtimeW && res.height == runtimeH;
                var buckets = new Dictionary<long, List<int>>();
                for (var i = 0; i < nodes.Count; i++)
                {
                    if (!nodes[i].hasGraphic && !nodes[i].interactiveCandidate)
                    {
                        continue;
                    }

                    var rect = nodes[i].RectForResolution(runtimeW, runtimeH, res.width, res.height);
                    var minX = Mathf.FloorToInt(rect.xMin / 128f);
                    var maxX = Mathf.FloorToInt(rect.xMax / 128f);
                    var minY = Mathf.FloorToInt(rect.yMin / 128f);
                    var maxY = Mathf.FloorToInt(rect.yMax / 128f);
                    for (var bx = minX; bx <= maxX; bx++)
                    {
                        for (var by = minY; by <= maxY; by++)
                        {
                            var key = ((long)bx << 32) | (uint)by;
                            List<int> list;
                            if (!buckets.TryGetValue(key, out list))
                            {
                                list = new List<int>();
                                buckets[key] = list;
                            }
                            list.Add(i);
                        }
                    }
                }

                var dedup = new HashSet<ulong>();
                foreach (var entry in buckets)
                {
                    var list = entry.Value;
                    for (var i = 0; i < list.Count; i++)
                    {
                        for (var j = i + 1; j < list.Count; j++)
                        {
                            if (!tracker.CanContinue())
                            {
                                return;
                            }

                            var a = list[i];
                            var b = list[j];
                            var key = ((ulong)(uint)Math.Min(a, b) << 32) | (uint)Math.Max(a, b);
                            if (!dedup.Add(key))
                            {
                                continue;
                            }

                            if (!string.Equals(nodes[a].canvasKey, nodes[b].canvasKey, StringComparison.Ordinal))
                            {
                                continue;
                            }

                            var ra = nodes[a].RectForResolution(runtimeW, runtimeH, res.width, res.height);
                            var rb = nodes[b].RectForResolution(runtimeW, runtimeH, res.width, res.height);
                            if (!ra.Overlaps(rb))
                            {
                                continue;
                            }

                            var ixMin = Mathf.Max(ra.xMin, rb.xMin);
                            var iyMin = Mathf.Max(ra.yMin, rb.yMin);
                            var ixMax = Mathf.Min(ra.xMax, rb.xMax);
                            var iyMax = Mathf.Min(ra.yMax, rb.yMax);
                            if ((ixMax - ixMin) * (iyMax - iyMin) < 16f)
                            {
                                continue;
                            }

                            tracker.TryAdd(
                                new UnityUiLayoutIssue
                                {
                                    anchor = new UnityObjectAnchor
                                    {
                                        object_id = nodes[a].objectId,
                                        path = nodes[a].path
                                    },
                                    issue_type = "OVERLAP",
                                    severity = "warning",
                                    resolution = res.name,
                                    details = "AABB overlap detected with another UI element.",
                                    suggestion = "Adjust layout constraints or sibling order.",
                                    mode = runtimeResolution ? "direct_runtime" : "derived_only",
                                    confidence = runtimeResolution ? "medium" : "low",
                                    approximate = !runtimeResolution,
                                    approx_reason = runtimeResolution ? string.Empty : "DERIVED_ONLY_MODEL"
                                });
                        }
                    }
                }
            }
        }

        private static void EvaluateNotClickableIssues(
            List<ValidateNode> nodes,
            string runtimeName,
            bool hasRaycastSource,
            ValidateIssueTracker tracker)
        {
            for (var i = 0; i < nodes.Count; i++)
            {
                if (!tracker.CanContinue())
                {
                    return;
                }

                var node = nodes[i];
                if (!node.interactiveCandidate)
                {
                    continue;
                }

                var reasons = new List<string>(4);
                if (!node.componentEnabled)
                {
                    reasons.Add("component disabled");
                }
                if (!node.interactable)
                {
                    reasons.Add("interactable=false");
                }
                if (node.hasGraphic && !node.raycastTarget)
                {
                    reasons.Add("raycast_target=false");
                }
                if (!hasRaycastSource)
                {
                    reasons.Add("NO_RAYCAST_SOURCE");
                }
                if (reasons.Count == 0)
                {
                    continue;
                }

                var approximate = !hasRaycastSource;
                tracker.TryAdd(
                    new UnityUiLayoutIssue
                    {
                        anchor = new UnityObjectAnchor
                        {
                            object_id = node.objectId,
                            path = node.path
                        },
                        issue_type = "NOT_CLICKABLE",
                        severity = approximate ? "warning" : "error",
                        resolution = runtimeName,
                        details = "Potentially not clickable: " + string.Join(", ", reasons.ToArray()),
                        suggestion = "Enable interactable state and ensure raycast path is available.",
                        mode = approximate ? "static_only" : "theoretical_with_raycast_context",
                        confidence = approximate ? "low" : "medium",
                        approximate = approximate,
                        approx_reason = approximate ? "NO_RAYCAST_SOURCE" : string.Empty
                    });
            }
        }

        private static void EvaluateTextOverflowIssues(
            List<ValidateNode> nodes,
            List<ValidateResolutionSpec> resolutions,
            int runtimeW,
            int runtimeH,
            string runtimeName,
            ValidateIssueTracker tracker)
        {
            for (var i = 0; i < nodes.Count; i++)
            {
                if (!tracker.CanContinue())
                {
                    return;
                }

                var node = nodes[i];
                if (!node.textCandidate)
                {
                    continue;
                }

                bool runtimeOverflow;
                float runtimePreferredW;
                float runtimePreferredH;
                if (!TryReadTextOverflowForNode(node, runtimeW, runtimeH, runtimeW, runtimeH, out runtimeOverflow, out runtimePreferredW, out runtimePreferredH))
                {
                    continue;
                }

                if (runtimeOverflow)
                {
                    tracker.TryAdd(
                        new UnityUiLayoutIssue
                        {
                            anchor = new UnityObjectAnchor
                            {
                                object_id = node.objectId,
                                path = node.path
                            },
                            issue_type = "TEXT_OVERFLOW",
                            severity = "error",
                            resolution = runtimeName,
                            details = "Text preferred size exceeds current rect.",
                            suggestion = "Increase rect size, reduce font size, or enable wrapping.",
                            mode = "direct_runtime",
                            confidence = "high",
                            approximate = false,
                            approx_reason = string.Empty
                        });
                }

                for (var r = 0; r < resolutions.Count; r++)
                {
                    if (!tracker.CanContinue())
                    {
                        return;
                    }

                    var res = resolutions[r];
                    if (res.width == runtimeW && res.height == runtimeH)
                    {
                        continue;
                    }

                    bool derivedOverflow;
                    float derivedPreferredW;
                    float derivedPreferredH;
                    if (!TryReadTextOverflowForNode(
                        node,
                        runtimeW,
                        runtimeH,
                        res.width,
                        res.height,
                        out derivedOverflow,
                        out derivedPreferredW,
                        out derivedPreferredH))
                    {
                        continue;
                    }

                    if (!derivedOverflow && !runtimeOverflow)
                    {
                        continue;
                    }

                    tracker.TryAdd(
                        new UnityUiLayoutIssue
                        {
                            anchor = new UnityObjectAnchor
                            {
                                object_id = node.objectId,
                                path = node.path
                            },
                            issue_type = "TEXT_OVERFLOW",
                            severity = "warning",
                            resolution = res.name,
                            details = "Derived model predicts text overflow for this resolution.",
                            suggestion = "Review wrapping and bounds at this resolution.",
                            mode = "derived_only",
                            confidence = "low",
                            approximate = true,
                            approx_reason = "DERIVED_ONLY_MODEL"
                        });
                }
            }
        }

        private static bool TryReadTextOverflowForNode(
            ValidateNode node,
            int runtimeW,
            int runtimeH,
            int targetW,
            int targetH,
            out bool overflow,
            out float preferredW,
            out float preferredH)
        {
            overflow = false;
            preferredW = 0f;
            preferredH = 0f;
            if (node == null)
            {
                return false;
            }

            var rect = node.RectForResolution(runtimeW, runtimeH, targetW, targetH);
            if (rect.width <= 0.5f || rect.height <= 0.5f)
            {
                return false;
            }

            var scaleW = node.runtimeRect.width <= 0.5f ? 1f : rect.width / node.runtimeRect.width;
            var scaleH = node.runtimeRect.height <= 0.5f ? 1f : rect.height / node.runtimeRect.height;

            if (node.textComponent != null)
            {
                preferredW = Mathf.Max(0f, LayoutUtility.GetPreferredWidth(node.rectTransform)) * scaleW;
                preferredH = Mathf.Max(0f, LayoutUtility.GetPreferredHeight(node.rectTransform)) * scaleH;
                overflow = preferredW > rect.width + 0.5f || preferredH > rect.height + 0.5f;
                return true;
            }

            if (node.tmpTextComponent != null)
            {
                ForceTmpMeshUpdate(node.tmpTextComponent);
                preferredW = ReadFloatProperty(node.tmpTextComponent, "preferredWidth") * scaleW;
                preferredH = ReadFloatProperty(node.tmpTextComponent, "preferredHeight") * scaleH;
                var runtimeOverflow = ReadBoolProperty(node.tmpTextComponent, "isTextOverflowing", false);
                overflow = runtimeOverflow || preferredW > rect.width + 0.5f || preferredH > rect.height + 0.5f;
                return true;
            }

            return false;
        }

        private static float ResolveUiScaleRatio(Canvas rootCanvas, int runtimeW, int runtimeH, int targetW, int targetH)
        {
            var runtimeScale = ComputeUiScale(rootCanvas, runtimeW, runtimeH);
            var targetScale = ComputeUiScale(rootCanvas, targetW, targetH);
            if (runtimeScale <= 0.0001f)
            {
                return 1f;
            }

            return Mathf.Max(0.0001f, targetScale / runtimeScale);
        }

        private static float ComputeUiScale(Canvas rootCanvas, int width, int height)
        {
            if (rootCanvas == null || width <= 0 || height <= 0)
            {
                return 1f;
            }

            var scaler = rootCanvas.GetComponent<CanvasScaler>();
            if (scaler == null)
            {
                return 1f;
            }

            if (scaler.uiScaleMode != CanvasScaler.ScaleMode.ScaleWithScreenSize)
            {
                return Mathf.Max(0.0001f, scaler.scaleFactor);
            }

            var reference = scaler.referenceResolution;
            if (reference.x <= 0.01f || reference.y <= 0.01f)
            {
                return 1f;
            }

            var scaleX = width / reference.x;
            var scaleY = height / reference.y;
            var match = Mathf.Clamp01(scaler.matchWidthOrHeight);
            return Mathf.Max(0.0001f, Mathf.Pow(scaleX, 1f - match) * Mathf.Pow(scaleY, match));
        }

        private static Component GetComponentByName(GameObject gameObject, string typeName)
        {
            if (gameObject == null || string.IsNullOrEmpty(typeName))
            {
                return null;
            }

            Component[] components;
            try
            {
                components = gameObject.GetComponents<Component>();
            }
            catch
            {
                return null;
            }

            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null || component.GetType() == null)
                {
                    continue;
                }

                if (string.Equals(component.GetType().Name, typeName, StringComparison.Ordinal))
                {
                    return component;
                }
            }

            return null;
        }

        private static Component ResolveTmpTextComponent(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return null;
            }

            Component[] components;
            try
            {
                components = gameObject.GetComponents<Component>();
            }
            catch
            {
                return null;
            }

            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null || component.GetType() == null)
                {
                    continue;
                }

                var fullName = component.GetType().FullName;
                if (string.IsNullOrEmpty(fullName))
                {
                    continue;
                }

                if (string.Equals(fullName, "TMPro.TMP_Text", StringComparison.Ordinal) ||
                    string.Equals(fullName, "TMPro.TextMeshProUGUI", StringComparison.Ordinal))
                {
                    return component;
                }
            }

            return null;
        }

        private static void ForceTmpMeshUpdate(Component tmpText)
        {
            if (tmpText == null)
            {
                return;
            }

            try
            {
                var noArgs = tmpText.GetType().GetMethod(
                    "ForceMeshUpdate",
                    BindingFlags.Public | BindingFlags.Instance,
                    null,
                    Type.EmptyTypes,
                    null);
                if (noArgs != null)
                {
                    noArgs.Invoke(tmpText, null);
                    return;
                }

                var withFlags = tmpText.GetType().GetMethod(
                    "ForceMeshUpdate",
                    BindingFlags.Public | BindingFlags.Instance,
                    null,
                    new[] { typeof(bool), typeof(bool) },
                    null);
                if (withFlags != null)
                {
                    withFlags.Invoke(tmpText, new object[] { false, false });
                }
            }
            catch
            {
                // best effort
            }
        }

        private static float ReadFloatProperty(Component component, string propertyName)
        {
            if (component == null || string.IsNullOrEmpty(propertyName))
            {
                return 0f;
            }

            var property = component.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
            if (property == null)
            {
                return 0f;
            }

            try
            {
                var value = property.GetValue(component, null);
                if (value is float)
                {
                    return (float)value;
                }

                if (value is double)
                {
                    return (float)(double)value;
                }

                if (value is int)
                {
                    return (int)value;
                }
            }
            catch
            {
                // ignored
            }

            return 0f;
        }

        private static bool ReadBoolProperty(Component component, string propertyName, bool fallback)
        {
            if (component == null || string.IsNullOrEmpty(propertyName))
            {
                return fallback;
            }

            var property = component.GetType().GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
            if (property == null || property.PropertyType != typeof(bool))
            {
                return fallback;
            }

            try
            {
                return (bool)property.GetValue(component, null);
            }
            catch
            {
                return fallback;
            }
        }


    }
}

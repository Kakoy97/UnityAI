using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        public UnityGetUiTreeResponse GetUiTree(UnityGetUiTreeRequest request)
        {
            return UiTreeReadService.Execute(request);
        }

        private static class UiTreeReadService
        {
            internal static UnityGetUiTreeResponse Execute(UnityGetUiTreeRequest request)
            {
                var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
                var payload = request == null ? null : request.payload;

                var uiSystem = NormalizeUiSystem(payload == null ? string.Empty : payload.ui_system);
                var rootPath = payload != null ? NormalizePath(payload.root_path) : string.Empty;
                var includeInactive = payload == null || payload.include_inactive;
                var includeComponents = payload == null || payload.include_components;
                var includeLayout = payload == null || payload.include_layout;
                var includeInteraction = payload == null || payload.include_interaction;
                var includeTextMetrics = payload == null || payload.include_text_metrics;
                var maxDepth = ClampInRange(
                    payload == null ? 0 : payload.max_depth,
                    DefaultUiTreeMaxDepth,
                    0,
                    MaxUiTreeDepth);
                var nodeBudget = ClampPositive(payload == null ? 0 : payload.node_budget, DefaultNodeBudget);
                var charBudget = ClampPositive(payload == null ? 0 : payload.char_budget, DefaultCharBudget);
                var requestedResolution = payload == null ? null : payload.resolution;

                if (string.Equals(uiSystem, "uitk", StringComparison.Ordinal))
                {
                    return BuildGetUiTreeFailure(
                        requestId,
                        "E_UI_TREE_SOURCE_NOT_FOUND",
                        "UI Toolkit tree export is not supported in this phase.");
                }

                var roots = CollectUiTreeRoots(rootPath, includeInactive);
                if (roots.Count == 0)
                {
                    return BuildGetUiTreeFailure(
                        requestId,
                        "E_UI_TREE_SOURCE_NOT_FOUND",
                        string.IsNullOrEmpty(rootPath)
                            ? "No UGUI root found in loaded scenes."
                            : "UI root_path not found: " + rootPath);
                }

                var scopeTransform = string.IsNullOrEmpty(rootPath) ? null : FindTransformByScenePath(rootPath);
                var runtimeCanvases = CollectRuntimeCanvases(scopeTransform);
                RuntimeResolutionPick runtimePick;
                if (!TryResolveRuntimeResolution(scopeTransform, runtimeCanvases, requestedResolution, out runtimePick))
                {
                    var fallbackWidth = requestedResolution != null && requestedResolution.width > 0
                        ? requestedResolution.width
                        : 1;
                    var fallbackHeight = requestedResolution != null && requestedResolution.height > 0
                        ? requestedResolution.height
                        : 1;
                    runtimePick = new RuntimeResolutionPick
                    {
                        width = fallbackWidth,
                        height = fallbackHeight,
                        source = "fallback_req_resolution",
                        scope_path = rootPath,
                        scope_object_id = string.Empty
                    };
                }

                var buildStats = new UiTreeBuildStats();
                var remainingBudget = nodeBudget;
                var rootNodes = new List<UnityUiTreeNode>(roots.Count);
                for (var i = 0; i < roots.Count; i++)
                {
                    if (remainingBudget <= 0)
                    {
                        buildStats.truncated_by_node_budget = true;
                        break;
                    }

                    var node = BuildUiTreeNode(
                        roots[i],
                        0,
                        maxDepth,
                        includeInactive,
                        includeComponents,
                        includeLayout,
                        includeInteraction,
                        includeTextMetrics,
                        ref remainingBudget,
                        ref buildStats,
                        runtimePick.width,
                        runtimePick.height);
                    if (node != null)
                    {
                        rootNodes.Add(node);
                    }
                }

                if (rootNodes.Count == 0)
                {
                    return BuildGetUiTreeFailure(
                        requestId,
                        "E_UI_TREE_SOURCE_NOT_FOUND",
                        "No visible UI nodes matched current filters.");
                }

                var data = new UnityGetUiTreeData
                {
                    ui_system = uiSystem,
                    root_path = rootPath,
                    include_inactive = includeInactive,
                    include_components = includeComponents,
                    include_layout = includeLayout,
                    include_interaction = includeInteraction,
                    include_text_metrics = includeTextMetrics,
                    max_depth = maxDepth,
                    node_budget = nodeBudget,
                    char_budget = charBudget,
                    returned_node_count = CountUiNodes(rootNodes),
                    truncated = false,
                    truncated_reason = string.Empty,
                    runtime_resolution = new UnityQueryResolution
                    {
                        width = runtimePick.width,
                        height = runtimePick.height
                    },
                    runtime_source = runtimePick.source,
                    canvases = CollectUiCanvasInfos(includeInactive, rootPath).ToArray(),
                    roots = rootNodes.ToArray()
                };

                ApplyUiTreeCharBudget(data, charBudget, ref buildStats);
                data.returned_node_count = CountUiNodes(data.roots);
                data.truncated_reason = BuildUiTreeTruncatedReason(buildStats);
                data.truncated = !string.IsNullOrEmpty(data.truncated_reason);

                var tokenPath = string.IsNullOrEmpty(rootPath)
                    ? (data.roots != null && data.roots.Length > 0 ? data.roots[0].path : "Scene/UI")
                    : rootPath;
                var tokenObjectId =
                    data.roots != null && data.roots.Length > 0
                        ? (data.roots[0].object_id ?? string.Empty)
                        : string.Empty;

                return new UnityGetUiTreeResponse
                {
                    ok = true,
                    request_id = requestId,
                    captured_at = NowIso(),
                    error_code = string.Empty,
                    error_message = string.Empty,
                    read_token = BuildReadToken("scene", tokenObjectId, tokenPath),
                    data = data
                };
            }
        }
    }
}
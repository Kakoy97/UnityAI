using System;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class GetUiTreeSsotExecutor
    {
        private readonly UnityRagReadService _readService;

        public GetUiTreeSsotExecutor()
            : this(new UnityRagReadService())
        {
        }

        internal GetUiTreeSsotExecutor(UnityRagReadService readService)
        {
            _readService = readService ?? new UnityRagReadService();
        }

        public SsotDispatchResponse Execute(GetUiTreeRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "get_ui_tree request payload is required.",
                    GetUiTreeRequestDto.ToolName);
            }

            var scope = ParseScope(request.scope);
            var rootPath = ResolveRootPath(request.root_path, scope);
            var readRequest = new UnityGetUiTreeRequest
            {
                @event = "unity.query.get_ui_tree.request",
                request_id = "ssot_" + Guid.NewGuid().ToString("N"),
                thread_id = SsotExecutorCommon.Normalize(request.thread_id),
                turn_id = string.Empty,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityGetUiTreePayload
                {
                    ui_system = SsotExecutorCommon.Normalize(request.ui_system),
                    root_path = rootPath,
                    include_inactive = request.include_inactive,
                    include_components = request.include_components,
                    include_layout = request.include_layout,
                    include_interaction = request.include_interaction,
                    include_text_metrics = request.include_text_metrics,
                    max_depth = request.max_depth,
                    node_budget = request.node_budget,
                    char_budget = request.char_budget,
                    resolution = ParseResolution(request.resolution),
                    timeout_ms = request.timeout_ms
                }
            };

            var response = _readService.GetUiTree(readRequest);
            if (response == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_ui_tree returned null response.",
                    GetUiTreeRequestDto.ToolName);
            }

            if (!response.ok)
            {
                return SsotRequestDispatcher.Failure(
                    SsotExecutorCommon.Normalize(response.error_code),
                    SsotExecutorCommon.Normalize(response.error_message),
                    GetUiTreeRequestDto.ToolName);
            }

            var responseData = response.data ?? new UnityGetUiTreeData();
            var uiRoots = ConvertNodes(responseData.roots);
            var canvasCount = responseData.canvases == null ? 0 : responseData.canvases.Length;

            return SsotRequestDispatcher.Success(
                GetUiTreeRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    ui_system = SsotExecutorCommon.Normalize(responseData.ui_system),
                    root_path = SsotExecutorCommon.Normalize(responseData.root_path),
                    include_inactive = responseData.include_inactive,
                    include_components = responseData.include_components,
                    include_layout = responseData.include_layout,
                    include_interaction = responseData.include_interaction,
                    include_text_metrics = responseData.include_text_metrics,
                    max_depth = responseData.max_depth,
                    node_budget = responseData.node_budget,
                    char_budget = responseData.char_budget,
                    returned_node_count = responseData.returned_node_count,
                    truncated = responseData.truncated,
                    truncated_reason = SsotExecutorCommon.Normalize(responseData.truncated_reason),
                    returned_canvas_count = canvasCount,
                    ui_roots = uiRoots,
                    read_token_candidate =
                        response.read_token != null &&
                        !string.IsNullOrWhiteSpace(response.read_token.token)
                            ? response.read_token.token
                            : SsotExecutorCommon.BuildReadTokenCandidate()
                });
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

        private static UnityQueryResolution ParseResolution(object raw)
        {
            if (raw == null)
            {
                return null;
            }

            if (raw is UnityQueryResolution resolution)
            {
                return resolution;
            }

            if (raw is string rawJson)
            {
                return ParseJsonResolution(rawJson);
            }

            try
            {
                var json = JsonUtility.ToJson(raw);
                return ParseJsonResolution(json);
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

        private static UnityQueryResolution ParseJsonResolution(string rawJson)
        {
            var normalized = SsotExecutorCommon.Normalize(rawJson);
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            try
            {
                return JsonUtility.FromJson<UnityQueryResolution>(normalized);
            }
            catch
            {
                return null;
            }
        }

        private static SsotHierarchyNodeSummary[] ConvertNodes(UnityUiTreeNode[] nodes)
        {
            if (nodes == null || nodes.Length <= 0)
            {
                return Array.Empty<SsotHierarchyNodeSummary>();
            }

            var mapped = new SsotHierarchyNodeSummary[nodes.Length];
            for (var i = 0; i < nodes.Length; i += 1)
            {
                mapped[i] = ConvertNode(nodes[i]);
            }

            return mapped;
        }

        private static SsotHierarchyNodeSummary ConvertNode(UnityUiTreeNode node)
        {
            if (node == null)
            {
                return null;
            }

            var children = ConvertNodes(node.children);
            var componentCount = node.components == null ? 0 : node.components.Length;
            if (componentCount <= 0 && node.components_summary != null)
            {
                componentCount = node.components_summary.Length;
            }

            return new SsotHierarchyNodeSummary
            {
                name = SsotExecutorCommon.Normalize(node.name),
                object_id = SsotExecutorCommon.Normalize(node.object_id),
                path = SsotExecutorCommon.Normalize(node.path),
                depth = node.depth,
                component_count = componentCount,
                active = node.active_self,
                children_truncated_count = node.children_truncated_count,
                children = children
            };
        }
    }
}

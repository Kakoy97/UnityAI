using System;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Generated.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class QueryPrefabInfoSsotExecutor
    {
        private readonly UnityRagReadService _readService;

        public QueryPrefabInfoSsotExecutor()
            : this(new UnityRagReadService())
        {
        }

        internal QueryPrefabInfoSsotExecutor(UnityRagReadService readService)
        {
            _readService = readService ?? new UnityRagReadService();
        }

        public SsotDispatchResponse Execute(QueryPrefabInfoRequestDto request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.prefab_path))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "prefab_path is required.",
                    QueryPrefabInfoRequestDto.ToolName);
            }

            var normalizedPrefabPath = SsotExecutorCommon.Normalize(request.prefab_path);
            var readRequest = new UnityQueryPrefabInfoRequest
            {
                @event = "unity.query.query_prefab_info.request",
                request_id = "ssot_" + Guid.NewGuid().ToString("N"),
                thread_id = SsotExecutorCommon.Normalize(request.thread_id),
                turn_id = string.Empty,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityQueryPrefabInfoPayload
                {
                    prefab_path = normalizedPrefabPath,
                    max_depth = request.max_depth,
                    node_budget = request.node_budget,
                    char_budget = request.char_budget,
                    include_components = request.include_components,
                    include_missing_scripts = request.include_missing_scripts
                }
            };

            var response = _readService.QueryPrefabInfo(readRequest);
            if (response == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "query_prefab_info returned null response.",
                    QueryPrefabInfoRequestDto.ToolName);
            }

            if (!response.ok)
            {
                return SsotRequestDispatcher.Failure(
                    SsotExecutorCommon.Normalize(response.error_code),
                    SsotExecutorCommon.Normalize(response.error_message),
                    QueryPrefabInfoRequestDto.ToolName);
            }

            var responseData = response.data ?? new UnityQueryPrefabInfoData();
            return SsotRequestDispatcher.Success(
                QueryPrefabInfoRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    prefab_path = normalizedPrefabPath,
                    max_depth = responseData.max_depth,
                    node_budget = responseData.node_budget,
                    char_budget = responseData.char_budget,
                    include_components = responseData.include_components,
                    include_missing_scripts = responseData.include_missing_scripts,
                    returned_node_count = responseData.returned_node_count,
                    truncated = responseData.truncated,
                    truncated_reason = SsotExecutorCommon.Normalize(responseData.truncated_reason),
                    root = ConvertNode(responseData.root),
                });
        }

        private static SsotHierarchyNodeSummary ConvertNode(UnityPrefabTreeNode node)
        {
            if (node == null)
            {
                return null;
            }

            var children = node.children;
            var mappedChildren = children == null || children.Length <= 0
                ? Array.Empty<SsotHierarchyNodeSummary>()
                : new SsotHierarchyNodeSummary[children.Length];
            for (var i = 0; i < mappedChildren.Length; i += 1)
            {
                mappedChildren[i] = ConvertNode(children[i]);
            }

            var componentCount = node.components == null ? 0 : node.components.Length;
            return new SsotHierarchyNodeSummary
            {
                name = SsotExecutorCommon.Normalize(node.name),
                object_id = SsotExecutorCommon.Normalize(node.object_id),
                path = SsotExecutorCommon.Normalize(node.path),
                depth = node.depth,
                component_count = componentCount,
                active = node.active,
                children_truncated_count = node.children_truncated_count,
                children = mappedChildren
            };
        }
    }
}

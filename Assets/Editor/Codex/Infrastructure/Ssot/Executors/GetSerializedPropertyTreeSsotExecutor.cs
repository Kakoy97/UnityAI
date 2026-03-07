using System;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Generated.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class GetSerializedPropertyTreeSsotExecutor
    {
        private readonly UnityRagReadService _readService;

        public GetSerializedPropertyTreeSsotExecutor()
            : this(new UnityRagReadService())
        {
        }

        internal GetSerializedPropertyTreeSsotExecutor(UnityRagReadService readService)
        {
            _readService = readService ?? new UnityRagReadService();
        }

        public SsotDispatchResponse Execute(GetSerializedPropertyTreeRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "get_serialized_property_tree request payload is required.",
                    GetSerializedPropertyTreeRequestDto.ToolName);
            }

            var targetObjectId = SsotExecutorCommon.Normalize(request.target_object_id);
            var targetPath = SsotExecutorCommon.Normalize(request.target_path);
            var componentType =
                SsotExecutorCommon.Normalize(request.component_assembly_qualified_name);
            if (string.IsNullOrEmpty(targetObjectId) ||
                string.IsNullOrEmpty(targetPath) ||
                string.IsNullOrEmpty(componentType))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "target_object_id, target_path, component_assembly_qualified_name are required.",
                    GetSerializedPropertyTreeRequestDto.ToolName);
            }

            var requestEnvelope = new UnityGetSerializedPropertyTreeRequest
            {
                @event = "unity.query.get_serialized_property_tree.request",
                request_id = "ssot_" + Guid.NewGuid().ToString("N"),
                thread_id = SsotExecutorCommon.Normalize(request.thread_id),
                turn_id = string.Empty,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityGetSerializedPropertyTreePayload
                {
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = targetObjectId,
                        path = targetPath
                    },
                    component_selector = new SerializedPropertyComponentSelector
                    {
                        component_assembly_qualified_name = componentType,
                        component_index = request.component_index
                    },
                    root_property_path = SsotExecutorCommon.Normalize(request.root_property_path),
                    depth = request.depth,
                    after_property_path = SsotExecutorCommon.Normalize(request.after_property_path),
                    page_size = request.page_size,
                    node_budget = request.node_budget,
                    char_budget = request.char_budget,
                    include_value_summary = request.include_value_summary,
                    include_non_visible = request.include_non_visible,
                    timeout_ms = request.timeout_ms
                }
            };

            var response = _readService.GetSerializedPropertyTree(requestEnvelope);
            if (response == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "get_serialized_property_tree returned null response.",
                    GetSerializedPropertyTreeRequestDto.ToolName);
            }

            if (!response.ok)
            {
                return SsotRequestDispatcher.Failure(
                    SsotExecutorCommon.Normalize(response.error_code),
                    SsotExecutorCommon.Normalize(response.error_message),
                    GetSerializedPropertyTreeRequestDto.ToolName);
            }

            var responseData = response.data ?? new UnityGetSerializedPropertyTreeData();
            var componentInfo = ResolveComponentInfo(responseData, request);
            var nodes = ConvertNodes(responseData.nodes);
            var components = ConvertComponents(responseData.components);
            var returnedCount = responseData.returned_count > 0
                ? responseData.returned_count
                : nodes.Length;

            return SsotRequestDispatcher.Success(
                GetSerializedPropertyTreeRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.Normalize(componentInfo.target_object_id),
                    target_path = SsotExecutorCommon.Normalize(componentInfo.target_path),
                    component_type = SsotExecutorCommon.Normalize(componentInfo.type),
                    property_path = SsotExecutorCommon.Normalize(responseData.root_property_path),
                    depth = responseData.depth,
                    node_budget = responseData.node_budget,
                    char_budget = responseData.char_budget,
                    include_value_summary = responseData.include_value_summary,
                    include_non_visible = responseData.include_non_visible,
                    returned_node_count = returnedCount,
                    total_count = returnedCount,
                    truncated = responseData.truncated,
                    truncated_reason = SsotExecutorCommon.Normalize(responseData.truncated_reason),
                    next_cursor = SsotExecutorCommon.Normalize(responseData.next_cursor),
                    serialized_property_nodes = nodes,
                    serialized_property_components = components,
                });
        }

        private static UnitySerializedPropertyTreeComponentInfo ResolveComponentInfo(
            UnityGetSerializedPropertyTreeData data,
            GetSerializedPropertyTreeRequestDto request)
        {
            if (data != null && data.component != null)
            {
                return data.component;
            }

            if (data != null &&
                data.components != null &&
                data.components.Length > 0 &&
                data.components[0] != null &&
                data.components[0].component != null)
            {
                return data.components[0].component;
            }

            return new UnitySerializedPropertyTreeComponentInfo
            {
                type = SsotExecutorCommon.Normalize(request.component_assembly_qualified_name),
                target_object_id = SsotExecutorCommon.Normalize(request.target_object_id),
                target_path = SsotExecutorCommon.Normalize(request.target_path)
            };
        }

        private static SsotSerializedPropertyNodeSummary[] ConvertNodes(UnitySerializedPropertyTreeNode[] nodes)
        {
            if (nodes == null || nodes.Length <= 0)
            {
                return Array.Empty<SsotSerializedPropertyNodeSummary>();
            }

            var mapped = new SsotSerializedPropertyNodeSummary[nodes.Length];
            for (var i = 0; i < nodes.Length; i += 1)
            {
                var node = nodes[i] ?? new UnitySerializedPropertyTreeNode();
                mapped[i] = new SsotSerializedPropertyNodeSummary
                {
                    property_path = SsotExecutorCommon.Normalize(node.property_path),
                    display_name = SsotExecutorCommon.Normalize(node.display_name),
                    property_type = SsotExecutorCommon.Normalize(node.property_type),
                    depth = node.depth,
                    writable = node.writable,
                    value_summary = SsotExecutorCommon.Normalize(node.value_summary),
                    has_visible_children = node.has_visible_children,
                    common_use = node.common_use,
                    llm_hint = SsotExecutorCommon.Normalize(node.llm_hint)
                };
            }

            return mapped;
        }

        private static SsotSerializedPropertyComponentSummary[] ConvertComponents(
            UnitySerializedPropertyTreeComponentData[] components)
        {
            if (components == null || components.Length <= 0)
            {
                return Array.Empty<SsotSerializedPropertyComponentSummary>();
            }

            var mapped = new SsotSerializedPropertyComponentSummary[components.Length];
            for (var i = 0; i < components.Length; i += 1)
            {
                var entry = components[i] ?? new UnitySerializedPropertyTreeComponentData();
                var component = entry.component ?? new UnitySerializedPropertyTreeComponentInfo();
                mapped[i] = new SsotSerializedPropertyComponentSummary
                {
                    selector_index = entry.selector_index,
                    type = SsotExecutorCommon.Normalize(component.type),
                    target_object_id = SsotExecutorCommon.Normalize(component.target_object_id),
                    target_path = SsotExecutorCommon.Normalize(component.target_path),
                    returned_count = entry.returned_count,
                    truncated = entry.truncated,
                    truncated_reason = SsotExecutorCommon.Normalize(entry.truncated_reason),
                    next_cursor = SsotExecutorCommon.Normalize(entry.next_cursor)
                };
            }

            return mapped;
        }
    }
}

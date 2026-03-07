using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class GetHierarchySubtreeSsotExecutor
    {
        private const int DefaultDepth = 2;
        private const int DefaultNodeBudget = 200;
        private const int DefaultCharBudget = 12000;

        public SsotDispatchResponse Execute(GetHierarchySubtreeRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "get_hierarchy_subtree request payload is required.",
                    GetHierarchySubtreeRequestDto.ToolName);
            }

            GameObject target;
            string errorCode;
            string errorMessage;
            if (!SsotExecutorCommon.TryResolveTargetFromAnchor(
                    request.target_path,
                    request.target_object_id,
                    out target,
                    out errorCode,
                    out errorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    errorCode,
                    errorMessage,
                    GetHierarchySubtreeRequestDto.ToolName);
            }

            var depth = request.depth > 0 ? request.depth : DefaultDepth;
            if (depth < 0)
            {
                depth = 0;
            }

            var nodeBudget = request.node_budget > 0 ? request.node_budget : DefaultNodeBudget;
            var charBudget = request.char_budget > 0 ? request.char_budget : DefaultCharBudget;

            var visitedNodes = 0;
            var truncated = false;
            var root = BuildHierarchyNode(
                target == null ? null : target.transform,
                0,
                depth,
                nodeBudget,
                ref visitedNodes,
                ref truncated);
            if (root == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "Target hierarchy root is unavailable.",
                    GetHierarchySubtreeRequestDto.ToolName);
            }

            var truncatedReason = string.Empty;
            if (truncated)
            {
                truncatedReason = "node_budget_exceeded";
            }

            try
            {
                var charCount = JsonUtility.ToJson(root).Length;
                if (charCount > charBudget)
                {
                    truncated = true;
                    truncatedReason = string.IsNullOrEmpty(truncatedReason)
                        ? "char_budget_exceeded"
                        : truncatedReason + "+char_budget_exceeded";
                }
            }
            catch
            {
                // No-op: char budget estimation is best effort only.
            }

            return SsotRequestDispatcher.Success(
                GetHierarchySubtreeRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    target_object_name = target == null ? string.Empty : target.name,
                    target_object_active = target != null && target.activeSelf,
                    depth = depth,
                    node_budget = nodeBudget,
                    char_budget = charBudget,
                    returned_node_count = visitedNodes,
                    truncated = truncated,
                    truncated_reason = truncatedReason,
                    root = root,
                });
        }

        private static SsotHierarchyNodeSummary BuildHierarchyNode(
            Transform current,
            int currentDepth,
            int maxDepth,
            int nodeBudget,
            ref int visitedNodes,
            ref bool truncated)
        {
            if (current == null)
            {
                return null;
            }

            if (visitedNodes >= nodeBudget)
            {
                truncated = true;
                return null;
            }

            visitedNodes += 1;
            var gameObject = current.gameObject;
            var components = gameObject == null
                ? Array.Empty<Component>()
                : gameObject.GetComponents<Component>();
            var node = new SsotHierarchyNodeSummary
            {
                name = gameObject == null ? string.Empty : gameObject.name,
                object_id = SsotExecutorCommon.BuildObjectId(gameObject),
                path = SsotExecutorCommon.BuildScenePath(gameObject),
                depth = currentDepth,
                component_count = components == null ? 0 : components.Length,
                active = gameObject != null && gameObject.activeSelf,
                children_truncated_count = 0,
                children = Array.Empty<SsotHierarchyNodeSummary>()
            };

            if (currentDepth >= maxDepth || current.childCount <= 0)
            {
                return node;
            }

            var children = new List<SsotHierarchyNodeSummary>();
            var truncatedChildrenCount = 0;
            for (var i = 0; i < current.childCount; i += 1)
            {
                if (visitedNodes >= nodeBudget)
                {
                    truncated = true;
                    truncatedChildrenCount += current.childCount - i;
                    break;
                }

                var childNode = BuildHierarchyNode(
                    current.GetChild(i),
                    currentDepth + 1,
                    maxDepth,
                    nodeBudget,
                    ref visitedNodes,
                    ref truncated);
                if (childNode != null)
                {
                    children.Add(childNode);
                }
                else
                {
                    truncatedChildrenCount += 1;
                }
            }

            node.children = children.ToArray();
            node.children_truncated_count = truncatedChildrenCount;
            return node;
        }
    }
}

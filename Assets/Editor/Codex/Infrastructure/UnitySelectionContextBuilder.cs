using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Ports;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class UnitySelectionContextBuilder : ISelectionContextBuilder
    {
        public TurnContext BuildContext(GameObject selected, int maxDepth)
        {
            var prefabPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(selected);
            if (string.IsNullOrEmpty(prefabPath))
            {
                prefabPath = string.Empty;
            }

            var truncatedCount = 0;
            var rootNode = BuildTreeNode(selected.transform, 0, maxDepth, ref truncatedCount);
            var truncatedReason = truncatedCount > 0 ? "max_depth_exceeded" : string.Empty;

            return new TurnContext
            {
                selection = new SelectionInfo
                {
                    mode = "selection",
                    target_object_path = BuildGameObjectPath(selected.transform),
                    prefab_path = prefabPath
                },
                selection_tree = new SelectionTreeInfo
                {
                    max_depth = maxDepth,
                    root = rootNode,
                    truncated_node_count = truncatedCount,
                    truncated_reason = truncatedReason
                }
            };
        }

        private static SelectionTreeNode BuildTreeNode(Transform transform, int depth, int maxDepth, ref int truncatedCount)
        {
            var node = new SelectionTreeNode
            {
                name = transform.name,
                path = BuildGameObjectPath(transform),
                depth = depth,
                components = GetComponentNames(transform)
            };

            if (depth >= maxDepth)
            {
                node.children = new SelectionTreeNode[0];
                node.children_truncated_count = transform.childCount;
                truncatedCount += transform.childCount;
                return node;
            }

            var children = new List<SelectionTreeNode>();
            for (var i = 0; i < transform.childCount; i++)
            {
                var child = transform.GetChild(i);
                children.Add(BuildTreeNode(child, depth + 1, maxDepth, ref truncatedCount));
            }

            node.children = children.ToArray();
            node.children_truncated_count = 0;
            return node;
        }

        private static string[] GetComponentNames(Transform transform)
        {
            var components = transform.GetComponents<Component>();
            var names = new List<string>(components.Length);
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                names.Add(component == null ? "MissingScript" : component.GetType().Name);
            }

            return names.ToArray();
        }

        private static string BuildGameObjectPath(Transform transform)
        {
            var current = transform;
            var path = current.name;
            while (current.parent != null)
            {
                current = current.parent;
                path = current.name + "/" + path;
            }

            return "Scene/" + path;
        }
    }
}


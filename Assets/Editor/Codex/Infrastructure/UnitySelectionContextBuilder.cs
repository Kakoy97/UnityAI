using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Ports;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class UnitySelectionContextBuilder : ISelectionContextBuilder
    {
        private const string MissingScriptShortName = "MissingScript";
        private const string MissingScriptAssemblyQualifiedName = "UnityEditor.MissingScript";

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
                scene_revision = UnitySceneRevisionTracker.CurrentRevision,
                selection = new SelectionInfo
                {
                    mode = "selection",
                    object_id = BuildObjectId(selected),
                    target_object_path = BuildGameObjectPath(selected.transform),
                    active = selected.activeInHierarchy,
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
                object_id = BuildObjectId(transform.gameObject),
                path = BuildGameObjectPath(transform),
                depth = depth,
                active = transform.gameObject != null && transform.gameObject.activeInHierarchy,
                prefab_path = GetPrefabAssetPath(transform.gameObject),
                components = GetComponentDescriptors(transform)
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

        private static string GetPrefabAssetPath(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            var path = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(gameObject);
            return string.IsNullOrEmpty(path) ? string.Empty : path;
        }

        private static UnityComponentDescriptor[] GetComponentDescriptors(Transform transform)
        {
            var components = transform.GetComponents<Component>();
            var descriptors = new List<UnityComponentDescriptor>(components.Length);
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    descriptors.Add(
                        new UnityComponentDescriptor
                        {
                            short_name = MissingScriptShortName,
                            assembly_qualified_name = MissingScriptAssemblyQualifiedName
                        });
                    continue;
                }

                var type = component.GetType();
                if (type == null)
                {
                    continue;
                }

                descriptors.Add(
                    new UnityComponentDescriptor
                    {
                        short_name = string.IsNullOrEmpty(type.Name) ? "-" : type.Name,
                        assembly_qualified_name = BuildAssemblyQualifiedName(type)
                    });
            }

            return descriptors.ToArray();
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

        private static string BuildObjectId(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            try
            {
                var globalId = GlobalObjectId.GetGlobalObjectIdSlow(gameObject);
                var text = globalId.ToString();
                return string.IsNullOrEmpty(text) ? string.Empty : text;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string BuildAssemblyQualifiedName(Type type)
        {
            if (type == null)
            {
                return string.Empty;
            }

            if (!string.IsNullOrEmpty(type.AssemblyQualifiedName))
            {
                return type.AssemblyQualifiedName;
            }

            if (!string.IsNullOrEmpty(type.FullName))
            {
                return type.FullName;
            }

            return type.Name ?? string.Empty;
        }
    }
}

using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        private static bool CollectSceneRoots(string scenePath, bool includeInactive, List<UnitySceneRootInfo> roots)
        {
            if (roots == null)
            {
                return false;
            }

            if (!string.IsNullOrEmpty(scenePath))
            {
                var scene = SceneManager.GetSceneByPath(scenePath);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    return false;
                }
                AppendSceneRoots(scene, includeInactive, roots);
                return true;
            }

            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }
                AppendSceneRoots(scene, includeInactive, roots);
            }
            return true;
        }

        private static void AppendSceneRoots(Scene scene, bool includeInactive, List<UnitySceneRootInfo> roots)
        {
            var rootObjects = scene.GetRootGameObjects();
            for (var i = 0; i < rootObjects.Length; i++)
            {
                var root = rootObjects[i];
                if (root == null)
                {
                    continue;
                }
                if (!includeInactive && !root.activeInHierarchy)
                {
                    continue;
                }
                roots.Add(
                    new UnitySceneRootInfo
                    {
                        object_id = BuildObjectId(root),
                        path = BuildObjectPath(root.transform, "Scene"),
                        name = root.name,
                        active = root.activeInHierarchy,
                        child_count = root.transform.childCount
                    });
            }
        }

        private static bool FindComponentMatches(
            string scenePath,
            string underPath,
            bool includeInactive,
            string query,
            int limit,
            out List<UnityComponentMatchItem> matches)
        {
            matches = new List<UnityComponentMatchItem>(Math.Min(limit, 128));
            if (!string.IsNullOrEmpty(scenePath))
            {
                var scene = SceneManager.GetSceneByPath(scenePath);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    return false;
                }
                SearchScene(scene, underPath, includeInactive, query, limit, matches);
                return true;
            }

            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }
                SearchScene(scene, underPath, includeInactive, query, limit, matches);
                if (matches.Count >= limit)
                {
                    break;
                }
            }
            return true;
        }

        private static void SearchScene(
            Scene scene,
            string underPath,
            bool includeInactive,
            string query,
            int limit,
            List<UnityComponentMatchItem> matches)
        {
            var roots = scene.GetRootGameObjects();
            for (var i = 0; i < roots.Length; i++)
            {
                var root = roots[i];
                if (root == null)
                {
                    continue;
                }
                WalkForComponentMatches(root.transform, scene.path, underPath, includeInactive, query, limit, matches);
                if (matches.Count >= limit)
                {
                    break;
                }
            }
        }

        private static void WalkForComponentMatches(
            Transform transform,
            string scenePath,
            string underPath,
            bool includeInactive,
            string query,
            int limit,
            List<UnityComponentMatchItem> matches)
        {
            if (transform == null || matches == null || matches.Count >= limit)
            {
                return;
            }

            var path = BuildObjectPath(transform, "Scene");
            var inScope = string.IsNullOrEmpty(underPath) ||
                          string.Equals(path, underPath, StringComparison.Ordinal) ||
                          path.StartsWith(underPath + "/", StringComparison.Ordinal);
            var maybeContainsScope = string.IsNullOrEmpty(underPath) ||
                                     inScope ||
                                     underPath.StartsWith(path + "/", StringComparison.Ordinal);
            if (!maybeContainsScope)
            {
                return;
            }

            var gameObject = transform.gameObject;
            if (gameObject != null && (includeInactive || gameObject.activeInHierarchy) && inScope)
            {
                var matchedComponents = BuildMatchedComponents(gameObject, query);
                if (matchedComponents.Length > 0)
                {
                    matches.Add(
                        new UnityComponentMatchItem
                        {
                            object_id = BuildObjectId(gameObject),
                            path = path,
                            name = gameObject.name,
                            scene_path = scenePath,
                            active = gameObject.activeInHierarchy,
                            matched_components = matchedComponents
                        });
                }
            }

            for (var i = 0; i < transform.childCount; i++)
            {
                if (matches.Count >= limit)
                {
                    return;
                }
                WalkForComponentMatches(
                    transform.GetChild(i),
                    scenePath,
                    underPath,
                    includeInactive,
                    query,
                    limit,
                    matches);
            }
        }

        private static UnityComponentDescriptor[] BuildMatchedComponents(GameObject gameObject, string query)
        {
            if (gameObject == null || string.IsNullOrWhiteSpace(query))
            {
                return new UnityComponentDescriptor[0];
            }

            var normalizedQuery = query.Trim();
            var components = gameObject.GetComponents<Component>();
            var result = new List<UnityComponentDescriptor>(4);
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    if (ContainsIgnoreCase(MissingScriptShortName, normalizedQuery) ||
                        ContainsIgnoreCase(MissingScriptAssemblyQualifiedName, normalizedQuery))
                    {
                        result.Add(
                            new UnityComponentDescriptor
                            {
                                short_name = MissingScriptShortName,
                                assembly_qualified_name = MissingScriptAssemblyQualifiedName
                            });
                    }
                    continue;
                }

                var type = component.GetType();
                if (type == null)
                {
                    continue;
                }
                var shortName = string.IsNullOrEmpty(type.Name) ? string.Empty : type.Name;
                var fullName = string.IsNullOrEmpty(type.FullName) ? string.Empty : type.FullName;
                var assemblyName = BuildAssemblyQualifiedName(type);
                if (!ContainsIgnoreCase(shortName, normalizedQuery) &&
                    !ContainsIgnoreCase(fullName, normalizedQuery) &&
                    !ContainsIgnoreCase(assemblyName, normalizedQuery))
                {
                    continue;
                }

                result.Add(
                    new UnityComponentDescriptor
                    {
                        short_name = shortName,
                        assembly_qualified_name = assemblyName
                    });
            }

            return result.ToArray();
        }

        private static UnityPrefabTreeNode BuildPrefabTreeNode(
            Transform transform,
            string prefabPath,
            int depth,
            int maxDepth,
            int nodeBudget,
            bool includeComponents,
            bool includeMissingScripts)
        {
            if (transform == null || nodeBudget <= 0)
            {
                return null;
            }

            var root = new UnityPrefabTreeNode
            {
                name = transform.name,
                object_id = BuildObjectId(transform.gameObject),
                path = BuildObjectPath(transform, "Prefab"),
                depth = depth,
                active = transform.gameObject != null && transform.gameObject.activeSelf,
                prefab_path = prefabPath,
                components = includeComponents
                    ? BuildAllComponents(transform, includeMissingScripts)
                    : new UnityComponentDescriptor[0],
                children = new UnityPrefabTreeNode[0],
                children_truncated_count = 0
            };

            if (depth >= maxDepth)
            {
                root.children_truncated_count = transform.childCount;
                return root;
            }

            var children = new List<UnityPrefabTreeNode>();
            var remaining = nodeBudget - 1;
            for (var i = 0; i < transform.childCount; i++)
            {
                if (remaining <= 0)
                {
                    root.children_truncated_count += transform.childCount - i;
                    break;
                }

                var child = BuildPrefabTreeNode(
                    transform.GetChild(i),
                    prefabPath,
                    depth + 1,
                    maxDepth,
                    remaining,
                    includeComponents,
                    includeMissingScripts);
                if (child == null)
                {
                    root.children_truncated_count += transform.childCount - i;
                    break;
                }

                children.Add(child);
                remaining -= CountNodes(child);
            }

            root.children = children.ToArray();
            return root;
        }

        private static UnityComponentDescriptor[] BuildAllComponents(Transform transform, bool includeMissingScripts)
        {
            if (transform == null)
            {
                return new UnityComponentDescriptor[0];
            }

            var components = transform.GetComponents<Component>();
            var result = new List<UnityComponentDescriptor>(components.Length);
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    if (!includeMissingScripts)
                    {
                        continue;
                    }
                    result.Add(
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
                result.Add(
                    new UnityComponentDescriptor
                    {
                        short_name = string.IsNullOrEmpty(type.Name) ? "-" : type.Name,
                        assembly_qualified_name = BuildAssemblyQualifiedName(type)
                    });
            }
            return result.ToArray();
        }

        private static int CountNodes(UnityPrefabTreeNode node)
        {
            if (node == null)
            {
                return 0;
            }

            var count = 1;
            if (node.children == null)
            {
                return count;
            }
            for (var i = 0; i < node.children.Length; i++)
            {
                count += CountNodes(node.children[i]);
            }
            return count;
        }
    }
}

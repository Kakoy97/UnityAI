using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class FindObjectsByComponentSsotExecutor
    {
        public SsotDispatchResponse Execute(FindObjectsByComponentRequestDto request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.component_query))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "component_query is required.",
                    FindObjectsByComponentRequestDto.ToolName);
            }

            var componentQuery = SsotExecutorCommon.Normalize(request.component_query);
            var scenePath = SsotExecutorCommon.Normalize(request.scene_path);
            var underPath = NormalizeUnderPath(request.under_path);
            var includeInactive = request.include_inactive;
            var limit = request.limit > 0 ? request.limit : 5000;
            if (limit > 5000)
            {
                limit = 5000;
            }

            var matches = CollectMatches(
                componentQuery,
                scenePath,
                underPath,
                includeInactive,
                limit,
                out var matchedSceneCount);
            if (!string.IsNullOrEmpty(scenePath) && matchedSceneCount <= 0)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SCENE_NOT_FOUND",
                    "scene_path does not match any loaded scene: " + scenePath,
                    FindObjectsByComponentRequestDto.ToolName);
            }

            return SsotRequestDispatcher.Success(
                FindObjectsByComponentRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    component_query = componentQuery,
                    scene_path = scenePath,
                    under_path = underPath,
                    include_inactive = includeInactive,
                    total_count = matches.Length,
                    found_objects = matches,
                });
        }

        private static SsotSceneNodeSummary[] CollectMatches(
            string componentQuery,
            string scenePath,
            string underPath,
            bool includeInactive,
            int limit,
            out int matchedSceneCount)
        {
            matchedSceneCount = 0;
            var output = new List<SsotSceneNodeSummary>();
            var query = componentQuery.ToLowerInvariant();

            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex += 1)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                if (!ShouldIncludeScene(scenePath, scene))
                {
                    continue;
                }

                matchedSceneCount += 1;
                var roots = scene.GetRootGameObjects();
                for (var i = 0; i < roots.Length; i += 1)
                {
                    if (roots[i] == null)
                    {
                        continue;
                    }

                    TraverseAndCollect(
                        roots[i].transform,
                        query,
                        underPath,
                        includeInactive,
                        output,
                        limit);
                    if (output.Count >= limit)
                    {
                        return output.ToArray();
                    }
                }
            }

            return output.ToArray();
        }

        private static void TraverseAndCollect(
            Transform root,
            string query,
            string underPath,
            bool includeInactive,
            List<SsotSceneNodeSummary> output,
            int limit)
        {
            if (root == null || output == null || output.Count >= limit)
            {
                return;
            }

            var stack = new Stack<Transform>();
            stack.Push(root);
            while (stack.Count > 0 && output.Count < limit)
            {
                var current = stack.Pop();
                if (current == null || current.gameObject == null)
                {
                    continue;
                }

                var gameObject = current.gameObject;
                if (!includeInactive && !gameObject.activeInHierarchy)
                {
                    continue;
                }

                var scenePath = SsotExecutorCommon.BuildScenePath(gameObject);
                if (!string.IsNullOrEmpty(underPath) &&
                    !scenePath.StartsWith(underPath, StringComparison.Ordinal))
                {
                    // Keep traversing children only if current node can still contain the prefix.
                    if (!underPath.StartsWith(scenePath + "/", StringComparison.Ordinal))
                    {
                        continue;
                    }
                }

                if (HasMatchingComponent(gameObject, query))
                {
                    output.Add(new SsotSceneNodeSummary
                    {
                        object_id = SsotExecutorCommon.BuildObjectId(gameObject),
                        path = scenePath,
                        active_self = gameObject.activeSelf,
                        child_count = current.childCount
                    });
                }

                for (var childIndex = current.childCount - 1; childIndex >= 0; childIndex -= 1)
                {
                    var child = current.GetChild(childIndex);
                    if (child != null)
                    {
                        stack.Push(child);
                    }
                }
            }
        }

        private static bool HasMatchingComponent(GameObject gameObject, string query)
        {
            var components = gameObject.GetComponents<Component>();
            for (var i = 0; i < components.Length; i += 1)
            {
                var component = components[i];
                if (component == null)
                {
                    continue;
                }

                var type = component.GetType();
                var shortName = type.Name ?? string.Empty;
                var fullName = type.FullName ?? string.Empty;
                var aqn = type.AssemblyQualifiedName ?? string.Empty;
                if (shortName.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    fullName.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0 ||
                    aqn.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool ShouldIncludeScene(string scenePath, Scene scene)
        {
            if (string.IsNullOrEmpty(scenePath))
            {
                return true;
            }

            var currentScenePath = SsotExecutorCommon.Normalize(scene.path);
            if (string.Equals(scenePath, currentScenePath, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            var sceneNameToken = scene.name + ".unity";
            return scenePath.EndsWith(sceneNameToken, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizeUnderPath(string underPath)
        {
            var normalized = SsotExecutorCommon.Normalize(underPath).Replace('\\', '/');
            if (string.IsNullOrEmpty(normalized))
            {
                return string.Empty;
            }

            if (!normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = "Scene/" + normalized.TrimStart('/');
            }

            return normalized.TrimEnd('/');
        }
    }
}

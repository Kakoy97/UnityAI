using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class GetSceneSnapshotForWriteSsotExecutor
    {
        public SsotDispatchResponse Execute(GetSceneSnapshotForWriteRequestDto request)
        {
            var normalizedScopePath = NormalizeScopePath(request == null ? string.Empty : request.scope_path);
            var roots = BuildRoots(normalizedScopePath, out var errorCode, out var errorMessage);
            if (!string.IsNullOrEmpty(errorCode))
            {
                return SsotRequestDispatcher.Failure(
                    errorCode,
                    errorMessage,
                    GetSceneSnapshotForWriteRequestDto.ToolName);
            }

            return SsotRequestDispatcher.Success(
                GetSceneSnapshotForWriteRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    scope_path = normalizedScopePath,
                    read_token_candidate = SsotExecutorCommon.BuildReadTokenCandidate(),
                    scene_roots = roots
                });
        }

        private static SsotSceneNodeSummary[] BuildRoots(
            string scopePath,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (!string.IsNullOrEmpty(scopePath))
            {
                var scopedTarget = FindGameObjectByScenePath(scopePath);
                if (scopedTarget == null)
                {
                    errorCode = "E_SCOPE_NOT_FOUND";
                    errorMessage = "scope_path does not resolve to a scene object: " + scopePath;
                    return Array.Empty<SsotSceneNodeSummary>();
                }

                return new[]
                {
                    BuildNodeSummary(scopedTarget)
                };
            }

            var output = new List<SsotSceneNodeSummary>();
            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex += 1)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var i = 0; i < roots.Length; i += 1)
                {
                    var root = roots[i];
                    if (root == null)
                    {
                        continue;
                    }

                    output.Add(BuildNodeSummary(root));
                }
            }

            return output.ToArray();
        }

        private static SsotSceneNodeSummary BuildNodeSummary(GameObject gameObject)
        {
            return new SsotSceneNodeSummary
            {
                object_id = BuildObjectId(gameObject),
                path = BuildScenePath(gameObject),
                active_self = gameObject != null && gameObject.activeSelf,
                child_count = gameObject == null || gameObject.transform == null
                    ? 0
                    : gameObject.transform.childCount
            };
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static string NormalizeScopePath(string scopePath)
        {
            var normalized = Normalize(scopePath).Replace('\\', '/');
            if (string.IsNullOrEmpty(normalized))
            {
                return string.Empty;
            }

            if (!normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = "Scene/" + normalized;
            }

            return normalized;
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
                return globalId.ToString();
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string BuildScenePath(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            var transform = target.transform;
            var path = transform.name;
            while (transform.parent != null)
            {
                transform = transform.parent;
                path = transform.name + "/" + path;
            }

            return "Scene/" + path;
        }

        private static GameObject FindGameObjectByScenePath(string scenePath)
        {
            var normalized = Normalize(scenePath).Replace('\\', '/');
            if (normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = normalized.Substring("Scene/".Length);
            }

            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            var segments = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (segments == null || segments.Length == 0)
            {
                return null;
            }

            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex += 1)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var i = 0; i < roots.Length; i += 1)
                {
                    var root = roots[i];
                    if (root == null || !string.Equals(root.name, segments[0], StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var found = FindChildByPathSegments(root.transform, segments, 1);
                    if (found != null)
                    {
                        return found.gameObject;
                    }
                }
            }

            return null;
        }

        private static Transform FindChildByPathSegments(Transform current, string[] segments, int index)
        {
            if (current == null || segments == null)
            {
                return null;
            }

            if (index >= segments.Length)
            {
                return current;
            }

            for (var i = 0; i < current.childCount; i += 1)
            {
                var child = current.GetChild(i);
                if (child == null || !string.Equals(child.name, segments[index], StringComparison.Ordinal))
                {
                    continue;
                }

                var found = FindChildByPathSegments(child, segments, index + 1);
                if (found != null)
                {
                    return found;
                }
            }

            return null;
        }
    }
}

using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class GetSceneRootsSsotExecutor
    {
        public SsotDispatchResponse Execute(GetSceneRootsRequestDto request)
        {
            var scenePath = SsotExecutorCommon.Normalize(request == null ? string.Empty : request.scene_path);
            var includeInactive = request != null && request.include_inactive;

            var roots = BuildSceneRoots(scenePath, includeInactive, out var matchedSceneCount);
            if (!string.IsNullOrEmpty(scenePath) && matchedSceneCount <= 0)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SCENE_NOT_FOUND",
                    "scene_path does not match any loaded scene: " + scenePath,
                    GetSceneRootsRequestDto.ToolName);
            }

            return SsotRequestDispatcher.Success(
                GetSceneRootsRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    scene_path = scenePath,
                    include_inactive = includeInactive,
                    total_count = roots.Length,
                    scene_roots = roots,
                    read_token_candidate = SsotExecutorCommon.BuildReadTokenCandidate()
                });
        }

        private static SsotSceneNodeSummary[] BuildSceneRoots(
            string scenePath,
            bool includeInactive,
            out int matchedSceneCount)
        {
            matchedSceneCount = 0;
            var output = new List<SsotSceneNodeSummary>();
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
                    var root = roots[i];
                    if (root == null)
                    {
                        continue;
                    }

                    if (!includeInactive && !root.activeSelf)
                    {
                        continue;
                    }

                    output.Add(BuildNodeSummary(root));
                }
            }

            return output.ToArray();
        }

        private static bool ShouldIncludeScene(string scenePath, Scene scene)
        {
            var normalizedScenePath = SsotExecutorCommon.Normalize(scenePath);
            if (string.IsNullOrEmpty(normalizedScenePath))
            {
                return true;
            }

            var currentScenePath = SsotExecutorCommon.Normalize(scene.path);
            if (string.Equals(normalizedScenePath, currentScenePath, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            var sceneNameToken = scene.name + ".unity";
            return normalizedScenePath.EndsWith(sceneNameToken, StringComparison.OrdinalIgnoreCase);
        }

        private static SsotSceneNodeSummary BuildNodeSummary(GameObject gameObject)
        {
            return new SsotSceneNodeSummary
            {
                object_id = SsotExecutorCommon.BuildObjectId(gameObject),
                path = SsotExecutorCommon.BuildScenePath(gameObject),
                active_self = gameObject != null && gameObject.activeSelf,
                child_count = gameObject == null || gameObject.transform == null
                    ? 0
                    : gameObject.transform.childCount
            };
        }
    }
}

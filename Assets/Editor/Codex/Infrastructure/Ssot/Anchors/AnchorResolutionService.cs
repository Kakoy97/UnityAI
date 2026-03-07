using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Anchors
{
    internal sealed class AnchorResolutionResult
    {
        internal bool IsSuccess;
        internal string ErrorCode;
        internal string ErrorMessage;
        internal string AmbiguityKind;
        internal int ResolvedCandidatesCount;
        internal string PathCandidatePath;
        internal string PathCandidateObjectId;
        internal string ObjectIdCandidatePath;
        internal string ObjectIdCandidateObjectId;
        internal GameObject Target;
        internal GameObject TargetByPath;
        internal GameObject TargetByObjectId;
    }

    internal sealed class AnchorResolutionService
    {
        internal AnchorResolutionResult ResolveTargetFromAnchor(string targetPath, string targetObjectId)
        {
            var result = new AnchorResolutionResult
            {
                IsSuccess = false,
                ErrorCode = string.Empty,
                ErrorMessage = string.Empty,
                AmbiguityKind = string.Empty,
                ResolvedCandidatesCount = 0,
                PathCandidatePath = string.Empty,
                PathCandidateObjectId = string.Empty,
                ObjectIdCandidatePath = string.Empty,
                ObjectIdCandidateObjectId = string.Empty,
                Target = null,
                TargetByPath = null,
                TargetByObjectId = null
            };

            var normalizedPath = Normalize(targetPath);
            var normalizedObjectId = Normalize(targetObjectId);
            if (string.IsNullOrEmpty(normalizedPath) || string.IsNullOrEmpty(normalizedObjectId))
            {
                result.ErrorCode = "E_SSOT_SCHEMA_INVALID";
                result.ErrorMessage = "target_path and target_object_id are required.";
                return result;
            }

            var targetByPath = FindGameObjectByScenePath(normalizedPath);
            var targetByObjectId = FindGameObjectByObjectId(normalizedObjectId);
            result.TargetByPath = targetByPath;
            result.TargetByObjectId = targetByObjectId;
            result.ResolvedCandidatesCount = ComputeCandidateCount(targetByPath, targetByObjectId);
            result.PathCandidatePath = targetByPath == null ? string.Empty : BuildScenePath(targetByPath);
            result.PathCandidateObjectId = targetByPath == null ? string.Empty : BuildObjectId(targetByPath);
            result.ObjectIdCandidatePath = targetByObjectId == null ? string.Empty : BuildScenePath(targetByObjectId);
            result.ObjectIdCandidateObjectId = targetByObjectId == null ? string.Empty : BuildObjectId(targetByObjectId);

            if (targetByPath == null && targetByObjectId == null)
            {
                result.ErrorCode = "E_TARGET_NOT_FOUND";
                result.ErrorMessage = "Target object not found.";
                return result;
            }

            var pathCandidateObjectId = targetByPath == null ? string.Empty : BuildObjectId(targetByPath);
            var objectIdCandidateObjectId = targetByObjectId == null ? string.Empty : BuildObjectId(targetByObjectId);
            var objectIdCandidatePath = targetByObjectId == null ? string.Empty : BuildScenePath(targetByObjectId);

            var hasStrictMismatch = false;
            if (targetByPath != null && targetByObjectId != null)
            {
                hasStrictMismatch = !string.Equals(
                    pathCandidateObjectId,
                    objectIdCandidateObjectId,
                    StringComparison.Ordinal);
            }
            else if (targetByPath != null)
            {
                hasStrictMismatch = !string.Equals(
                    pathCandidateObjectId,
                    normalizedObjectId,
                    StringComparison.Ordinal);
            }
            else
            {
                hasStrictMismatch = !ScenePathEquals(objectIdCandidatePath, normalizedPath);
            }

            if (hasStrictMismatch)
            {
                result.ErrorCode = "E_TARGET_ANCHOR_CONFLICT";
                result.ErrorMessage = "target_path and target_object_id resolve to different objects.";
                result.AmbiguityKind = "path_object_id_mismatch";
                return result;
            }

            result.Target = targetByPath ?? targetByObjectId;
            result.IsSuccess = result.Target != null;
            if (!result.IsSuccess)
            {
                result.ErrorCode = "E_TARGET_NOT_FOUND";
                result.ErrorMessage = "Target object resolution returned null.";
            }

            return result;
        }

        internal GameObject FindGameObjectByObjectId(string objectId)
        {
            var normalized = Normalize(objectId);
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            GlobalObjectId parsed;
            if (GlobalObjectId.TryParse(normalized, out parsed))
            {
                var resolved = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
                var resolvedAsGameObject = resolved as GameObject;
                if (resolvedAsGameObject != null)
                {
                    return resolvedAsGameObject;
                }

                var resolvedAsComponent = resolved as Component;
                if (resolvedAsComponent != null && resolvedAsComponent.gameObject != null)
                {
                    return resolvedAsComponent.gameObject;
                }
            }

            var requestedLocalId = 0L;
            var hasRequestedLocalId = TryExtractLocalIdentifierFromGlobalObjectId(
                normalized,
                out requestedLocalId);

            var fromSceneGraph = FindGameObjectInLoadedScenes(
                normalized,
                hasRequestedLocalId,
                requestedLocalId);
            if (fromSceneGraph != null)
            {
                return fromSceneGraph;
            }

            try
            {
                var allGameObjects = Resources.FindObjectsOfTypeAll<GameObject>();
                for (var i = 0; i < allGameObjects.Length; i += 1)
                {
                    var candidate = allGameObjects[i];
                    if (candidate == null)
                    {
                        continue;
                    }

                    var candidateId = BuildObjectId(candidate);
                    if (string.Equals(candidateId, normalized, StringComparison.Ordinal))
                    {
                        return candidate;
                    }

                    if (!hasRequestedLocalId)
                    {
                        continue;
                    }

                    long candidateLocalId;
                    if (TryExtractLocalIdentifierFromGlobalObjectId(candidateId, out candidateLocalId) &&
                        candidateLocalId == requestedLocalId)
                    {
                        return candidate;
                    }

                    if (candidate.GetInstanceID() == (int)requestedLocalId)
                    {
                        return candidate;
                    }
                }
            }
            catch
            {
            }

            return null;
        }

        private static GameObject FindGameObjectInLoadedScenes(
            string normalizedObjectId,
            bool hasRequestedLocalId,
            long requestedLocalId)
        {
            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex += 1)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                if (roots == null || roots.Length == 0)
                {
                    continue;
                }

                for (var i = 0; i < roots.Length; i += 1)
                {
                    var found = FindInTransformTree(
                        roots[i] == null ? null : roots[i].transform,
                        normalizedObjectId,
                        hasRequestedLocalId,
                        requestedLocalId);
                    if (found != null)
                    {
                        return found;
                    }
                }
            }

            return null;
        }

        private static GameObject FindInTransformTree(
            Transform root,
            string normalizedObjectId,
            bool hasRequestedLocalId,
            long requestedLocalId)
        {
            if (root == null)
            {
                return null;
            }

            var stack = new Stack<Transform>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                var current = stack.Pop();
                if (current == null)
                {
                    continue;
                }

                var candidate = current.gameObject;
                if (candidate != null)
                {
                    var candidateId = BuildObjectId(candidate);
                    if (string.Equals(candidateId, normalizedObjectId, StringComparison.Ordinal))
                    {
                        return candidate;
                    }

                    if (hasRequestedLocalId)
                    {
                        long candidateLocalId;
                        if (TryExtractLocalIdentifierFromGlobalObjectId(candidateId, out candidateLocalId) &&
                            candidateLocalId == requestedLocalId)
                        {
                            return candidate;
                        }

                        if (candidate.GetInstanceID() == (int)requestedLocalId)
                        {
                            return candidate;
                        }
                    }
                }

                for (var i = current.childCount - 1; i >= 0; i -= 1)
                {
                    var child = current.GetChild(i);
                    if (child != null)
                    {
                        stack.Push(child);
                    }
                }
            }

            return null;
        }

        internal GameObject FindGameObjectByScenePath(string scenePath)
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

            // Fallback for edit-mode query contexts where SceneManager traversal can miss
            // objects that are otherwise discoverable by hierarchy path.
            try
            {
                var foundByFind = GameObject.Find(normalized);
                if (foundByFind != null)
                {
                    return foundByFind;
                }
            }
            catch
            {
            }

            var expectedPath = normalized.StartsWith("Scene/", StringComparison.Ordinal)
                ? normalized
                : "Scene/" + normalized;
            try
            {
                var allGameObjects = Resources.FindObjectsOfTypeAll<GameObject>();
                for (var i = 0; i < allGameObjects.Length; i += 1)
                {
                    var candidate = allGameObjects[i];
                    if (candidate == null)
                    {
                        continue;
                    }

                    if (string.Equals(
                            BuildScenePath(candidate),
                            expectedPath,
                            StringComparison.Ordinal))
                    {
                        return candidate;
                    }
                }
            }
            catch
            {
            }

            return null;
        }

        private static string BuildObjectId(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            try
            {
                return GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();
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

            var path = BuildTransformPath(target.transform, string.Empty);
            if (string.IsNullOrEmpty(path))
            {
                return "Scene/" + target.name;
            }

            return "Scene/" + path;
        }

        private static bool ScenePathEquals(string left, string right)
        {
            return string.Equals(
                NormalizeScenePath(left),
                NormalizeScenePath(right),
                StringComparison.Ordinal);
        }

        private static string NormalizeScenePath(string value)
        {
            var normalized = Normalize(value).Replace('\\', '/');
            if (normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = normalized.Substring("Scene/".Length);
            }

            return normalized.Trim('/');
        }

        private static string BuildTransformPath(Transform current, string suffix)
        {
            if (current == null)
            {
                return suffix;
            }

            var next = string.IsNullOrEmpty(suffix)
                ? current.name
                : current.name + "/" + suffix;
            return current.parent == null ? next : BuildTransformPath(current.parent, next);
        }

        private static int ComputeCandidateCount(GameObject byPath, GameObject byObjectId)
        {
            if (byPath == null && byObjectId == null)
            {
                return 0;
            }

            if (byPath != null && byObjectId != null)
            {
                return ReferenceEquals(byPath, byObjectId) ? 1 : 2;
            }

            return 1;
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static bool TryExtractLocalIdentifierFromGlobalObjectId(
            string globalObjectId,
            out long localIdentifier)
        {
            localIdentifier = 0L;
            var normalized = Normalize(globalObjectId);
            if (string.IsNullOrEmpty(normalized))
            {
                return false;
            }

            // GlobalObjectId string shape:
            // GlobalObjectId_V1-<identifierType>-<assetGuid>-<localIdentifierInFile>-<prefabInstanceId>
            var first = normalized.IndexOf('-', StringComparison.Ordinal);
            if (first < 0 || first >= normalized.Length - 1)
            {
                return false;
            }

            var second = normalized.IndexOf('-', first + 1);
            if (second < 0 || second >= normalized.Length - 1)
            {
                return false;
            }

            var third = normalized.IndexOf('-', second + 1);
            if (third < 0 || third >= normalized.Length - 1)
            {
                return false;
            }

            var fourth = normalized.IndexOf('-', third + 1);
            if (fourth < 0 || fourth <= third + 1)
            {
                return false;
            }

            var localTokenLength = fourth - third - 1;
            if (localTokenLength <= 0)
            {
                return false;
            }

            var localToken = normalized.Substring(third + 1, localTokenLength);
            return long.TryParse(
                localToken,
                out localIdentifier);
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

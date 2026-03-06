using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    internal static class SsotExecutorCommon
    {
        internal static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        internal static string BuildSceneRevision()
        {
            return "ssot_rev_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        }

        internal static string BuildReadTokenCandidate()
        {
            // Token issuance moved to Sidecar Token Authority (L2). L3 no longer emits write-ready token.
            return string.Empty;
        }

        internal static string BuildObjectId(GameObject gameObject)
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

        internal static string BuildScenePath(GameObject target)
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

        internal static SsotComponentSummary[] BuildComponentSummaries(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return Array.Empty<SsotComponentSummary>();
            }

            var components = gameObject.GetComponents<Component>();
            if (components == null || components.Length == 0)
            {
                return Array.Empty<SsotComponentSummary>();
            }

            var results = new List<SsotComponentSummary>(components.Length);
            for (var i = 0; i < components.Length; i += 1)
            {
                var component = components[i];
                if (component == null)
                {
                    continue;
                }

                var componentType = component.GetType();
                results.Add(new SsotComponentSummary
                {
                    short_name = componentType.Name,
                    assembly_qualified_name = componentType.AssemblyQualifiedName
                });
            }

            return results.ToArray();
        }

        internal static bool TryResolveTargetFromAnchor(
            string targetPath,
            string targetObjectId,
            out GameObject target,
            out string errorCode,
            out string errorMessage)
        {
            target = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var normalizedPath = Normalize(targetPath);
            var normalizedObjectId = Normalize(targetObjectId);
            if (string.IsNullOrEmpty(normalizedPath) || string.IsNullOrEmpty(normalizedObjectId))
            {
                errorCode = "E_SSOT_SCHEMA_INVALID";
                errorMessage = "target_path and target_object_id are required.";
                return false;
            }

            var targetByPath = FindGameObjectByScenePath(normalizedPath);
            var targetByObjectId = FindGameObjectByObjectId(normalizedObjectId);
            if (targetByPath == null && targetByObjectId == null)
            {
                errorCode = "E_TARGET_NOT_FOUND";
                errorMessage = "Target object not found.";
                return false;
            }

            if (targetByPath != null &&
                targetByObjectId != null &&
                !ReferenceEquals(targetByPath, targetByObjectId))
            {
                errorCode = "E_TARGET_ANCHOR_CONFLICT";
                errorMessage = "target_path and target_object_id resolve to different objects.";
                return false;
            }

            target = targetByPath ?? targetByObjectId;
            return target != null;
        }

        internal static GameObject FindGameObjectByObjectId(string objectId)
        {
            var normalized = Normalize(objectId);
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            GlobalObjectId parsed;
            if (!GlobalObjectId.TryParse(normalized, out parsed))
            {
                return null;
            }

            return GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed) as GameObject;
        }

        internal static GameObject FindGameObjectByScenePath(string scenePath)
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

        internal static Transform FindChildByPathSegments(Transform current, string[] segments, int index)
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

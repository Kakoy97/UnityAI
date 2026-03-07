using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEngine;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Anchors;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    internal static class SsotExecutorCommon
    {
        private static readonly AnchorResolutionService AnchorResolutionService =
            new AnchorResolutionService();

        internal static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        internal static string BuildSceneRevision()
        {
            return "ssot_rev_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
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
            var resolution = AnchorResolutionService.ResolveTargetFromAnchor(targetPath, targetObjectId);
            if (resolution == null || !resolution.IsSuccess || resolution.Target == null)
            {
                errorCode = Normalize(resolution == null ? string.Empty : resolution.ErrorCode);
                errorMessage = Normalize(resolution == null ? string.Empty : resolution.ErrorMessage);
                if (string.IsNullOrEmpty(errorCode))
                {
                    errorCode = "E_TARGET_NOT_FOUND";
                }

                if (string.IsNullOrEmpty(errorMessage))
                {
                    errorMessage = "Target object not found.";
                }

                return false;
            }

            target = resolution.Target;
            return true;
        }
    }
}

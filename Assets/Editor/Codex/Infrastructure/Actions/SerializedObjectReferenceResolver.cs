using System;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    internal sealed class SerializedObjectReferenceResolver
    {
        public bool TryResolve(
            SerializedPropertyObjectReferenceDto payload,
            Type expectedType,
            out UnityEngine.Object resolved,
            out string errorCode,
            out string errorMessage)
        {
            resolved = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (payload == null)
            {
                errorCode = "E_OBJECT_REF_NOT_FOUND";
                errorMessage = "object_ref payload is required.";
                return false;
            }

            var hasSceneAnchorPayload =
                payload.scene_anchor != null &&
                (!string.IsNullOrWhiteSpace(payload.scene_anchor.object_id) ||
                 !string.IsNullOrWhiteSpace(payload.scene_anchor.path));
            if (hasSceneAnchorPayload)
            {
                GameObject sceneObject;
                if (!TryResolveSceneAnchor(payload.scene_anchor, out sceneObject, out errorCode, out errorMessage))
                {
                    return false;
                }

                var fromScene = ConvertSceneObject(sceneObject, expectedType, out errorCode, out errorMessage);
                if (fromScene == null)
                {
                    return false;
                }

                resolved = fromScene;
                return true;
            }

            var assetCandidate = ResolveAssetCandidate(payload, out errorCode, out errorMessage);
            if (assetCandidate == null)
            {
                return false;
            }

            var normalizedAsset = ConvertToExpectedType(assetCandidate, expectedType, out errorCode, out errorMessage);
            if (normalizedAsset == null)
            {
                return false;
            }

            resolved = normalizedAsset;
            return true;
        }

        private static UnityEngine.Object ResolveAssetCandidate(
            SerializedPropertyObjectReferenceDto payload,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var guid = Normalize(payload == null ? null : payload.asset_guid);
            var requestedPath = Normalize(payload == null ? null : payload.asset_path);
            var subAssetName = Normalize(payload == null ? null : payload.sub_asset_name);

            var guidPath = string.IsNullOrEmpty(guid)
                ? string.Empty
                : Normalize(AssetDatabase.GUIDToAssetPath(guid));
            var resolvedPath = !string.IsNullOrEmpty(guidPath) ? guidPath : requestedPath;
            if (string.IsNullOrEmpty(resolvedPath))
            {
                errorCode = "E_OBJECT_REF_NOT_FOUND";
                errorMessage = "object_ref requires scene_anchor or asset_guid/asset_path.";
                return null;
            }

            if (!string.IsNullOrEmpty(subAssetName))
            {
                var assets = AssetDatabase.LoadAllAssetsAtPath(resolvedPath);
                for (var i = 0; i < assets.Length; i++)
                {
                    var candidate = assets[i];
                    if (candidate == null || string.IsNullOrWhiteSpace(candidate.name))
                    {
                        continue;
                    }

                    if (string.Equals(candidate.name.Trim(), subAssetName, StringComparison.Ordinal))
                    {
                        return candidate;
                    }
                }

                errorCode = "E_OBJECT_REF_NOT_FOUND";
                errorMessage =
                    "Sub asset not found: " +
                    subAssetName +
                    " at " +
                    resolvedPath;
                return null;
            }

            var mainAsset = AssetDatabase.LoadMainAssetAtPath(resolvedPath);
            if (mainAsset != null)
            {
                return mainAsset;
            }

            var genericAsset = AssetDatabase.LoadAssetAtPath<UnityEngine.Object>(resolvedPath);
            if (genericAsset != null)
            {
                return genericAsset;
            }

            errorCode = "E_OBJECT_REF_NOT_FOUND";
            errorMessage = "Asset not found: " + resolvedPath;
            return null;
        }

        private static bool TryResolveSceneAnchor(
            UnityObjectAnchor anchor,
            out GameObject resolved,
            out string errorCode,
            out string errorMessage)
        {
            resolved = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var objectId = Normalize(anchor == null ? null : anchor.object_id);
            var path = Normalize(anchor == null ? null : anchor.path);
            if (string.IsNullOrEmpty(objectId) || string.IsNullOrEmpty(path))
            {
                errorCode = "E_OBJECT_REF_NOT_FOUND";
                errorMessage = "scene_anchor requires both object_id and path.";
                return false;
            }

            var fromPath = FindGameObjectByScenePath(path);
            if (fromPath == null)
            {
                errorCode = "E_OBJECT_REF_NOT_FOUND";
                errorMessage = "scene_anchor path not found: " + path;
                return false;
            }

            var fromId = FindGameObjectByObjectId(objectId);
            if (fromId == null)
            {
                var fromPathObjectId = BuildObjectId(fromPath);
                if (!string.IsNullOrEmpty(fromPathObjectId) &&
                    string.Equals(fromPathObjectId, objectId, StringComparison.Ordinal))
                {
                    fromId = fromPath;
                }
                else
                {
                    errorCode = "E_OBJECT_REF_NOT_FOUND";
                    errorMessage = "scene_anchor object_id not found: " + objectId;
                    return false;
                }
            }

            if (!ReferenceEquals(fromPath, fromId))
            {
                errorCode = "E_OBJECT_REF_NOT_FOUND";
                errorMessage = "scene_anchor object_id/path conflict.";
                return false;
            }

            resolved = fromId;
            return true;
        }

        private static UnityEngine.Object ConvertSceneObject(
            GameObject sceneObject,
            Type expectedType,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;
            if (sceneObject == null)
            {
                errorCode = "E_OBJECT_REF_NOT_FOUND";
                errorMessage = "scene_anchor object is null.";
                return null;
            }

            if (expectedType == null || expectedType == typeof(UnityEngine.Object))
            {
                return sceneObject;
            }

            if (expectedType.IsAssignableFrom(typeof(GameObject)))
            {
                return sceneObject;
            }

            if (typeof(Component).IsAssignableFrom(expectedType))
            {
                var component = sceneObject.GetComponent(expectedType);
                if (component != null)
                {
                    return component;
                }

                errorCode = "E_OBJECT_REF_TYPE_MISMATCH";
                errorMessage = BuildTypeMismatchMessage(expectedType, typeof(GameObject));
                return null;
            }

            errorCode = "E_OBJECT_REF_TYPE_MISMATCH";
            errorMessage = BuildTypeMismatchMessage(expectedType, typeof(GameObject));
            return null;
        }

        private static UnityEngine.Object ConvertToExpectedType(
            UnityEngine.Object candidate,
            Type expectedType,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;
            if (candidate == null)
            {
                errorCode = "E_OBJECT_REF_NOT_FOUND";
                errorMessage = "Resolved object reference is null.";
                return null;
            }

            if (expectedType == null || expectedType == typeof(UnityEngine.Object))
            {
                return candidate;
            }

            var candidateType = candidate.GetType();
            if (expectedType.IsAssignableFrom(candidateType))
            {
                return candidate;
            }

            if (candidate is GameObject && typeof(Component).IsAssignableFrom(expectedType))
            {
                var component = ((GameObject)candidate).GetComponent(expectedType);
                if (component != null)
                {
                    return component;
                }
            }

            errorCode = "E_OBJECT_REF_TYPE_MISMATCH";
            errorMessage = BuildTypeMismatchMessage(expectedType, candidateType);
            return null;
        }

        private static string BuildTypeMismatchMessage(Type expectedType, Type actualType)
        {
            var expected = expectedType == null ? "UnityEngine.Object" : expectedType.FullName;
            var actual = actualType == null ? "<null>" : actualType.FullName;
            return "Object reference type mismatch. expected=" + expected + ", actual=" + actual;
        }

        private static GameObject FindGameObjectByScenePath(string scenePath)
        {
            if (string.IsNullOrEmpty(scenePath))
            {
                return null;
            }

            var normalized = scenePath.Replace('\\', '/').Trim();
            if (normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = normalized.Substring("Scene/".Length);
            }

            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            var segments = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0)
            {
                return null;
            }

            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex++)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var rootIndex = 0; rootIndex < roots.Length; rootIndex++)
                {
                    var root = roots[rootIndex];
                    if (root == null || !string.Equals(root.name, segments[0], StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var found = FindChildBySegments(root.transform, segments, 1);
                    if (found != null)
                    {
                        return found.gameObject;
                    }
                }
            }

            return null;
        }

        private static Transform FindChildBySegments(Transform current, string[] segments, int index)
        {
            if (current == null || segments == null)
            {
                return null;
            }

            if (index >= segments.Length)
            {
                return current;
            }

            var childName = segments[index];
            for (var i = 0; i < current.childCount; i++)
            {
                var child = current.GetChild(i);
                if (child == null || !string.Equals(child.name, childName, StringComparison.Ordinal))
                {
                    continue;
                }

                var found = FindChildBySegments(child, segments, index + 1);
                if (found != null)
                {
                    return found;
                }
            }

            return null;
        }

        private static GameObject FindGameObjectByObjectId(string objectId)
        {
            var normalized = Normalize(objectId);
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            try
            {
                GlobalObjectId parsed;
                if (!GlobalObjectId.TryParse(normalized, out parsed))
                {
                    return null;
                }

                var obj = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
                if (obj is GameObject)
                {
                    return (GameObject)obj;
                }

                var asComponent = obj as Component;
                return asComponent != null ? asComponent.gameObject : null;
            }
            catch
            {
                return null;
            }
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

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }
    }
}

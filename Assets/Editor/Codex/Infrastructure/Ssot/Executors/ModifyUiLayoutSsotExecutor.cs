using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class ModifyUiLayoutSsotExecutor
    {
        public SsotDispatchResponse Execute(ModifyUiLayoutRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "modify_ui_layout request payload is required.",
                    ModifyUiLayoutRequestDto.ToolName);
            }

            if (!IsFinite(request.anchored_x) ||
                !IsFinite(request.anchored_y) ||
                !IsFinite(request.width) ||
                !IsFinite(request.height))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "modify_ui_layout numeric fields must be finite numbers.",
                    ModifyUiLayoutRequestDto.ToolName);
            }

            var targetPath = Normalize(request.target_path);
            var targetObjectId = Normalize(request.target_object_id);
            if (string.IsNullOrEmpty(targetPath) || string.IsNullOrEmpty(targetObjectId))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "modify_ui_layout requires target_path and target_object_id.",
                    ModifyUiLayoutRequestDto.ToolName);
            }

            var targetByPath = FindGameObjectByScenePath(targetPath);
            var targetByObjectId = FindGameObjectByObjectId(targetObjectId);
            if (targetByPath == null && targetByObjectId == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "Target object not found for modify_ui_layout.",
                    ModifyUiLayoutRequestDto.ToolName);
            }

            if (targetByPath != null &&
                targetByObjectId != null &&
                !ReferenceEquals(targetByPath, targetByObjectId))
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_ANCHOR_CONFLICT",
                    "target_path and target_object_id resolve to different objects.",
                    ModifyUiLayoutRequestDto.ToolName);
            }

            var target = targetByPath ?? targetByObjectId;
            if (target == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "Target object resolution returned null.",
                    ModifyUiLayoutRequestDto.ToolName);
            }

            var rectTransform = target.GetComponent<RectTransform>();
            if (rectTransform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "Target object does not contain RectTransform.",
                    ModifyUiLayoutRequestDto.ToolName);
            }

            Undo.RecordObject(rectTransform, "SSOT modify_ui_layout");
            rectTransform.anchoredPosition = new Vector2(
                (float)request.anchored_x,
                (float)request.anchored_y);
            rectTransform.SetSizeWithCurrentAnchors(
                RectTransform.Axis.Horizontal,
                (float)request.width);
            rectTransform.SetSizeWithCurrentAnchors(
                RectTransform.Axis.Vertical,
                (float)request.height);
            EditorUtility.SetDirty(rectTransform);

            var normalizedPath = BuildScenePath(target);
            var normalizedObjectId = BuildObjectId(target);
            return SsotRequestDispatcher.Success(
                ModifyUiLayoutRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    target_object_id = normalizedObjectId,
                    target_path = normalizedPath,
                    anchored_x = rectTransform.anchoredPosition.x,
                    anchored_y = rectTransform.anchoredPosition.y,
                    width = rectTransform.rect.width,
                    height = rectTransform.rect.height
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
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

        private static GameObject FindGameObjectByObjectId(string objectId)
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
            if (current == null)
            {
                return null;
            }

            if (segments == null)
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

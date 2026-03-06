using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class CreateObjectSsotExecutor
    {
        public SsotDispatchResponse Execute(CreateObjectRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "create_object request payload is required.",
                    CreateObjectRequestDto.ToolName);
            }

            var objectName = SsotExecutorCommon.Normalize(request.new_object_name);
            if (string.IsNullOrEmpty(objectName))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "create_object requires non-empty new_object_name.",
                    CreateObjectRequestDto.ToolName);
            }

            var objectKind = SsotExecutorCommon.Normalize(request.object_kind).ToLowerInvariant();
            if (string.IsNullOrEmpty(objectKind))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "create_object requires object_kind.",
                    CreateObjectRequestDto.ToolName);
            }

            GameObject parent;
            string errorCode;
            string errorMessage;
            if (!SsotExecutorCommon.TryResolveTargetFromAnchor(
                    request.parent_path,
                    request.parent_object_id,
                    out parent,
                    out errorCode,
                    out errorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    errorCode,
                    errorMessage,
                    CreateObjectRequestDto.ToolName);
            }

            GameObject created = CreateByKind(objectKind, objectName);
            if (created == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "Unsupported object_kind for create_object.",
                    CreateObjectRequestDto.ToolName);
            }

            Undo.RegisterCreatedObjectUndo(created, "SSOT create_object");
            created.transform.SetParent(parent.transform, false);
            created.SetActive(request.set_active);
            EditorUtility.SetDirty(created);
            EditorUtility.SetDirty(parent);

            return SsotRequestDispatcher.Success(
                CreateObjectRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(created),
                    target_path = SsotExecutorCommon.BuildScenePath(created),
                    target_object_name = created.name,
                    target_object_active = created.activeSelf
                });
        }

        private static GameObject CreateByKind(string objectKind, string objectName)
        {
            switch (objectKind)
            {
                case "empty":
                    return new GameObject(objectName);
                case "camera":
                    return new GameObject(objectName, typeof(Camera));
                case "light":
                    return new GameObject(objectName, typeof(Light));
                case "ui_panel":
                    return new GameObject(
                        objectName,
                        typeof(RectTransform),
                        typeof(CanvasRenderer),
                        typeof(Image));
                case "ui_button":
                    return new GameObject(
                        objectName,
                        typeof(RectTransform),
                        typeof(CanvasRenderer),
                        typeof(Image),
                        typeof(Button));
                default:
                    return null;
            }
        }
    }
}


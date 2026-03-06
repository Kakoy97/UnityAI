using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetUiImageRaycastTargetSsotExecutor
    {
        public SsotDispatchResponse Execute(SetUiImageRaycastTargetRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_ui_image_raycast_target request payload is required.",
                    SetUiImageRaycastTargetRequestDto.ToolName);
            }

            GameObject target;
            string errorCode;
            string errorMessage;
            if (!SsotExecutorCommon.TryResolveTargetFromAnchor(
                    request.target_path,
                    request.target_object_id,
                    out target,
                    out errorCode,
                    out errorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    errorCode,
                    errorMessage,
                    SetUiImageRaycastTargetRequestDto.ToolName);
            }

            var image = target.GetComponent<Image>();
            if (image == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_ui_image_raycast_target requires UnityEngine.UI.Image on target.",
                    SetUiImageRaycastTargetRequestDto.ToolName);
            }

            Undo.RecordObject(image, "SSOT set_ui_image_raycast_target");
            image.raycastTarget = request.raycast_target;
            EditorUtility.SetDirty(image);

            return SsotRequestDispatcher.Success(
                SetUiImageRaycastTargetRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = typeof(Image).AssemblyQualifiedName,
                    property_path = "raycastTarget",
                    value_kind = "boolean",
                    value_boolean = request.raycast_target
                });
        }
    }
}


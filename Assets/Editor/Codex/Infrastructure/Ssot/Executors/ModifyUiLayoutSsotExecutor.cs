using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

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

            return SsotRequestDispatcher.Success(
                ModifyUiLayoutRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
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
    }
}

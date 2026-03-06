using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetRectPivotSsotExecutor
    {
        public SsotDispatchResponse Execute(SetRectPivotRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_rect_pivot request payload is required.",
                    SetRectPivotRequestDto.ToolName);
            }

            if (!IsFinite(request.x) || !IsFinite(request.y))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_rect_pivot requires finite x and y values.",
                    SetRectPivotRequestDto.ToolName);
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
                    SetRectPivotRequestDto.ToolName);
            }

            var rectTransform = target.GetComponent<RectTransform>();
            if (rectTransform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_rect_pivot requires RectTransform on target.",
                    SetRectPivotRequestDto.ToolName);
            }

            Undo.RecordObject(rectTransform, "SSOT set_rect_pivot");
            var nextPivot = new Vector2((float)request.x, (float)request.y);
            rectTransform.pivot = nextPivot;
            EditorUtility.SetDirty(rectTransform);

            return SsotRequestDispatcher.Success(
                SetRectPivotRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "m_Pivot",
                    value_kind = "vector2",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1}",
                        nextPivot.x,
                        nextPivot.y)
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


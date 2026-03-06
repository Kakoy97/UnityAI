using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetRectAnchoredPositionSsotExecutor
    {
        public SsotDispatchResponse Execute(SetRectAnchoredPositionRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_rect_anchored_position request payload is required.",
                    SetRectAnchoredPositionRequestDto.ToolName);
            }

            if (!IsFinite(request.x) || !IsFinite(request.y))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_rect_anchored_position requires finite x and y values.",
                    SetRectAnchoredPositionRequestDto.ToolName);
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
                    SetRectAnchoredPositionRequestDto.ToolName);
            }

            var rectTransform = target.GetComponent<RectTransform>();
            if (rectTransform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_rect_anchored_position requires RectTransform on target.",
                    SetRectAnchoredPositionRequestDto.ToolName);
            }

            Undo.RecordObject(rectTransform, "SSOT set_rect_anchored_position");
            var nextPosition = new Vector2((float)request.x, (float)request.y);
            rectTransform.anchoredPosition = nextPosition;
            EditorUtility.SetDirty(rectTransform);

            return SsotRequestDispatcher.Success(
                SetRectAnchoredPositionRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "m_AnchoredPosition",
                    value_kind = "vector2",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1}",
                        nextPosition.x,
                        nextPosition.y),
                    anchored_x = nextPosition.x,
                    anchored_y = nextPosition.y
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetRectAnchorsSsotExecutor
    {
        public SsotDispatchResponse Execute(SetRectAnchorsRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_rect_anchors request payload is required.",
                    SetRectAnchorsRequestDto.ToolName);
            }

            if (!IsFinite(request.min_x) ||
                !IsFinite(request.min_y) ||
                !IsFinite(request.max_x) ||
                !IsFinite(request.max_y))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_rect_anchors requires finite min/max values.",
                    SetRectAnchorsRequestDto.ToolName);
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
                    SetRectAnchorsRequestDto.ToolName);
            }

            var rectTransform = target.GetComponent<RectTransform>();
            if (rectTransform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_rect_anchors requires RectTransform on target.",
                    SetRectAnchorsRequestDto.ToolName);
            }

            Undo.RecordObject(rectTransform, "SSOT set_rect_anchors");
            var nextAnchorMin = new Vector2((float)request.min_x, (float)request.min_y);
            var nextAnchorMax = new Vector2((float)request.max_x, (float)request.max_y);
            rectTransform.anchorMin = nextAnchorMin;
            rectTransform.anchorMax = nextAnchorMax;
            EditorUtility.SetDirty(rectTransform);

            return SsotRequestDispatcher.Success(
                SetRectAnchorsRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "m_AnchorMin,m_AnchorMax",
                    value_kind = "vector2_pair",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1}|{2},{3}",
                        nextAnchorMin.x,
                        nextAnchorMin.y,
                        nextAnchorMax.x,
                        nextAnchorMax.y)
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


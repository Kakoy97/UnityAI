using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetRectSizeDeltaSsotExecutor
    {
        public SsotDispatchResponse Execute(SetRectSizeDeltaRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_rect_size_delta request payload is required.",
                    SetRectSizeDeltaRequestDto.ToolName);
            }

            if (!IsFinite(request.x) || !IsFinite(request.y))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_rect_size_delta requires finite x and y values.",
                    SetRectSizeDeltaRequestDto.ToolName);
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
                    SetRectSizeDeltaRequestDto.ToolName);
            }

            var rectTransform = target.GetComponent<RectTransform>();
            if (rectTransform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_rect_size_delta requires RectTransform on target.",
                    SetRectSizeDeltaRequestDto.ToolName);
            }

            Undo.RecordObject(rectTransform, "SSOT set_rect_size_delta");
            var nextSize = new Vector2((float)request.x, (float)request.y);
            rectTransform.sizeDelta = nextSize;
            EditorUtility.SetDirty(rectTransform);

            return SsotRequestDispatcher.Success(
                SetRectSizeDeltaRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "m_SizeDelta",
                    value_kind = "vector2",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1}",
                        nextSize.x,
                        nextSize.y),
                    width = nextSize.x,
                    height = nextSize.y
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


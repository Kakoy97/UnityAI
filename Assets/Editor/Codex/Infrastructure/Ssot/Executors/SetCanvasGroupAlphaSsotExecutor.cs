using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetCanvasGroupAlphaSsotExecutor
    {
        public SsotDispatchResponse Execute(SetCanvasGroupAlphaRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_canvas_group_alpha request payload is required.",
                    SetCanvasGroupAlphaRequestDto.ToolName);
            }

            if (!IsFinite(request.alpha))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_canvas_group_alpha requires a finite alpha value.",
                    SetCanvasGroupAlphaRequestDto.ToolName);
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
                    SetCanvasGroupAlphaRequestDto.ToolName);
            }

            var canvasGroup = target.GetComponent<CanvasGroup>();
            if (canvasGroup == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_canvas_group_alpha requires CanvasGroup on target.",
                    SetCanvasGroupAlphaRequestDto.ToolName);
            }

            Undo.RecordObject(canvasGroup, "SSOT set_canvas_group_alpha");
            canvasGroup.alpha = (float)request.alpha;
            EditorUtility.SetDirty(canvasGroup);

            return SsotRequestDispatcher.Success(
                SetCanvasGroupAlphaRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = typeof(CanvasGroup).AssemblyQualifiedName,
                    property_path = "alpha",
                    value_kind = "number",
                    value_number = request.alpha
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


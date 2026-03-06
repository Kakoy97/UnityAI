using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetLocalScaleSsotExecutor
    {
        public SsotDispatchResponse Execute(SetLocalScaleRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_local_scale request payload is required.",
                    SetLocalScaleRequestDto.ToolName);
            }

            if (!IsFinite(request.x) || !IsFinite(request.y) || !IsFinite(request.z))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_local_scale requires finite x, y, z values.",
                    SetLocalScaleRequestDto.ToolName);
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
                    SetLocalScaleRequestDto.ToolName);
            }

            var transform = target.transform;
            if (transform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "set_local_scale target transform is unavailable.",
                    SetLocalScaleRequestDto.ToolName);
            }

            Undo.RecordObject(transform, "SSOT set_local_scale");
            var nextScale = new Vector3((float)request.x, (float)request.y, (float)request.z);
            transform.localScale = nextScale;
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                SetLocalScaleRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "m_LocalScale",
                    value_kind = "vector3",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1},{2}",
                        nextScale.x,
                        nextScale.y,
                        nextScale.z)
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


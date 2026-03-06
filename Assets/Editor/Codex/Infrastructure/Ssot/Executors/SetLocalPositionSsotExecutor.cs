using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetLocalPositionSsotExecutor
    {
        public SsotDispatchResponse Execute(SetLocalPositionRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_local_position request payload is required.",
                    SetLocalPositionRequestDto.ToolName);
            }

            if (!IsFinite(request.x) || !IsFinite(request.y) || !IsFinite(request.z))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_local_position requires finite x, y, z values.",
                    SetLocalPositionRequestDto.ToolName);
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
                    SetLocalPositionRequestDto.ToolName);
            }

            var transform = target.transform;
            if (transform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "set_local_position target transform is unavailable.",
                    SetLocalPositionRequestDto.ToolName);
            }

            Undo.RecordObject(transform, "SSOT set_local_position");
            var nextPosition = new Vector3((float)request.x, (float)request.y, (float)request.z);
            transform.localPosition = nextPosition;
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                SetLocalPositionRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "m_LocalPosition",
                    value_kind = "vector3",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1},{2}",
                        nextPosition.x,
                        nextPosition.y,
                        nextPosition.z)
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}

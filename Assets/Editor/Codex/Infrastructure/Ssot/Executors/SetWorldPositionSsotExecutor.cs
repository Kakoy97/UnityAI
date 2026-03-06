using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetWorldPositionSsotExecutor
    {
        public SsotDispatchResponse Execute(SetWorldPositionRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_world_position request payload is required.",
                    SetWorldPositionRequestDto.ToolName);
            }

            if (!IsFinite(request.x) || !IsFinite(request.y) || !IsFinite(request.z))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_world_position requires finite x, y, z values.",
                    SetWorldPositionRequestDto.ToolName);
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
                    SetWorldPositionRequestDto.ToolName);
            }

            var transform = target.transform;
            if (transform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "set_world_position target transform is unavailable.",
                    SetWorldPositionRequestDto.ToolName);
            }

            Undo.RecordObject(transform, "SSOT set_world_position");
            var nextWorldPosition = new Vector3((float)request.x, (float)request.y, (float)request.z);
            transform.position = nextWorldPosition;
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                SetWorldPositionRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "m_Position",
                    value_kind = "vector3",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1},{2}",
                        nextWorldPosition.x,
                        nextWorldPosition.y,
                        nextWorldPosition.z)
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


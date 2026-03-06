using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetLocalRotationSsotExecutor
    {
        public SsotDispatchResponse Execute(SetLocalRotationRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_local_rotation request payload is required.",
                    SetLocalRotationRequestDto.ToolName);
            }

            if (!IsFinite(request.x) || !IsFinite(request.y) || !IsFinite(request.z))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_local_rotation requires finite x, y, z values.",
                    SetLocalRotationRequestDto.ToolName);
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
                    SetLocalRotationRequestDto.ToolName);
            }

            var transform = target.transform;
            if (transform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "set_local_rotation target transform is unavailable.",
                    SetLocalRotationRequestDto.ToolName);
            }

            Undo.RecordObject(transform, "SSOT set_local_rotation");
            var nextEuler = new Vector3((float)request.x, (float)request.y, (float)request.z);
            transform.localEulerAngles = nextEuler;
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                SetLocalRotationRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "m_LocalEulerAnglesHint",
                    value_kind = "vector3",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1},{2}",
                        nextEuler.x,
                        nextEuler.y,
                        nextEuler.z)
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


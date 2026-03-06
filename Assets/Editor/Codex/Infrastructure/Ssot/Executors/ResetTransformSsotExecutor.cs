using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class ResetTransformSsotExecutor
    {
        public SsotDispatchResponse Execute(ResetTransformRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "reset_transform request payload is required.",
                    ResetTransformRequestDto.ToolName);
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
                    ResetTransformRequestDto.ToolName);
            }

            var transform = target.transform;
            if (transform == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "reset_transform target transform is unavailable.",
                    ResetTransformRequestDto.ToolName);
            }

            Undo.RecordObject(transform, "SSOT reset_transform");
            transform.localPosition = Vector3.zero;
            transform.localRotation = Quaternion.identity;
            transform.localScale = Vector3.one;
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                ResetTransformRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    property_path = "transform.local",
                    value_kind = "reset"
                });
        }
    }
}


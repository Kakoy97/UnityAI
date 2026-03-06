using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class DeleteObjectSsotExecutor
    {
        public SsotDispatchResponse Execute(DeleteObjectRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "delete_object request payload is required.",
                    DeleteObjectRequestDto.ToolName);
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
                    DeleteObjectRequestDto.ToolName);
            }

            var targetObjectId = SsotExecutorCommon.BuildObjectId(target);
            var targetPath = SsotExecutorCommon.BuildScenePath(target);
            var targetName = target.name;

            Undo.DestroyObjectImmediate(target);

            return SsotRequestDispatcher.Success(
                DeleteObjectRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = targetObjectId,
                    target_path = targetPath,
                    target_object_name = targetName
                });
        }
    }
}


using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class RenameObjectSsotExecutor
    {
        public SsotDispatchResponse Execute(RenameObjectRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "rename_object request payload is required.",
                    RenameObjectRequestDto.ToolName);
            }

            var newName = SsotExecutorCommon.Normalize(request.new_name);
            if (string.IsNullOrEmpty(newName))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "rename_object requires non-empty new_name.",
                    RenameObjectRequestDto.ToolName);
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
                    RenameObjectRequestDto.ToolName);
            }

            Undo.RecordObject(target, "SSOT rename_object");
            target.name = newName;
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                RenameObjectRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    target_object_name = target.name
                });
        }
    }
}


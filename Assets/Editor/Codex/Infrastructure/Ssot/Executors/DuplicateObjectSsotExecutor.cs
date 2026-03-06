using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class DuplicateObjectSsotExecutor
    {
        public SsotDispatchResponse Execute(DuplicateObjectRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "duplicate_object request payload is required.",
                    DuplicateObjectRequestDto.ToolName);
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
                    DuplicateObjectRequestDto.ToolName);
            }

            var parent = target.transform.parent;
            var clone = Object.Instantiate(target, parent);
            if (clone == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_DUPLICATE_FAILED",
                    "duplicate_object failed to clone target object.",
                    DuplicateObjectRequestDto.ToolName);
            }

            Undo.RegisterCreatedObjectUndo(clone, "SSOT duplicate_object");
            var duplicateName = SsotExecutorCommon.Normalize(request.duplicate_name);
            if (!string.IsNullOrEmpty(duplicateName))
            {
                clone.name = duplicateName;
            }

            if (parent != null)
            {
                var siblingIndex = target.transform.GetSiblingIndex();
                clone.transform.SetSiblingIndex(siblingIndex + 1);
            }

            EditorUtility.SetDirty(clone);

            return SsotRequestDispatcher.Success(
                DuplicateObjectRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(clone),
                    target_path = SsotExecutorCommon.BuildScenePath(clone),
                    target_object_name = clone.name,
                    target_object_active = clone.activeSelf
                });
        }
    }
}


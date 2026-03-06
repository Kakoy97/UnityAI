using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetParentSsotExecutor
    {
        public SsotDispatchResponse Execute(SetParentRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_parent request payload is required.",
                    SetParentRequestDto.ToolName);
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
                    SetParentRequestDto.ToolName);
            }

            GameObject parent;
            if (!SsotExecutorCommon.TryResolveTargetFromAnchor(
                    request.parent_path,
                    request.parent_object_id,
                    out parent,
                    out errorCode,
                    out errorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    errorCode,
                    errorMessage,
                    SetParentRequestDto.ToolName);
            }

            if (ReferenceEquals(target, parent))
            {
                return SsotRequestDispatcher.Failure(
                    "E_INVALID_PARENT",
                    "set_parent cannot use target as its own parent.",
                    SetParentRequestDto.ToolName);
            }

            if (parent.transform.IsChildOf(target.transform))
            {
                return SsotRequestDispatcher.Failure(
                    "E_INVALID_PARENT",
                    "set_parent cannot create a hierarchy cycle.",
                    SetParentRequestDto.ToolName);
            }

            Undo.SetTransformParent(target.transform, parent.transform, "SSOT set_parent");
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                SetParentRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target)
                });
        }
    }
}


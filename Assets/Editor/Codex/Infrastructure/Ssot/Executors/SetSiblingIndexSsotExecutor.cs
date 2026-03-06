using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetSiblingIndexSsotExecutor
    {
        public SsotDispatchResponse Execute(SetSiblingIndexRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_sibling_index request payload is required.",
                    SetSiblingIndexRequestDto.ToolName);
            }

            if (request.sibling_index < 0)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_sibling_index requires sibling_index >= 0.",
                    SetSiblingIndexRequestDto.ToolName);
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
                    SetSiblingIndexRequestDto.ToolName);
            }

            Undo.RecordObject(target.transform, "SSOT set_sibling_index");
            target.transform.SetSiblingIndex(request.sibling_index);
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                SetSiblingIndexRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target)
                });
        }
    }
}


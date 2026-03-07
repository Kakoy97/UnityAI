using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class GetGameobjectComponentsSsotExecutor
    {
        public SsotDispatchResponse Execute(GetGameobjectComponentsRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "get_gameobject_components request payload is required.",
                    GetGameobjectComponentsRequestDto.ToolName);
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
                    GetGameobjectComponentsRequestDto.ToolName);
            }

            var components = SsotExecutorCommon.BuildComponentSummaries(target);
            return SsotRequestDispatcher.Success(
                GetGameobjectComponentsRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    target_object_name = target == null ? string.Empty : target.name,
                    target_object_active = target != null && target.activeSelf,
                    component_count = components.Length,
                    components = components,
                });
        }
    }
}

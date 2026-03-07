using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class GetCurrentSelectionSsotExecutor
    {
        public SsotDispatchResponse Execute(GetCurrentSelectionRequestDto request)
        {
            var selected = Selection.activeGameObject;
            if (selected == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SELECTION_EMPTY",
                    "No active Unity selection is available.",
                    GetCurrentSelectionRequestDto.ToolName);
            }

            var components = SsotExecutorCommon.BuildComponentSummaries(selected);
            return SsotRequestDispatcher.Success(
                GetCurrentSelectionRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(selected),
                    target_path = SsotExecutorCommon.BuildScenePath(selected),
                    target_object_name = selected.name,
                    target_object_active = selected.activeSelf,
                    component_count = components.Length,
                    components = components,
                });
        }
    }
}

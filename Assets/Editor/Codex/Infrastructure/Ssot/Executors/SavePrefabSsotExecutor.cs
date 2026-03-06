using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SavePrefabSsotExecutor
    {
        public SsotDispatchResponse Execute(SavePrefabRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "save_prefab request payload is required.",
                    SavePrefabRequestDto.ToolName);
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
                    SavePrefabRequestDto.ToolName);
            }

            if (target == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_OBJECT_NOT_FOUND",
                    "Target GameObject not found.",
                    SavePrefabRequestDto.ToolName);
            }

            string prefabPath = request.prefab_path;
            bool saveAsNew = request.save_as_new == true;

            // Check if it's already a prefab instance
            PrefabAssetType prefabType = PrefabUtility.GetPrefabAssetType(target);
            PrefabInstanceStatus prefabStatus = PrefabUtility.GetPrefabInstanceStatus(target);

            bool success = false;
            string savedPath = string.Empty;

            if (prefabStatus == PrefabInstanceStatus.Connected || prefabStatus == PrefabInstanceStatus.Disconnected)
            {
                // It's a prefab instance - save changes to existing prefab
                if (saveAsNew && !string.IsNullOrEmpty(prefabPath))
                {
                    // Save as new prefab
                    Object prefabAsset = PrefabUtility.SaveAsPrefabAsset(target, prefabPath, out success);
                    if (success && prefabAsset != null)
                    {
                        savedPath = AssetDatabase.GetAssetPath(prefabAsset);
                    }
                }
                else
                {
                    // Save changes to existing prefab
                    PrefabUtility.SavePrefabAsset(target);
                    savedPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(target);
                    success = !string.IsNullOrEmpty(savedPath);
                }
            }
            else
            {
                // Not a prefab instance - create new prefab
                if (string.IsNullOrEmpty(prefabPath))
                {
                    return SsotRequestDispatcher.Failure(
                        "E_PREFAB_PATH_REQUIRED",
                        "prefab_path is required when saving a non-prefab GameObject as a prefab.",
                        SavePrefabRequestDto.ToolName);
                }

                // Ensure .prefab extension
                if (!prefabPath.EndsWith(".prefab", System.StringComparison.OrdinalIgnoreCase))
                {
                    prefabPath += ".prefab";
                }

                Object prefabAsset = PrefabUtility.SaveAsPrefabAsset(target, prefabPath, out success);
                if (success && prefabAsset != null)
                {
                    savedPath = AssetDatabase.GetAssetPath(prefabAsset);
                }
            }

            if (!success)
            {
                return SsotRequestDispatcher.Failure(
                    "E_PREFAB_SAVE_FAILED",
                    "Failed to save prefab. Check if the path is valid and writable.",
                    SavePrefabRequestDto.ToolName);
            }

            return SsotRequestDispatcher.Success(
                SavePrefabRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = savedPath
                });
        }
    }
}

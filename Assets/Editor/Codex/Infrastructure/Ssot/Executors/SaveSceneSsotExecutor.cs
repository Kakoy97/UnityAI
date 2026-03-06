using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SaveSceneSsotExecutor
    {
        public SsotDispatchResponse Execute(SaveSceneRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "save_scene request payload is required.",
                    SaveSceneRequestDto.ToolName);
            }

            var activeScene = EditorSceneManager.GetActiveScene();
            if (!activeScene.IsValid())
            {
                return SsotRequestDispatcher.Failure(
                    "E_SCENE_NOT_LOADED",
                    "No active scene is currently loaded.",
                    SaveSceneRequestDto.ToolName);
            }

            string scenePath = activeScene.path;
            bool saveAsNew = request.save_as_new == true;

            // If scene is not saved and no path provided, or save_as_new is true
            if (string.IsNullOrEmpty(scenePath) || saveAsNew)
            {
                if (!string.IsNullOrEmpty(request.scene_path))
                {
                    scenePath = request.scene_path;
                }
                else
                {
                    // Use current scene name or default
                    scenePath = "Assets/Scenes/NewScene.unity";
                }
            }
            else if (!string.IsNullOrEmpty(request.scene_path))
            {
                // Override with provided path
                scenePath = request.scene_path;
            }

            // Ensure .unity extension
            if (!scenePath.EndsWith(".unity", System.StringComparison.OrdinalIgnoreCase))
            {
                scenePath += ".unity";
            }

            bool success;
            string savedPath;

            if (saveAsNew || string.IsNullOrEmpty(activeScene.path))
            {
                // Save as new scene
                success = EditorSceneManager.SaveScene(activeScene, scenePath, false);
                savedPath = success ? scenePath : string.Empty;
            }
            else
            {
                // Save existing scene
                success = EditorSceneManager.SaveScene(activeScene);
                savedPath = success ? activeScene.path : string.Empty;
            }

            if (!success)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SCENE_SAVE_FAILED",
                    "Failed to save scene. Check if the path is valid and writable.",
                    SaveSceneRequestDto.ToolName);
            }

            return SsotRequestDispatcher.Success(
                SaveSceneRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_path = savedPath
                });
        }
    }
}

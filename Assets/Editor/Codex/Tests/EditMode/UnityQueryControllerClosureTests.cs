using System.IO;
using NUnit.Framework;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityQueryControllerClosureTests
    {
        [Test]
        public void ExecutePulledReadQueryAsync_UsesRegistryDispatch_WithoutPerQueryBranches()
        {
            var controllerPath = Path.Combine(
                UnityEngine.Application.dataPath,
                "Editor/Codex/Application/ConversationController.cs");
            Assert.IsTrue(File.Exists(controllerPath), "ConversationController.cs not found.");

            var source = File.ReadAllText(controllerPath);
            Assert.IsTrue(
                source.Contains("_unityQueryRegistry.DispatchAsync("),
                "ConversationController must dispatch pulled queries through UnityQueryRegistry.");

            Assert.IsFalse(
                source.Contains("string.Equals(queryType, \"list_assets_in_folder\""),
                "Legacy per-query branch for list_assets_in_folder must be removed.");
            Assert.IsFalse(
                source.Contains("string.Equals(queryType, \"get_scene_roots\""),
                "Legacy per-query branch for get_scene_roots must be removed.");
            Assert.IsFalse(
                source.Contains("string.Equals(queryType, \"find_objects_by_component\""),
                "Legacy per-query branch for find_objects_by_component must be removed.");
            Assert.IsFalse(
                source.Contains("string.Equals(queryType, \"query_prefab_info\""),
                "Legacy per-query branch for query_prefab_info must be removed.");
            Assert.IsFalse(
                source.Contains("string.Equals(queryType, \"capture_scene_screenshot\""),
                "Legacy per-query branch for capture_scene_screenshot must be removed.");
            Assert.IsFalse(
                source.Contains("string.Equals(queryType, \"get_ui_tree\""),
                "Legacy per-query branch for get_ui_tree must be removed.");
            Assert.IsFalse(
                source.Contains("string.Equals(queryType, \"hit_test_ui_at_screen_point\""),
                "Legacy per-query branch for hit_test_ui_at_screen_point must be removed.");
            Assert.IsFalse(
                source.Contains("BuildListAssetsInFolderRequest("),
                "ConversationController must not host per-query request builders.");
            Assert.IsFalse(
                source.Contains("BuildGetSceneRootsRequest("),
                "ConversationController must not host per-query request builders.");
            Assert.IsFalse(
                source.Contains("BuildFindObjectsByComponentRequest("),
                "ConversationController must not host per-query request builders.");
            Assert.IsFalse(
                source.Contains("BuildQueryPrefabInfoRequest("),
                "ConversationController must not host per-query request builders.");
            Assert.IsFalse(
                source.Contains("BuildCaptureSceneScreenshotRequest("),
                "ConversationController must not host per-query request builders.");
            Assert.IsFalse(
                source.Contains("BuildGetUiTreeRequest("),
                "ConversationController must not host per-query request builders.");
            Assert.IsFalse(
                source.Contains("BuildHitTestUiAtScreenPointRequest("),
                "ConversationController must not host per-query request builders.");
        }
    }
}

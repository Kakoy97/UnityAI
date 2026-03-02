using System.IO;
using NUnit.Framework;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityR15SplitClosureGuardTests
    {
        [Test]
        public void R15Split_FacadeFilesRemainThin()
        {
            AssertFileMaxLines(
                Path.Combine(
                    "Assets",
                    "Editor",
                    "Codex",
                    "Infrastructure",
                    "UnityRagReadService.cs"),
                260);
            AssertFileMaxLines(
                Path.Combine(
                    "Assets",
                    "Editor",
                    "Codex",
                    "Infrastructure",
                    "UnityVisualActionExecutor.cs"),
                320);
            AssertFileMaxLines(
                Path.Combine(
                    "Assets",
                    "Editor",
                    "Codex",
                    "Domain",
                    "SidecarContracts.cs"),
                80);
            AssertFileMaxLines(
                Path.Combine(
                    "Assets",
                    "Editor",
                    "Codex",
                    "Application",
                    "ConversationController.cs"),
                1100);
        }

        [Test]
        public void R15Split_ReadWriteContractModulesExist()
        {
            var expectedFiles = new[]
            {
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Read", "AssetSceneReadService.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Read", "UiTreeReadService.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Read", "UiHitTestReadService.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Read", "UiLayoutReadService.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Read", "ScreenshotReadService.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Read", "ReadErrorMapper.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Actions", "LegacyPrimitiveActionHandlers.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Actions", "BuiltInVisualActionHandlers.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Infrastructure", "Actions", "ValuePackVisualActionHandlers.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Domain", "Contracts", "SidecarContracts.Core.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Domain", "Contracts", "SidecarContracts.Turn.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Domain", "Contracts", "SidecarContracts.Action.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Domain", "Contracts", "SidecarContracts.Query.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Domain", "Contracts", "SidecarContracts.UiVision.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Application", "Conversation", "TurnStateCoordinator.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Application", "Conversation", "PendingActionCoordinator.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Application", "Conversation", "QueryPollingCoordinator.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Application", "Conversation", "CapabilityReporter.cs"),
                Path.Combine("Assets", "Editor", "Codex", "Application", "Conversation", "ConversationController.QueryRuntimeCoordinator.cs"),
            };

            for (var i = 0; i < expectedFiles.Length; i++)
            {
                var absolutePath = ResolveRepoPath(expectedFiles[i]);
                Assert.IsTrue(File.Exists(absolutePath), "Expected split module missing: " + expectedFiles[i]);
            }
        }

        [Test]
        public void R15Split_FacadeEntryFilesDoNotReintroduceLargeInlineImplementations()
        {
            var ragFacade = ReadSource(
                Path.Combine(
                    "Assets",
                    "Editor",
                    "Codex",
                    "Infrastructure",
                    "UnityRagReadService.cs"));
            StringAssert.DoesNotContain("public UnityGetUiTreeResponse GetUiTree(", ragFacade);
            StringAssert.DoesNotContain("public UnityCaptureSceneScreenshotResponse CaptureSceneScreenshot(", ragFacade);
            StringAssert.DoesNotContain("public UnityValidateUiLayoutResponse ValidateUiLayout(", ragFacade);
            StringAssert.DoesNotContain("public UnityHitTestUiAtViewportPointResponse HitTestUiAtViewportPoint(", ragFacade);

            var actionFacade = ReadSource(
                Path.Combine(
                    "Assets",
                    "Editor",
                    "Codex",
                    "Infrastructure",
                    "UnityVisualActionExecutor.cs"));
            StringAssert.DoesNotContain("RunSetTransformLocalPosition(", actionFacade);
            StringAssert.DoesNotContain("RunSetUiTextContent(", actionFacade);
            StringAssert.DoesNotContain("switch (actionType)", actionFacade);
        }

        private static void AssertFileMaxLines(string relativePath, int maxLines)
        {
            var source = ReadSource(relativePath);
            var lineCount = source.Split('\n').Length;
            Assert.LessOrEqual(
                lineCount,
                maxLines,
                relativePath + " exceeded LOC limit: " + lineCount + " > " + maxLines);
        }

        private static string ReadSource(string relativePath)
        {
            var absolutePath = ResolveRepoPath(relativePath);
            Assert.IsTrue(File.Exists(absolutePath), "Expected source file missing: " + relativePath);
            return File.ReadAllText(absolutePath);
        }

        private static string ResolveRepoPath(string relativePath)
        {
            var normalized = relativePath.Replace('\\', Path.DirectorySeparatorChar).Replace('/', Path.DirectorySeparatorChar);
            return Path.Combine(Directory.GetCurrentDirectory(), normalized);
        }
    }
}

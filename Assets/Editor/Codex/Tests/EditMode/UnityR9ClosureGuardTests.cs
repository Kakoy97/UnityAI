using System.IO;
using NUnit.Framework;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityR9ClosureGuardTests
    {
        [Test]
        public void UnityVisualActionExecutor_Source_DoesNotContainLegacySwitchOrExecuteBranches()
        {
            var source = ReadSource(
                "Assets",
                "Editor",
                "Codex",
                "Infrastructure",
                "UnityVisualActionExecutor.cs");

            StringAssert.DoesNotContain("switch (actionType)", source);
            StringAssert.DoesNotContain("ExecuteAddComponent(", source);
            StringAssert.DoesNotContain("ExecuteRemoveComponent(", source);
            StringAssert.DoesNotContain("ExecuteReplaceComponent(", source);
            StringAssert.DoesNotContain("ExecuteCreateGameObject(", source);
            StringAssert.DoesNotContain("PrepareActionForDispatch(", source);
            StringAssert.DoesNotContain("LegacyAddComponentActionData", source);
        }

        [Test]
        public void ConversationController_Source_DoesNotContainHardcodedActionPayloadValidationBranches()
        {
            var source = ReadSource(
                "Assets",
                "Editor",
                "Codex",
                "Application",
                "ConversationController.cs");

            StringAssert.DoesNotContain("string.Equals(action.type, \"add_component\"", source);
            StringAssert.DoesNotContain("string.Equals(action.type, \"remove_component\"", source);
            StringAssert.DoesNotContain("string.Equals(action.type, \"replace_component\"", source);
            StringAssert.DoesNotContain("string.Equals(action.type, \"create_gameobject\"", source);
        }

        [Test]
        public void RuntimeReloadBootstrap_Source_ContainsCapabilityReportHook()
        {
            var source = ReadSource(
                "Assets",
                "Editor",
                "Codex",
                "Infrastructure",
                "UnityRuntimeReloadPingBootstrap.cs");

            StringAssert.Contains("TryReportCapabilitiesAfterReloadAsync", source);
            StringAssert.Contains("CapabilityReportIntervalSeconds", source);
        }

        private static string ReadSource(params string[] relativeSegments)
        {
            var path = Path.Combine(Directory.GetCurrentDirectory(), Path.Combine(relativeSegments));
            Assert.IsTrue(File.Exists(path), "Expected source file missing: " + path);
            return File.ReadAllText(path);
        }
    }
}

using System;
using System.Linq;
using NUnit.Framework;
using UnityAI.Editor.Codex.Infrastructure.Actions;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class McpActionRegistryTests
    {
        [Test]
        public void Register_And_TryGet_WorksForExplicitActionType()
        {
            var registry = new McpActionRegistry();
            registry.Register<TestActionHandlerA>("test_action_a");

            IMcpVisualActionHandler resolved;
            var ok = registry.TryGet("test_action_a", out resolved);

            Assert.IsTrue(ok);
            Assert.NotNull(resolved);
            Assert.AreEqual("test_action_a", resolved.ActionType);
        }

        [Test]
        public void Register_Throws_OnDuplicateActionType()
        {
            var registry = new McpActionRegistry();
            registry.Register<TestActionHandlerA>("test_action_a");

            Assert.Throws<InvalidOperationException>(
                () => registry.Register<TestActionHandlerA>("test_action_a"));
        }

        [Test]
        public void Register_Throws_OnEmptyActionType()
        {
            var registry = new McpActionRegistry();

            Assert.Throws<ArgumentException>(() => registry.Register<TestActionHandlerA>(" "));
        }

        [Test]
        public void Register_Throws_OnInvalidActionTypePattern()
        {
            var registry = new McpActionRegistry();
            Assert.Throws<ArgumentException>(() => registry.Register<TestActionHandlerA>("SetAction"));
        }

        [Test]
        public void GetCapabilities_ReturnsStableSortedList()
        {
            var registry = new McpActionRegistry();
            registry.Register<TestActionHandlerB>(
                "test_action_b",
                new McpActionCapability(
                    "test_action_b",
                    "B",
                    "target_required",
                    "{\"type\":\"object\"}"));
            registry.Register<TestActionHandlerA>(
                "test_action_a",
                new McpActionCapability(
                    "test_action_a",
                    "A",
                    "target_required",
                    "{\"type\":\"object\"}"));

            var capabilities = registry.GetCapabilities();

            Assert.AreEqual(2, capabilities.Count);
            Assert.AreEqual("test_action_a", capabilities[0].ActionType);
            Assert.AreEqual("test_action_b", capabilities[1].ActionType);
        }

        [Test]
        public void Capability_Throws_WhenDeprecatedWithoutReplacement()
        {
            Assert.Throws<ArgumentException>(
                delegate
                {
                    new McpActionCapability(
                        "deprecated_action",
                        "deprecated",
                        "target_required",
                        "{\"type\":\"object\"}",
                        McpActionGovernance.DomainUi,
                        McpActionGovernance.TierCore,
                        McpActionGovernance.LifecycleDeprecated,
                        McpActionGovernance.UndoSafetyAtomicSafe,
                        string.Empty);
                });
        }

        [Test]
        public void BootstrapRegistry_ExportsGovernanceMetadata_ForAllCapabilities()
        {
            var capabilities = McpActionRegistryBootstrap.GetCapabilities();
            Assert.NotNull(capabilities);
            Assert.GreaterOrEqual(capabilities.Count, 20);

            for (var i = 0; i < capabilities.Count; i++)
            {
                var item = capabilities[i];
                Assert.IsNotNull(item);
                Assert.IsFalse(string.IsNullOrWhiteSpace(item.Domain), "domain is required");
                Assert.IsFalse(string.IsNullOrWhiteSpace(item.Tier), "tier is required");
                Assert.IsFalse(string.IsNullOrWhiteSpace(item.Lifecycle), "lifecycle is required");
                Assert.IsFalse(string.IsNullOrWhiteSpace(item.UndoSafety), "undo_safety is required");
            }
        }

        [Test]
        public void BootstrapRegistry_ContainsCompositeVisualActionHandler()
        {
            var registry = McpActionRegistryBootstrap.Registry;
            IMcpVisualActionHandler resolved;
            var ok = registry.TryGet("composite_visual_action", out resolved);

            Assert.IsTrue(ok);
            Assert.NotNull(resolved);
            Assert.AreEqual("composite_visual_action", resolved.ActionType);
        }

        [Test]
        public void BootstrapRegistry_ContainsHighValueUiActions()
        {
            var registry = McpActionRegistryBootstrap.Registry;
            IMcpVisualActionHandler resolved;
            Assert.IsTrue(registry.TryGet("set_ui_image_color", out resolved));
            Assert.AreEqual("set_ui_image_color", resolved.ActionType);

            Assert.IsTrue(registry.TryGet("set_ui_text_content", out resolved));
            Assert.AreEqual("set_ui_text_content", resolved.ActionType);

            var capabilities = McpActionRegistryBootstrap.GetCapabilities();
            Assert.IsTrue(
                capabilities.Any((item) =>
                    item != null &&
                    string.Equals(item.ActionType, "set_ui_image_color", StringComparison.Ordinal) &&
                    string.Equals(item.Domain, McpActionGovernance.DomainUi, StringComparison.Ordinal)));
        }

        [Test]
        public void BootstrapRegistry_ContainsSetSerializedProperty_WithSchemaHints()
        {
            var registry = McpActionRegistryBootstrap.Registry;
            IMcpVisualActionHandler resolved;
            Assert.IsTrue(registry.TryGet("set_serialized_property", out resolved));
            Assert.NotNull(resolved);
            Assert.AreEqual("set_serialized_property", resolved.ActionType);

            var capabilities = McpActionRegistryBootstrap.GetCapabilities();
            var capability = capabilities.FirstOrDefault(
                (item) =>
                    item != null &&
                    string.Equals(item.ActionType, "set_serialized_property", StringComparison.Ordinal));
            Assert.NotNull(capability);
            Assert.AreEqual(McpActionGovernance.DomainComponent, capability.Domain);
            Assert.AreEqual(McpActionGovernance.TierAdvanced, capability.Tier);
            Assert.AreEqual(McpActionGovernance.LifecycleExperimental, capability.Lifecycle);
            Assert.IsTrue(capability.ActionDataSchemaJson.Contains("component_selector"));
            Assert.IsTrue(capability.ActionDataSchemaJson.Contains("patches"));
            Assert.IsTrue(capability.ActionDataSchemaJson.Contains("object_ref"));
        }

        private sealed class TestActionHandlerA : IMcpVisualActionHandler
        {
            public string ActionType
            {
                get { return "test_action_a"; }
            }

            public McpVisualActionExecutionResult Execute(McpVisualActionContext context)
            {
                return McpVisualActionExecutionResult.Ok();
            }
        }

        private sealed class TestActionHandlerB : IMcpVisualActionHandler
        {
            public string ActionType
            {
                get { return "test_action_b"; }
            }

            public McpVisualActionExecutionResult Execute(McpVisualActionContext context)
            {
                return McpVisualActionExecutionResult.Ok();
            }
        }
    }
}

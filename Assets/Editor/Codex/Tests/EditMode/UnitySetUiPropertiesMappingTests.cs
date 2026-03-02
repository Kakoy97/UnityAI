using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityAI.Editor.Codex.Infrastructure.Actions;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnitySetUiPropertiesMappingTests
    {
        private static readonly string[] SetUiMappedActionTypes =
        {
            "set_rect_transform_anchored_position",
            "set_rect_transform_size_delta",
            "set_rect_transform_pivot",
            "set_rect_transform_anchors",
            "set_ui_image_color",
            "set_ui_image_raycast_target",
            "set_ui_text_content",
            "set_ui_text_color",
            "set_ui_text_font_size",
            "set_layout_element",
        };

        [Test]
        public void BootstrapRegistry_ContainsAllSetUiPropertiesMappedActions()
        {
            var registry = McpActionRegistryBootstrap.Registry;
            for (var i = 0; i < SetUiMappedActionTypes.Length; i++)
            {
                var actionType = SetUiMappedActionTypes[i];
                IMcpVisualActionHandler handler;
                var ok = registry.TryGet(actionType, out handler);

                Assert.IsTrue(ok, "Missing mapped action handler: " + actionType);
                Assert.NotNull(handler, "Mapped action handler is null: " + actionType);
                Assert.AreEqual(actionType, handler.ActionType);
            }
        }

        [Test]
        public void BootstrapCapabilities_SetUiMappedActions_AreAtomicSafe()
        {
            var capabilities = McpActionRegistryBootstrap.GetCapabilities();
            var capabilityByType = new Dictionary<string, McpActionCapability>(StringComparer.Ordinal);
            for (var i = 0; i < capabilities.Count; i++)
            {
                var item = capabilities[i];
                if (item == null || string.IsNullOrWhiteSpace(item.ActionType))
                {
                    continue;
                }

                capabilityByType[item.ActionType] = item;
            }

            for (var i = 0; i < SetUiMappedActionTypes.Length; i++)
            {
                var actionType = SetUiMappedActionTypes[i];
                McpActionCapability capability;
                var ok = capabilityByType.TryGetValue(actionType, out capability);
                Assert.IsTrue(ok, "Missing mapped capability: " + actionType);
                Assert.NotNull(capability, "Mapped capability is null: " + actionType);
                Assert.AreEqual(
                    McpActionGovernance.UndoSafetyAtomicSafe,
                    capability.UndoSafety,
                    "Mapped capability must remain atomic_safe: " + actionType);
            }
        }
    }
}

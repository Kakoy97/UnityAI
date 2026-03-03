using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.Actions;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class BuiltInVisualActionHandlersTests
    {
        [Test]
        public void CloneAction_CopiesMarshaledPayload()
        {
            var source = new VisualLayerActionItem
            {
                type = "add_component",
                target_anchor = new UnityObjectAnchor
                {
                    object_id = "go_target",
                    path = "Scene/Canvas/Button",
                },
                parent_anchor = new UnityObjectAnchor
                {
                    object_id = "go_parent",
                    path = "Scene/Canvas",
                },
                target_anchor_ref = "$target",
                parent_anchor_ref = "$parent",
                action_data_json = "{\"component_assembly_qualified_name\":\"UnityEngine.UI.Image, UnityEngine.UI\"}",
                action_data_marshaled = "eyJjb21wb25lbnRfYXNzZW1ibHlfcXVhbGlmaWVkX25hbWUiOiJVbml0eUVuZ2luZS5VSS5JbWFnZSwgVW5pdHlFbmdpbmUuVUkifQ",
                component_assembly_qualified_name = "UnityEngine.UI.Image, UnityEngine.UI",
                source_component_assembly_qualified_name = "UnityEngine.UI.RawImage, UnityEngine.UI",
                name = "ButtonImage",
                primitive_type = "Cube",
                ui_type = "Text",
            };

            var clone = McpBuiltInActionMapper.CloneAction(source);

            Assert.NotNull(clone);
            Assert.AreNotSame(source, clone);
            Assert.AreEqual(source.type, clone.type);
            Assert.AreEqual(source.action_data_json, clone.action_data_json);
            Assert.AreEqual(source.action_data_marshaled, clone.action_data_marshaled);
            Assert.AreEqual(source.component_assembly_qualified_name, clone.component_assembly_qualified_name);
            Assert.AreEqual(source.source_component_assembly_qualified_name, clone.source_component_assembly_qualified_name);
            Assert.AreEqual(source.name, clone.name);
            Assert.AreEqual(source.primitive_type, clone.primitive_type);
            Assert.AreEqual(source.ui_type, clone.ui_type);

            Assert.NotNull(clone.target_anchor);
            Assert.NotNull(clone.parent_anchor);
            Assert.AreNotSame(source.target_anchor, clone.target_anchor);
            Assert.AreNotSame(source.parent_anchor, clone.parent_anchor);
            Assert.AreEqual(source.target_anchor.object_id, clone.target_anchor.object_id);
            Assert.AreEqual(source.target_anchor.path, clone.target_anchor.path);
            Assert.AreEqual(source.parent_anchor.object_id, clone.parent_anchor.object_id);
            Assert.AreEqual(source.parent_anchor.path, clone.parent_anchor.path);
        }
    }
}

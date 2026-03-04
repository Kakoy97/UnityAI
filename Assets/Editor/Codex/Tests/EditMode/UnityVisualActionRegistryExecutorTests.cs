using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityVisualActionRegistryExecutorTests
    {
        [Test]
        public void Execute_ReturnsHandlerNotFound_ForUnknownActionType()
        {
            var executor = new UnityVisualActionExecutor();
            var result = executor.Execute(
                new VisualLayerActionItem
                {
                    type = "set_custom_unknown_action",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_unknown",
                        path = "Scene/Unknown",
                    },
                    action_data_json = "{\"r\":1,\"g\":1,\"b\":1,\"a\":1}",
                },
                null);

            Assert.NotNull(result);
            Assert.IsFalse(result.success);
            Assert.AreEqual("E_ACTION_HANDLER_NOT_FOUND", result.errorCode);
            Assert.NotNull(result.writeReceipt);
            Assert.AreEqual("write_receipt.v1", result.writeReceipt.schema_version);
            Assert.NotNull(result.writeReceipt.console_snapshot);
        }

        [Test]
        public void Execute_ReturnsDeserializeFailed_WhenActionDataJsonInvalid()
        {
            var executor = new UnityVisualActionExecutor();
            var result = executor.Execute(
                new VisualLayerActionItem
                {
                    type = "add_component",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_unknown",
                        path = "Scene/Unknown",
                    },
                    action_data_json = "{\"component_assembly_qualified_name\":",
                },
                null);

            Assert.NotNull(result);
            Assert.IsFalse(result.success);
            Assert.AreEqual("E_ACTION_DESERIALIZE_FAILED", result.errorCode);
        }

        [Test]
        public void Execute_ReturnsDeserializeFailed_WhenBuiltInActionUsesLegacyTopLevelFields()
        {
            var executor = new UnityVisualActionExecutor();
            var result = executor.Execute(
                new VisualLayerActionItem
                {
                    type = "create_object",
                    parent_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_parent",
                        path = "Scene/Parent",
                    },
                    name = "LegacyNameOnly",
                },
                null);

            Assert.NotNull(result);
            Assert.IsFalse(result.success);
            Assert.AreEqual("E_ACTION_DESERIALIZE_FAILED", result.errorCode);
        }
    }
}

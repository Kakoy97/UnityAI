using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using System;
using System.Text;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class McpVisualActionContextTests
    {
        [Test]
        public void TryDeserializeActionData_ReturnsTypedDto_ForValidJson()
        {
            var context = new McpVisualActionContext(
                new VisualLayerActionItem
                {
                    type = "set_ui_image_color",
                    action_data_json = "{\"r\":1,\"g\":0.5,\"b\":0.25,\"a\":1}",
                },
                null,
                null,
                null);

            ColorPayload data;
            string error;
            var ok = context.TryDeserializeActionData(out data, out error);

            Assert.IsTrue(ok);
            Assert.NotNull(data);
            Assert.AreEqual(1f, data.r);
            Assert.AreEqual(0.5f, data.g);
            Assert.AreEqual(string.Empty, error);
        }

        [Test]
        public void TryDeserializeActionData_Fails_WhenActionDataJsonMissing()
        {
            var context = new McpVisualActionContext(
                new VisualLayerActionItem
                {
                    type = "set_ui_image_color",
                    action_data_json = string.Empty,
                },
                null,
                null,
                null);

            ColorPayload data;
            string error;
            var ok = context.TryDeserializeActionData(out data, out error);

            Assert.IsFalse(ok);
            Assert.IsNull(data);
            Assert.IsNotEmpty(error);
        }

        [Test]
        public void TryDeserializeActionData_Fails_WhenJsonInvalid()
        {
            var context = new McpVisualActionContext(
                new VisualLayerActionItem
                {
                    type = "set_ui_image_color",
                    action_data_json = "{\"r\":1,",
                },
                null,
                null,
                null);

            ColorPayload data;
            string error;
            var ok = context.TryDeserializeActionData(out data, out error);

            Assert.IsFalse(ok);
            Assert.IsNull(data);
            Assert.IsNotEmpty(error);
        }

        [Test]
        public void TryDeserializeActionData_UsesMarshaledPayload_WhenPresent()
        {
            const string json = "{\"r\":0.2,\"g\":0.3,\"b\":0.4,\"a\":1}";
            var context = new McpVisualActionContext(
                new VisualLayerActionItem
                {
                    type = "set_ui_image_color",
                    action_data_json = "{\"r\":1,\"g\":1,\"b\":1,\"a\":1}",
                    action_data_marshaled = ToBase64Url(json),
                },
                null,
                null,
                null);

            ColorPayload data;
            string error;
            var ok = context.TryDeserializeActionData(out data, out error);

            Assert.IsTrue(ok);
            Assert.NotNull(data);
            Assert.AreEqual(0.2f, data.r);
            Assert.AreEqual(0.3f, data.g);
            Assert.AreEqual(string.Empty, error);
        }

        [Test]
        public void TryDeserializeActionData_FallsBackToJson_WhenMarshaledInvalid()
        {
            var context = new McpVisualActionContext(
                new VisualLayerActionItem
                {
                    type = "set_ui_image_color",
                    action_data_json = "{\"r\":0.9,\"g\":0.1,\"b\":0.2,\"a\":1}",
                    action_data_marshaled = "%%%invalid%%%",
                },
                null,
                null,
                null);

            ColorPayload data;
            string error;
            var ok = context.TryDeserializeActionData(out data, out error);

            Assert.IsTrue(ok);
            Assert.NotNull(data);
            Assert.AreEqual(0.9f, data.r);
            Assert.AreEqual(string.Empty, error);
        }

        private static string ToBase64Url(string raw)
        {
            var base64 = Convert.ToBase64String(Encoding.UTF8.GetBytes(raw));
            return base64.TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        [System.Serializable]
        private sealed class ColorPayload
        {
            public float r;
            public float g;
            public float b;
            public float a;
        }
    }
}

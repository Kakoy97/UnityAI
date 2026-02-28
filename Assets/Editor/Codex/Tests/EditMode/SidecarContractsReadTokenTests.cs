using NUnit.Framework;
using UnityEngine;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class SidecarContractsReadTokenTests
    {
        [Test]
        public void UnityActionRequestPayload_Deserializes_BasedOnReadToken()
        {
            const string expectedToken = "tok_read_123456789012345678901234";
            var json =
                "{" +
                "\"based_on_read_token\":\"" + expectedToken + "\"," +
                "\"requires_confirmation\":false," +
                "\"action\":{" +
                "\"type\":\"add_component\"," +
                "\"target_object_path\":\"Scene/Root\"," +
                "\"component_assembly_qualified_name\":\"UnityEngine.Transform, UnityEngine.CoreModule\"" +
                "}" +
                "}";

            var payload = JsonUtility.FromJson<UnityActionRequestPayload>(json);

            Assert.NotNull(payload);
            Assert.AreEqual(expectedToken, payload.based_on_read_token);
            Assert.NotNull(payload.action);
            Assert.AreEqual("add_component", payload.action.type);
        }

        [Test]
        public void UnityActionRequestEnvelope_Deserializes_PayloadReadTokenWithoutLoss()
        {
            const string expectedToken = "tok_env_123456789012345678901234";
            var json =
                "{" +
                "\"event\":\"unity.action.request\"," +
                "\"request_id\":\"req_1\"," +
                "\"thread_id\":\"thread_1\"," +
                "\"turn_id\":\"turn_1\"," +
                "\"timestamp\":\"2026-02-25T00:00:00.000Z\"," +
                "\"payload\":{" +
                "\"based_on_read_token\":\"" + expectedToken + "\"," +
                "\"requires_confirmation\":true," +
                "\"action\":{" +
                "\"type\":\"remove_component\"," +
                "\"target_object_path\":\"Scene/Root/Button\"," +
                "\"component_assembly_qualified_name\":\"UnityEngine.UI.Image, UnityEngine.UI\"" +
                "}" +
                "}" +
                "}";

            var envelope = JsonUtility.FromJson<UnityActionRequestEnvelope>(json);

            Assert.NotNull(envelope);
            Assert.NotNull(envelope.payload);
            Assert.AreEqual(expectedToken, envelope.payload.based_on_read_token);
            Assert.IsTrue(envelope.payload.requires_confirmation);
        }
    }
}


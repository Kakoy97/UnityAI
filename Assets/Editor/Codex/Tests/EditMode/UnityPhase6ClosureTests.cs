using System.IO;
using System.Reflection;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityPhase6ClosureTests
    {
        [Test]
        public void UnityActionRequestEnvelope_Deserializes_Phase6RequiredFields()
        {
            const string json =
                "{" +
                "\"event\":\"unity.action.request\"," +
                "\"request_id\":\"req_phase6\"," +
                "\"thread_id\":\"thread_phase6\"," +
                "\"turn_id\":\"turn_phase6\"," +
                "\"timestamp\":\"2026-02-26T16:00:00.000Z\"," +
                "\"payload\":{" +
                "\"based_on_read_token\":\"tok_phase6_123456789012345678901234\"," +
                "\"requires_confirmation\":false," +
                "\"write_anchor\":{\"object_id\":\"go_root\",\"path\":\"Scene/Root\"}," +
                "\"action\":{" +
                "\"type\":\"add_component\"," +
                "\"target_anchor\":{\"object_id\":\"go_root\",\"path\":\"Scene/Root\"}," +
                "\"component_assembly_qualified_name\":\"UnityEngine.Transform, UnityEngine.CoreModule\"" +
                "}" +
                "}" +
                "}";

            var envelope = JsonUtility.FromJson<UnityActionRequestEnvelope>(json);

            Assert.NotNull(envelope);
            Assert.NotNull(envelope.payload);
            Assert.AreEqual("tok_phase6_123456789012345678901234", envelope.payload.based_on_read_token);
            Assert.NotNull(envelope.payload.write_anchor);
            Assert.AreEqual("go_root", envelope.payload.write_anchor.object_id);
            Assert.AreEqual("Scene/Root", envelope.payload.write_anchor.path);
            Assert.NotNull(envelope.payload.action);
            Assert.NotNull(envelope.payload.action.target_anchor);
            Assert.AreEqual("go_root", envelope.payload.action.target_anchor.object_id);
            Assert.AreEqual("Scene/Root", envelope.payload.action.target_anchor.path);
        }

        [Test]
        public void PollingEntry_IsGlobalBootstrap_NotWindowUpdateBound()
        {
            var bootstrapAttributes = typeof(UnityRagQueryPollingBootstrap)
                .GetCustomAttributes(typeof(InitializeOnLoadAttribute), false);
            Assert.IsNotNull(bootstrapAttributes);
            Assert.Greater(bootstrapAttributes.Length, 0);

            var controller = UnityRagQueryPollingBootstrap.GetController();
            Assert.NotNull(controller);

            var hookedField = typeof(UnityRagQueryPollingBootstrap).GetField(
                "_updateHooked",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(hookedField);
            Assert.IsTrue((bool)hookedField.GetValue(null));

            var chatWindowPath = Path.Combine(
                Directory.GetCurrentDirectory(),
                "Assets",
                "Editor",
                "Codex",
                "UI",
                "CodexChatWindow.cs");
            Assert.IsTrue(File.Exists(chatWindowPath));
            var source = File.ReadAllText(chatWindowPath);
            StringAssert.DoesNotContain("PollRagQueriesAsync(", source);
        }

        [Test]
        public void NormalizeUnityActionResultRequest_PreservesPhase6ReceiptCoreFields()
        {
            var request = new UnityActionResultRequest
            {
                @event = "unity.action.result",
                request_id = "req_phase6_result",
                thread_id = "thread_phase6",
                turn_id = "turn_phase6",
                timestamp = "2026-02-26T16:00:00.000Z",
                payload = new UnityActionResultPayload
                {
                    action_type = "add_component",
                    target_object_path = "Scene/Main Camera",
                    target_object_id = "go_main_camera",
                    object_id = "go_main_camera",
                    success = false,
                    error_code = "E_TARGET_ANCHOR_CONFLICT",
                    error_message = "Target anchor conflict: object_id and path resolve to different objects.",
                    duration_ms = 42,
                },
            };

            var method = typeof(HttpSidecarGateway).GetMethod(
                "NormalizeUnityActionResultRequest",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);

            var normalized = method.Invoke(null, new object[] { request }) as UnityActionResultRequest;

            Assert.NotNull(normalized);
            Assert.AreEqual("unity.action.result", normalized.@event);
            Assert.NotNull(normalized.payload);
            Assert.AreEqual("add_component", normalized.payload.action_type);
            Assert.AreEqual("Scene/Main Camera", normalized.payload.target_object_path);
            Assert.AreEqual("go_main_camera", normalized.payload.target_object_id);
            Assert.AreEqual("go_main_camera", normalized.payload.object_id);
            Assert.AreEqual("E_TARGET_ANCHOR_CONFLICT", normalized.payload.error_code);
            Assert.AreEqual(42, normalized.payload.duration_ms);
        }
    }
}

using System;
using System.Reflection;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityErrorFeedbackReceiptTests
    {
        [Test]
        public void NormalizeUnityActionResultRequest_PreservesSchemaCodeWithoutFolding()
        {
            var request = BuildFailedActionRequest(
                "E_SCHEMA_INVALID",
                string.Empty);

            var normalized = InvokePrivate<UnityActionResultRequest>(
                "NormalizeUnityActionResultRequest",
                request);

            Assert.NotNull(normalized);
            Assert.NotNull(normalized.payload);
            Assert.AreEqual("E_SCHEMA_INVALID", normalized.payload.error_code);
            Assert.AreEqual(
                "Visual action payload schema validation failed.",
                normalized.payload.error_message);
        }

        [Test]
        public void NormalizeUnityActionResultRequest_PreservesReceiptFieldsAndAnchorConflictTemplate()
        {
            var request = new UnityActionResultRequest
            {
                @event = "unity.action.result",
                request_id = "req_anchor_conflict_001",
                thread_id = "t_default",
                turn_id = "turn_anchor_conflict_001",
                timestamp = "2026-02-26T10:00:00.000Z",
                payload = new UnityActionResultPayload
                {
                    action_type = "add_component",
                    target = "Scene/Main Camera",
                    target_object_path = "Scene/Main Camera",
                    target_object_id = "go_main_camera",
                    object_id = "go_main_camera",
                    component_assembly_qualified_name =
                        "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
                    success = false,
                    error_code = "E_TARGET_ANCHOR_CONFLICT",
                    error_message = string.Empty,
                    duration_ms = 37,
                    write_receipt = new UnityWriteReceipt
                    {
                        schema_version = "write_receipt.v1",
                        success = false
                    }
                }
            };

            var normalized = InvokePrivate<UnityActionResultRequest>(
                "NormalizeUnityActionResultRequest",
                request);

            Assert.NotNull(normalized);
            Assert.NotNull(normalized.payload);

            Assert.AreEqual("unity.action.result", normalized.@event);
            Assert.AreEqual("req_anchor_conflict_001", normalized.request_id);
            Assert.AreEqual("t_default", normalized.thread_id);
            Assert.AreEqual("turn_anchor_conflict_001", normalized.turn_id);
            Assert.AreEqual("2026-02-26T10:00:00.000Z", normalized.timestamp);

            Assert.AreEqual("add_component", normalized.payload.action_type);
            Assert.AreEqual("Scene/Main Camera", normalized.payload.target);
            Assert.AreEqual("Scene/Main Camera", normalized.payload.target_object_path);
            Assert.AreEqual("go_main_camera", normalized.payload.target_object_id);
            Assert.AreEqual("go_main_camera", normalized.payload.object_id);
            Assert.AreEqual(
                "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
                normalized.payload.component_assembly_qualified_name);
            Assert.AreEqual(37, normalized.payload.duration_ms);
            Assert.AreEqual("E_TARGET_ANCHOR_CONFLICT", normalized.payload.error_code);
            Assert.AreEqual(
                "Target anchor conflict: object_id and path resolve to different objects.",
                normalized.payload.error_message);
            Assert.NotNull(normalized.payload.write_receipt);
            Assert.AreEqual("write_receipt.v1", normalized.payload.write_receipt.schema_version);
        }

        [Test]
        public void NormalizeUnityActionResultRequest_SanitizesMultilineErrorMessage()
        {
            var longTail = new string('x', 500);
            var request = BuildFailedActionRequest(
                "E_ACTION_EXECUTION_FAILED",
                "top line\r\nat stack frame one\nat stack frame two " + longTail);

            var normalized = InvokePrivate<UnityActionResultRequest>(
                "NormalizeUnityActionResultRequest",
                request);

            Assert.NotNull(normalized);
            Assert.NotNull(normalized.payload);
            Assert.AreEqual("E_ACTION_EXECUTION_FAILED", normalized.payload.error_code);
            Assert.False(normalized.payload.error_message.Contains("\r"));
            Assert.False(normalized.payload.error_message.Contains("\n"));
            Assert.True(normalized.payload.error_message.StartsWith("top line"));
            Assert.LessOrEqual(normalized.payload.error_message.Length, 320);
        }

        [Test]
        public void NormalizeUnityActionResultRequest_PreservesExtendedErrorCode()
        {
            var request = BuildFailedActionRequest(
                "E_ACTION_DESERIALIZE_FAILED",
                "action_data_json cannot parse");

            var normalized = InvokePrivate<UnityActionResultRequest>(
                "NormalizeUnityActionResultRequest",
                request);

            Assert.NotNull(normalized);
            Assert.NotNull(normalized.payload);
            Assert.AreEqual("E_ACTION_DESERIALIZE_FAILED", normalized.payload.error_code);
            Assert.AreEqual("action_data_json cannot parse", normalized.payload.error_message);
        }

        [Test]
        public void NormalizeUnityActionResultRequest_UsesMissingErrorCodeFallback()
        {
            var request = BuildFailedActionRequest(
                string.Empty,
                string.Empty);

            var normalized = InvokePrivate<UnityActionResultRequest>(
                "NormalizeUnityActionResultRequest",
                request);

            Assert.NotNull(normalized);
            Assert.NotNull(normalized.payload);
            Assert.AreEqual("E_ACTION_RESULT_MISSING_ERROR_CODE", normalized.payload.error_code);
            Assert.AreEqual("Unity action result missing error_code.", normalized.payload.error_message);
        }

        private static UnityActionResultRequest BuildFailedActionRequest(
            string errorCode,
            string errorMessage)
        {
            return new UnityActionResultRequest
            {
                @event = "unity.action.result",
                request_id = "req_test_001",
                thread_id = "t_default",
                turn_id = "turn_test_001",
                timestamp = "2026-02-26T10:00:00.000Z",
                payload = new UnityActionResultPayload
                {
                    action_type = "add_component",
                    target = "Scene/Root",
                    target_object_path = "Scene/Root",
                    target_object_id = "go_root",
                    object_id = "go_root",
                    component_assembly_qualified_name =
                        "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
                    success = false,
                    error_code = errorCode,
                    error_message = errorMessage,
                    duration_ms = 12
                }
            };
        }

        private static T InvokePrivate<T>(string methodName, params object[] args) where T : class
        {
            var method = typeof(HttpSidecarGateway).GetMethod(
                methodName,
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method, "Expected private method not found: " + methodName);

            var result = method.Invoke(null, args);
            return result as T;
        }
    }
}

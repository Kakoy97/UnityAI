using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class OperationHistoryStoreTests
    {
        private string _tempRoot;

        [SetUp]
        public void SetUp()
        {
            _tempRoot = Path.Combine(
                Path.GetTempPath(),
                "codex_operation_history_tests_" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(_tempRoot);
            OperationHistoryStore.ConfigureForTests(
                _tempRoot,
                retentionDays: 7,
                maxEntries: 1000,
                sessionId: "sess_test_fixed",
                nowUtc: new DateTime(2026, 3, 3, 10, 0, 0, DateTimeKind.Utc));
        }

        [TearDown]
        public void TearDown()
        {
            OperationHistoryStore.ResetTestOverrides();
            if (!string.IsNullOrWhiteSpace(_tempRoot) && Directory.Exists(_tempRoot))
            {
                Directory.Delete(_tempRoot, true);
            }
        }

        [Test]
        public void Append_WritesJsonlEntry_WithExpectedFields()
        {
            var request = BuildActionResultRequest("rename_object", true, string.Empty);
            var append = OperationHistoryStore.Append(request);

            Assert.IsTrue(append.Success, append.ErrorMessage);
            Assert.IsTrue(File.Exists(append.FilePath));

            var lines = File.ReadAllLines(append.FilePath);
            Assert.AreEqual(1, lines.Length);
            Assert.IsTrue(lines[0].Contains("\"schema_version\":\"operation_history.v1\""));
            Assert.IsTrue(lines[0].Contains("\"session_id\":\"sess_test_fixed\""));
            Assert.IsTrue(lines[0].Contains("\"action_type\":\"rename_object\""));
            Assert.IsTrue(lines[0].Contains("\"success\":true"));
            Assert.IsTrue(lines[0].Contains("\"request_id\":\"req_rename_object\""));
        }

        [Test]
        public void Append_EnforcesMaxEntriesBudget()
        {
            OperationHistoryStore.ConfigureForTests(
                _tempRoot,
                retentionDays: 7,
                maxEntries: 2,
                sessionId: "sess_test_fixed",
                nowUtc: new DateTime(2026, 3, 3, 10, 0, 0, DateTimeKind.Utc));

            OperationHistoryStore.Append(BuildActionResultRequest("set_active", true, string.Empty));
            OperationHistoryStore.Append(BuildActionResultRequest("rename_object", true, string.Empty));
            OperationHistoryStore.Append(BuildActionResultRequest("set_parent", false, "E_ACTION_EXECUTION_FAILED"));

            var files = Directory.GetFiles(_tempRoot, "*.jsonl");
            Assert.IsTrue(files.Length >= 1);
            var totalLines = files.Sum(file => File.ReadAllLines(file).Length);
            Assert.LessOrEqual(totalLines, 2);
        }

        [Test]
        public void Append_FailureEntry_PersistsObservabilityFields()
        {
            var request = BuildActionResultRequest(
                "create_object",
                false,
                "E_ACTION_SCHEMA_INVALID",
                "actions[0].parent_anchor.object_id is required");
            request.payload.field_path = "actions[0].parent_anchor.object_id";
            request.payload.anchor_snapshot = new UnityActionAnchorSnapshot
            {
                write_anchor = new UnityObjectAnchor
                {
                    object_id = "go_canvas",
                    path = "Scene/Canvas"
                },
                target_anchor = new UnityObjectAnchor
                {
                    object_id = "go_canvas",
                    path = "Scene/Canvas"
                },
                parent_anchor = new UnityObjectAnchor
                {
                    object_id = string.Empty,
                    path = "Scene/Canvas"
                }
            };

            var append = OperationHistoryStore.Append(request);
            Assert.IsTrue(append.Success, append.ErrorMessage);
            Assert.IsTrue(File.Exists(append.FilePath));

            var line = File.ReadAllText(append.FilePath);
            Assert.IsTrue(line.Contains("\"success\":false"));
            Assert.IsTrue(line.Contains("\"error_code\":\"E_ACTION_SCHEMA_INVALID\""));
            Assert.IsTrue(line.Contains("\"error_message\":\"actions[0].parent_anchor.object_id is required\""));
            Assert.IsTrue(line.Contains("\"field_path\":\"actions[0].parent_anchor.object_id\""));
            Assert.IsTrue(line.Contains("\"anchor_snapshot\":"));
            Assert.IsTrue(line.Contains("\"write_anchor\""));
            Assert.IsTrue(line.Contains("\"target_anchor\""));
            Assert.IsTrue(line.Contains("\"parent_anchor\""));
        }

        private static UnityActionResultRequest BuildActionResultRequest(
            string actionType,
            bool success,
            string errorCode,
            string errorMessage = "")
        {
            return new UnityActionResultRequest
            {
                @event = "unity.action.result",
                request_id = "req_" + actionType,
                thread_id = "t_default",
                turn_id = "turn_" + actionType,
                timestamp = "2026-03-03T10:00:00.000Z",
                payload = new UnityActionResultPayload
                {
                    action_type = actionType,
                    target_object_path = "Scene/Root",
                    target_object_id = "go_root",
                    object_id = "go_root",
                    created_object_path = string.Empty,
                    created_object_id = string.Empty,
                    component_assembly_qualified_name = string.Empty,
                    success = success,
                    error_code = errorCode,
                    error_message = errorMessage,
                    duration_ms = 12,
                    write_receipt = new UnityWriteReceipt
                    {
                        schema_version = "write_receipt.v1",
                        success = success,
                    }
                }
            };
        }
    }
}

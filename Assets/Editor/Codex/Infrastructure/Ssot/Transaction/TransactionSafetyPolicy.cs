using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction
{
    internal sealed class TransactionSafetyPolicy
    {
        private sealed class Snapshot
        {
            internal readonly HashSet<string> ActiveToolNames =
                new HashSet<string>(StringComparer.Ordinal);
            internal readonly HashSet<string> DeprecatedToolNames =
                new HashSet<string>(StringComparer.Ordinal);
            internal readonly HashSet<string> RemovedToolNames =
                new HashSet<string>(StringComparer.Ordinal);
            internal readonly HashSet<string> DisabledToolNames =
                new HashSet<string>(StringComparer.Ordinal);
            internal readonly HashSet<string> TransactionEnabledWriteToolNames =
                new HashSet<string>(StringComparer.Ordinal);
            internal string LoadErrorMessage = string.Empty;
        }

        private static readonly object SnapshotGate = new object();
        private static Snapshot _snapshot;

        internal bool Validate(
            TransactionPlan plan,
            out string errorCode,
            out string errorMessage,
            out int failedStepIndex,
            out string failedStepId,
            out string failedToolName)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;
            failedStepIndex = -1;
            failedStepId = string.Empty;
            failedToolName = string.Empty;

            if (plan == null || plan.Steps == null)
            {
                errorCode = "E_TRANSACTION_STEP_TOOL_FORBIDDEN";
                errorMessage = "transaction safety policy requires a valid plan.";
                return false;
            }

            var snapshot = GetSnapshot();
            if (!string.IsNullOrEmpty(snapshot.LoadErrorMessage))
            {
                errorCode = "E_TRANSACTION_STEP_TOOL_FORBIDDEN";
                errorMessage = snapshot.LoadErrorMessage;
                return false;
            }

            for (var index = 0; index < plan.Steps.Count; index += 1)
            {
                var step = plan.Steps[index];
                var toolName = step == null ? string.Empty : step.ToolName;
                if (!IsToolAllowed(toolName, snapshot, out errorMessage))
                {
                    errorCode = "E_TRANSACTION_STEP_TOOL_FORBIDDEN";
                    failedStepIndex = step == null ? index : step.StepIndex;
                    failedStepId = step == null ? string.Empty : step.StepId;
                    failedToolName = toolName ?? string.Empty;
                    return false;
                }
            }

            return true;
        }

        private static bool IsToolAllowed(string toolName, Snapshot snapshot, out string message)
        {
            message = string.Empty;
            if (string.IsNullOrEmpty(toolName))
            {
                message = "transaction step tool_name is required.";
                return false;
            }

            if (snapshot.DeprecatedToolNames.Contains(toolName))
            {
                message = "deprecated tool is blocked in transaction: " + toolName;
                return false;
            }

            if (snapshot.RemovedToolNames.Contains(toolName))
            {
                message = "removed tool is blocked in transaction: " + toolName;
                return false;
            }

            if (snapshot.DisabledToolNames.Contains(toolName))
            {
                message = "disabled tool is blocked in transaction: " + toolName;
                return false;
            }

            if (!snapshot.ActiveToolNames.Contains(toolName))
            {
                message = "inactive tool is blocked in transaction: " + toolName;
                return false;
            }

            if (!snapshot.TransactionEnabledWriteToolNames.Contains(toolName))
            {
                message = "tool is not transaction-enabled write: " + toolName;
                return false;
            }

            return true;
        }

        private static Snapshot GetSnapshot()
        {
            lock (SnapshotGate)
            {
                if (_snapshot != null)
                {
                    return _snapshot;
                }

                _snapshot = LoadSnapshot();
                return _snapshot;
            }
        }

        private static Snapshot LoadSnapshot()
        {
            var snapshot = new Snapshot();
            try
            {
                var projectRoot = Directory.GetParent(UnityEngine.Application.dataPath).FullName;
                var visibilityPolicyPath = Path.Combine(
                    projectRoot,
                    "ssot",
                    "artifacts",
                    "l2",
                    "visibility-policy.generated.json");
                var sidecarManifestPath = Path.Combine(
                    projectRoot,
                    "ssot",
                    "artifacts",
                    "l2",
                    "sidecar-command-manifest.generated.json");

                if (!TryLoadVisibilityPolicy(snapshot, visibilityPolicyPath, out var visibilityError))
                {
                    snapshot.LoadErrorMessage = visibilityError;
                    return snapshot;
                }

                if (!TryLoadSidecarManifest(snapshot, sidecarManifestPath, out var sidecarError))
                {
                    snapshot.LoadErrorMessage = sidecarError;
                    return snapshot;
                }
            }
            catch (Exception ex)
            {
                snapshot.LoadErrorMessage = "transaction safety policy load failed: " + ex.Message;
            }

            return snapshot;
        }

        private static bool TryLoadVisibilityPolicy(
            Snapshot snapshot,
            string visibilityPolicyPath,
            out string errorMessage)
        {
            errorMessage = string.Empty;
            if (!File.Exists(visibilityPolicyPath))
            {
                errorMessage = "visibility policy artifact not found: " + visibilityPolicyPath;
                return false;
            }

            var raw = File.ReadAllText(visibilityPolicyPath);
            if (!TransactionJson.TryParseObject(raw, out var root, out var parseError))
            {
                errorMessage = "visibility policy artifact parse failed: " + parseError;
                return false;
            }

            ReadStringSet(root, "active_tool_names", snapshot.ActiveToolNames);
            ReadStringSet(root, "deprecated_tool_names", snapshot.DeprecatedToolNames);
            ReadStringSet(root, "removed_tool_names", snapshot.RemovedToolNames);
            ReadStringSet(root, "disabled_tools", snapshot.DisabledToolNames);
            return true;
        }

        private static bool TryLoadSidecarManifest(
            Snapshot snapshot,
            string sidecarManifestPath,
            out string errorMessage)
        {
            errorMessage = string.Empty;
            if (!File.Exists(sidecarManifestPath))
            {
                errorMessage = "sidecar command manifest artifact not found: " + sidecarManifestPath;
                return false;
            }

            var raw = File.ReadAllText(sidecarManifestPath);
            if (!TransactionJson.TryParseObject(raw, out var root, out var parseError))
            {
                errorMessage = "sidecar command manifest parse failed: " + parseError;
                return false;
            }

            if (!root.TryGetValue("commands", out var commandsNode) || !(commandsNode is List<object> commands))
            {
                errorMessage = "sidecar command manifest is missing commands array.";
                return false;
            }

            for (var index = 0; index < commands.Count; index += 1)
            {
                if (!(commands[index] is Dictionary<string, object> command))
                {
                    continue;
                }

                var name = ReadString(command, "name");
                var kind = ReadString(command, "kind");
                if (string.IsNullOrEmpty(name) || !string.Equals(kind, "write", StringComparison.Ordinal))
                {
                    continue;
                }

                if (!command.TryGetValue("transaction", out var transactionNode) ||
                    !(transactionNode is Dictionary<string, object> transaction))
                {
                    continue;
                }

                var enabled = ReadBool(transaction, "enabled");
                var undoSafe = ReadBool(transaction, "undo_safe");
                if (enabled && undoSafe)
                {
                    snapshot.TransactionEnabledWriteToolNames.Add(name);
                }
            }

            return true;
        }

        private static void ReadStringSet(
            Dictionary<string, object> source,
            string key,
            ISet<string> output)
        {
            if (!source.TryGetValue(key, out var node) || !(node is List<object> values))
            {
                return;
            }

            for (var index = 0; index < values.Count; index += 1)
            {
                if (!(values[index] is string value) || string.IsNullOrEmpty(value))
                {
                    continue;
                }

                output.Add(value);
            }
        }

        private static string ReadString(Dictionary<string, object> source, string key)
        {
            if (!source.TryGetValue(key, out var node))
            {
                return string.Empty;
            }

            return node as string ?? string.Empty;
        }

        private static bool ReadBool(Dictionary<string, object> source, string key)
        {
            if (!source.TryGetValue(key, out var node))
            {
                return false;
            }

            return node is bool value && value;
        }
    }
}

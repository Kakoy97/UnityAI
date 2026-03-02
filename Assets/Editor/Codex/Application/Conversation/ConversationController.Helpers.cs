using System;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Application
{
    public sealed partial class ConversationController
    {
        private static string BuildCapabilityVersion(IReadOnlyList<McpActionCapability> capabilities)
        {
            var sb = new StringBuilder();
            if (capabilities != null)
            {
                for (var i = 0; i < capabilities.Count; i++)
                {
                    var item = capabilities[i];
                    if (item == null)
                    {
                        continue;
                    }

                    sb.Append(item.ActionType ?? string.Empty);
                    sb.Append('|');
                    sb.Append(item.AnchorPolicy ?? string.Empty);
                    sb.Append('|');
                    sb.Append(item.Description ?? string.Empty);
                    sb.Append('|');
                    sb.Append(item.ActionDataSchemaJson ?? "{}");
                    sb.Append('|');
                    sb.Append(item.Domain ?? string.Empty);
                    sb.Append('|');
                    sb.Append(item.Tier ?? string.Empty);
                    sb.Append('|');
                    sb.Append(item.Lifecycle ?? string.Empty);
                    sb.Append('|');
                    sb.Append(item.UndoSafety ?? string.Empty);
                    sb.Append('|');
                    sb.Append(item.ReplacementActionType ?? string.Empty);
                    sb.Append('\n');
                }
            }

            var raw = Encoding.UTF8.GetBytes(sb.ToString());
            using (var sha = SHA256.Create())
            {
                var hash = sha.ComputeHash(raw);
                var hex = new StringBuilder(hash.Length * 2);
                for (var i = 0; i < hash.Length; i++)
                {
                    hex.Append(hash[i].ToString("x2"));
                }

                return "sha256:" + hex.ToString();
            }
        }

        private static UnityCapabilityActionItem[] BuildCapabilityActionItems(
            IReadOnlyList<McpActionCapability> capabilities)
        {
            if (capabilities == null || capabilities.Count == 0)
            {
                return new UnityCapabilityActionItem[0];
            }

            var items = new List<UnityCapabilityActionItem>(capabilities.Count);
            for (var i = 0; i < capabilities.Count; i++)
            {
                var capability = capabilities[i];
                if (capability == null || string.IsNullOrWhiteSpace(capability.ActionType))
                {
                    continue;
                }

                items.Add(
                    new UnityCapabilityActionItem
                    {
                        type = capability.ActionType,
                        description = capability.Description ?? string.Empty,
                        anchor_policy = capability.AnchorPolicy ?? string.Empty,
                        domain = capability.Domain ?? string.Empty,
                        tier = capability.Tier ?? string.Empty,
                        lifecycle = capability.Lifecycle ?? string.Empty,
                        undo_safety = capability.UndoSafety ?? string.Empty,
                        replacement_action_type = capability.ReplacementActionType ?? string.Empty,
                        action_data_schema = ParseCapabilityActionDataSchema(
                            capability.ActionDataSchemaJson),
                    });
            }

            return items.ToArray();
        }

        private static UnityActionDataSchema ParseCapabilityActionDataSchema(string rawJson)
        {
            var json = string.IsNullOrWhiteSpace(rawJson)
                ? "{}"
                : rawJson.Trim();
            UnityActionDataSchema parsed = null;
            try
            {
                parsed = JsonUtility.FromJson<UnityActionDataSchema>(json);
            }
            catch
            {
                parsed = null;
            }

            if (parsed == null)
            {
                parsed = new UnityActionDataSchema();
            }

            parsed.type = string.IsNullOrWhiteSpace(parsed.type) ? "object" : parsed.type.Trim();
            if (parsed.required == null)
            {
                parsed.required = new string[0];
            }

            if (parsed.properties == null)
            {
                parsed.properties = new UnityActionDataSchemaProperty[0];
            }

            return parsed;
        }

        private static string FirstNonEmpty(params string[] values)
        {
            if (values == null || values.Length == 0)
            {
                return string.Empty;
            }

            for (var i = 0; i < values.Length; i++)
            {
                var item = values[i];
                if (string.IsNullOrWhiteSpace(item))
                {
                    continue;
                }

                return item.Trim();
            }

            return string.Empty;
        }

        private static string NormalizeErrorCodeForTransport(string value, string fallback)
        {
            var normalized = string.IsNullOrWhiteSpace(value)
                ? string.Empty
                : value.Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(normalized))
            {
                return fallback;
            }

            if (string.Equals(normalized, "UNITY_BUSY_OR_COMPILING", StringComparison.Ordinal))
            {
                return UnityQueryErrorBusyOrCompiling;
            }

            if (string.Equals(normalized, "TARGET_NOT_FOUND", StringComparison.Ordinal))
            {
                return UnityQueryErrorTargetNotFound;
            }

            if (string.Equals(normalized, "UNITY_QUERY_FAILED", StringComparison.Ordinal))
            {
                return UnityQueryErrorFailed;
            }

            if (string.Equals(normalized, "E_ACTION_TARGET_NOT_FOUND", StringComparison.Ordinal))
            {
                return "E_TARGET_NOT_FOUND";
            }

            return normalized;
        }

        private static string NormalizeErrorMessageForTransport(string value, string fallback)
        {
            var sanitized = SanitizeSingleLine(value, MaxTransportErrorMessageLength);
            return string.IsNullOrEmpty(sanitized)
                ? fallback
                : sanitized;
        }

        private static string SanitizeSingleLine(string value, int maxLength)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
            if (string.IsNullOrEmpty(normalized))
            {
                return string.Empty;
            }

            var lines = normalized.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var singleLine = lines.Length > 0 ? lines[0].Trim() : normalized;
            if (singleLine.Length <= maxLength)
            {
                return singleLine;
            }

            return singleLine.Substring(0, maxLength).TrimEnd();
        }

        private static string BuildSelectedPath(GameObject selected)
        {
            if (selected == null)
            {
                return string.Empty;
            }

            var current = selected.transform;
            var path = current.name;
            while (current.parent != null)
            {
                current = current.parent;
                path = current.name + "/" + path;
            }

            return "Scene/" + path;
        }

        private static string BuildObjectId(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            try
            {
                var globalId = GlobalObjectId.GetGlobalObjectIdSlow(gameObject);
                var text = globalId.ToString();
                return string.IsNullOrEmpty(text) ? string.Empty : text;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static UnitySelectionComponentIndexItem[] BuildSelectionComponentIndex(
            GameObject selected,
            int maxDepth,
            int nodeBudget)
        {
            if (selected == null || selected.transform == null)
            {
                return new UnitySelectionComponentIndexItem[0];
            }

            var depthLimit = maxDepth < 0 ? 0 : maxDepth;
            var budget = nodeBudget <= 0 ? 1 : nodeBudget;
            var items = new List<UnitySelectionComponentIndexItem>(Math.Min(budget, 64));
            AppendSelectionComponentIndex(
                selected.transform,
                0,
                depthLimit,
                budget,
                items);
            return items.ToArray();
        }

        private static void AppendSelectionComponentIndex(
            Transform transform,
            int depth,
            int depthLimit,
            int nodeBudget,
            List<UnitySelectionComponentIndexItem> sink)
        {
            if (transform == null || sink == null)
            {
                return;
            }

            if (sink.Count >= nodeBudget)
            {
                return;
            }

            sink.Add(
                new UnitySelectionComponentIndexItem
                {
                    object_id = BuildObjectId(transform.gameObject),
                    path = BuildSelectedPath(transform.gameObject),
                    name = transform.name,
                    depth = depth,
                    prefab_path = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(transform.gameObject) ?? string.Empty,
                    components = GetComponentDescriptors(transform)
                });

            if (depth >= depthLimit)
            {
                return;
            }

            for (var i = 0; i < transform.childCount; i++)
            {
                if (sink.Count >= nodeBudget)
                {
                    return;
                }

                var child = transform.GetChild(i);
                AppendSelectionComponentIndex(
                    child,
                    depth + 1,
                    depthLimit,
                    nodeBudget,
                    sink);
            }
        }

        private static UnityComponentDescriptor[] GetComponentDescriptors(Transform transform)
        {
            if (transform == null)
            {
                return new UnityComponentDescriptor[0];
            }

            Component[] components;
            try
            {
                components = transform.GetComponents<Component>();
            }
            catch
            {
                return new UnityComponentDescriptor[0];
            }

            var descriptors = new List<UnityComponentDescriptor>(components.Length);
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    descriptors.Add(
                        new UnityComponentDescriptor
                        {
                            short_name = MissingScriptShortName,
                            assembly_qualified_name = MissingScriptAssemblyQualifiedName
                        });
                    continue;
                }

                var type = component.GetType();
                if (type == null)
                {
                    continue;
                }

                descriptors.Add(
                    new UnityComponentDescriptor
                    {
                        short_name = !string.IsNullOrEmpty(type.Name) ? type.Name : "-",
                        assembly_qualified_name = BuildAssemblyQualifiedName(type)
                    });
            }

            return descriptors.ToArray();
        }

        private static bool IsTerminalStatus(TurnStatusResponse status)
        {
            if (status == null)
            {
                return false;
            }

            var normalizedState = NormalizeGatewayState(
                status.state,
                status.status,
                status.error_code);
            return normalizedState == "completed" ||
                   normalizedState == "cancelled" ||
                   normalizedState == "error";
        }

        private static string SafeString(string value)
        {
            return string.IsNullOrEmpty(value) ? "-" : value;
        }

        private static string NormalizeAssistantMessage(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            return value.Replace("\r\n", "\n").Trim();
        }

        private static string BuildErrorCodeSuffix(string errorCode)
        {
            if (string.IsNullOrEmpty(errorCode))
            {
                return string.Empty;
            }

            return " (" + errorCode + ")";
        }

        private async Task TryAutoReportCompileResultAsync()
        {
            if (!CanReportCompileResult || _compileResultAutoReportInFlight)
            {
                return;
            }

            var now = EditorApplicationTimeFallback();
            if (!EditorApplication.isCompiling)
            {
                if (!_compileRefreshIssued)
                {
                    AddLog(UiLogLevel.Info, "Compile pending: issuing refresh for recovered compile gate.");
                    AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                    _compileRefreshIssued = true;
                    _lastCompileRefreshAt = now;
                    return;
                }

                const double refreshRetryIntervalSeconds = 20d;
                if (!HasCompileFinishedForCurrentGate() &&
                    _lastCompileRefreshAt > 0d &&
                    now - _lastCompileRefreshAt >= refreshRetryIntervalSeconds)
                {
                    AddLog(UiLogLevel.Warning, "Compile pending too long. Re-triggering AssetDatabase.Refresh().");
                    AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                    _lastCompileRefreshAt = now;
                    return;
                }
            }

            if (EditorApplication.isCompiling)
            {
                return;
            }

            if (!HasCompileFinishedForCurrentGate() && !CanInferCompileSuccessFromLoadedType())
            {
                return;
            }

            _compileResultAutoReportInFlight = true;
            try
            {
                if (!HasCompileFinishedForCurrentGate() && CanInferCompileSuccessFromLoadedType())
                {
                    AddLog(UiLogLevel.Warning, "Compile finish event missing; inferred success from resolved component type.");
                    await ReportCompileResultAsync(true);
                    return;
                }

                if (HasCompileErrorsForCurrentGate())
                {
                    var errorCount = UnityCompilationStateTracker.GetLastCompilationErrorCountSince(_compileGateOpenedAtUtcTicks);
                    AddLog(UiLogLevel.Warning, "Auto report compile failure (" + errorCount + " error(s)).");
                    var errors = BuildCompileErrorItemsForReport(false);
                    if (errors.Length > 0 && errors[0] != null)
                    {
                        AddLog(
                            UiLogLevel.Warning,
                            "First compile error: " + errors[0].code + " " + errors[0].message);
                    }
                    await ReportCompileResultAsync(false);
                    return;
                }

                AddLog(UiLogLevel.Info, "Auto report compile success.");
                await ReportCompileResultAsync(true);
            }
            finally
            {
                _compileResultAutoReportInFlight = false;
            }
        }

        private void MaybeLogCompilePendingHeartbeat(double now)
        {
            const double heartbeatIntervalSeconds = 8d;
            if (_lastCompilePendingHeartbeatAt > 0d && now - _lastCompilePendingHeartbeatAt < heartbeatIntervalSeconds)
            {
                return;
            }

            _lastCompilePendingHeartbeatAt = now;
            if (EditorApplication.isCompiling)
            {
                AddLog(UiLogLevel.Info, "Compile pending: Unity is compiling...");
                return;
            }

            if (!HasCompileFinishedForCurrentGate())
            {
                AddLog(UiLogLevel.Info, "Compile pending: waiting for Unity compile to complete...");
            }
        }

        private bool CanInferCompileSuccessFromLoadedType()
        {
            var assemblyQualifiedName = _pendingCompileComponentAssemblyQualifiedName;
            if (string.IsNullOrEmpty(assemblyQualifiedName))
            {
                return false;
            }

            var type = ResolveComponentType(assemblyQualifiedName);
            return type != null;
        }

        private static Type ResolveComponentType(string componentAssemblyQualifiedName)
        {
            if (string.IsNullOrEmpty(componentAssemblyQualifiedName))
            {
                return null;
            }

            var exact = Type.GetType(componentAssemblyQualifiedName, false);
            if (IsValidComponentType(exact))
            {
                return exact;
            }

            var rawTypeName = ExtractRawTypeName(componentAssemblyQualifiedName);
            if (string.IsNullOrEmpty(rawTypeName))
            {
                return null;
            }

            var shortTypeName = ExtractShortTypeName(rawTypeName);
            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (var i = 0; i < assemblies.Length; i++)
            {
                var assembly = assemblies[i];
                Type[] types;
                try
                {
                    types = assembly.GetTypes();
                }
                catch (ReflectionTypeLoadException rtl)
                {
                    types = rtl.Types;
                }
                catch
                {
                    continue;
                }

                if (types == null)
                {
                    continue;
                }

                for (var j = 0; j < types.Length; j++)
                {
                    var type = types[j];
                    if (!IsValidComponentType(type))
                    {
                        continue;
                    }

                    if (string.Equals(type.AssemblyQualifiedName, componentAssemblyQualifiedName, StringComparison.Ordinal))
                    {
                        return type;
                    }

                    if (string.Equals(type.FullName, rawTypeName, StringComparison.Ordinal))
                    {
                        return type;
                    }

                    if (string.Equals(type.Name, rawTypeName, StringComparison.Ordinal))
                    {
                        return type;
                    }

                    if (!string.IsNullOrEmpty(shortTypeName) &&
                        string.Equals(type.Name, shortTypeName, StringComparison.Ordinal))
                    {
                        return type;
                    }
                }
            }

            return null;
        }

        private static bool IsValidComponentType(Type type)
        {
            return type != null && !type.IsAbstract && typeof(Component).IsAssignableFrom(type);
        }

        private static string ExtractRawTypeName(string assemblyQualifiedName)
        {
            if (string.IsNullOrEmpty(assemblyQualifiedName))
            {
                return string.Empty;
            }

            var commaIndex = assemblyQualifiedName.IndexOf(',');
            if (commaIndex <= 0)
            {
                return assemblyQualifiedName.Trim();
            }

            return assemblyQualifiedName.Substring(0, commaIndex).Trim();
        }

        private static string ExtractShortTypeName(string rawTypeName)
        {
            if (string.IsNullOrEmpty(rawTypeName))
            {
                return string.Empty;
            }

            var lastDotIndex = rawTypeName.LastIndexOf('.');
            if (lastDotIndex < 0 || lastDotIndex == rawTypeName.Length - 1)
            {
                return rawTypeName;
            }

            return rawTypeName.Substring(lastDotIndex + 1);
        }
    }
}


using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class SsotDispatcherBindingsContractTests
    {
        private static readonly HashSet<string> UnsupportedToolNames =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "instantiate_prefab",
                "get_action_catalog",
                "get_action_schema",
                "get_tool_schema",
                "get_write_contract_bundle",
                "preflight_validate_write_payload",
                "setup_cursor_mcp",
                "verify_mcp_setup",
                "run_unity_tests",
                "get_unity_task_status",
                "cancel_unity_task",
                "submit_unity_task",
                "apply_script_actions",
            };

        private static readonly HashSet<string> DeprecatedToolNames =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "apply_visual_actions",
                "set_ui_properties",
            };

        [Test]
        public void DispatchBindings_CoversAllGeneratedRequestDtos()
        {
            var expectedToolNames = GetGeneratedRequestToolNames();
            var bindings = CreateBindingMap();
            var actualToolNames = new HashSet<string>(bindings.Keys, StringComparer.Ordinal);

            CollectionAssert.AreEquivalent(expectedToolNames, actualToolNames);
            foreach (var pair in bindings)
            {
                Assert.NotNull(pair.Value, "Binding instance is null for tool: " + pair.Key);
                Assert.AreEqual(
                    pair.Key,
                    pair.Value.ToolName,
                    "Binding tool_name drift for tool: " + pair.Key);
            }
        }

        [Test]
        public void DispatchBindings_UsesExplicitStrategyPerTool()
        {
            var bindings = CreateBindingMap();
            foreach (var pair in bindings)
            {
                var toolName = pair.Key;
                var normalizedToolName = string.IsNullOrEmpty(toolName) ? string.Empty : toolName.Trim();
                var bindingTypeName = pair.Value.GetType().Name;

                if (UnsupportedToolNames.Contains(normalizedToolName) ||
                    string.Equals(
                        normalizedToolName,
                        RunUnityTestsRequestDto.ToolName,
                        StringComparison.Ordinal))
                {
                    Assert.AreEqual(
                        "UnsupportedDispatchBinding",
                        bindingTypeName,
                        "Unsupported strategy drift for tool: " + normalizedToolName);
                    continue;
                }

                if (DeprecatedToolNames.Contains(normalizedToolName))
                {
                    StringAssert.StartsWith(
                        "DeprecatedDispatchBinding",
                        bindingTypeName,
                        "Deprecated strategy drift for tool: " + normalizedToolName);
                    continue;
                }

                StringAssert.StartsWith(
                    "ExecutorDispatchBinding",
                    bindingTypeName,
                    "Executor strategy drift for tool: " + normalizedToolName);
            }
        }

        private static IReadOnlyDictionary<string, ISsotDispatchBinding> CreateBindingMap()
        {
            return SsotDispatchBindings.CreateBindingMap(
                new DefaultSsotExecutorFactory(),
                (toolName, payloadJson) => null);
        }

        private static HashSet<string> GetGeneratedRequestToolNames()
        {
            var dtoAssembly = typeof(SsotToolEnvelopeDto).Assembly;
            var expectedToolNames = new HashSet<string>(StringComparer.Ordinal);
            var dtoTypes = dtoAssembly.GetTypes()
                .Where(type =>
                    type != null &&
                    type.IsClass &&
                    type.Namespace == "UnityAI.Editor.Codex.Generated.Ssot" &&
                    type.Name.EndsWith("RequestDto", StringComparison.Ordinal));

            foreach (var type in dtoTypes)
            {
                var toolField = type.GetField(
                    "ToolName",
                    BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy);
                if (toolField == null || toolField.FieldType != typeof(string))
                {
                    continue;
                }

                var toolName = Convert.ToString(toolField.GetValue(null));
                if (!string.IsNullOrEmpty(toolName))
                {
                    expectedToolNames.Add(toolName);
                }
            }

            return expectedToolNames;
        }
    }
}

using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class PrimitiveActionCoverageTests
    {
        private static readonly string[] CanonicalPhase2ActionTypes =
        {
            "create_object",
            "destroy_object",
            "rename_object",
            "set_active",
            "set_parent",
            "set_sibling_index",
            "duplicate_object",
            "add_component",
            "remove_component",
            "replace_component",
            "set_local_position",
            "set_local_rotation",
            "set_local_scale",
            "set_world_position",
            "set_world_rotation",
            "reset_transform",
            "set_rect_anchored_position",
            "set_rect_size_delta",
            "set_rect_pivot",
            "set_rect_anchors",
        };

        private static readonly Dictionary<string, string> DeprecatedAliasMap =
            new Dictionary<string, string>(StringComparer.Ordinal)
            {
                { "create_gameobject", "create_object" },
                { "destroy_gameobject", "destroy_object" },
                { "rename_gameobject", "rename_object" },
                { "set_gameobject_active", "set_active" },
                { "set_transform_local_position", "set_local_position" },
                { "set_transform_local_rotation", "set_local_rotation" },
                { "set_transform_local_scale", "set_local_scale" },
                { "set_transform_world_position", "set_world_position" },
                { "set_transform_world_rotation", "set_world_rotation" },
                { "set_rect_transform_anchored_position", "set_rect_anchored_position" },
                { "set_rect_transform_size_delta", "set_rect_size_delta" },
                { "set_rect_transform_pivot", "set_rect_pivot" },
                { "set_rect_transform_anchors", "set_rect_anchors" },
            };

        [Test]
        public void BootstrapRegistry_ContainsCanonicalPhase2Primitives_AsStableAtomicSafe()
        {
            var registry = McpActionRegistryBootstrap.Registry;
            var capabilities = McpActionRegistryBootstrap.GetCapabilities();
            var capabilityByType = new Dictionary<string, McpActionCapability>(StringComparer.Ordinal);
            for (var i = 0; i < capabilities.Count; i++)
            {
                var capability = capabilities[i];
                if (capability == null || string.IsNullOrWhiteSpace(capability.ActionType))
                {
                    continue;
                }

                capabilityByType[capability.ActionType] = capability;
            }

            for (var i = 0; i < CanonicalPhase2ActionTypes.Length; i++)
            {
                var actionType = CanonicalPhase2ActionTypes[i];
                IMcpVisualActionHandler handler;
                Assert.IsTrue(registry.TryGet(actionType, out handler), "Missing handler: " + actionType);
                Assert.NotNull(handler, "Handler should not be null: " + actionType);
                Assert.AreEqual(actionType, handler.ActionType, "Handler action type mismatch: " + actionType);

                McpActionCapability capability;
                Assert.IsTrue(capabilityByType.TryGetValue(actionType, out capability), "Missing capability: " + actionType);
                Assert.NotNull(capability, "Capability should not be null: " + actionType);
                Assert.AreEqual(McpActionGovernance.LifecycleStable, capability.Lifecycle, "Canonical lifecycle mismatch: " + actionType);
                Assert.AreEqual(
                    McpActionGovernance.UndoSafetyAtomicSafe,
                    capability.UndoSafety,
                    "Canonical undo_safety mismatch: " + actionType);
            }
        }

        [Test]
        public void BootstrapRegistry_DeprecatedAliases_ExposeReplacementActionType()
        {
            var capabilities = McpActionRegistryBootstrap.GetCapabilities();
            var capabilityByType = new Dictionary<string, McpActionCapability>(StringComparer.Ordinal);
            for (var i = 0; i < capabilities.Count; i++)
            {
                var capability = capabilities[i];
                if (capability == null || string.IsNullOrWhiteSpace(capability.ActionType))
                {
                    continue;
                }

                capabilityByType[capability.ActionType] = capability;
            }

            foreach (var alias in DeprecatedAliasMap)
            {
                McpActionCapability capability;
                Assert.IsTrue(capabilityByType.TryGetValue(alias.Key, out capability), "Missing alias capability: " + alias.Key);
                Assert.NotNull(capability, "Alias capability should not be null: " + alias.Key);
                Assert.AreEqual(McpActionGovernance.LifecycleDeprecated, capability.Lifecycle, "Alias lifecycle mismatch: " + alias.Key);
                Assert.AreEqual(alias.Value, capability.ReplacementActionType, "Alias replacement mismatch: " + alias.Key);
            }
        }

        [Test]
        public void Execute_SetParent_Succeeds()
        {
            var root = new GameObject("__R16_P2_ROOT_set_parent");
            var sourceParent = new GameObject("__R16_P2_PARENT_source");
            var targetParent = new GameObject("__R16_P2_PARENT_target");
            sourceParent.transform.SetParent(root.transform, false);
            targetParent.transform.SetParent(root.transform, false);
            var target = new GameObject("__R16_P2_TARGET_set_parent");
            target.transform.SetParent(sourceParent.transform, false);

            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = new VisualLayerActionItem
                {
                    type = "set_parent",
                    target_anchor = BuildAnchor(target),
                    parent_anchor = BuildAnchor(targetParent),
                    action_data_json = "{\"world_position_stays\":false}",
                };

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success, result == null ? string.Empty : result.errorMessage);
                Assert.AreEqual(targetParent.transform, target.transform.parent);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSiblingIndex_Succeeds()
        {
            var root = new GameObject("__R16_P2_ROOT_sibling");
            var first = new GameObject("__R16_P2_CHILD_first");
            var second = new GameObject("__R16_P2_CHILD_second");
            var third = new GameObject("__R16_P2_CHILD_third");
            first.transform.SetParent(root.transform, false);
            second.transform.SetParent(root.transform, false);
            third.transform.SetParent(root.transform, false);

            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = new VisualLayerActionItem
                {
                    type = "set_sibling_index",
                    target_anchor = BuildAnchor(third),
                    action_data_json = "{\"sibling_index\":0}",
                };

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success, result == null ? string.Empty : result.errorMessage);
                Assert.AreEqual(0, third.transform.GetSiblingIndex());
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_DuplicateObject_Succeeds()
        {
            var root = new GameObject("__R16_P2_ROOT_duplicate");
            var target = new GameObject("__R16_P2_TARGET_duplicate");
            target.transform.SetParent(root.transform, false);

            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = new VisualLayerActionItem
                {
                    type = "duplicate_object",
                    target_anchor = BuildAnchor(target),
                    action_data_json = "{\"name\":\"__R16_P2_DUPLICATE_copy\"}",
                };

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success, result == null ? string.Empty : result.errorMessage);
                Assert.AreEqual(2, root.transform.childCount);

                var duplicate = root.transform.GetChild(1).gameObject;
                Assert.AreEqual("__R16_P2_DUPLICATE_copy", duplicate.name);
                Assert.AreNotEqual(target, duplicate);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_ResetTransform_Succeeds()
        {
            var root = new GameObject("__R16_P2_ROOT_reset");
            var target = new GameObject("__R16_P2_TARGET_reset");
            target.transform.SetParent(root.transform, false);
            target.transform.localPosition = new Vector3(3f, -2f, 7f);
            target.transform.localRotation = Quaternion.Euler(11f, 27f, 39f);
            target.transform.localScale = new Vector3(1.2f, 0.8f, 2.1f);

            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = new VisualLayerActionItem
                {
                    type = "reset_transform",
                    target_anchor = BuildAnchor(target),
                    action_data_json = "{}",
                };

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success, result == null ? string.Empty : result.errorMessage);
                Assert.AreEqual(Vector3.zero, target.transform.localPosition);
                Assert.AreEqual(Quaternion.identity, target.transform.localRotation);
                Assert.AreEqual(Vector3.one, target.transform.localScale);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(root);
            }
        }

        private static UnityObjectAnchor BuildAnchor(GameObject target)
        {
            return new UnityObjectAnchor
            {
                object_id = BuildObjectId(target),
                path = BuildPath(target),
            };
        }

        private static string BuildObjectId(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            return GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();
        }

        private static string BuildPath(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            var current = target.transform;
            var path = current.name;
            while (current.parent != null)
            {
                current = current.parent;
                path = current.name + "/" + path;
            }

            return "Scene/" + path;
        }
    }
}

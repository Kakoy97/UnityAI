using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class CompositeVisualActionHandlerTests
    {
        [Test]
        public void Execute_CompositeAction_Succeeds_WithAliasReference()
        {
            var root = new GameObject("R10_L3_ROOT_SUCCESS");
            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = BuildCompositeAction(
                    root,
                    "R10_L3_CHILD_OK",
                    "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
                    failStep2: false,
                    aliasRef: "hp_root");

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success);
                Assert.AreEqual(string.Empty, result.errorCode);
                var created = root.transform.Find("R10_L3_CHILD_OK");
                Assert.NotNull(created);
                Assert.NotNull(created.GetComponent<CanvasRenderer>());
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_CompositeAction_RollsBack_WhenStep2Fails()
        {
            var root = new GameObject("R10_L3_ROOT_FAILURE");
            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = BuildCompositeAction(
                    root,
                    "R10_L3_CHILD_ROLLBACK",
                    "UnityEngine.NotExistsComponent, UnityEngine.CoreModule",
                    failStep2: true,
                    aliasRef: "hp_root");

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_COMPOSITE_STEP_FAILED", result.errorCode);
                Assert.IsNull(root.transform.Find("R10_L3_CHILD_ROLLBACK"));
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_CompositeAction_Fails_WhenAliasNotFound()
        {
            var root = new GameObject("R10_L3_ROOT_ALIAS_MISS");
            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = BuildCompositeAction(
                    root,
                    "R10_L3_CHILD_ALIAS_MISS",
                    "UnityEngine.CanvasRenderer, UnityEngine.UIModule",
                    failStep2: false,
                    aliasRef: "missing_alias");

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_COMPOSITE_ALIAS_NOT_FOUND", result.errorCode);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_CompositeAction_Fails_WhenAliasForwardReferencedBeforeBind()
        {
            var root = new GameObject("R10_L3_ROOT_FORWARD_REF");
            try
            {
                var rootObjectId = BuildObjectId(root);
                var rootPath = "Scene/" + root.name;
                var executor = new UnityVisualActionExecutor();
                var action = BuildCompositeEnvelope(
                    root,
                    new CompositeVisualActionData
                    {
                        schema_version = "r10.v1",
                        transaction_id = "tx_r10_l3_forward_ref",
                        atomic_mode = "all_or_nothing",
                        max_step_ms = 1500,
                        steps = new[]
                        {
                            new CompositeVisualActionStep
                            {
                                step_id = "s1_use_before_bind",
                                type = "set_active",
                                target_anchor_ref = "future_alias",
                                action_data_json = "{\"active\":true}",
                            },
                            new CompositeVisualActionStep
                            {
                                step_id = "s2_create_late_bind",
                                type = "create_object",
                                parent_anchor = new UnityObjectAnchor
                                {
                                    object_id = rootObjectId,
                                    path = rootPath,
                                },
                                action_data_json = "{\"name\":\"R10_L3_FORWARD_CHILD\"}",
                                bind_outputs = new[]
                                {
                                    new CompositeVisualActionBindOutput
                                    {
                                        source = "created_object",
                                        alias = "future_alias",
                                    },
                                },
                            },
                        },
                    });

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_COMPOSITE_ALIAS_NOT_FOUND", result.errorCode);
                Assert.IsNull(root.transform.Find("R10_L3_FORWARD_CHILD"));
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_CompositeAction_Fails_WhenAtomicModeIsNotAllOrNothing()
        {
            var root = new GameObject("R14_L3_ROOT_ATOMIC_MODE_INVALID");
            try
            {
                var rootObjectId = BuildObjectId(root);
                var rootPath = "Scene/" + root.name;
                var executor = new UnityVisualActionExecutor();
                var action = BuildCompositeEnvelope(
                    root,
                    new CompositeVisualActionData
                    {
                        schema_version = "r14.v1",
                        transaction_id = "tx_r14_l3_atomic_mode_invalid",
                        atomic_mode = "best_effort",
                        max_step_ms = 1500,
                        steps = new[]
                        {
                            new CompositeVisualActionStep
                            {
                                step_id = "s1_create",
                                type = "create_object",
                                parent_anchor = new UnityObjectAnchor
                                {
                                    object_id = rootObjectId,
                                    path = rootPath,
                                },
                                action_data_json = "{\"name\":\"R14_L3_INVALID_ATOMIC_CHILD\"}",
                            },
                        },
                    });

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_COMPOSITE_PAYLOAD_INVALID", result.errorCode);
                StringAssert.Contains("atomic_mode", result.errorMessage);
                Assert.IsNull(root.transform.Find("R14_L3_INVALID_ATOMIC_CHILD"));
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_CompositeAction_RollsBack_WhenAliasDuplicatedOnLaterStep()
        {
            var root = new GameObject("R10_L3_ROOT_ALIAS_DUP");
            try
            {
                var rootObjectId = BuildObjectId(root);
                var rootPath = "Scene/" + root.name;
                var executor = new UnityVisualActionExecutor();
                var action = BuildCompositeEnvelope(
                    root,
                    new CompositeVisualActionData
                    {
                        schema_version = "r10.v1",
                        transaction_id = "tx_r10_l3_alias_dup",
                        atomic_mode = "all_or_nothing",
                        max_step_ms = 1500,
                        steps = new[]
                        {
                            new CompositeVisualActionStep
                            {
                                step_id = "s1_create_first",
                                type = "create_object",
                                parent_anchor = new UnityObjectAnchor
                                {
                                    object_id = rootObjectId,
                                    path = rootPath,
                                },
                                action_data_json = "{\"name\":\"R10_L3_DUP_CHILD_1\"}",
                                bind_outputs = new[]
                                {
                                    new CompositeVisualActionBindOutput
                                    {
                                        source = "created_object",
                                        alias = "dup_alias",
                                    },
                                },
                            },
                            new CompositeVisualActionStep
                            {
                                step_id = "s2_create_second_dup",
                                type = "create_object",
                                parent_anchor_ref = "dup_alias",
                                action_data_json = "{\"name\":\"R10_L3_DUP_CHILD_2\"}",
                                bind_outputs = new[]
                                {
                                    new CompositeVisualActionBindOutput
                                    {
                                        source = "created_object",
                                        alias = "dup_alias",
                                    },
                                },
                            },
                        },
                    });

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_COMPOSITE_ALIAS_DUPLICATED", result.errorCode);
                Assert.IsNull(root.transform.Find("R10_L3_DUP_CHILD_1"));
                Assert.IsNull(root.transform.Find("R10_L3_DUP_CHILD_2"));
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        private static VisualLayerActionItem BuildCompositeAction(
            GameObject root,
            string childName,
            string componentAssemblyQualifiedName,
            bool failStep2,
            string aliasRef)
        {
            var rootObjectId = BuildObjectId(root);
            var rootPath = "Scene/" + root.name;
            var composite = new CompositeVisualActionData
            {
                schema_version = "r10.v1",
                transaction_id = "tx_r10_l3_composite",
                atomic_mode = "all_or_nothing",
                max_step_ms = 1500,
                steps = new[]
                {
                    new CompositeVisualActionStep
                    {
                        step_id = "s1_create",
                        type = "create_object",
                        parent_anchor = new UnityObjectAnchor
                        {
                            object_id = rootObjectId,
                            path = rootPath,
                        },
                        action_data_json = "{\"name\":\"" + childName + "\"}",
                        bind_outputs = new[]
                        {
                            new CompositeVisualActionBindOutput
                            {
                                source = "created_object",
                                alias = "hp_root",
                            },
                        },
                    },
                    new CompositeVisualActionStep
                    {
                        step_id = "s2_update",
                        type = failStep2 ? "remove_component" : "add_component",
                        target_anchor_ref = aliasRef,
                        action_data_json =
                            "{\"component_assembly_qualified_name\":\"" +
                            componentAssemblyQualifiedName +
                            "\"}",
                    },
                },
            };

            return new VisualLayerActionItem
            {
                type = "composite_visual_action",
                target_anchor = new UnityObjectAnchor
                {
                    object_id = rootObjectId,
                    path = rootPath,
                },
                action_data_json = JsonUtility.ToJson(composite),
            };
        }

        private static VisualLayerActionItem BuildCompositeEnvelope(
            GameObject root,
            CompositeVisualActionData composite)
        {
            var rootObjectId = BuildObjectId(root);
            var rootPath = "Scene/" + root.name;

            return new VisualLayerActionItem
            {
                type = "composite_visual_action",
                target_anchor = new UnityObjectAnchor
                {
                    object_id = rootObjectId,
                    path = rootPath,
                },
                action_data_json = JsonUtility.ToJson(composite),
            };
        }

        private static string BuildObjectId(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            return GlobalObjectId.GetGlobalObjectIdSlow(gameObject).ToString();
        }
    }
}

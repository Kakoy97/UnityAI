using System.Collections.Generic;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class AtomicSafeAdmissionTests
    {
        [Test]
        public void CompositeAction_RejectsNonAtomicSafeStep_BeforeExecutingHandler()
        {
            var root = new GameObject("R14_L3_ATOMIC_GUARD_ROOT");
            try
            {
                var registry = new McpActionRegistry();
                var nonAtomicHandler = new CountingNonAtomicHandler();

                registry.Register(
                    "set_non_atomic_test",
                    nonAtomicHandler,
                    new McpActionCapability(
                        "set_non_atomic_test",
                        "non-atomic test handler",
                        "target_required",
                        "{}",
                        McpActionGovernance.DomainUi,
                        McpActionGovernance.TierCore,
                        McpActionGovernance.LifecycleStable,
                        McpActionGovernance.UndoSafetyNonAtomic,
                        string.Empty));
                registry.Register(
                    "composite_visual_action",
                    new CompositeVisualActionHandler(registry),
                    new McpActionCapability(
                        "composite_visual_action",
                        "composite handler",
                        "target_or_parent_required",
                        "{}",
                        McpActionGovernance.DomainComposite,
                        McpActionGovernance.TierCore,
                        McpActionGovernance.LifecycleStable,
                        McpActionGovernance.UndoSafetyAtomicSafe,
                        string.Empty));

                var executor = new UnityVisualActionExecutor(registry);
                var rootObjectId = BuildObjectId(root);
                var rootPath = "Scene/" + root.name;
                var composite = new CompositeVisualActionData
                {
                    schema_version = "r14.v1",
                    transaction_id = "tx_r14_atomic_guard",
                    atomic_mode = "all_or_nothing",
                    max_step_ms = 1500,
                    steps = new[]
                    {
                        new CompositeVisualActionStep
                        {
                            step_id = "s1_non_atomic",
                            type = "set_non_atomic_test",
                            target_anchor = new UnityObjectAnchor
                            {
                                object_id = rootObjectId,
                                path = rootPath,
                            },
                            action_data_json = "{}",
                        },
                    },
                };

                var action = new VisualLayerActionItem
                {
                    type = "composite_visual_action",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = rootObjectId,
                        path = rootPath,
                    },
                    action_data_json = JsonUtility.ToJson(composite),
                };

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_COMPOSITE_PAYLOAD_INVALID", result.errorCode);
                StringAssert.Contains("not atomic_safe", result.errorMessage);
                Assert.AreEqual(0, nonAtomicHandler.ExecuteCount);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void CompositeTransactionRunner_FailsClosed_WhenRollbackVerificationFails()
        {
            var runner = new CompositeTransactionRunner();
            GameObject leaked = null;
            var expectedDestroyedInstanceIds = new List<int>();

            var result = runner.ExecuteAtomic(
                "r14_atomic_rollback_guard",
                () =>
                {
                    leaked = new GameObject("R14_ATOMIC_ROLLBACK_LEAK");
                    expectedDestroyedInstanceIds.Add(leaked.GetInstanceID());
                    // Intentionally skip Undo registration, forcing rollback verification failure.
                    return McpVisualActionExecutionResult.Fail("E_TEST_FAILED", "forced");
                },
                expectedDestroyedInstanceIds);

            Assert.NotNull(result);
            Assert.IsFalse(result.Success);
            Assert.AreEqual("E_COMPOSITE_ROLLBACK_INCOMPLETE", result.ErrorCode);

            if (leaked != null)
            {
                Object.DestroyImmediate(leaked);
            }
        }

        private static string BuildObjectId(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            return GlobalObjectId.GetGlobalObjectIdSlow(gameObject).ToString();
        }

        private sealed class CountingNonAtomicHandler : IMcpVisualActionHandler
        {
            public int ExecuteCount { get; private set; }

            public string ActionType
            {
                get { return "set_non_atomic_test"; }
            }

            public McpVisualActionExecutionResult Execute(McpVisualActionContext context)
            {
                ExecuteCount += 1;
                return McpVisualActionExecutionResult.Ok();
            }
        }
    }

    public sealed class SetGameObjectActiveAtomicActionTests : AtomicActionTestBase
    {
        protected override string ActionType
        {
            get { return "set_gameobject_active"; }
        }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject();
            target.SetActive(true);
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"active\":false}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.NotNull(executionResult);
            Assert.IsFalse(target.activeSelf);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.IsTrue(target.activeSelf);
        }
    }
}

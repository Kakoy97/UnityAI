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
    public abstract class AtomicActionTestBase
    {
        private const string AtomicObjectPrefix = "__R16_ATOMIC__";

        private CompositeTransactionRunner _runner;
        private UnityVisualActionExecutor _executor;

        protected abstract string ActionType { get; }

        protected virtual string TransactionPrefix
        {
            get { return "r16_atomic_" + ActionType; }
        }

        protected virtual string ObjectPrefix
        {
            get { return AtomicObjectPrefix + ActionType + "_"; }
        }

        protected abstract GameObject CreateTarget();

        protected abstract VisualLayerActionItem BuildValidAction(GameObject target);

        protected abstract void AssertApplied(GameObject target, UnityActionExecutionResult executionResult);

        protected abstract void AssertRolledBack(GameObject target);

        [SetUp]
        public void AtomicActionBaseSetUp()
        {
            _runner = new CompositeTransactionRunner();
            _executor = new UnityVisualActionExecutor();
        }

        [TearDown]
        public void AtomicActionBaseTearDown()
        {
            DestroyTaggedObjects();
        }

        [Test]
        public void Action_Succeeds_WhenPayloadValid()
        {
            var target = CreateTarget();
            Assert.NotNull(target, "CreateTarget must return a non-null GameObject.");

            var result = _runner.ExecuteAtomic(
                TransactionPrefix + "_success",
                delegate
                {
                    var executionResult = ExecuteAtomicAction(target);
                    return McpVisualActionExecutionResult.FromExecutionResult(executionResult);
                });

            Assert.NotNull(result);
            Assert.IsTrue(result.Success, result.ErrorCode + " " + result.ErrorMessage);
            Assert.NotNull(result.ExecutionResult);
            Assert.IsTrue(result.ExecutionResult.success);
            Assert.AreEqual(string.Empty, result.ErrorCode);
            AssertApplied(target, result.ExecutionResult);
        }

        [Test]
        public void Action_RollsBack_WhenHandlerReturnsFailure()
        {
            var target = CreateTarget();
            Assert.NotNull(target, "CreateTarget must return a non-null GameObject.");

            var actionExecuted = false;
            var result = _runner.ExecuteAtomic(
                TransactionPrefix + "_rollback",
                delegate
                {
                    var executionResult = ExecuteAtomicAction(target);
                    if (executionResult == null || !executionResult.success)
                    {
                        return McpVisualActionExecutionResult.Fail(
                            "E_TEST_SETUP_FAILED",
                            "Atomic test setup action failed.");
                    }

                    actionExecuted = true;
                    return McpVisualActionExecutionResult.Fail(
                        "E_TEST_FORCED_ROLLBACK",
                        "Forced rollback to verify atomic undo behavior.");
                });

            Assert.IsTrue(actionExecuted, "Expected action execution before forced rollback.");
            Assert.NotNull(result);
            Assert.IsFalse(result.Success);
            Assert.AreEqual(
                "E_TEST_FORCED_ROLLBACK",
                result.ErrorCode,
                "ActionType=" + ActionType + " ErrorMessage=" + (result == null ? string.Empty : result.ErrorMessage));
            AssertRolledBack(target);
        }

        [Test]
        public void Action_FailsClosed_WhenUndoRegistrationMissing()
        {
            GameObject leaked = null;
            var expectedDestroyedInstanceIds = new List<int>();
            var result = _runner.ExecuteAtomic(
                TransactionPrefix + "_fail_closed",
                delegate
                {
                    leaked = new GameObject(BuildTaggedName("leak"));
                    expectedDestroyedInstanceIds.Add(leaked.GetInstanceID());
                    // Intentionally skip Undo registration to force rollback verification failure.
                    return McpVisualActionExecutionResult.Fail(
                        "E_TEST_FORCED_ROLLBACK",
                        "forced fail-closed verification");
                },
                expectedDestroyedInstanceIds);

            Assert.NotNull(result);
            Assert.IsFalse(result.Success);
            Assert.AreEqual("E_COMPOSITE_ROLLBACK_INCOMPLETE", result.ErrorCode);

            if (leaked != null)
            {
                UnityEngine.Object.DestroyImmediate(leaked);
            }
        }

        protected UnityObjectAnchor BuildAnchor(GameObject target)
        {
            return new UnityObjectAnchor
            {
                object_id = BuildObjectId(target),
                path = BuildScenePath(target),
            };
        }

        protected GameObject CreateTaggedGameObject(params Type[] componentTypes)
        {
            return new GameObject(BuildTaggedName("target"), componentTypes ?? new Type[0]);
        }

        private UnityActionExecutionResult ExecuteAtomicAction(GameObject target)
        {
            var action = BuildValidAction(target);
            Assert.NotNull(action, "BuildValidAction must return a non-null action.");
            var actionType = string.IsNullOrWhiteSpace(action.type) ? string.Empty : action.type.Trim();
            Assert.AreEqual(ActionType, actionType, "ActionType mismatch in test action payload.");

            return _executor.Execute(action, target);
        }

        private string BuildTaggedName(string suffix)
        {
            var normalizedSuffix = string.IsNullOrWhiteSpace(suffix) ? "item" : suffix.Trim();
            return ObjectPrefix + normalizedSuffix + "_" + Guid.NewGuid().ToString("N").Substring(0, 8);
        }

        private void DestroyTaggedObjects()
        {
            var objects = Resources.FindObjectsOfTypeAll<GameObject>();
            for (var i = 0; i < objects.Length; i += 1)
            {
                var go = objects[i];
                if (go == null || string.IsNullOrWhiteSpace(go.name))
                {
                    continue;
                }

                if (EditorUtility.IsPersistent(go))
                {
                    continue;
                }

                if (!go.scene.IsValid())
                {
                    continue;
                }

                if (!go.name.StartsWith(ObjectPrefix, StringComparison.Ordinal))
                {
                    continue;
                }

                UnityEngine.Object.DestroyImmediate(go);
            }
        }

        private static string BuildObjectId(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            return GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();
        }

        private static string BuildScenePath(GameObject target)
        {
            if (target == null || target.transform == null)
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

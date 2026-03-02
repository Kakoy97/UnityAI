using NUnit.Framework;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class CompositeTransactionRunnerTests
    {
        [Test]
        public void ExecuteAtomic_CommitsOnSuccess_AndKeepsCreatedObject()
        {
            var runner = new CompositeTransactionRunner();
            var createdInstanceId = 0;

            var result = runner.ExecuteAtomic(
                "r10_arch02_success",
                () =>
                {
                    var go = new GameObject("R10_ARCH02_SUCCESS");
                    Undo.RegisterCreatedObjectUndo(go, "create");
                    createdInstanceId = go.GetInstanceID();
                    return McpVisualActionExecutionResult.Ok();
                });

            Assert.NotNull(result);
            Assert.IsTrue(result.Success);

            var alive = EditorUtility.InstanceIDToObject(createdInstanceId) as GameObject;
            Assert.NotNull(alive);
            Object.DestroyImmediate(alive);
        }

        [Test]
        public void ExecuteAtomic_RollsBackOnFailure_AndDestroysCreatedObject()
        {
            var runner = new CompositeTransactionRunner();
            var createdInstanceId = 0;

            var result = runner.ExecuteAtomic(
                "r10_arch02_failure",
                () =>
                {
                    var go = new GameObject("R10_ARCH02_FAILURE");
                    Undo.RegisterCreatedObjectUndo(go, "create");
                    createdInstanceId = go.GetInstanceID();
                    return McpVisualActionExecutionResult.Fail("E_TEST_FAILED", "forced");
                });

            Assert.NotNull(result);
            Assert.IsFalse(result.Success);
            Assert.AreEqual("E_TEST_FAILED", result.ErrorCode);
            Assert.IsNull(EditorUtility.InstanceIDToObject(createdInstanceId));
        }

        [Test]
        public void ExecuteAtomic_RollsBackRecordedPropertyMutation_OnFailure()
        {
            var runner = new CompositeTransactionRunner();
            var go = new GameObject("R16_ATOMIC_RUNNER_PROPERTY");

            try
            {
                go.SetActive(true);
                var result = runner.ExecuteAtomic(
                    "r16_atomic_runner_property_rollback",
                    () =>
                    {
                        Undo.RecordObject(go, "toggle active");
                        go.SetActive(false);
                        return McpVisualActionExecutionResult.Fail("E_TEST_FAILED", "forced");
                    });

                Assert.NotNull(result);
                Assert.IsFalse(result.Success);
                Assert.AreEqual("E_TEST_FAILED", result.ErrorCode);
                Assert.IsTrue(go.activeSelf);
            }
            finally
            {
                Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void RollbackVerifier_DetectsLeakedObject_WhenExpectedDestroyedIdStillAlive()
        {
            var verifier = new RollbackVerifier();
            var baseline = verifier.CaptureBaseline();
            var go = new GameObject("R10_ARCH02_LEAK");
            var leakedId = go.GetInstanceID();

            var verification = verifier.VerifyAfterRollback(
                baseline,
                new[] { leakedId });

            Assert.NotNull(verification);
            Assert.IsFalse(verification.Ok);
            StringAssert.Contains("Rollback leaked object instance id", verification.Message);

            Object.DestroyImmediate(go);
        }

        [Test]
        public void ExecuteAtomic_ReturnsCompositeExecutionFailed_WhenBodyIsMissing()
        {
            var runner = new CompositeTransactionRunner();
            var result = runner.ExecuteAtomic("r10_l3_missing_body", null);

            Assert.NotNull(result);
            Assert.IsFalse(result.Success);
            Assert.AreEqual("E_COMPOSITE_EXECUTION_FAILED", result.ErrorCode);
        }

        [Test]
        public void ExecuteAtomic_ReturnsCompositeExecutionFailed_WhenBodyThrows()
        {
            var runner = new CompositeTransactionRunner();
            var result = runner.ExecuteAtomic(
                "r10_l3_throw",
                () =>
                {
                    throw new System.InvalidOperationException("boom");
                });

            Assert.NotNull(result);
            Assert.IsFalse(result.Success);
            Assert.AreEqual("E_COMPOSITE_EXECUTION_FAILED", result.ErrorCode);
        }
    }
}

using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class SsotTransactionExecutionTests
    {
        [Test]
        public void RequestRouter_DeserializeExecuteUnityTransaction_ParsesStructuredStepPayloadObject()
        {
            var payloadJson =
                "{" +
                "\"execution_mode\":\"execute\"," +
                "\"idempotency_key\":\"idem_txn_router_001\"," +
                "\"based_on_read_token\":\"ssot_rt_router_001\"," +
                "\"write_anchor_object_id\":\"go_canvas\"," +
                "\"write_anchor_path\":\"Scene/Canvas\"," +
                "\"transaction_id\":\"txn_router_001\"," +
                "\"steps\":[{" +
                    "\"step_id\":\"step_create\"," +
                    "\"tool_name\":\"create_object\"," +
                    "\"payload\":{" +
                        "\"parent_object_id\":\"go_canvas\"," +
                        "\"parent_path\":\"Scene/Canvas\"," +
                        "\"new_object_name\":\"Btn\"," +
                        "\"object_kind\":\"ui_button\"" +
                    "}" +
                "}]" +
                "}";

            var ok = SsotRequestRouter.TryDeserializeExecuteUnityTransaction(
                payloadJson,
                out var request,
                out var errorMessage);

            Assert.IsTrue(ok, errorMessage);
            Assert.NotNull(request);
            Assert.NotNull(request.steps);
            Assert.AreEqual(1, request.steps.Length);
            Assert.NotNull(request.steps[0].payload);
            Assert.AreEqual("go_canvas", request.steps[0].payload["parent_object_id"] as string);
            Assert.AreEqual("Scene/Canvas", request.steps[0].payload["parent_path"] as string);
        }

        [Test]
        public void PlanValidator_RejectsDuplicateSaveAsAlias()
        {
            var request = BuildRequest(new[]
            {
                BuildStep(
                    "step_1",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"BtnA\",\"object_kind\":\"ui_button\"}",
                    saveAs: "node"),
                BuildStep(
                    "step_2",
                    "duplicate_object",
                    "{\"target_object_id\":\"go_btn\",\"target_path\":\"Scene/Canvas/BtnA\"}",
                    saveAs: "node"),
            });

            Assert.IsTrue(TransactionPlanModelFactory.TryBuild(request, out var plan, out var buildErrorCode, out var buildErrorMessage), buildErrorCode + ":" + buildErrorMessage);

            var validator = new TransactionPlanValidator();
            var valid = validator.Validate(plan, out var errorCode, out var errorMessage);
            Assert.IsFalse(valid);
            Assert.AreEqual("E_TRANSACTION_PLAN_INVALID", errorCode);
            StringAssert.Contains("duplicated save_as alias", errorMessage);
        }

        [Test]
        public void PlanValidator_RejectsReservedWriteEnvelopeFieldsInStepPayload()
        {
            var request = BuildRequest(new[]
            {
                BuildStep(
                    "step_1",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"BtnA\",\"object_kind\":\"ui_button\",\"based_on_read_token\":\"should_not_be_here\"}",
                    saveAs: "node"),
            });

            Assert.IsTrue(
                TransactionPlanModelFactory.TryBuild(
                    request,
                    out var plan,
                    out var buildErrorCode,
                    out var buildErrorMessage),
                buildErrorCode + ":" + buildErrorMessage);

            var validator = new TransactionPlanValidator();
            var valid = validator.Validate(plan, out var errorCode, out var errorMessage);
            Assert.IsFalse(valid);
            Assert.AreEqual("E_TRANSACTION_PLAN_INVALID", errorCode);
            StringAssert.Contains("reserved write_envelope field", errorMessage);
            StringAssert.Contains("based_on_read_token", errorMessage);
        }

        [Test]
        public void PlanValidator_AllowsMultipleBackwardDependencies()
        {
            var request = BuildRequest(new[]
            {
                BuildStep(
                    "step_create_a",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"BtnA\",\"object_kind\":\"ui_button\"}",
                    saveAs: "btn_a"),
                BuildStep(
                    "step_create_b",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"BtnB\",\"object_kind\":\"ui_button\"}",
                    saveAs: "btn_b"),
                BuildStep(
                    "step_attach",
                    "set_parent",
                    "{\"target_object_id\":{\"$ref\":\"btn_b.target_object_id\"},\"target_path\":{\"$ref\":\"btn_b.target_path\"},\"parent_object_id\":{\"$ref\":\"btn_a.target_object_id\"},\"parent_path\":{\"$ref\":\"btn_a.target_path\"}}",
                    dependsOn: new[] { "step_create_a", "step_create_b" }),
            });

            Assert.IsTrue(
                TransactionPlanModelFactory.TryBuild(
                    request,
                    out var plan,
                    out var buildErrorCode,
                    out var buildErrorMessage),
                buildErrorCode + ":" + buildErrorMessage);

            var validator = new TransactionPlanValidator();
            var valid = validator.Validate(plan, out var errorCode, out var errorMessage);
            Assert.IsTrue(valid, errorCode + ":" + errorMessage);
        }

        [Test]
        public void PlanValidator_RejectsForwardDependency()
        {
            var request = BuildRequest(new[]
            {
                BuildStep(
                    "step_1",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"BtnA\",\"object_kind\":\"ui_button\"}",
                    dependsOn: new[] { "step_2" }),
                BuildStep(
                    "step_2",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"BtnB\",\"object_kind\":\"ui_button\"}"),
            });

            Assert.IsTrue(
                TransactionPlanModelFactory.TryBuild(
                    request,
                    out var plan,
                    out var buildErrorCode,
                    out var buildErrorMessage),
                buildErrorCode + ":" + buildErrorMessage);

            var validator = new TransactionPlanValidator();
            var valid = validator.Validate(plan, out var errorCode, out var errorMessage);
            Assert.IsFalse(valid);
            Assert.AreEqual("E_TRANSACTION_DEPENDENCY_ORDER_INVALID", errorCode);
            StringAssert.Contains("non-previous step_id", errorMessage);
        }

        [Test]
        public void PlanValidator_RejectsDependencyCycle()
        {
            var request = BuildRequest(new[]
            {
                BuildStep(
                    "step_1",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"BtnA\",\"object_kind\":\"ui_button\"}",
                    dependsOn: new[] { "step_2" }),
                BuildStep(
                    "step_2",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"BtnB\",\"object_kind\":\"ui_button\"}",
                    dependsOn: new[] { "step_1" }),
            });

            Assert.IsTrue(
                TransactionPlanModelFactory.TryBuild(
                    request,
                    out var plan,
                    out var buildErrorCode,
                    out var buildErrorMessage),
                buildErrorCode + ":" + buildErrorMessage);

            var validator = new TransactionPlanValidator();
            var valid = validator.Validate(plan, out var errorCode, out var errorMessage);
            Assert.IsFalse(valid);
            Assert.AreEqual("E_TRANSACTION_DEPENDENCY_CYCLE", errorCode);
            StringAssert.Contains("contains a cycle", errorMessage);
        }

        [Test]
        public void ReferenceResolver_ResolvesAliasRefInNestedPayload()
        {
            var aliasStore = new TransactionAliasStore();
            var bindOk = aliasStore.TryBind(
                "button",
                new SsotDispatchResultData
                {
                    target_object_id = "go_button_001",
                    target_path = "Scene/Canvas/Button"
                },
                out var bindErrorCode,
                out var bindErrorMessage);
            Assert.IsTrue(bindOk, bindErrorCode + ":" + bindErrorMessage);

            var payload = new Dictionary<string, object>
            {
                {
                    "target_anchor",
                    new Dictionary<string, object>
                    {
                        { "object_id", new Dictionary<string, object> { { "$ref", "button.target_object_id" } } },
                        { "path", new Dictionary<string, object> { { "$ref", "button.target_path" } } }
                    }
                }
            };

            var resolver = new TransactionReferenceResolver();
            var ok = resolver.TryResolvePayload(
                payload,
                aliasStore,
                out var resolvedPayload,
                out var resolvedRefCount,
                out var errorCode,
                out var errorMessage);

            Assert.IsTrue(ok, errorCode + ":" + errorMessage);
            Assert.AreEqual(2, resolvedRefCount);
            Assert.NotNull(resolvedPayload);
            var anchor = resolvedPayload["target_anchor"] as Dictionary<string, object>;
            Assert.NotNull(anchor);
            Assert.AreEqual("go_button_001", anchor["object_id"] as string);
            Assert.AreEqual("Scene/Canvas/Button", anchor["path"] as string);
        }

        [Test]
        public void ReferenceResolver_ResolvesAliasRefInArrayPayload()
        {
            var aliasStore = new TransactionAliasStore();
            var bindOk = aliasStore.TryBind(
                "button",
                new SsotDispatchResultData
                {
                    target_object_id = "go_button_001",
                    target_path = "Scene/Canvas/Button"
                },
                out var bindErrorCode,
                out var bindErrorMessage);
            Assert.IsTrue(bindOk, bindErrorCode + ":" + bindErrorMessage);

            var payload = new Dictionary<string, object>
            {
                {
                    "targets",
                    new List<object>
                    {
                        new Dictionary<string, object>
                        {
                            { "object_id", new Dictionary<string, object> { { "$ref", "button.target_object_id" } } },
                            { "path", new Dictionary<string, object> { { "$ref", "button.target_path" } } }
                        },
                        new Dictionary<string, object>
                        {
                            { "object_id", new Dictionary<string, object> { { "$ref", "button.target_object_id" } } },
                            { "path", new Dictionary<string, object> { { "$ref", "button.target_path" } } }
                        }
                    }
                }
            };

            var resolver = new TransactionReferenceResolver();
            var ok = resolver.TryResolvePayload(
                payload,
                aliasStore,
                out var resolvedPayload,
                out var resolvedRefCount,
                out var errorCode,
                out var errorMessage);

            Assert.IsTrue(ok, errorCode + ":" + errorMessage);
            Assert.AreEqual(4, resolvedRefCount);
            var targets = resolvedPayload["targets"] as List<object>;
            Assert.NotNull(targets);
            Assert.AreEqual(2, targets.Count);
        }

        [Test]
        public void ReferenceResolver_RejectsAliasFieldOutsideWhitelist()
        {
            var aliasStore = new TransactionAliasStore();
            var bindOk = aliasStore.TryBind(
                "button",
                new SsotDispatchResultData
                {
                    target_object_id = "go_button_001",
                    target_path = "Scene/Canvas/Button",
                    read_token_candidate = "ssot_rt_should_be_blocked"
                },
                out var bindErrorCode,
                out var bindErrorMessage);
            Assert.IsTrue(bindOk, bindErrorCode + ":" + bindErrorMessage);

            var payload = new Dictionary<string, object>
            {
                { "target_object_id", new Dictionary<string, object> { { "$ref", "button.read_token_candidate" } } }
            };

            var resolver = new TransactionReferenceResolver();
            var ok = resolver.TryResolvePayload(
                payload,
                aliasStore,
                out var resolvedPayload,
                out var resolvedRefCount,
                out var errorCode,
                out var errorMessage);

            Assert.IsFalse(ok);
            Assert.IsNull(resolvedPayload);
            Assert.AreEqual(0, resolvedRefCount);
            Assert.AreEqual("E_TRANSACTION_REF_PATH_INVALID", errorCode);
            StringAssert.Contains("button.read_token_candidate", errorMessage);
        }

        [Test]
        public void ReferenceResolver_RejectsMixedRefObject()
        {
            var aliasStore = new TransactionAliasStore();
            var bindOk = aliasStore.TryBind(
                "button",
                new SsotDispatchResultData
                {
                    target_object_id = "go_button_001",
                },
                out var bindErrorCode,
                out var bindErrorMessage);
            Assert.IsTrue(bindOk, bindErrorCode + ":" + bindErrorMessage);

            var payload = new Dictionary<string, object>
            {
                {
                    "target_object_id",
                    new Dictionary<string, object>
                    {
                        { "$ref", "button.target_object_id" },
                        { "extra", "invalid" }
                    }
                }
            };

            var resolver = new TransactionReferenceResolver();
            var ok = resolver.TryResolvePayload(
                payload,
                aliasStore,
                out var resolvedPayload,
                out var resolvedRefCount,
                out var errorCode,
                out var errorMessage);

            Assert.IsFalse(ok);
            Assert.IsNull(resolvedPayload);
            Assert.AreEqual(0, resolvedRefCount);
            Assert.AreEqual("E_TRANSACTION_REF_PATH_INVALID", errorCode);
            StringAssert.Contains("cannot contain extra fields", errorMessage);
        }

        [Test]
        public void ReferenceResolver_RejectsStringInterpolationRef()
        {
            var aliasStore = new TransactionAliasStore();
            var payload = new Dictionary<string, object>
            {
                { "target_object_id", "prefix-$ref:button.target_object_id" }
            };

            var resolver = new TransactionReferenceResolver();
            var ok = resolver.TryResolvePayload(
                payload,
                aliasStore,
                out var resolvedPayload,
                out var resolvedRefCount,
                out var errorCode,
                out var errorMessage);

            Assert.IsFalse(ok);
            Assert.IsNull(resolvedPayload);
            Assert.AreEqual(0, resolvedRefCount);
            Assert.AreEqual("E_TRANSACTION_REF_PATH_INVALID", errorCode);
            StringAssert.Contains("string interpolation", errorMessage);
        }

        [Test]
        public void ExecutionEngine_InjectsWriteEnvelopeAndDispatchesStructuredSteps()
        {
            var request = BuildRequest(new[]
            {
                BuildStep(
                    "step_create",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"StartButton\",\"object_kind\":\"ui_button\",\"set_active\":true}",
                    saveAs: "button"),
                BuildStep(
                    "step_move",
                    "set_rect_anchored_position",
                    "{\"target_object_id\":{\"$ref\":\"button.target_object_id\"},\"target_path\":{\"$ref\":\"button.target_path\"},\"x\":-150,\"y\":-50}",
                    dependsOn: new[] { "step_create" }),
            });

            Assert.IsTrue(TransactionExecutionContext.TryCreate(request, out var context, out var contextErrorCode, out var contextErrorMessage), contextErrorCode + ":" + contextErrorMessage);
            Assert.IsTrue(TransactionPlanModelFactory.TryBuild(request, out var plan, out var planErrorCode, out var planErrorMessage), planErrorCode + ":" + planErrorMessage);

            var callCount = 0;
            var engine = new TransactionExecutionEngine(
                (toolName, payloadJson) =>
                {
                    callCount += 1;
                    var parsed = TransactionJson.TryParseObject(payloadJson, out var payloadObject, out var parseError);
                    Assert.IsTrue(parsed, parseError);
                    Assert.AreEqual("execute", payloadObject["execution_mode"] as string);
                    Assert.AreEqual("idem_txn_exec_001", payloadObject["idempotency_key"] as string);
                    Assert.AreEqual("ssot_rt_exec_001", payloadObject["based_on_read_token"] as string);
                    Assert.AreEqual("go_canvas", payloadObject["write_anchor_object_id"] as string);
                    Assert.AreEqual("Scene/Canvas", payloadObject["write_anchor_path"] as string);

                    if (string.Equals(toolName, "create_object", StringComparison.Ordinal))
                    {
                        return SsotRequestDispatcher.Success(
                            toolName,
                            new SsotDispatchResultData
                            {
                                target_object_id = "go_btn_001",
                                target_path = "Scene/Canvas/StartButton"
                            });
                    }

                    if (string.Equals(toolName, "set_rect_anchored_position", StringComparison.Ordinal))
                    {
                        Assert.AreEqual("go_btn_001", payloadObject["target_object_id"] as string);
                        Assert.AreEqual("Scene/Canvas/StartButton", payloadObject["target_path"] as string);
                        return SsotRequestDispatcher.Success(
                            toolName,
                            new SsotDispatchResultData
                            {
                                scene_revision = "ssot_rev_mock_exec"
                            });
                    }

                    Assert.Fail("Unexpected tool dispatch: " + toolName);
                    return null;
                },
                new TransactionPlanValidator(),
                new TransactionSafetyPolicy(),
                new TransactionReferenceResolver());

            var response = engine.Execute(context, plan);
            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.IsTrue(response.success);
            Assert.NotNull(response.data);
            Assert.AreEqual(2, response.data.executed_step_count);
            Assert.AreEqual(2, callCount);
        }

        [Test]
        public void ExecutionEngine_ReturnsStepFailedEnvelope_WhenNestedStepFails()
        {
            var request = BuildRequest(new[]
            {
                BuildStep(
                    "step_create",
                    "create_object",
                    "{\"parent_object_id\":\"go_canvas\",\"parent_path\":\"Scene/Canvas\",\"new_object_name\":\"StartButton\",\"object_kind\":\"ui_button\",\"set_active\":true}",
                    saveAs: "button"),
                BuildStep(
                    "step_move",
                    "set_rect_anchored_position",
                    "{\"target_object_id\":{\"$ref\":\"button.target_object_id\"},\"target_path\":{\"$ref\":\"button.target_path\"},\"x\":-150,\"y\":-50}",
                    dependsOn: new[] { "step_create" }),
            });

            Assert.IsTrue(TransactionExecutionContext.TryCreate(request, out var context, out var contextErrorCode, out var contextErrorMessage), contextErrorCode + ":" + contextErrorMessage);
            Assert.IsTrue(TransactionPlanModelFactory.TryBuild(request, out var plan, out var planErrorCode, out var planErrorMessage), planErrorCode + ":" + planErrorMessage);

            var callCount = 0;
            var engine = new TransactionExecutionEngine(
                (toolName, payloadJson) =>
                {
                    callCount += 1;
                    if (string.Equals(toolName, "create_object", StringComparison.Ordinal))
                    {
                        return SsotRequestDispatcher.Success(
                            toolName,
                            new SsotDispatchResultData
                            {
                                target_object_id = "go_btn_001",
                                target_path = "Scene/Canvas/StartButton"
                            });
                    }

                    return SsotRequestDispatcher.Failure(
                        "E_SSOT_SCHEMA_INVALID",
                        "target_object_id is required",
                        toolName);
                },
                new TransactionPlanValidator(),
                new TransactionSafetyPolicy(),
                new TransactionReferenceResolver());

            var response = engine.Execute(context, plan);
            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.IsFalse(response.success);
            Assert.AreEqual("E_TRANSACTION_STEP_FAILED", response.error_code);
            Assert.NotNull(response.data);
            Assert.AreEqual(1, response.data.failed_step_index);
            Assert.AreEqual("step_move", response.data.failed_step_id);
            Assert.AreEqual("set_rect_anchored_position", response.data.failed_tool_name);
            Assert.AreEqual("E_SSOT_SCHEMA_INVALID", response.data.failed_error_code);
            Assert.AreEqual("E_SSOT_SCHEMA_INVALID", response.data.nested_error_code);
            Assert.AreEqual("target_object_id is required", response.data.nested_error_message);
            Assert.IsTrue(response.data.rollback_applied);
            Assert.AreEqual("rollback_all", response.data.rollback_policy);
            Assert.AreEqual("nested_step_failed", response.data.rollback_reason);
            Assert.AreEqual("2.0", response.data.error_context_version);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.error_context_issued_at));
            Assert.IsFalse(string.IsNullOrEmpty(response.data.scene_revision_at_failure));
            Assert.AreEqual(0, response.data.suppressed_error_count);
            Assert.IsFalse(response.data.requires_context_refresh);
            Assert.AreEqual(1, response.data.executed_step_count);
            Assert.AreEqual(2, callCount);
        }

        private static ExecuteUnityTransactionRequestDto BuildRequest(
            ExecuteUnityTransactionRequestDtoStepsItemDto[] steps)
        {
            return new ExecuteUnityTransactionRequestDto
            {
                execution_mode = "execute",
                idempotency_key = "idem_txn_exec_001",
                based_on_read_token = "ssot_rt_exec_001",
                write_anchor_object_id = "go_canvas",
                write_anchor_path = "Scene/Canvas",
                transaction_id = "txn_exec_001",
                steps = steps
            };
        }

        private static ExecuteUnityTransactionRequestDtoStepsItemDto BuildStep(
            string stepId,
            string toolName,
            string payloadJson,
            string saveAs = null,
            string[] dependsOn = null)
        {
            Dictionary<string, object> payloadObject;
            string parseError;
            var parseOk = TransactionJson.TryParseObject(payloadJson, out payloadObject, out parseError);
            Assert.IsTrue(parseOk, parseError);

            return new ExecuteUnityTransactionRequestDtoStepsItemDto
            {
                step_id = stepId,
                tool_name = toolName,
                payload = payloadObject,
                save_as = saveAs,
                depends_on = dependsOn
            };
        }
    }
}

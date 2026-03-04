using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityAI.Editor.Codex.Application;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Ports;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityRuntimeRecoveryTests
    {
        [Test]
        public void SendRuntimePingAsync_AutoCancelResponse_ClearsLocalBusyState()
        {
            var stateStore = new InMemoryConversationStateStore(
                new PersistedConversationState
                {
                    thread_id = "thread_auto_cancel",
                    is_busy = true,
                    active_request_id = "req_busy",
                    turn_id = "turn_busy",
                    busy_reason = "Action Executing",
                    runtime_state = TurnRuntimeState.ActionExecuting.ToString(),
                });
            var gateway = new FakeSidecarGateway
            {
                RuntimePingResponseFactory = () =>
                    GatewayOk(
                        new UnityRuntimePingResponse
                        {
                            ok = true,
                            @event = "job.completed",
                            request_id = "req_busy",
                            status = "cancelled",
                            state = "cancelled",
                            error_code = "E_JOB_MAX_RUNTIME_EXCEEDED",
                            error_message = "Job runtime exceeded max_runtime_ms. Job auto-cancelled.",
                            suggestion = "Split task and retry.",
                            recoverable = true,
                            stage = "cancelled",
                            message = "Job runtime exceeded max_runtime_ms. Job auto-cancelled.",
                        }),
            };
            var controller = CreateController(gateway, stateStore);
            controller.InitializeFromPersistedState();
            Assert.IsTrue(controller.IsBusy);

            controller.SendRuntimePingAsync().GetAwaiter().GetResult();

            Assert.IsFalse(controller.IsBusy);
            Assert.AreEqual("Idle", controller.BusyReason);
            var saved = stateStore.LastSaved;
            Assert.NotNull(saved);
            Assert.IsFalse(saved.is_busy);
            Assert.AreEqual(string.Empty, saved.active_request_id);
            Assert.IsNotEmpty(saved.last_terminal_event);
            Assert.AreEqual("E_JOB_MAX_RUNTIME_EXCEEDED", saved.last_error_code);
            Assert.AreEqual(TurnRuntimeState.Idle.ToString(), saved.runtime_state);
        }

        [Test]
        public void SendRuntimePingAsync_RunningResponse_RecoversBusyStateWithoutWindow()
        {
            var stateStore = new InMemoryConversationStateStore(null);
            var gateway = new FakeSidecarGateway
            {
                RuntimePingResponseFactory = () =>
                    GatewayOk(
                        new UnityRuntimePingResponse
                        {
                            ok = true,
                            @event = "job.progress",
                            request_id = "req_recovered",
                            status = "pending",
                            state = "running",
                            stage = "waiting_for_unity_reboot",
                            message = "Recovered pending action",
                            recovered = true,
                        }),
            };
            var controller = CreateController(gateway, stateStore);
            controller.InitializeFromPersistedState();

            controller.SendRuntimePingAsync().GetAwaiter().GetResult();

            Assert.IsTrue(controller.IsBusy);
            Assert.AreEqual("Action Executing", controller.BusyReason);
            Assert.AreEqual("req_recovered", controller.ActiveRequestId);
            var saved = stateStore.LastSaved;
            Assert.NotNull(saved);
            Assert.IsTrue(saved.is_busy);
            Assert.AreEqual("req_recovered", saved.active_request_id);
            Assert.AreEqual(TurnRuntimeState.ActionExecuting.ToString(), saved.runtime_state);
        }

        [Test]
        public void SendRuntimePingAsync_InvalidCapturedActionEnvelope_ReportsDeterministicSchemaFailureWithoutTimeout()
        {
            var stateStore = new InMemoryConversationStateStore(null);
            var gateway = new FakeSidecarGateway
            {
                RuntimePingResponseFactory = () =>
                    GatewayOk(
                        new UnityRuntimePingResponse
                        {
                            ok = true,
                            @event = "job.progress",
                            request_id = "req_hf01",
                            status = "pending",
                            state = "running",
                            stage = "action_confirm_pending",
                            unity_action_request = new UnityActionRequestEnvelope
                            {
                                request_id = "req_hf01",
                                turn_id = "turn_hf01",
                                payload = new UnityActionRequestPayload
                                {
                                    based_on_read_token = "tok_anchor_hf_12345678901234567890",
                                    write_anchor = new UnityObjectAnchor
                                    {
                                        object_id = "go_target",
                                        path = "Scene/Canvas/Panel",
                                    },
                                    requires_confirmation = false,
                                    action = new VisualLayerActionItem
                                    {
                                        type = "rename_object",
                                        target_anchor = new UnityObjectAnchor
                                        {
                                            object_id = "go_target",
                                            path = string.Empty,
                                        },
                                        action_data_json = "{\"name\":\"A\"}",
                                    }
                                }
                            }
                        }),
                ActionResponseFactory = request =>
                    GatewayOk(
                        new UnityActionReportResponse
                        {
                            ok = true,
                            @event = "job.failed",
                            request_id = request == null ? string.Empty : request.request_id,
                            status = "failed",
                            state = "error",
                            stage = "error",
                            error_code = request == null || request.payload == null
                                ? "E_ACTION_SCHEMA_INVALID"
                                : request.payload.error_code,
                            error_message = request == null || request.payload == null
                                ? "Visual action execution failed."
                                : request.payload.error_message,
                            message = request == null || request.payload == null
                                ? "Visual action execution failed."
                                : request.payload.error_message,
                        }),
            };
            var controller = CreateController(gateway, stateStore);

            controller.SendRuntimePingAsync().GetAwaiter().GetResult();

            Assert.NotNull(gateway.LastActionResultRequest);
            Assert.NotNull(gateway.LastActionResultRequest.payload);
            Assert.IsFalse(gateway.LastActionResultRequest.payload.success);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", gateway.LastActionResultRequest.payload.error_code);
            Assert.IsTrue(
                (gateway.LastActionResultRequest.payload.error_message ?? string.Empty)
                    .Contains("target_anchor/parent_anchor"));
            Assert.IsFalse(controller.IsBusy);
            Assert.NotNull(stateStore.LastSaved);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", stateStore.LastSaved.last_error_code);
            Assert.AreNotEqual("E_JOB_MAX_RUNTIME_EXCEEDED", stateStore.LastSaved.last_error_code);
        }

        [Test]
        public void SendRuntimePingAsync_MutationWithMalformedOptionalParentAnchor_AllowsExecutionAndReportsSuccess()
        {
            var stateStore = new InMemoryConversationStateStore(null);
            var gateway = new FakeSidecarGateway
            {
                RuntimePingResponseFactory = () =>
                    GatewayOk(
                        new UnityRuntimePingResponse
                        {
                            ok = true,
                            @event = "job.progress",
                            request_id = "req_hf02",
                            status = "pending",
                            state = "running",
                            stage = "action_confirm_pending",
                            unity_action_request = new UnityActionRequestEnvelope
                            {
                                request_id = "req_hf02",
                                turn_id = "turn_hf02",
                                payload = new UnityActionRequestPayload
                                {
                                    based_on_read_token = "tok_anchor_hf_22345678901234567890",
                                    write_anchor = new UnityObjectAnchor
                                    {
                                        object_id = "go_target",
                                        path = "Scene/Canvas/Panel",
                                    },
                                    requires_confirmation = false,
                                    action = new VisualLayerActionItem
                                    {
                                        type = "rename_object",
                                        target_anchor = new UnityObjectAnchor
                                        {
                                            object_id = "go_target",
                                            path = "Scene/Canvas/Panel",
                                        },
                                        parent_anchor = new UnityObjectAnchor
                                        {
                                            object_id = "go_parent",
                                            path = string.Empty,
                                        },
                                        action_data_json = "{\"name\":\"A\"}",
                                    }
                                }
                            }
                        }),
                ActionResponseFactory = request =>
                    GatewayOk(
                        new UnityActionReportResponse
                        {
                            ok = true,
                            @event = "job.completed",
                            request_id = request == null ? string.Empty : request.request_id,
                            status = "succeeded",
                            state = "completed",
                            stage = "completed",
                            message = "Action completed.",
                        }),
            };
            var executor = new FakeUnityVisualActionExecutor();
            var controller = CreateController(gateway, stateStore, executor);

            controller.SendRuntimePingAsync().GetAwaiter().GetResult();

            Assert.AreEqual(0, executor.ExecuteCount);
            Assert.IsNull(executor.LastAction);
            Assert.NotNull(gateway.LastActionResultRequest);
            Assert.NotNull(gateway.LastActionResultRequest.payload);
            Assert.IsFalse(gateway.LastActionResultRequest.payload.success);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", gateway.LastActionResultRequest.payload.error_code);
            Assert.IsTrue(
                (gateway.LastActionResultRequest.payload.error_message ?? string.Empty)
                    .Contains("target_anchor/parent_anchor"));
            Assert.IsFalse(controller.IsBusy);
            Assert.NotNull(stateStore.LastSaved);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", stateStore.LastSaved.last_error_code);
            Assert.AreNotEqual("E_JOB_MAX_RUNTIME_EXCEEDED", stateStore.LastSaved.last_error_code);
        }

        [Test]
        public void UnityRuntimeReloadPingBootstrap_NormalizeGatewayState_AutoCancelCodeMapsToCancelled()
        {
            var method = typeof(UnityRuntimeReloadPingBootstrap).GetMethod(
                "NormalizeGatewayState",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);

            var normalized = method.Invoke(
                null,
                new object[] { string.Empty, string.Empty, "E_JOB_HEARTBEAT_TIMEOUT" }) as string;

            Assert.AreEqual("cancelled", normalized);
        }

        [Test]
        public void UnityRuntimeReloadPingBootstrap_RebootWaitMapping_IsStable()
        {
            var mapStateMethod = typeof(UnityRuntimeReloadPingBootstrap).GetMethod(
                "MapRuntimeState",
                BindingFlags.NonPublic | BindingFlags.Static);
            var mapReasonMethod = typeof(UnityRuntimeReloadPingBootstrap).GetMethod(
                "MapBusyReason",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(mapStateMethod);
            Assert.NotNull(mapReasonMethod);

            var runtimeState = (TurnRuntimeState)mapStateMethod.Invoke(
                null,
                new object[] { "waiting_for_unity_reboot" });
            var busyReason = mapReasonMethod.Invoke(
                null,
                new object[] { "waiting_for_unity_reboot" }) as string;

            Assert.AreEqual(TurnRuntimeState.ActionExecuting, runtimeState);
            Assert.AreEqual("Waiting For Unity Reboot", busyReason);
        }

        [Test]
        public void ReportCapabilitiesAsync_SendsRegisteredActionsAndVersion()
        {
            var stateStore = new InMemoryConversationStateStore(null);
            var gateway = new FakeSidecarGateway();
            var controller = CreateController(gateway, stateStore);

            var ok = controller.ReportCapabilitiesAsync("test", true).GetAwaiter().GetResult();

            Assert.IsTrue(ok);
            Assert.NotNull(gateway.LastCapabilitiesRequest);
            Assert.AreEqual("unity.capabilities.report", gateway.LastCapabilitiesRequest.@event);
            Assert.NotNull(gateway.LastCapabilitiesRequest.payload);
            Assert.IsNotEmpty(gateway.LastCapabilitiesRequest.payload.capability_version);
            Assert.NotNull(gateway.LastCapabilitiesRequest.payload.actions);
            Assert.GreaterOrEqual(gateway.LastCapabilitiesRequest.payload.actions.Length, 4);
            Assert.IsFalse(string.IsNullOrEmpty(gateway.LastCapabilitiesRequest.payload.actions[0].domain));
            Assert.IsFalse(string.IsNullOrEmpty(gateway.LastCapabilitiesRequest.payload.actions[0].tier));
            Assert.IsFalse(string.IsNullOrEmpty(gateway.LastCapabilitiesRequest.payload.actions[0].lifecycle));
            Assert.IsFalse(string.IsNullOrEmpty(gateway.LastCapabilitiesRequest.payload.actions[0].undo_safety));
        }

        private static ConversationController CreateController(
            ISidecarGateway gateway,
            IConversationStateStore stateStore,
            IUnityVisualActionExecutor visualActionExecutor = null)
        {
            return new ConversationController(
                gateway,
                new FakeSidecarProcessManager(),
                new FakeSelectionContextBuilder(),
                stateStore,
                visualActionExecutor ?? new FakeUnityVisualActionExecutor());
        }

        private static GatewayResponse<T> GatewayOk<T>(T data) where T : class
        {
            return new GatewayResponse<T>
            {
                TransportSuccess = true,
                StatusCode = 200,
                Data = data,
                ErrorMessage = string.Empty,
            };
        }

        private sealed class InMemoryConversationStateStore : IConversationStateStore
        {
            private PersistedConversationState _state;

            public InMemoryConversationStateStore(PersistedConversationState initial)
            {
                _state = initial;
            }

            public PersistedConversationState LastSaved { get; private set; }

            public PersistedConversationState Load()
            {
                return _state;
            }

            public void Save(PersistedConversationState state)
            {
                LastSaved = state;
                _state = state;
            }

            public void Clear()
            {
                _state = null;
                LastSaved = null;
            }
        }

        private sealed class FakeSidecarGateway : ISidecarGateway
        {
            public System.Func<GatewayResponse<UnityRuntimePingResponse>> RuntimePingResponseFactory;
            public System.Func<GatewayResponse<UnityCapabilitiesReportResponse>> CapabilityResponseFactory;
            public System.Func<UnityActionResultRequest, GatewayResponse<UnityActionReportResponse>> ActionResponseFactory;
            public UnityCapabilitiesReportRequest LastCapabilitiesRequest;
            public UnityActionResultRequest LastActionResultRequest;

            public Task<GatewayResponse<HealthResponse>> GetHealthAsync(string baseUrl)
            {
                return Task.FromResult(GatewayOk(new HealthResponse { ok = true }));
            }

            public Task<GatewayResponse<SidecarStateSnapshotResponse>> GetStateSnapshotAsync(string baseUrl)
            {
                return Task.FromResult(GatewayOk(new SidecarStateSnapshotResponse { ok = true }));
            }

            public Task<GatewayResponse<FilesChangedEnvelopeResponse>> ApplyFileActionsAsync(
                string baseUrl,
                FileActionsApplyRequest request)
            {
                return Task.FromResult(
                    GatewayOk(
                        new FilesChangedEnvelopeResponse
                        {
                            payload = new FilesChangedPayload
                            {
                                changes = new FileChangeItem[0],
                                compile_request = null,
                            },
                        }));
            }

            public Task<GatewayResponse<UnitySelectionSnapshotResponse>> ReportSelectionSnapshotAsync(
                string baseUrl,
                UnitySelectionSnapshotRequest request)
            {
                return Task.FromResult(GatewayOk(new UnitySelectionSnapshotResponse { ok = true }));
            }

            public Task<GatewayResponse<UnityConsoleSnapshotResponse>> ReportConsoleSnapshotAsync(
                string baseUrl,
                UnityConsoleSnapshotRequest request)
            {
                return Task.FromResult(GatewayOk(new UnityConsoleSnapshotResponse { ok = true }));
            }

            public Task<GatewayResponse<UnityRuntimePingResponse>> ReportRuntimePingAsync(
                string baseUrl,
                UnityRuntimePingRequest request)
            {
                var response = RuntimePingResponseFactory != null
                    ? RuntimePingResponseFactory()
                    : GatewayOk(new UnityRuntimePingResponse { ok = true, state = "idle", status = "cancelled" });
                return Task.FromResult(response);
            }

            public Task<GatewayResponse<UnityCapabilitiesReportResponse>> ReportUnityCapabilitiesAsync(
                string baseUrl,
                UnityCapabilitiesReportRequest request)
            {
                LastCapabilitiesRequest = request;
                var response = CapabilityResponseFactory != null
                    ? CapabilityResponseFactory()
                    : GatewayOk(
                        new UnityCapabilitiesReportResponse
                        {
                            ok = true,
                            @event = "unity.capabilities.accepted",
                            unity_connection_state = "ready",
                        });
                return Task.FromResult(response);
            }

            public Task<GatewayResponse<UnityCompileReportResponse>> ReportCompileResultAsync(
                string baseUrl,
                UnityCompileResultRequest request)
            {
                return Task.FromResult(GatewayOk(new UnityCompileReportResponse { ok = true }));
            }

            public Task<GatewayResponse<UnityActionReportResponse>> ReportUnityActionResultAsync(
                string baseUrl,
                UnityActionResultRequest request)
            {
                LastActionResultRequest = request;
                var response = ActionResponseFactory != null
                    ? ActionResponseFactory(request)
                    : GatewayOk(
                        new UnityActionReportResponse
                        {
                            ok = true,
                            @event = "job.completed",
                            request_id = request == null ? string.Empty : request.request_id,
                            status = "succeeded",
                            state = "completed",
                            stage = "completed",
                            message = "Action completed.",
                        });
                return Task.FromResult(response);
            }

            public Task<GatewayResponse<UnityQueryComponentsReportResponse>> ReportUnityComponentsQueryResultAsync(
                string baseUrl,
                UnityQueryComponentsResultRequest request)
            {
                return Task.FromResult(GatewayOk(new UnityQueryComponentsReportResponse { ok = true }));
            }

            public Task<GatewayResponse<UnityQueryPullResponse>> PullQueriesAsync(string baseUrl)
            {
                return Task.FromResult(
                    GatewayOk(
                        new UnityQueryPullResponse
                        {
                            ok = true,
                            pending = false,
                            query = null,
                        }));
            }

            public Task<GatewayResponse<UnityQueryReportResponse>> ReportQueryResultAsync(
                string baseUrl,
                string queryId,
                object payload)
            {
                return Task.FromResult(GatewayOk(new UnityQueryReportResponse { ok = true }));
            }
        }

        private sealed class FakeSidecarProcessManager : ISidecarProcessManager
        {
            public bool IsRunning
            {
                get { return true; }
            }

            public Task<SidecarStartResult> StartAsync(string sidecarUrl)
            {
                return Task.FromResult(
                    new SidecarStartResult
                    {
                        Success = true,
                        AlreadyRunning = true,
                        Message = "already running",
                    });
            }

            public SidecarStopResult Stop()
            {
                return new SidecarStopResult
                {
                    Success = true,
                    WasRunning = true,
                    Message = "stopped",
                };
            }
        }

        private sealed class FakeSelectionContextBuilder : ISelectionContextBuilder
        {
            public TurnContext BuildContext(GameObject selected, int maxDepth)
            {
                return null;
            }
        }

        private sealed class FakeUnityVisualActionExecutor : IUnityVisualActionExecutor
        {
            public int ExecuteCount { get; private set; }
            public VisualLayerActionItem LastAction { get; private set; }

            public UnityActionExecutionResult Execute(VisualLayerActionItem action, GameObject selected)
            {
                ExecuteCount++;
                LastAction = action;
                return new UnityActionExecutionResult
                {
                    success = true,
                    actionType = action == null ? string.Empty : action.type,
                    targetObjectPath = action == null || action.target_anchor == null ? string.Empty : action.target_anchor.path,
                    targetObjectId = action == null || action.target_anchor == null ? string.Empty : action.target_anchor.object_id,
                    errorCode = string.Empty,
                    errorMessage = string.Empty,
                };
            }
        }
    }
}

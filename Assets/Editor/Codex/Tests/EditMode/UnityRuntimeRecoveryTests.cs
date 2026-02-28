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

        private static ConversationController CreateController(
            ISidecarGateway gateway,
            IConversationStateStore stateStore)
        {
            return new ConversationController(
                gateway,
                new FakeSidecarProcessManager(),
                new FakeSelectionContextBuilder(),
                stateStore,
                new FakeUnityVisualActionExecutor());
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
                return Task.FromResult(GatewayOk(new UnityActionReportResponse { ok = true }));
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
            public UnityActionExecutionResult Execute(VisualLayerActionItem action, GameObject selected)
            {
                return new UnityActionExecutionResult
                {
                    success = true,
                    errorCode = string.Empty,
                    errorMessage = string.Empty,
                };
            }
        }
    }
}

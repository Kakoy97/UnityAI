using System;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Ports;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Application
{
    public sealed class ConversationController
    {
        private const int MaxLogEntries = 200;
        private const double PollIntervalSeconds = 0.6d;
        private const double CodexTimeoutSeconds = 60d;
        private const double CompileTimeoutSeconds = 120d;
        private static readonly bool EnableDiagnosticLogs = false;
        private const string MissingScriptShortName = "MissingScript";
        private const string MissingScriptAssemblyQualifiedName = "UnityEditor.MissingScript";
        private const string UnityQueryErrorBusyOrCompiling = "E_SELECTION_UNAVAILABLE";
        private const string UnityQueryErrorTargetNotFound = "E_TARGET_NOT_FOUND";
        private const string UnityQueryErrorFailed = "E_QUERY_HANDLER_FAILED";
        private const int MaxTransportErrorMessageLength = 320;
        private const int MaxConsoleConditionLength = 320;
        private const int MaxConsoleStackTraceLength = 640;
        private const int SelectionSnapshotMaxDepth = 2;
        private const int SelectionSnapshotIndexDepth = 6;
        private const int SelectionSnapshotIndexNodeBudget = 192;
        private const int ConsoleSnapshotMaxErrors = 50;
        private const double RuntimePingProbeIntervalSeconds = 4d;

        private readonly ISidecarGateway _sidecarGateway;
        private readonly ISidecarProcessManager _processManager;
        private readonly ISelectionContextBuilder _contextBuilder;
        private readonly IConversationStateStore _stateStore;
        private readonly IUnityVisualActionExecutor _visualActionExecutor;
        private readonly UnityRagReadService _ragReadService;
        private readonly SynchronizationContext _unitySynchronizationContext;
        private readonly List<UiLogEntry> _logs = new List<UiLogEntry>();

        private string _activeRequestId = string.Empty;
        private string _turnId = string.Empty;
        private double _compileDeadlineAt;
        private TurnRuntimeState _runtimeState = TurnRuntimeState.Idle;
        private string _lastTerminalEvent = string.Empty;
        private string _lastErrorCode = string.Empty;
        private string _lastMessage = string.Empty;
        private string _lastSmokeScriptPath = "Assets/Scripts/AIGenerated/Phase6Smoke/HelloPhase6.cs";
        private long _compileGateOpenedAtUtcTicks;
        private bool _compileResultAutoReportInFlight;
        private double _lastCompilePendingHeartbeatAt;
        private bool _compileRefreshIssued;
        private double _lastCompileRefreshAt;
        private string _pendingCompileComponentAssemblyQualifiedName = string.Empty;
        private UnityActionRequestEnvelope _pendingUnityActionRequest;
        private int _transportErrorStreak;
        private double _lastTransportErrorLogAt;
        private bool _selectionSnapshotInFlight;
        private string _lastSelectionSnapshotSignature = string.Empty;
        private bool _consoleSnapshotInFlight;
        private string _lastConsoleSnapshotSignature = string.Empty;
        private bool _ragQueryPollInFlight;
        private double _lastRagQueryPollAt;
        private bool _runtimePingProbeInFlight;
        private double _lastRuntimePingProbeAt;

        public ConversationController(
            ISidecarGateway sidecarGateway,
            ISidecarProcessManager processManager,
            ISelectionContextBuilder contextBuilder,
            IConversationStateStore stateStore,
            IUnityVisualActionExecutor visualActionExecutor)
        {
            _sidecarGateway = sidecarGateway;
            _processManager = processManager;
            _contextBuilder = contextBuilder;
            _stateStore = stateStore;
            _visualActionExecutor = visualActionExecutor;
            _ragReadService = new UnityRagReadService();
            _unitySynchronizationContext = SynchronizationContext.Current;

            SidecarUrl = "http://127.0.0.1:46321";
            ThreadId = "t_default";
            BusyReason = "Idle";
        }

        public event Action Changed;

        public string SidecarUrl { get; set; }
        public string ThreadId { get; set; }
        public bool IsBusy { get; private set; }
        public string BusyReason { get; private set; }
        public bool IsEditorCompiling
        {
            get { return EditorApplication.isCompiling; }
        }
        public bool CanReportCompileResult
        {
            get
            {
                return IsBusy &&
                       _runtimeState == TurnRuntimeState.CompilePending &&
                       !string.IsNullOrEmpty(_activeRequestId);
            }
        }

        public bool CanReportCompileSuccess
        {
            get
            {
                if (!CanReportCompileResult || IsEditorCompiling)
                {
                    return false;
                }

                return HasCompileFinishedForCurrentGate() && !HasCompileErrorsForCurrentGate();
            }
        }

        public bool CanReportCompileFailure
        {
            get
            {
                return CanReportCompileResult && !IsEditorCompiling && HasCompileFinishedForCurrentGate();
            }
        }

        public bool IsWaitingForCompileGateCompletion
        {
            get
            {
                return CanReportCompileResult && !IsEditorCompiling && !HasCompileFinishedForCurrentGate();
            }
        }

        public bool HasCompileGateErrors
        {
            get
            {
                return CanReportCompileResult &&
                       !IsEditorCompiling &&
                       HasCompileFinishedForCurrentGate() &&
                       HasCompileErrorsForCurrentGate();
            }
        }
        public bool CanConfirmPendingAction
        {
            get
            {
                return IsBusy &&
                       _runtimeState == TurnRuntimeState.ActionConfirmPending &&
                       _pendingUnityActionRequest != null &&
                       _pendingUnityActionRequest.payload != null &&
                       _pendingUnityActionRequest.payload.action != null;
            }
        }
        public IReadOnlyList<UiLogEntry> Logs { get { return _logs; } }
        public string ActiveRequestId { get { return _activeRequestId; } }
        public bool IsWaitingForCodexReply
        {
            get
            {
                return false; // L3 no longer handles Codex/LLM phases
            }
        }

        public void InitializeFromPersistedState()
        {
            var persisted = _stateStore.Load();
            if (persisted == null)
            {
                return;
            }

            if (!string.IsNullOrEmpty(persisted.thread_id))
            {
                ThreadId = persisted.thread_id;
            }

            _lastTerminalEvent = persisted.last_terminal_event ?? string.Empty;
            _lastErrorCode = persisted.last_error_code ?? string.Empty;
            _lastMessage = persisted.last_message ?? string.Empty;

            TurnRuntimeState parsedState;
            if (Enum.TryParse(persisted.runtime_state, out parsedState))
            {
                _runtimeState = parsedState;
            }

            if (persisted.is_busy && !string.IsNullOrEmpty(persisted.active_request_id))
            {
                IsBusy = true;
                if (!string.IsNullOrEmpty(persisted.pending_action_request_id))
                {
                    _activeRequestId = persisted.pending_action_request_id;
                }
                else if (!string.IsNullOrEmpty(persisted.pending_compile_request_id))
                {
                    _activeRequestId = persisted.pending_compile_request_id;
                }
                else
                {
                    _activeRequestId = persisted.active_request_id;
                }
                _turnId = persisted.turn_id ?? string.Empty;
                BusyReason = string.IsNullOrEmpty(persisted.busy_reason)
                    ? "Recovered"
                    : persisted.busy_reason;
                ResetDeadlinesForState(EditorApplicationTimeFallback());
                AddLog(UiLogLevel.Warning, "Recovered pending turn from EditorPrefs state.");
            }
            else if (!string.IsNullOrEmpty(_lastTerminalEvent))
            {
                AddLog(
                    UiLogLevel.Info,
                    "Recovered last terminal event: " + _lastTerminalEvent + " " +
                    (!string.IsNullOrEmpty(_lastErrorCode) ? "(" + _lastErrorCode + ")" : string.Empty));
            }

            SaveState();
        }

        public async Task StartSidecarAsync()
        {
            var result = await _processManager.StartAsync(SidecarUrl);
            if (result.AlreadyRunning)
            {
                AddLog(UiLogLevel.Warning, result.Message);
                await CheckHealthAsync();
                await SyncWithSidecarSnapshotAsync(EditorApplicationTimeFallback());
                await SendRuntimePingInternalAsync("just_recompiled", false);
                await ReportSelectionSnapshotAsync(Selection.activeGameObject, "startup_sync", true);
                await ReportConsoleSnapshotAsync("startup_sync", true);
                return;
            }

            if (!result.Success)
            {
                AddLog(UiLogLevel.Error, result.Message);
                return;
            }

            AddLog(UiLogLevel.Info, result.Message);
            await CheckHealthAsync();
            await SyncWithSidecarSnapshotAsync(EditorApplicationTimeFallback());
            await SendRuntimePingInternalAsync("just_recompiled", false);
            await ReportSelectionSnapshotAsync(Selection.activeGameObject, "startup_sync", true);
            await ReportConsoleSnapshotAsync("startup_sync", true);
        }

        public void StopSidecar()
        {
            var result = _processManager.Stop();

            if (IsBusy)
            {
                ForceLocalAbort(
                    "E_SIDECAR_STOPPED",
                    "Sidecar stopped while a turn was active. Local turn state has been cleared.");
            }
            else
            {
                SaveState();
            }

            if (result.Success && result.WasRunning)
            {
                AddLog(UiLogLevel.Info, result.Message);
                return;
            }

            if (result.Success)
            {
                AddLog(UiLogLevel.Warning, result.Message);
                return;
            }

            AddLog(UiLogLevel.Error, result.Message);
        }

        public async Task CheckHealthAsync()
        {
            var result = await _sidecarGateway.GetHealthAsync(SidecarUrl);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "Health check failed: " + result.ErrorMessage);
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "Health check failed: HTTP " + result.StatusCode);
                return;
            }

            if (result.Data == null)
            {
                AddLog(UiLogLevel.Error, "Health response parse failed.");
                return;
            }

            AddLog(
                UiLogLevel.Info,
                "Health ok=" + result.Data.ok +
                " active_request_id=" + SafeString(result.Data.active_request_id));
        }

        public void NotifySelectionChanged(GameObject selected)
        {
            _ = ReportSelectionSnapshotAsync(selected, "selection_changed", false);
        }

        public async Task ReportSelectionSnapshotAsync(GameObject selected, string reason, bool force)
        {
            if (_selectionSnapshotInFlight && !force)
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(ThreadId))
            {
                ThreadId = "t_default";
            }

            var normalizedReason = string.IsNullOrWhiteSpace(reason)
                ? "selection_changed"
                : reason.Trim();
            var snapshotRequestId = "req_selection_" + Guid.NewGuid().ToString("N");
            var snapshotTurnId = "u_selection_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var request = new UnitySelectionSnapshotRequest
            {
                @event = "unity.selection.snapshot",
                request_id = snapshotRequestId,
                thread_id = ThreadId,
                turn_id = snapshotTurnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnitySelectionSnapshotPayload
                {
                    reason = normalizedReason,
                    selection_empty = selected == null,
                    context = null,
                    component_index = null
                }
            };

            string signature;
            if (selected == null)
            {
                signature = "empty";
            }
            else
            {
                var context = _contextBuilder.BuildContext(selected, SelectionSnapshotMaxDepth);
                request.payload.context = context;
                request.payload.component_index = BuildSelectionComponentIndex(
                    selected,
                    SelectionSnapshotIndexDepth,
                    SelectionSnapshotIndexNodeBudget);
                signature =
                    (context != null && !string.IsNullOrEmpty(context.scene_revision)
                        ? context.scene_revision
                        : "rev_unknown") +
                    "|" +
                    BuildSelectedPath(selected);
            }

            if (!force && string.Equals(signature, _lastSelectionSnapshotSignature, StringComparison.Ordinal))
            {
                return;
            }

            _selectionSnapshotInFlight = true;
            try
            {
                var result = await _sidecarGateway.ReportSelectionSnapshotAsync(SidecarUrl, request);
                if (!result.TransportSuccess || !result.IsHttpSuccess || result.Data == null || !result.Data.ok)
                {
                    if (force)
                    {
                        AddLog(
                            UiLogLevel.Warning,
                            "unity.selection.snapshot failed: " +
                            (result.TransportSuccess
                                ? ReadErrorCode(result)
                                : result.ErrorMessage));
                    }
                    return;
                }

                _lastSelectionSnapshotSignature = signature;
            }
            finally
            {
                _selectionSnapshotInFlight = false;
            }
        }

        public async Task ReportConsoleSnapshotAsync(string reason, bool force)
        {
            if (_consoleSnapshotInFlight && !force)
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(ThreadId))
            {
                ThreadId = "t_default";
            }

            var normalizedReason = string.IsNullOrWhiteSpace(reason)
                ? "console_probe"
                : reason.Trim();
            var errors = BuildConsoleErrorItemsForSnapshot(ConsoleSnapshotMaxErrors);
            var signature = BuildConsoleSnapshotSignature(errors);
            if (!force && string.Equals(signature, _lastConsoleSnapshotSignature, StringComparison.Ordinal))
            {
                return;
            }

            var request = new UnityConsoleSnapshotRequest
            {
                @event = "unity.console.snapshot",
                request_id = "req_console_" + Guid.NewGuid().ToString("N"),
                thread_id = ThreadId,
                turn_id = "u_console_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityConsoleSnapshotPayload
                {
                    reason = normalizedReason,
                    errors = errors
                }
            };

            _consoleSnapshotInFlight = true;
            try
            {
                var result = await _sidecarGateway.ReportConsoleSnapshotAsync(SidecarUrl, request);
                if (!result.TransportSuccess || !result.IsHttpSuccess || result.Data == null || !result.Data.ok)
                {
                    if (force)
                    {
                        AddLog(
                            UiLogLevel.Warning,
                            "unity.console.snapshot failed: " +
                            (result.TransportSuccess
                                ? ReadErrorCode(result)
                                : result.ErrorMessage));
                    }

                    return;
                }

                _lastConsoleSnapshotSignature = signature;
            }
            finally
            {
                _consoleSnapshotInFlight = false;
            }
        }

        public async Task ApplyPhase6SmokeWriteAsync(GameObject selected)
        {
            if (IsBusy)
            {
                AddLog(UiLogLevel.Warning, "Cannot run file action smoke test while a turn is in progress.");
                return;
            }

            if (selected == null)
            {
                AddLog(UiLogLevel.Error, "Pre-flight failed: please select a target GameObject in Hierarchy.");
                return;
            }

            var requestId = "req_file_" + Guid.NewGuid().ToString("N");
            var turnId = "u_file_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var smokeSuffix = requestId.Replace("req_file_", string.Empty).Substring(0, 8);
            var className = "HelloPhase6_" + smokeSuffix;
            var scriptPath = "Assets/Scripts/AIGenerated/Phase6Smoke/" + className + ".cs";
            var selectedPath = BuildSelectedPath(selected);
            var selectedObjectId = BuildObjectId(selected);
            _lastSmokeScriptPath = scriptPath;
            _pendingCompileComponentAssemblyQualifiedName = className + ", Assembly-CSharp";
            var request = new FileActionsApplyRequest
            {
                @event = "file_actions.apply",
                request_id = requestId,
                thread_id = ThreadId,
                turn_id = turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new FileActionsApplyPayload
                {
                    file_actions = new[]
                    {
                        new FileActionItem
                        {
                            type = "create_file",
                            path = scriptPath,
                            content =
                                "using UnityEngine;\n\n" +
                                "public class " + className + " : MonoBehaviour\n" +
                                "{\n" +
                                "    private void Start()\n" +
                                "    {\n" +
                                "        Debug.Log(\"Hello from Phase 6 smoke file action\");\n" +
                                "    }\n" +
                                "}\n",
                            overwrite_if_exists = true
                        }
                    },
                    visual_layer_actions = new[]
                    {
                        new VisualLayerActionItem
                        {
                            type = "add_component",
                            target_anchor = new UnityObjectAnchor
                            {
                                object_id = selectedObjectId,
                                path = selectedPath
                            },
                            component_assembly_qualified_name = _pendingCompileComponentAssemblyQualifiedName
                        }
                    }
                }
            };

            AddLog(UiLogLevel.Info, "file_actions.apply => " + requestId);

            var result = await _sidecarGateway.ApplyFileActionsAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "file_actions.apply failed: " + result.ErrorMessage);
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "file_actions.apply rejected: " + ReadErrorCode(result));
                return;
            }

            var response = result.Data;
            if (response == null || response.payload == null || response.payload.changes == null)
            {
                AddLog(UiLogLevel.Error, "file_actions.apply response parse failed.");
                return;
            }

            var count = response.payload.changes.Length;
            AddLog(UiLogLevel.Info, "files.changed: " + count + " file(s).");
            for (var i = 0; i < response.payload.changes.Length; i++)
            {
                var item = response.payload.changes[i];
                AddLog(UiLogLevel.Info, " - " + item.type + ": " + item.path);
            }

            _activeRequestId = requestId;
            _turnId = turnId;
            IsBusy = true;
            BusyReason = "Compile Pending";
            _runtimeState = TurnRuntimeState.CompilePending;
            _compileDeadlineAt = EditorApplicationTimeFallback() + CompileTimeoutSeconds;
            _compileGateOpenedAtUtcTicks = DateTime.UtcNow.Ticks;
            _compileResultAutoReportInFlight = false;
            _lastCompilePendingHeartbeatAt = EditorApplicationTimeFallback();
            _compileRefreshIssued = true;
            _lastCompileRefreshAt = EditorApplicationTimeFallback();
            _pendingUnityActionRequest = null;
            SaveState();
            EmitChanged();
            AddLog(UiLogLevel.Info, "Compile gate opened. Step 2/3: refreshing assets and waiting Unity compile.");
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            AddLog(UiLogLevel.Info, "Compile result will be auto-reported when Unity finishes compiling.");
        }

        public async Task ReportCompileResultAsync(bool success)
        {
            if (!CanReportCompileResult)
            {
                AddLog(UiLogLevel.Warning, "No compile_pending turn to report.");
                return;
            }

            if (success && EditorApplication.isCompiling)
            {
                AddLog(UiLogLevel.Warning, "Unity is still compiling. Wait for compile to finish before reporting success.");
                return;
            }

            if (success && !HasCompileFinishedForCurrentGate())
            {
                if (!CanInferCompileSuccessFromLoadedType())
                {
                    AddLog(UiLogLevel.Warning, "No completed compile detected for this turn yet. Wait until Unity finishes compiling.");
                    return;
                }

                AddLog(UiLogLevel.Warning, "Compile finish event missing; continue with inferred success from resolved component type.");
            }

            if (success && HasCompileErrorsForCurrentGate())
            {
                var errorCount = UnityCompilationStateTracker.GetLastCompilationErrorCountSince(_compileGateOpenedAtUtcTicks);
                AddLog(
                    UiLogLevel.Warning,
                    "Last compile finished with " + errorCount + " error(s). Report failure instead of success.");
                return;
            }

            var request = new UnityCompileResultRequest
            {
                @event = "unity.compile.result",
                request_id = _activeRequestId,
                thread_id = ThreadId,
                turn_id = _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityCompileResultPayload
                {
                    success = success,
                    duration_ms = 0,
                    errors = BuildCompileErrorItemsForReport(success)
                }
            };

            AddLog(
                UiLogLevel.Info,
                "unity.compile.result => " + _activeRequestId + " success=" + success);

            await ReportConsoleSnapshotAsync("compile_result", true);

            var result = await _sidecarGateway.ReportCompileResultAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.compile.result failed: " + result.ErrorMessage);
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.compile.result rejected: " + ReadErrorCode(result));
                return;
            }

            var report = result.Data;
            if (report == null)
            {
                AddLog(UiLogLevel.Error, "unity.compile.result response parse failed.");
                return;
            }

            // AutoFix removed - no longer logging auto fix progress

            var status = ToTurnStatus(report);
            LogStatusDiagnostics("unity.compile.result.response", status);
            if (IsTerminalStatus(status))
            {
                HandleTerminalStatus(status);
                return;
            }

            if (TryCapturePendingUnityActionRequest(
                    report.unity_action_request,
                    "unity.compile.result",
                    status != null ? status.request_id : string.Empty))
            {
                await HandleCapturedPendingActionAsync(
                    "unity.compile.result",
                    "Received unity.action.request. Waiting for confirmation.");
                return;
            }

            ApplyStage(status.stage, EditorApplicationTimeFallback());
            BusyReason = BuildBusyReasonForRuntimeState();
            SaveState();
            EmitChanged();
        }

        public async Task SendRuntimePingAsync()
        {
            await SendRuntimePingInternalAsync("just_recompiled", true);
        }

        public async Task PollRagQueriesAsync(double now)
        {
            if (_ragQueryPollInFlight)
            {
                return;
            }
            if (_lastRagQueryPollAt > 0d && now - _lastRagQueryPollAt < PollIntervalSeconds)
            {
                return;
            }

            _ragQueryPollInFlight = true;
            _lastRagQueryPollAt = now;
            try
            {
                await TryHandlePulledReadQueryAsync();
                await TryBackgroundRuntimePingAsync(now);
                await TryAutoReportCompileResultAsync();
                TryTripTimeout(now);
            }
            catch (Exception ex)
            {
                AddLog(
                    UiLogLevel.Error,
                    "poll loop failed: " + NormalizeErrorMessageForTransport(
                        ex == null ? string.Empty : ex.Message,
                        "poll loop failed."));
                Debug.LogError("[Codex] PollRagQueriesAsync failed: " + ex);
            }
            finally
            {
                _ragQueryPollInFlight = false;
            }
        }

        private async Task TryBackgroundRuntimePingAsync(double now)
        {
            if (_runtimePingProbeInFlight)
            {
                return;
            }

            if (_lastRuntimePingProbeAt > 0d &&
                now - _lastRuntimePingProbeAt < RuntimePingProbeIntervalSeconds)
            {
                return;
            }

            _runtimePingProbeInFlight = true;
            _lastRuntimePingProbeAt = now;
            try
            {
                await SendRuntimePingInternalAsync("heartbeat", false);
            }
            finally
            {
                _runtimePingProbeInFlight = false;
            }
        }

        public async Task ConfirmPendingActionAsync(GameObject selected)
        {
            await ExecutePendingActionAndReportAsync(selected, true);
        }

        public async Task RejectPendingActionAsync(GameObject selected)
        {
            await ExecutePendingActionAndReportAsync(selected, false);
        }

        private async Task ExecutePendingActionAndReportAsync(GameObject selected, bool approved)
        {
            if (!CanConfirmPendingAction)
            {
                AddLog(UiLogLevel.Warning, "No pending unity.action.request to handle.");
                Debug.LogWarning("[Codex] No pending unity.action.request to handle.");
                return;
            }

            if (approved && EditorApplication.isCompiling)
            {
                AddLog(UiLogLevel.Warning, "Unity is still compiling. Please approve action after compile completes.");
                Debug.LogWarning("[Codex] Pending action blocked because Unity is compiling.");
                return;
            }

            var actionEnvelope = _pendingUnityActionRequest;
            var action = actionEnvelope.payload.action;

            UnityActionExecutionResult execution;
            if (approved && !IsActionPayloadValid(action))
            {
                AddLog(
                    UiLogLevel.Warning,
                    "Pending action schema check failed on execution gate. Execution blocked.");
                execution = new UnityActionExecutionResult
                {
                    actionType = action != null ? action.type : string.Empty,
                    targetObjectPath = action == null ? string.Empty : ReadAnchorPath(action.target_anchor),
                    targetObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.target_anchor),
                    componentAssemblyQualifiedName =
                        action == null ? string.Empty : action.component_assembly_qualified_name,
                    sourceComponentAssemblyQualifiedName =
                        action == null ? string.Empty : action.source_component_assembly_qualified_name,
                    createdObjectPath = string.Empty,
                    createdObjectId = string.Empty,
                    name = action == null ? string.Empty : action.name,
                    parentObjectPath = action == null ? string.Empty : ReadAnchorPath(action.parent_anchor),
                    parentObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.parent_anchor),
                    primitiveType = action == null ? string.Empty : action.primitive_type,
                    uiType = action == null ? string.Empty : action.ui_type,
                    success = false,
                    errorCode = "E_ACTION_SCHEMA_INVALID",
                    errorMessage = "Visual action payload failed L3 pre-execution schema validation.",
                    durationMs = 0
                };
            }
            else if (approved)
            {
                execution = _visualActionExecutor.Execute(action, selected);
                if (!execution.success && execution.errorCode == "E_ACTION_COMPONENT_RESOLVE_FAILED")
                {
                    AddLog(UiLogLevel.Warning, "Component unresolved on first try. Refreshing assets and retrying once.");
                    AssetDatabase.Refresh();
                    await Task.Delay(300);
                    execution = _visualActionExecutor.Execute(action, selected);
                    if (!execution.success && execution.errorCode == "E_ACTION_COMPONENT_RESOLVE_FAILED")
                    {
                        AddLog(
                            UiLogLevel.Warning,
                            "Component is still unresolved after retry. This usually means compile did not actually succeed for this script.");
                    }
                }
            }
            else
            {
                var rejectedTargetPath = ReadAnchorPath(action.target_anchor);
                var rejectedTargetObjectId = ReadAnchorObjectId(action.target_anchor);
                var rejectedParentPath = ReadAnchorPath(action.parent_anchor);
                var rejectedParentObjectId = ReadAnchorObjectId(action.parent_anchor);
                execution = new UnityActionExecutionResult
                {
                    actionType = action.type,
                    targetObjectPath = rejectedTargetPath,
                    targetObjectId = rejectedTargetObjectId,
                    componentAssemblyQualifiedName = action.component_assembly_qualified_name,
                    sourceComponentAssemblyQualifiedName = action.source_component_assembly_qualified_name,
                    createdObjectPath = string.Empty,
                    createdObjectId = string.Empty,
                    name = action.name,
                    parentObjectPath = rejectedParentPath,
                    parentObjectId = rejectedParentObjectId,
                    primitiveType = action.primitive_type,
                    uiType = action.ui_type,
                    success = false,
                    errorCode = "E_ACTION_CONFIRM_REJECTED",
                    errorMessage = "User rejected visual action confirmation.",
                    durationMs = 0
                };
            }

            if (approved && execution.success)
            {
                var postWriteSelection = selected != null
                    ? selected
                    : Selection.activeGameObject;
                if (postWriteSelection != null)
                {
                    await ReportSelectionSnapshotAsync(postWriteSelection, "action_post_write", true);
                }
            }

            var reportTarget = !string.IsNullOrWhiteSpace(execution.targetObjectPath)
                    ? execution.targetObjectPath
                    : execution.targetObjectId;
            var normalizedActionErrorCode = execution.success
                ? string.Empty
                : NormalizeErrorCodeForTransport(execution.errorCode, "E_ACTION_EXECUTION_FAILED");
            var normalizedActionErrorMessage = execution.success
                ? string.Empty
                : NormalizeErrorMessageForTransport(
                    execution.errorMessage,
                    "Visual action execution failed.");

            var request = new UnityActionResultRequest
            {
                @event = "unity.action.result",
                request_id = _activeRequestId,
                thread_id = ThreadId,
                turn_id = _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityActionResultPayload
                {
                    action_type = execution.actionType,
                    target = reportTarget,
                    target_object_path = execution.targetObjectPath,
                    target_object_id = execution.targetObjectId,
                    object_id = execution.targetObjectId,
                    component_assembly_qualified_name = execution.componentAssemblyQualifiedName,
                    source_component_assembly_qualified_name = execution.sourceComponentAssemblyQualifiedName,
                    created_object_path = execution.createdObjectPath,
                    created_object_id = execution.createdObjectId,
                    name = execution.name,
                    parent_object_path = execution.parentObjectPath,
                    parent_object_id = execution.parentObjectId,
                    primitive_type = execution.primitiveType,
                    ui_type = execution.uiType,
                    success = execution.success,
                    error_code = normalizedActionErrorCode,
                    error_message = normalizedActionErrorMessage,
                    duration_ms = execution.durationMs
                }
            };

            AddLog(
                UiLogLevel.Info,
                "unity.action.result => " + _activeRequestId +
                " success=" + execution.success +
                (execution.success ? string.Empty : " code=" + normalizedActionErrorCode));
            Debug.Log(
                "[Codex] unity.action.result => " + _activeRequestId +
                " success=" + execution.success +
                (execution.success ? string.Empty : " code=" + normalizedActionErrorCode));

            _runtimeState = TurnRuntimeState.ActionExecuting;
            BusyReason = "Action Executing";
            SaveState();
            EmitChanged();

            var result = await _sidecarGateway.ReportUnityActionResultAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.action.result failed: " + result.ErrorMessage);
                Debug.LogWarning("[Codex] unity.action.result failed: " + result.ErrorMessage);
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.action.result rejected: " + ReadErrorCode(result));
                Debug.LogWarning("[Codex] unity.action.result rejected: " + ReadErrorCode(result));
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                return;
            }

            var report = result.Data;
            if (report == null)
            {
                AddLog(UiLogLevel.Error, "unity.action.result response parse failed.");
                Debug.LogWarning("[Codex] unity.action.result response parse failed.");
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                return;
            }

            // AutoFix removed - no longer logging auto fix progress

            var status = ToTurnStatus(report);
            LogStatusDiagnostics("unity.action.result.response", status);
            if (IsTerminalStatus(status))
            {
                HandleTerminalStatus(status);
                return;
            }

            if (TryCapturePendingUnityActionRequest(
                    report.unity_action_request,
                    "unity.action.result",
                    status != null ? status.request_id : string.Empty))
            {
                await HandleCapturedPendingActionAsync(
                    "unity.action.result",
                    "Next unity.action.request received. Waiting for confirmation.");
                return;
            }

            ApplyStage(status.stage, EditorApplicationTimeFallback());
            BusyReason = BuildBusyReasonForRuntimeState();
            SaveState();
            EmitChanged();
        }

        public string GetStatusText(double now)
        {
            if (!IsBusy)
            {
                return "Idle";
            }

            var spin = new[] { "|", "/", "-", "\\" };
            var index = (int)(now * 8d) % spin.Length;
            return BusyReason + " " + spin[index] + " (request_id=" + _activeRequestId + ")";
        }

        private async Task SyncWithSidecarSnapshotAsync(double now)
        {
            var result = await _sidecarGateway.GetStateSnapshotAsync(SidecarUrl);
            if (!result.TransportSuccess || !result.IsHttpSuccess || result.Data == null)
            {
                AddLog(UiLogLevel.Warning, "state.snapshot unavailable.");
                return;
            }

            var snapshot = result.Data;
            if (!snapshot.ok)
            {
                return;
            }

            if (!string.IsNullOrEmpty(snapshot.active_request_id))
            {
                _activeRequestId = snapshot.active_request_id;
                if (string.IsNullOrEmpty(_turnId))
                {
                    _turnId = "u_recovered";
                }
                IsBusy = true;
                BusyReason = "Recovered from sidecar snapshot";
                ApplyStage(snapshot.active_state, now);
                SaveState();
                EmitChanged();
                AddLog(UiLogLevel.Warning, "Recovered active turn from sidecar snapshot: " + _activeRequestId);
                return;
            }

            if (IsBusy && string.IsNullOrEmpty(snapshot.active_request_id))
            {
                AddLog(UiLogLevel.Warning, "Sidecar has no active turn; local busy state cleared.");
                UnlockTurn();
                SaveState();
            }
        }

        private async Task SendRuntimePingInternalAsync(string status, bool logWhenNoRecovery)
        {
            if (string.IsNullOrWhiteSpace(ThreadId))
            {
                ThreadId = "t_default";
            }

            var request = new UnityRuntimePingRequest
            {
                @event = "unity.runtime.ping",
                request_id = "req_ping_" + Guid.NewGuid().ToString("N"),
                thread_id = ThreadId,
                turn_id = string.IsNullOrEmpty(_turnId)
                    ? "u_ping_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    : _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityRuntimePingPayload
                {
                    status = string.IsNullOrEmpty(status) ? "just_recompiled" : status
                }
            };

            var result = await _sidecarGateway.ReportRuntimePingAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                MaybeLogTransportFailure(
                    EditorApplicationTimeFallback(),
                    "unity.runtime.ping failed: " + result.ErrorMessage);
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping failed: " + result.ErrorMessage);
                }
                return;
            }

            if (!result.IsHttpSuccess)
            {
                MaybeLogTransportFailure(
                    EditorApplicationTimeFallback(),
                    "unity.runtime.ping rejected: " + ReadErrorCode(result));
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping rejected: " + ReadErrorCode(result));
                }
                return;
            }

            var pong = result.Data;
            if (pong == null)
            {
                MaybeLogTransportFailure(
                    EditorApplicationTimeFallback(),
                    "unity.runtime.ping response parse failed.");
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping response parse failed.");
                }
                return;
            }

            var statusFromPing = ToTurnStatus(pong);
            if (EnableDiagnosticLogs)
            {
                AddLog(
                    UiLogLevel.Info,
                    "diag.runtime.ping.response: request_id=" + SafeString(pong.request_id) +
                    ", state=" + SafeString(statusFromPing == null ? string.Empty : statusFromPing.state) +
                    ", stage=" + SafeString(pong.stage) +
                    ", recovered=" + pong.recovered +
                    ", has_unity_action_request=" +
                    (pong.unity_action_request != null &&
                     pong.unity_action_request.payload != null &&
                     pong.unity_action_request.payload.action != null) + ".");
            }

            if (IsTerminalStatus(statusFromPing))
            {
                HandleTerminalStatus(statusFromPing);
                return;
            }

            var now = EditorApplicationTimeFallback();
            if (statusFromPing != null &&
                !string.IsNullOrEmpty(statusFromPing.request_id) &&
                string.Equals(statusFromPing.state, "running", StringComparison.Ordinal))
            {
                _activeRequestId = statusFromPing.request_id;
                if (string.IsNullOrEmpty(_turnId))
                {
                    _turnId = request.turn_id;
                }

                IsBusy = true;
                ApplyStage(statusFromPing.stage, now);
                if (TryCapturePendingUnityActionRequest(
                        statusFromPing.unity_action_request,
                        "unity.runtime.ping",
                        statusFromPing.request_id))
                {
                    await HandleCapturedPendingActionAsync(
                        "unity.runtime.ping",
                        "Received unity.action.request from runtime ping. Waiting for confirmation.");
                    return;
                }
                BusyReason = BuildBusyReasonForRuntimeState();
                SaveState();
                EmitChanged();
            }
            else if (IsBusy &&
                     statusFromPing != null &&
                     string.Equals(statusFromPing.state, "idle", StringComparison.Ordinal))
            {
                AddLog(UiLogLevel.Warning, "unity.runtime.ping: sidecar has no active job; clearing local busy state.");
                UnlockTurn();
                SaveState();
                return;
            }

            if (pong.recovered)
            {
                AddLog(UiLogLevel.Warning, "unity.runtime.ping recovered pending action from sidecar.");
                return;
            }

            if (logWhenNoRecovery)
            {
                var pingMessage =
                    statusFromPing != null && !string.IsNullOrEmpty(statusFromPing.message)
                        ? statusFromPing.message
                        : pong.message;
                AddLog(UiLogLevel.Info, "unity.runtime.ping: " + SafeString(pingMessage));
            }
        }

        private void ApplyStage(string stage, double now)
        {
            if (string.IsNullOrEmpty(stage))
            {
                return;
            }

            if (string.Equals(stage, "compile_pending", StringComparison.OrdinalIgnoreCase))
            {
                var enteringCompilePending = _runtimeState != TurnRuntimeState.CompilePending;
                _runtimeState = TurnRuntimeState.CompilePending;
                _compileDeadlineAt = now + CompileTimeoutSeconds;
                if (_compileGateOpenedAtUtcTicks <= 0L)
                {
                    _compileGateOpenedAtUtcTicks = DateTime.UtcNow.Ticks;
                }
                _compileResultAutoReportInFlight = false;
                if (_lastCompilePendingHeartbeatAt <= 0d)
                {
                    _lastCompilePendingHeartbeatAt = now;
                }
                if (enteringCompilePending)
                {
                    _compileRefreshIssued = false;
                    _lastCompileRefreshAt = 0d;
                }
                _pendingUnityActionRequest = null;
                return;
            }

            if (string.Equals(stage, "action_confirm_pending", StringComparison.OrdinalIgnoreCase))
            {
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                _compileDeadlineAt = 0d;
                return;
            }

            if (string.Equals(stage, "action_executing", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "action_pending", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "dispatch_pending", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "queued", StringComparison.OrdinalIgnoreCase))
            {
                _runtimeState = TurnRuntimeState.ActionExecuting;
                _compileDeadlineAt = 0d;
                return;
            }

            if (string.Equals(stage, "waiting_for_unity_reboot", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "WAITING_FOR_UNITY_REBOOT", StringComparison.Ordinal))
            {
                _runtimeState = TurnRuntimeState.ActionExecuting;
                _compileDeadlineAt = 0d;
            }
        }

        private bool TryTripTimeout(double now)
        {
            if (_runtimeState == TurnRuntimeState.CompilePending && _compileDeadlineAt > 0d && now > _compileDeadlineAt)
            {
                HandleLocalTimeout("E_COMPILE_TIMEOUT", "Compile phase timed out after 120s");
                return true;
            }

            return false;
        }

        private void HandleLocalTimeout(string errorCode, string message)
        {
            var synthetic = new TurnStatusResponse
            {
                request_id = _activeRequestId,
                state = "error",
                @event = "turn.error",
                message = message,
                error_code = errorCode,
                stage = "error"
            };
            HandleTerminalStatus(synthetic);
        }

        private void HandleLocalFailure(string errorCode, string message)
        {
            _runtimeState = TurnRuntimeState.Failed;
            _lastTerminalEvent = "turn.error";
            _lastErrorCode = errorCode;
            _lastMessage = message;
            AddLog(UiLogLevel.Error, message);
            UnlockTurn();
            SaveState();
        }

        private void HandleTerminalStatus(TurnStatusResponse status)
        {
            var state = NormalizeGatewayState(
                status == null ? string.Empty : status.state,
                status == null ? string.Empty : status.status,
                status == null ? string.Empty : status.error_code);
            if (string.IsNullOrEmpty(state))
            {
                state = "error";
            }

            var message =
                FirstNonEmpty(
                    status == null ? string.Empty : status.message,
                    status == null ? string.Empty : status.progress_message,
                    status == null ? string.Empty : status.error_message);
            if (string.IsNullOrEmpty(message))
            {
                message = "(no message)";
            }
            var eventName = string.IsNullOrEmpty(status == null ? string.Empty : status.@event)
                ? state
                : status.@event;

            _lastTerminalEvent = eventName;
            _lastErrorCode = status == null ? string.Empty : status.error_code ?? string.Empty;
            _lastMessage = message;

            if (state == "completed")
            {
                _runtimeState = TurnRuntimeState.Completed;
                LogAssistantMessage(message);
            }
            else if (state == "cancelled")
            {
                _runtimeState = TurnRuntimeState.Cancelled;
                AddLog(UiLogLevel.Warning, "turn.cancelled: " + message);
            }
            else
            {
                _runtimeState = TurnRuntimeState.Failed;
                AddLog(UiLogLevel.Error, "turn.error: " + message + BuildErrorCodeSuffix(_lastErrorCode));
            }

            if (status != null && !string.IsNullOrEmpty(status.suggestion))
            {
                AddLog(UiLogLevel.Info, "suggestion: " + status.suggestion);
            }

            UnlockTurn();
            SaveState();
        }

        private void UnlockTurn()
        {
            IsBusy = false;
            BusyReason = "Idle";
            _activeRequestId = string.Empty;
            _turnId = string.Empty;
            _runtimeState = TurnRuntimeState.Idle;
            _compileDeadlineAt = 0d;
            _compileGateOpenedAtUtcTicks = 0L;
            _compileResultAutoReportInFlight = false;
            _lastCompilePendingHeartbeatAt = 0d;
            _compileRefreshIssued = false;
            _lastCompileRefreshAt = 0d;
            _pendingCompileComponentAssemblyQualifiedName = string.Empty;
            _pendingUnityActionRequest = null;
            _transportErrorStreak = 0;
            _lastTransportErrorLogAt = 0d;
            EmitChanged();
        }

        private void AddLog(UiLogLevel level, string message, UiLogSource source = UiLogSource.System)
        {
            _logs.Add(new UiLogEntry(level, message, DateTime.Now, source));
            if (_logs.Count > MaxLogEntries)
            {
                _logs.RemoveAt(0);
            }

            EmitChanged();
        }

        private void SaveState()
        {
            var state = new PersistedConversationState
            {
                thread_id = ThreadId,
                is_busy = IsBusy,
                active_request_id = _activeRequestId,
                pending_compile_request_id =
                    _runtimeState == TurnRuntimeState.CompilePending
                        ? _activeRequestId
                        : string.Empty,
                pending_action_request_id =
                    _runtimeState == TurnRuntimeState.ActionConfirmPending ||
                    _runtimeState == TurnRuntimeState.ActionExecuting
                        ? _activeRequestId
                        : string.Empty,
                turn_id = _turnId,
                busy_reason = BusyReason,
                runtime_state = _runtimeState.ToString(),
                last_terminal_event = _lastTerminalEvent,
                last_error_code = _lastErrorCode,
                last_message = _lastMessage,
                updated_at = DateTime.UtcNow.ToString("o")
            };

            _stateStore.Save(state);
        }

        private void ResetDeadlinesForState(double now)
        {
            if (_runtimeState == TurnRuntimeState.CompilePending)
            {
                _compileDeadlineAt = now + CompileTimeoutSeconds;
                if (_compileGateOpenedAtUtcTicks <= 0L)
                {
                    _compileGateOpenedAtUtcTicks = DateTime.UtcNow.Ticks;
                }
                _compileRefreshIssued = false;
                _lastCompileRefreshAt = 0d;
                return;
            }

            if (_runtimeState == TurnRuntimeState.ActionConfirmPending ||
                _runtimeState == TurnRuntimeState.ActionExecuting)
            {
                _compileDeadlineAt = 0d;
                return;
            }

            _compileDeadlineAt = 0d;
        }

        private void LogStatusDiagnostics(string source, TurnStatusResponse status)
        {
            if (!EnableDiagnosticLogs || status == null)
            {
                return;
            }

            var hasUnityActionRequest =
                status.unity_action_request != null &&
                status.unity_action_request.payload != null &&
                status.unity_action_request.payload.action != null;
            AddLog(
                UiLogLevel.Info,
                "diag.status[" + SafeString(source) + "]: request_id=" + SafeString(status.request_id) +
                ", state=" + SafeString(status.state) +
                ", stage=" + SafeString(status.stage) +
                ", has_unity_action_request=" + hasUnityActionRequest + ".");
        }

        private static string BuildActionDebugText(VisualLayerActionItem action)
        {
            if (action == null)
            {
                return "null";
            }

            return
                "type=" + SafeString(action.type) +
                ", target_anchor=" + FormatAnchorDebug(action.target_anchor) +
                ", parent_anchor=" + FormatAnchorDebug(action.parent_anchor) +
                ", component=" + SafeString(action.component_assembly_qualified_name) +
                ", source_component=" + SafeString(action.source_component_assembly_qualified_name) +
                ", name=" + SafeString(action.name) +
                ", primitive_type=" + SafeString(action.primitive_type) +
                ", ui_type=" + SafeString(action.ui_type);
        }

        private bool TryCapturePendingUnityActionRequest(
            UnityActionRequestEnvelope envelope,
            string source,
            string statusRequestId)
        {
            var sourceTag = string.IsNullOrEmpty(source) ? "unknown" : source;
            if (envelope != null &&
                envelope.payload != null &&
                envelope.payload.action != null)
            {
                if (!IsActionPayloadValid(envelope.payload.action))
                {
                    LogDiagnostic(
                        UiLogLevel.Warning,
                        "diag.action.capture[" + sourceTag + "]: envelope action is incomplete, ignored. action=" +
                        BuildActionDebugText(envelope.payload.action) + ".");
                    Debug.LogWarning(
                        "[Codex] envelope action invalid; strict envelope mode keeps action pending.");
                }
                else
                {
                    LogDiagnostic(
                        UiLogLevel.Info,
                        "diag.action.capture[" + sourceTag + "]: source_request_id=" +
                        SafeString(statusRequestId) +
                        ", envelope_request_id=" + SafeString(envelope.request_id) +
                        ", action=" + BuildActionDebugText(envelope.payload.action) + ".");

                    if (!string.IsNullOrEmpty(statusRequestId) &&
                        !string.IsNullOrEmpty(envelope.request_id) &&
                        !string.Equals(statusRequestId, envelope.request_id, StringComparison.Ordinal))
                    {
                        LogDiagnostic(
                            UiLogLevel.Warning,
                            "diag.action.capture[" + sourceTag + "]: request_id mismatch (source=" +
                            statusRequestId + ", envelope=" + envelope.request_id + ").");
                    }

                    if (!string.IsNullOrEmpty(envelope.request_id))
                    {
                        _activeRequestId = envelope.request_id;
                    }

                    if (!string.IsNullOrEmpty(envelope.turn_id))
                    {
                        _turnId = envelope.turn_id;
                    }

                    if (!string.IsNullOrEmpty(envelope.payload.action.component_assembly_qualified_name))
                    {
                        _pendingCompileComponentAssemblyQualifiedName =
                            envelope.payload.action.component_assembly_qualified_name;
                    }

                    _pendingUnityActionRequest = envelope;
                    return true;
                }
            }

            LogDiagnostic(
                UiLogLevel.Warning,
                "diag.action.capture[" + sourceTag + "]: envelope missing or invalid; " +
                "pending action will not be synthesized from fallback fields. source_request_id=" +
                SafeString(statusRequestId) + ".");
            return false;
        }

        private async Task HandleCapturedPendingActionAsync(string source, string waitMessage)
        {
            _runtimeState = TurnRuntimeState.ActionConfirmPending;
            BusyReason = "Action Confirmation";
            SaveState();
            EmitChanged();

            if (!ShouldAutoApprovePendingAction())
            {
                AddLog(UiLogLevel.Info, waitMessage);
                Debug.Log("[Codex] " + waitMessage);
                return;
            }

            AddLog(
                UiLogLevel.Info,
                "Auto-approving unity.action.request (" + SafeString(source) + ").");
            Debug.Log(
                "[Codex] Auto-approving unity.action.request (" + SafeString(source) +
                "), request_id=" + SafeString(_activeRequestId));
            await ExecutePendingActionAndReportAsync(Selection.activeGameObject, true);
        }

        private bool ShouldAutoApprovePendingAction()
        {
            return _pendingUnityActionRequest != null &&
                   _pendingUnityActionRequest.payload != null &&
                   !_pendingUnityActionRequest.payload.requires_confirmation;
        }

        private static string FormatAnchorDebug(UnityObjectAnchor anchor)
        {
            if (anchor == null)
            {
                return "null";
            }

            return "{object_id=" + SafeString(anchor.object_id) + ", path=" + SafeString(anchor.path) + "}";
        }

        private static string ReadAnchorObjectId(UnityObjectAnchor anchor)
        {
            return anchor == null || string.IsNullOrWhiteSpace(anchor.object_id)
                ? string.Empty
                : anchor.object_id.Trim();
        }

        private static string ReadAnchorPath(UnityObjectAnchor anchor)
        {
            return anchor == null || string.IsNullOrWhiteSpace(anchor.path)
                ? string.Empty
                : anchor.path.Trim();
        }

        private static bool HasCompleteAnchor(UnityObjectAnchor anchor)
        {
            return !string.IsNullOrEmpty(ReadAnchorObjectId(anchor)) &&
                   !string.IsNullOrEmpty(ReadAnchorPath(anchor));
        }

        private static bool IsActionPayloadValid(VisualLayerActionItem action)
        {
            if (action == null)
            {
                return false;
            }

            if (string.IsNullOrWhiteSpace(action.type))
            {
                return false;
            }

            var hasTargetAnchor = HasCompleteAnchor(action.target_anchor);
            var hasParentAnchor = HasCompleteAnchor(action.parent_anchor);

            if (string.Equals(action.type, "add_component", StringComparison.Ordinal) ||
                string.Equals(action.type, "remove_component", StringComparison.Ordinal))
            {
                return hasTargetAnchor &&
                       !hasParentAnchor &&
                       !string.IsNullOrWhiteSpace(action.component_assembly_qualified_name);
            }

            if (string.Equals(action.type, "replace_component", StringComparison.Ordinal))
            {
                return hasTargetAnchor &&
                       !hasParentAnchor &&
                       !string.IsNullOrWhiteSpace(action.source_component_assembly_qualified_name) &&
                       !string.IsNullOrWhiteSpace(action.component_assembly_qualified_name);
            }

            if (string.Equals(action.type, "create_gameobject", StringComparison.Ordinal))
            {
                if (string.IsNullOrWhiteSpace(action.name))
                {
                    return false;
                }

                return hasParentAnchor &&
                       !hasTargetAnchor &&
                       (string.IsNullOrWhiteSpace(action.primitive_type) ||
                        string.IsNullOrWhiteSpace(action.ui_type));
            }

            return false;
        }

        private async Task HandleUnityQueryComponentsRequestAsync(UnityQueryComponentsRequestEnvelope envelope)
        {
            if (envelope == null || envelope.payload == null)
            {
                return;
            }

            var queryId = string.IsNullOrEmpty(envelope.payload.query_id)
                ? string.Empty
                : envelope.payload.query_id.Trim();
            if (string.IsNullOrEmpty(queryId))
            {
                return;
            }

            Debug.Log(
                "[Codex] 收到查询请求了！ query_id=" + queryId +
                ", target_path=" + (string.IsNullOrEmpty(envelope.payload.target_path) ? "-" : envelope.payload.target_path));

            try
            {
                var targetPath = string.IsNullOrEmpty(envelope.payload.target_path)
                    ? string.Empty
                    : envelope.payload.target_path.Trim();

                UnityComponentDescriptor[] components = null;
                var errorMessage = string.Empty;
                var errorCode = string.Empty;
                try
                {
                    var snapshot = await RunOnEditorMainThreadAsync(
                        () => QueryUnityComponentsOnMainThread(targetPath));
                    components = snapshot != null && snapshot.components != null
                        ? snapshot.components
                        : new UnityComponentDescriptor[0];
                    errorCode = NormalizeErrorCodeForTransport(
                        snapshot != null && !string.IsNullOrEmpty(snapshot.error_code)
                            ? snapshot.error_code
                            : string.Empty,
                        string.Empty);
                    errorMessage = NormalizeErrorMessageForTransport(
                        snapshot != null && !string.IsNullOrEmpty(snapshot.error_message)
                            ? snapshot.error_message
                            : string.Empty,
                        string.Empty);
                }
                catch (Exception ex)
                {
                    errorCode = UnityQueryErrorFailed;
                    errorMessage = NormalizeErrorMessageForTransport(
                        ex == null ? string.Empty : ex.Message,
                        "Unity query execution failed.");
                    components = new UnityComponentDescriptor[0];
                }

                if (components == null)
                {
                    components = new UnityComponentDescriptor[0];
                }

                var request = new UnityQueryComponentsResultRequest
                {
                    @event = "unity.query.components.result",
                    request_id = string.IsNullOrEmpty(envelope.request_id) ? _activeRequestId : envelope.request_id,
                    thread_id = string.IsNullOrEmpty(envelope.thread_id) ? ThreadId : envelope.thread_id,
                    turn_id = string.IsNullOrEmpty(envelope.turn_id) ? _turnId : envelope.turn_id,
                    timestamp = DateTime.UtcNow.ToString("o"),
                    payload = new UnityQueryComponentsResultPayload
                    {
                        query_id = queryId,
                        target_path = targetPath,
                        components = components,
                        error_code = string.IsNullOrEmpty(errorCode)
                            ? string.Empty
                            : NormalizeErrorCodeForTransport(errorCode, UnityQueryErrorFailed),
                        error_message = string.IsNullOrEmpty(errorCode)
                            ? string.Empty
                            : NormalizeErrorMessageForTransport(
                                errorMessage,
                                "Unity query execution failed.")
                    }
                };

                var report = await _sidecarGateway.ReportUnityComponentsQueryResultAsync(SidecarUrl, request);
                if (!report.TransportSuccess)
                {
                    AddLog(
                        UiLogLevel.Warning,
                        "unity.query.components.result failed: " + report.ErrorMessage);
                    return;
                }

                if (!report.IsHttpSuccess)
                {
                    AddLog(
                        UiLogLevel.Warning,
                        "unity.query.components.result rejected: " + ReadErrorCode(report));
                    return;
                }

                AddLog(
                    UiLogLevel.Info,
                    "unity.query.components.result: " + targetPath +
                    " (" + components.Length + " component(s))" +
                    (!string.IsNullOrEmpty(errorCode) ? ", error=" + errorCode : "."));
            }
            catch
            {
                // Ignore errors in component query handling
            }
        }

        private async Task TryHandlePulledReadQueryAsync()
        {
            var pull = await _sidecarGateway.PullQueriesAsync(SidecarUrl);
            if (!IsUsableQueryPull(pull))
            {
                return;
            }

            var pulledQuery = pull.Data.query;
            if (pulledQuery == null || string.IsNullOrEmpty(pulledQuery.query_id))
            {
                AddLog(UiLogLevel.Warning, "unity.query.pull returned pending query without query_id.");
                return;
            }

            var dispatchResult = await ExecutePulledReadQueryAsync(pulledQuery);
            var report = await _sidecarGateway.ReportQueryResultAsync(
                SidecarUrl,
                pulledQuery.query_id,
                dispatchResult.payload);
            HandleQueryReportOutcome(
                report,
                string.IsNullOrEmpty(pulledQuery.query_type) ? "unknown_query" : pulledQuery.query_type,
                pulledQuery.query_id,
                dispatchResult.error_code);
        }

        private async Task<UnityRagQueryDispatchResult> ExecutePulledReadQueryAsync(UnityPulledQuery pulledQuery)
        {
            var queryType = NormalizeQueryType(pulledQuery == null ? string.Empty : pulledQuery.query_type);
            if (string.IsNullOrEmpty(queryType))
            {
                return BuildQueryDispatchFailure(
                    pulledQuery,
                    "E_SCHEMA_INVALID",
                    "Pulled query is missing query_type.");
            }

            try
            {
                if (string.Equals(queryType, "list_assets_in_folder", StringComparison.Ordinal))
                {
                    var request = BuildListAssetsInFolderRequest(pulledQuery);
                    var response = await RunOnEditorMainThreadAsync(() => _ragReadService.ListAssetsInFolder(request));
                    if (response == null)
                    {
                        return BuildQueryDispatchFailure(
                            pulledQuery,
                            "E_QUERY_HANDLER_FAILED",
                            "list_assets_in_folder handler returned null.");
                    }
                    if (string.IsNullOrEmpty(response.request_id))
                    {
                        response.request_id = request.request_id;
                    }
                    return new UnityRagQueryDispatchResult
                    {
                        payload = response,
                        error_code = string.IsNullOrEmpty(response.error_code) ? string.Empty : response.error_code
                    };
                }

                if (string.Equals(queryType, "get_scene_roots", StringComparison.Ordinal))
                {
                    var request = BuildGetSceneRootsRequest(pulledQuery);
                    var response = await RunOnEditorMainThreadAsync(() => _ragReadService.GetSceneRoots(request));
                    if (response == null)
                    {
                        return BuildQueryDispatchFailure(
                            pulledQuery,
                            "E_QUERY_HANDLER_FAILED",
                            "get_scene_roots handler returned null.");
                    }
                    if (string.IsNullOrEmpty(response.request_id))
                    {
                        response.request_id = request.request_id;
                    }
                    return new UnityRagQueryDispatchResult
                    {
                        payload = response,
                        error_code = string.IsNullOrEmpty(response.error_code) ? string.Empty : response.error_code
                    };
                }

                if (string.Equals(queryType, "find_objects_by_component", StringComparison.Ordinal))
                {
                    var request = BuildFindObjectsByComponentRequest(pulledQuery);
                    var response = await RunOnEditorMainThreadAsync(() => _ragReadService.FindObjectsByComponent(request));
                    if (response == null)
                    {
                        return BuildQueryDispatchFailure(
                            pulledQuery,
                            "E_QUERY_HANDLER_FAILED",
                            "find_objects_by_component handler returned null.");
                    }
                    if (string.IsNullOrEmpty(response.request_id))
                    {
                        response.request_id = request.request_id;
                    }
                    return new UnityRagQueryDispatchResult
                    {
                        payload = response,
                        error_code = string.IsNullOrEmpty(response.error_code) ? string.Empty : response.error_code
                    };
                }

                if (string.Equals(queryType, "query_prefab_info", StringComparison.Ordinal))
                {
                    var request = BuildQueryPrefabInfoRequest(pulledQuery);
                    var response = await RunOnEditorMainThreadAsync(() => _ragReadService.QueryPrefabInfo(request));
                    if (response == null)
                    {
                        return BuildQueryDispatchFailure(
                            pulledQuery,
                            "E_QUERY_HANDLER_FAILED",
                            "query_prefab_info handler returned null.");
                    }
                    if (string.IsNullOrEmpty(response.request_id))
                    {
                        response.request_id = request.request_id;
                    }
                    return new UnityRagQueryDispatchResult
                    {
                        payload = response,
                        error_code = string.IsNullOrEmpty(response.error_code) ? string.Empty : response.error_code
                    };
                }

                return BuildQueryDispatchFailure(
                    pulledQuery,
                    "E_UNSUPPORTED_QUERY_TYPE",
                    "Unsupported Unity query_type: " + queryType);
            }
            catch (Exception ex)
            {
                return BuildQueryDispatchFailure(
                    pulledQuery,
                    "E_QUERY_HANDLER_FAILED",
                    ex.Message);
            }
        }

        private static UnityListAssetsInFolderRequest BuildListAssetsInFolderRequest(UnityPulledQuery pulledQuery)
        {
            var payload = pulledQuery != null && pulledQuery.payload != null
                ? pulledQuery.payload
                : new UnityPulledQueryPayload();
            return new UnityListAssetsInFolderRequest
            {
                @event = "unity.query.list_assets_in_folder.request",
                request_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityListAssetsInFolderPayload
                {
                    folder_path = NormalizeQueryField(payload.folder_path),
                    recursive = payload.recursive,
                    include_meta = payload.include_meta,
                    limit = payload.limit
                }
            };
        }

        private static UnityGetSceneRootsRequest BuildGetSceneRootsRequest(UnityPulledQuery pulledQuery)
        {
            var payload = pulledQuery != null && pulledQuery.payload != null
                ? pulledQuery.payload
                : new UnityPulledQueryPayload();
            return new UnityGetSceneRootsRequest
            {
                @event = "unity.query.get_scene_roots.request",
                request_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityGetSceneRootsPayload
                {
                    scene_path = NormalizeQueryField(payload.scene_path),
                    include_inactive = payload.include_inactive
                }
            };
        }

        private static UnityFindObjectsByComponentRequest BuildFindObjectsByComponentRequest(UnityPulledQuery pulledQuery)
        {
            var payload = pulledQuery != null && pulledQuery.payload != null
                ? pulledQuery.payload
                : new UnityPulledQueryPayload();
            return new UnityFindObjectsByComponentRequest
            {
                @event = "unity.query.find_objects_by_component.request",
                request_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityFindObjectsByComponentPayload
                {
                    component_query = NormalizeQueryField(payload.component_query),
                    scene_path = NormalizeQueryField(payload.scene_path),
                    under_path = NormalizeQueryField(payload.under_path),
                    include_inactive = payload.include_inactive,
                    limit = payload.limit
                }
            };
        }

        private static UnityQueryPrefabInfoRequest BuildQueryPrefabInfoRequest(UnityPulledQuery pulledQuery)
        {
            var payload = pulledQuery != null && pulledQuery.payload != null
                ? pulledQuery.payload
                : new UnityPulledQueryPayload();
            return new UnityQueryPrefabInfoRequest
            {
                @event = "unity.query.query_prefab_info.request",
                request_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityQueryPrefabInfoPayload
                {
                    prefab_path = NormalizeQueryField(payload.prefab_path),
                    max_depth = payload.max_depth,
                    node_budget = payload.node_budget,
                    char_budget = payload.char_budget,
                    include_components = payload.include_components,
                    include_missing_scripts = payload.include_missing_scripts
                }
            };
        }

        private static string NormalizeQueryType(string value)
        {
            return string.IsNullOrEmpty(value) ? string.Empty : value.Trim();
        }

        private static string NormalizeQueryField(string value)
        {
            return string.IsNullOrEmpty(value) ? string.Empty : value.Trim();
        }

        private UnityRagQueryDispatchResult BuildQueryDispatchFailure(
            UnityPulledQuery pulledQuery,
            string errorCode,
            string errorMessage)
        {
            var requestId = pulledQuery == null || string.IsNullOrEmpty(pulledQuery.request_id)
                ? string.Empty
                : pulledQuery.request_id.Trim();
            var payload = new UnityGenericQueryFailureResult
            {
                ok = false,
                request_id = requestId,
                captured_at = DateTime.UtcNow.ToString("o"),
                error_code = NormalizeErrorCodeForTransport(errorCode, "E_QUERY_HANDLER_FAILED"),
                error_message = NormalizeErrorMessageForTransport(
                    errorMessage,
                    "Unity query handler failed.")
            };
            return new UnityRagQueryDispatchResult
            {
                payload = payload,
                error_code = payload.error_code
            };
        }

        private bool IsUsableQueryPull(GatewayResponse<UnityQueryPullResponse> pull)
        {
            if (pull == null)
            {
                return false;
            }
            if (!pull.TransportSuccess)
            {
                return false;
            }

            if (pull.StatusCode == 404 || pull.StatusCode == 204)
            {
                return false;
            }

            if (!pull.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Warning, "unity.query.pull rejected: " + ReadErrorCode(pull));
                return false;
            }

            if (pull.Data == null || !pull.Data.ok || !pull.Data.pending)
            {
                return false;
            }

            return pull.Data.query != null;
        }

        private void HandleQueryReportOutcome(
            GatewayResponse<UnityQueryReportResponse> report,
            string queryName,
            string queryId,
            string localErrorCode)
        {
            if (report == null || !report.TransportSuccess)
            {
                AddLog(
                    UiLogLevel.Warning,
                    queryName + " result report failed: " +
                    (report == null ? "null response" : report.ErrorMessage));
                return;
            }

            if (!report.IsHttpSuccess)
            {
                AddLog(
                    UiLogLevel.Warning,
                    queryName + " result report rejected: " + ReadErrorCode(report));
                return;
            }

            if (!string.IsNullOrEmpty(localErrorCode))
            {
                AddLog(
                    UiLogLevel.Warning,
                    queryName + " result reported with error_code=" + localErrorCode +
                    " query_id=" + SafeString(queryId));
                return;
            }

            AddLog(
                UiLogLevel.Info,
                queryName + " result reported. query_id=" + SafeString(queryId));
        }

        private Task<T> RunOnEditorMainThreadAsync<T>(Func<T> action)
        {
            var context = _unitySynchronizationContext;
            if (context == null)
            {
                var fallback = new TaskCompletionSource<T>();
                EditorApplication.delayCall += () =>
                {
                    try
                    {
                        fallback.TrySetResult(action != null ? action() : default(T));
                    }
                    catch (Exception ex)
                    {
                        fallback.TrySetException(ex);
                    }
                };
                return fallback.Task;
            }

            var tcs = new TaskCompletionSource<T>();
            context.Post(_ =>
            {
                try
                {
                    tcs.TrySetResult(action != null ? action() : default(T));
                }
                catch (Exception ex)
                {
                    tcs.TrySetException(ex);
                }
            }, null);
            return tcs.Task;
        }

        [Serializable]
        private sealed class UnityRagQueryDispatchResult
        {
            public object payload;
            public string error_code;
        }

        [Serializable]
        private sealed class UnityGenericQueryFailureResult
        {
            public bool ok;
            public string request_id;
            public string captured_at;
            public string error_code;
            public string error_message;
        }

        [Serializable]
        private sealed class UnityComponentQuerySnapshot
        {
            public UnityComponentDescriptor[] components;
            public string error_code;
            public string error_message;
        }

        private static UnityComponentQuerySnapshot QueryUnityComponentsOnMainThread(
            string targetPath)
        {
            var snapshot = new UnityComponentQuerySnapshot
            {
                components = new UnityComponentDescriptor[0],
                error_code = string.Empty,
                error_message = string.Empty
            };

            if (EditorApplication.isCompiling)
            {
                snapshot.error_code = UnityQueryErrorBusyOrCompiling;
                snapshot.error_message = NormalizeErrorMessageForTransport(
                    "Unity is compiling scripts; component query is temporarily unavailable.",
                    "Unity is compiling scripts; component query is temporarily unavailable.");
                return snapshot;
            }

            var target = FindSceneObjectByPath(targetPath);
            if (target == null)
            {
                snapshot.error_code = UnityQueryErrorTargetNotFound;
                snapshot.error_message = NormalizeErrorMessageForTransport(
                    "Target object path not found in scene: " + targetPath,
                    "Target object path not found in scene.");
                return snapshot;
            }

            Component[] components;
            try
            {
                components = target.GetComponents<Component>();
            }
            catch (Exception ex)
            {
                snapshot.error_code = UnityQueryErrorFailed;
                snapshot.error_message = NormalizeErrorMessageForTransport(
                    ex == null ? string.Empty : ex.Message,
                    "Unity query handler failed.");
                return snapshot;
            }

            var results = new List<UnityComponentDescriptor>(components.Length);
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    results.Add(
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

                results.Add(
                    new UnityComponentDescriptor
                    {
                        short_name = string.IsNullOrEmpty(type.Name) ? "-" : type.Name,
                        assembly_qualified_name = BuildAssemblyQualifiedName(type)
                    });
            }

            snapshot.components = results.ToArray();
            return snapshot;
        }

        private static string BuildAssemblyQualifiedName(Type type)
        {
            if (type == null)
            {
                return string.Empty;
            }

            if (!string.IsNullOrEmpty(type.AssemblyQualifiedName))
            {
                return type.AssemblyQualifiedName;
            }

            if (!string.IsNullOrEmpty(type.FullName))
            {
                return type.FullName;
            }

            return type.Name ?? string.Empty;
        }

        private static GameObject FindSceneObjectByPath(string scenePath)
        {
            if (string.IsNullOrEmpty(scenePath))
            {
                return null;
            }

            var normalized = scenePath.Replace('\\', '/').Trim();
            if (normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = normalized.Substring("Scene/".Length);
            }

            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            var segments = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (segments == null || segments.Length == 0)
            {
                return null;
            }

            var sceneCount = SceneManager.sceneCount;
            for (var i = 0; i < sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var j = 0; j < roots.Length; j++)
                {
                    var root = roots[j];
                    if (root == null || !string.Equals(root.name, segments[0], StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var found = FindChildByPathSegments(root.transform, segments, 1);
                    if (found != null)
                    {
                        return found.gameObject;
                    }
                }
            }

            return null;
        }

        private static Transform FindChildByPathSegments(Transform current, string[] segments, int index)
        {
            if (current == null || segments == null)
            {
                return null;
            }

            if (index >= segments.Length)
            {
                return current;
            }

            for (var i = 0; i < current.childCount; i++)
            {
                var child = current.GetChild(i);
                if (child == null || !string.Equals(child.name, segments[index], StringComparison.Ordinal))
                {
                    continue;
                }

                var found = FindChildByPathSegments(child, segments, index + 1);
                if (found != null)
                {
                    return found;
                }
            }

            return null;
        }

        private void LogTurnSendPlan(TurnStatusResponse status)
        {
            if (status == null || !EnableDiagnosticLogs)
            {
                return;
            }

            if (!string.IsNullOrEmpty(status.phase))
            {
                AddLog(UiLogLevel.Info, "turn.phase=" + status.phase);
            }
        }

        private void LogDiagnostic(UiLogLevel level, string message)
        {
            if (!EnableDiagnosticLogs)
            {
                return;
            }

            AddLog(level, message);
        }

        private void LogAssistantMessage(string text)
        {
            var normalized = NormalizeAssistantMessage(text);
            if (string.IsNullOrEmpty(normalized))
            {
                return;
            }

            AddLog(UiLogLevel.Info, normalized, UiLogSource.Codex);
        }

        private void LogUserMessage(string text)
        {
            var normalized = NormalizeAssistantMessage(text);
            if (string.IsNullOrEmpty(normalized))
            {
                return;
            }

            AddLog(UiLogLevel.Info, normalized, UiLogSource.User);
        }

        private void HandleCompileGateFromTurnSend(TurnStatusResponse status, double now)
        {
            if (status != null &&
                status.unity_action_request != null &&
                status.unity_action_request.payload != null &&
                status.unity_action_request.payload.action != null &&
                !string.IsNullOrEmpty(status.unity_action_request.payload.action.component_assembly_qualified_name))
            {
                _pendingCompileComponentAssemblyQualifiedName =
                    status.unity_action_request.payload.action.component_assembly_qualified_name;
            }

            if (_compileGateOpenedAtUtcTicks <= 0L)
            {
                _compileGateOpenedAtUtcTicks = DateTime.UtcNow.Ticks;
            }

            _compileDeadlineAt = now + CompileTimeoutSeconds;
            _compileResultAutoReportInFlight = false;
            _lastCompilePendingHeartbeatAt = now;

            // compile_request field removed from TurnStatusResponse
            // Always refresh assets when compile gate opens
            if (!_compileRefreshIssued)
            {
                var reason = "compile_gate_opened";
                AddLog(UiLogLevel.Info, "Compile gate opened (" + reason + "). Step 2/3: refreshing assets.");
                AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                _compileRefreshIssued = true;
                _lastCompileRefreshAt = now;
                AddLog(UiLogLevel.Info, "Compile result will be auto-reported when Unity finishes compiling.");
            }
        }

        private string BuildBusyReasonForRuntimeState()
        {
            if (_runtimeState == TurnRuntimeState.CompilePending)
            {
                return "Compile Pending";
            }

            if (_runtimeState == TurnRuntimeState.ActionConfirmPending)
            {
                return "Action Confirmation";
            }

            if (_runtimeState == TurnRuntimeState.ActionExecuting)
            {
                return "Action Executing";
            }

            return "Idle";
        }

        private void LogAutoFixProgress(
            bool autoFixApplied,
            int attempts,
            int maxAttempts,
            string reason,
            FileChangeItem[] changes)
        {
            if (!autoFixApplied)
            {
                return;
            }

            var title = "Auto-fix applied";
            if (attempts > 0 && maxAttempts > 0)
            {
                title += " (" + attempts + "/" + maxAttempts + ")";
            }

            if (!string.IsNullOrEmpty(reason))
            {
                title += ": " + reason;
            }

            AddLog(UiLogLevel.Warning, title);

            if (changes == null || changes.Length == 0)
            {
                return;
            }

            for (var i = 0; i < changes.Length; i++)
            {
                var item = changes[i];
                if (item == null)
                {
                    continue;
                }

                AddLog(UiLogLevel.Info, " - " + item.type + ": " + item.path);
            }
        }

        private UnityCompileErrorItem[] BuildCompileErrorItemsForReport(bool success)
        {
            if (success)
            {
                return new UnityCompileErrorItem[0];
            }

            var snapshots = UnityCompilationStateTracker.GetLastCompilationErrorsSince(_compileGateOpenedAtUtcTicks, 20);
            if (snapshots != null && snapshots.Length > 0)
            {
                var items = new UnityCompileErrorItem[snapshots.Length];
                for (var i = 0; i < snapshots.Length; i++)
                {
                    var snapshot = snapshots[i];
                    items[i] = new UnityCompileErrorItem
                    {
                        code = snapshot == null || string.IsNullOrEmpty(snapshot.code) ? "UNKNOWN" : snapshot.code,
                        file = snapshot == null || string.IsNullOrEmpty(snapshot.file) ? _lastSmokeScriptPath : snapshot.file,
                        line = snapshot != null && snapshot.line > 0 ? snapshot.line : 1,
                        column = snapshot != null && snapshot.column > 0 ? snapshot.column : 1,
                        message = NormalizeErrorMessageForTransport(
                            snapshot == null || string.IsNullOrEmpty(snapshot.message)
                                ? "Compilation failed"
                                : snapshot.message,
                            "Compilation failed")
                    };
                }

                return items;
            }

            return new[]
            {
                new UnityCompileErrorItem
                {
                    code = "MOCK",
                    file = _lastSmokeScriptPath,
                    line = 1,
                    column = 1,
                    message = "Manual failure report from Unity panel"
                }
            };
        }

        private static UnityConsoleErrorItem[] BuildConsoleErrorItemsForSnapshot(int maxCount)
        {
            var snapshots = UnityConsoleErrorTracker.GetRecentErrors(maxCount);
            if (snapshots == null || snapshots.Length == 0)
            {
                return new UnityConsoleErrorItem[0];
            }

            var result = new UnityConsoleErrorItem[snapshots.Length];
            for (var i = 0; i < snapshots.Length; i++)
            {
                var item = snapshots[i];
                result[i] = new UnityConsoleErrorItem
                {
                    timestamp = item == null || string.IsNullOrEmpty(item.timestamp)
                        ? DateTime.UtcNow.ToString("o")
                        : item.timestamp,
                    log_type = item == null || string.IsNullOrEmpty(item.log_type) ? "Error" : item.log_type,
                    condition = SanitizeSingleLine(
                        item == null || string.IsNullOrEmpty(item.condition) ? string.Empty : item.condition,
                        MaxConsoleConditionLength),
                    stack_trace = SanitizeSingleLine(
                        item == null || string.IsNullOrEmpty(item.stack_trace) ? string.Empty : item.stack_trace,
                        MaxConsoleStackTraceLength),
                    file = item == null || string.IsNullOrEmpty(item.file) ? string.Empty : item.file,
                    line = item != null && item.line > 0 ? item.line : 0,
                    error_code = NormalizeErrorCodeForTransport(
                        item == null || string.IsNullOrEmpty(item.error_code) ? string.Empty : item.error_code,
                        string.Empty)
                };
            }

            return result;
        }

        private static string BuildConsoleSnapshotSignature(UnityConsoleErrorItem[] errors)
        {
            if (errors == null || errors.Length == 0)
            {
                return "empty";
            }

            var first = errors[0];
            var firstTimestamp = first != null ? first.timestamp ?? string.Empty : string.Empty;
            var firstCode = first != null ? first.error_code ?? string.Empty : string.Empty;
            var firstLine = first != null ? first.line.ToString() : "0";
            var firstFile = first != null ? first.file ?? string.Empty : string.Empty;
            return errors.Length + "|" + firstTimestamp + "|" + firstCode + "|" + firstFile + "|" + firstLine;
        }

        private void ForceLocalAbort(string errorCode, string message)
        {
            _runtimeState = TurnRuntimeState.Failed;
            _lastTerminalEvent = "turn.error";
            _lastErrorCode = errorCode;
            _lastMessage = message;
            AddLog(UiLogLevel.Warning, message + BuildErrorCodeSuffix(errorCode));
            UnlockTurn();
            SaveState();
        }

        private void ForceLocalCancel(string message)
        {
            _runtimeState = TurnRuntimeState.Cancelled;
            _lastTerminalEvent = "turn.cancelled";
            _lastErrorCode = "E_TURN_CANCELLED";
            _lastMessage = message;
            AddLog(UiLogLevel.Warning, message);
            UnlockTurn();
            SaveState();
        }

        private void MaybeLogTransportFailure(double now, string errorMessage)
        {
            const double minIntervalSeconds = 2d;
            if (_lastTransportErrorLogAt > 0d && now - _lastTransportErrorLogAt < minIntervalSeconds)
            {
                return;
            }

            _lastTransportErrorLogAt = now;
            AddLog(UiLogLevel.Error, "turn.status failed: " + errorMessage);
            Debug.LogWarning("[Codex] turn.status failed: " + errorMessage);
        }

        private TurnStatusResponse ToTurnStatus(UnityCompileReportResponse report)
        {
            if (report == null)
            {
                return null;
            }

            var normalizedState = NormalizeGatewayState(
                report.state,
                report.status,
                report.error_code);
            return new TurnStatusResponse
            {
                job_id = report.job_id,
                request_id = report.request_id,
                status = report.status,
                state = normalizedState,
                @event = report.@event,
                message = FirstNonEmpty(report.message, report.progress_message, report.error_message),
                progress_message = report.progress_message,
                error_code = report.error_code,
                error_message = report.error_message,
                suggestion = report.suggestion,
                recoverable = report.recoverable,
                stage = report.stage,
                phase = report.phase,
                auto_cancel_reason = report.auto_cancel_reason,
                lease_state = report.lease_state,
                lease_owner_client_id = report.lease_owner_client_id,
                lease_last_heartbeat_at = report.lease_last_heartbeat_at,
                lease_heartbeat_timeout_ms = report.lease_heartbeat_timeout_ms,
                lease_max_runtime_ms = report.lease_max_runtime_ms,
                lease_orphaned = report.lease_orphaned,
                pending_visual_action_count = report.pending_visual_action_count,
                pending_visual_action = report.pending_visual_action,
                unity_action_request = report.unity_action_request
            };
        }

        private TurnStatusResponse ToTurnStatus(UnityActionReportResponse report)
        {
            if (report == null)
            {
                return null;
            }

            var normalizedState = NormalizeGatewayState(
                report.state,
                report.status,
                report.error_code);
            return new TurnStatusResponse
            {
                job_id = report.job_id,
                request_id = report.request_id,
                status = report.status,
                state = normalizedState,
                @event = report.@event,
                message = FirstNonEmpty(report.message, report.progress_message, report.error_message),
                progress_message = report.progress_message,
                error_code = report.error_code,
                error_message = report.error_message,
                suggestion = report.suggestion,
                recoverable = report.recoverable,
                stage = report.stage,
                phase = report.phase,
                auto_cancel_reason = report.auto_cancel_reason,
                lease_state = report.lease_state,
                lease_owner_client_id = report.lease_owner_client_id,
                lease_last_heartbeat_at = report.lease_last_heartbeat_at,
                lease_heartbeat_timeout_ms = report.lease_heartbeat_timeout_ms,
                lease_max_runtime_ms = report.lease_max_runtime_ms,
                lease_orphaned = report.lease_orphaned,
                pending_visual_action_count = report.pending_visual_action_count,
                pending_visual_action = report.pending_visual_action,
                unity_action_request = report.unity_action_request
            };
        }

        private TurnStatusResponse ToTurnStatus(UnityRuntimePingResponse response)
        {
            if (response == null)
            {
                return null;
            }

            var normalizedState = NormalizeGatewayState(
                response.state,
                response.status,
                response.error_code);
            return new TurnStatusResponse
            {
                job_id = response.job_id,
                request_id = response.request_id,
                status = response.status,
                state = normalizedState,
                @event = response.@event,
                message = FirstNonEmpty(response.message, response.progress_message, response.error_message),
                progress_message = response.progress_message,
                error_code = response.error_code,
                error_message = response.error_message,
                suggestion = response.suggestion,
                recoverable = response.recoverable,
                stage = response.stage,
                phase = response.phase,
                auto_cancel_reason = response.auto_cancel_reason,
                lease_state = response.lease_state,
                lease_owner_client_id = response.lease_owner_client_id,
                lease_last_heartbeat_at = response.lease_last_heartbeat_at,
                lease_heartbeat_timeout_ms = response.lease_heartbeat_timeout_ms,
                lease_max_runtime_ms = response.lease_max_runtime_ms,
                lease_orphaned = response.lease_orphaned,
                pending_visual_action_count = response.pending_visual_action_count,
                pending_visual_action = response.pending_visual_action,
                unity_action_request = response.unity_action_request
            };
        }

        private static string NormalizeGatewayState(string state, string status, string errorCode)
        {
            var normalizedState = NormalizeToken(state);
            if (normalizedState == "running" ||
                normalizedState == "idle" ||
                normalizedState == "completed" ||
                normalizedState == "cancelled" ||
                normalizedState == "error")
            {
                return normalizedState;
            }

            var normalizedStatus = NormalizeToken(status);
            if (normalizedStatus == "succeeded" || normalizedStatus == "completed")
            {
                return "completed";
            }

            if (normalizedStatus == "failed" || normalizedStatus == "error")
            {
                return "error";
            }

            if (normalizedStatus == "cancelled" || normalizedStatus == "canceled")
            {
                return "cancelled";
            }

            if (normalizedStatus == "pending" ||
                normalizedStatus == "queued" ||
                normalizedStatus == "accepted" ||
                normalizedStatus == "running")
            {
                return "running";
            }

            if (IsAutoCancelErrorCode(errorCode))
            {
                return "cancelled";
            }

            if (normalizedState == "failed")
            {
                return "error";
            }

            return normalizedState;
        }

        private static bool IsAutoCancelErrorCode(string value)
        {
            var code = string.IsNullOrEmpty(value) ? string.Empty : value.Trim();
            if (string.IsNullOrEmpty(code))
            {
                return false;
            }

            return string.Equals(code, "E_JOB_HEARTBEAT_TIMEOUT", StringComparison.Ordinal) ||
                   string.Equals(code, "E_JOB_MAX_RUNTIME_EXCEEDED", StringComparison.Ordinal) ||
                   string.Equals(code, "E_WAITING_FOR_UNITY_REBOOT_TIMEOUT", StringComparison.Ordinal);
        }

        private static string NormalizeToken(string value)
        {
            return string.IsNullOrEmpty(value) ? string.Empty : value.Trim().ToLowerInvariant();
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

        private bool HasCompileFinishedForCurrentGate()
        {
            if (_compileGateOpenedAtUtcTicks <= 0L)
            {
                return false;
            }

            return UnityCompilationStateTracker.HasCompilationFinishedSince(_compileGateOpenedAtUtcTicks);
        }

        private bool HasCompileErrorsForCurrentGate()
        {
            if (_compileGateOpenedAtUtcTicks <= 0L)
            {
                return false;
            }

            return UnityCompilationStateTracker.LastCompilationHadErrorsSince(_compileGateOpenedAtUtcTicks);
        }

        private static string ReadErrorCode<T>(GatewayResponse<T> response) where T : class
        {
            if (response != null && response.Error != null && !string.IsNullOrEmpty(response.Error.error_code))
            {
                return response.Error.error_code;
            }

            return "unknown";
        }

        private static double EditorApplicationTimeFallback()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        }

        private void EmitChanged()
        {
            var changed = Changed;
            if (changed != null)
            {
                changed.Invoke();
            }
        }
    }
}

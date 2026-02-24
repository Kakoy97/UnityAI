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
        private const bool EnableDiagnosticLogs = false;
        private const string MissingScriptShortName = "MissingScript";
        private const string MissingScriptAssemblyQualifiedName = "UnityEditor.MissingScript";
        private const string UnityQueryErrorBusyOrCompiling = "unity_busy_or_compiling";
        private const string UnityQueryErrorTargetNotFound = "target_not_found";
        private const string UnityQueryErrorFailed = "unity_query_failed";

        private readonly ISidecarGateway _sidecarGateway;
        private readonly ISidecarProcessManager _processManager;
        private readonly ISelectionContextBuilder _contextBuilder;
        private readonly IConversationStateStore _stateStore;
        private readonly IUnityVisualActionExecutor _visualActionExecutor;
        private readonly SynchronizationContext _unitySynchronizationContext;
        private readonly List<UiLogEntry> _logs = new List<UiLogEntry>();

        private string _activeRequestId = string.Empty;
        private string _turnId = string.Empty;
        private bool _sessionStarted;
        private bool _pollInFlight;
        private double _nextPollAt;
        private double _codexDeadlineAt;
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
        private int _lastSeenEventSeq;
        private string _lastStatusDiagnosticSignature = string.Empty;
        private string _lastAssistantMessageSignature = string.Empty;
        private readonly HashSet<string> _inflightUnityComponentQueryIds =
            new HashSet<string>(StringComparer.Ordinal);
        private readonly object _unityComponentQueryLock = new object();

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
                return IsBusy &&
                       (_runtimeState == TurnRuntimeState.CodexPending ||
                        _runtimeState == TurnRuntimeState.AutoFixPending);
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
                _lastSeenEventSeq = 0;
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
                await EnsureSessionStartedAsync();
                await SyncWithSidecarSnapshotAsync(EditorApplicationTimeFallback());
                await SendRuntimePingInternalAsync("just_recompiled", false);
                return;
            }

            if (!result.Success)
            {
                AddLog(UiLogLevel.Error, result.Message);
                return;
            }

            AddLog(UiLogLevel.Info, result.Message);
            await CheckHealthAsync();
            await EnsureSessionStartedAsync();
            await SyncWithSidecarSnapshotAsync(EditorApplicationTimeFallback());
            await SendRuntimePingInternalAsync("just_recompiled", false);
        }

        public void StopSidecar()
        {
            var result = _processManager.Stop();
            _sessionStarted = false;

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

            if (!_sessionStarted)
            {
                await EnsureSessionStartedAsync();
                if (!_sessionStarted)
                {
                    AddLog(UiLogLevel.Error, "Cannot apply file actions before session.start succeeds.");
                    return;
                }
            }

            var requestId = "req_file_" + Guid.NewGuid().ToString("N");
            var turnId = "u_file_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var smokeSuffix = requestId.Replace("req_file_", string.Empty).Substring(0, 8);
            var className = "HelloPhase6_" + smokeSuffix;
            var scriptPath = "Assets/Scripts/AIGenerated/Phase6Smoke/" + className + ".cs";
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
                            target = "selection",
                            target_object_path = BuildSelectedPath(selected),
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
            _codexDeadlineAt = 0d;
            _nextPollAt = 0d;
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

            LogAutoFixProgress(
                report.auto_fix_applied,
                report.auto_fix_attempts,
                report.auto_fix_max_attempts,
                report.auto_fix_reason,
                report.files_changed);

            var status = ToTurnStatus(report);
            LogStatusDiagnostics("unity.compile.result.response", status);
            ProcessTurnEvents(status);
            if (IsTerminalStatus(status))
            {
                HandleTerminalStatus(status);
                return;
            }

            if (TryCapturePendingUnityActionRequest(
                    report.unity_action_request,
                    report.pending_visual_action,
                    "unity.compile.result",
                    status != null ? status.request_id : string.Empty,
                    status != null ? status.stage : string.Empty,
                    status != null ? status.pending_visual_action_count : 0))
            {
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                AddLog(UiLogLevel.Info, "Received unity.action.request. Waiting for confirmation.");
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
                return;
            }

            if (approved && EditorApplication.isCompiling)
            {
                AddLog(UiLogLevel.Warning, "Unity is still compiling. Please approve action after compile completes.");
                return;
            }

            var actionEnvelope = _pendingUnityActionRequest;
            var action = actionEnvelope.payload.action;

            UnityActionExecutionResult execution;
            if (approved)
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
                execution = new UnityActionExecutionResult
                {
                    actionType = action.type,
                    targetObjectPath = BuildSelectedPath(selected),
                    componentAssemblyQualifiedName = action.component_assembly_qualified_name,
                    sourceComponentAssemblyQualifiedName = action.source_component_assembly_qualified_name,
                    createdObjectPath = string.Empty,
                    name = action.name,
                    parentObjectPath = action.parent_object_path,
                    primitiveType = action.primitive_type,
                    uiType = action.ui_type,
                    success = false,
                    errorCode = "E_ACTION_CONFIRM_REJECTED",
                    errorMessage = "User rejected visual action confirmation.",
                    durationMs = 0
                };
            }

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
                    target = action.target,
                    target_object_path = execution.targetObjectPath,
                    component_assembly_qualified_name = execution.componentAssemblyQualifiedName,
                    source_component_assembly_qualified_name = execution.sourceComponentAssemblyQualifiedName,
                    created_object_path = execution.createdObjectPath,
                    name = execution.name,
                    parent_object_path = execution.parentObjectPath,
                    primitive_type = execution.primitiveType,
                    ui_type = execution.uiType,
                    success = execution.success,
                    error_code = execution.errorCode ?? string.Empty,
                    error_message = execution.errorMessage ?? string.Empty,
                    duration_ms = execution.durationMs
                }
            };

            AddLog(
                UiLogLevel.Info,
                "unity.action.result => " + _activeRequestId +
                " success=" + execution.success +
                (execution.success ? string.Empty : " code=" + execution.errorCode));

            _runtimeState = TurnRuntimeState.ActionExecuting;
            BusyReason = "Action Executing";
            SaveState();
            EmitChanged();

            var result = await _sidecarGateway.ReportUnityActionResultAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.action.result failed: " + result.ErrorMessage);
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.action.result rejected: " + ReadErrorCode(result));
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
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                return;
            }

            LogAutoFixProgress(
                report.auto_fix_applied,
                report.auto_fix_attempts,
                report.auto_fix_max_attempts,
                report.auto_fix_reason,
                null);

            var status = ToTurnStatus(report);
            LogStatusDiagnostics("unity.action.result.response", status);
            ProcessTurnEvents(status);
            if (IsTerminalStatus(status))
            {
                HandleTerminalStatus(status);
                return;
            }

            if (TryCapturePendingUnityActionRequest(
                    report.unity_action_request,
                    report.pending_visual_action,
                    "unity.action.result",
                    status != null ? status.request_id : string.Empty,
                    status != null ? status.stage : string.Empty,
                    status != null ? status.pending_visual_action_count : 0))
            {
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                AddLog(UiLogLevel.Info, "Next unity.action.request received. Waiting for confirmation.");
                return;
            }

            ApplyStage(status.stage, EditorApplicationTimeFallback());
            BusyReason = BuildBusyReasonForRuntimeState();
            SaveState();
            EmitChanged();
        }

        public async Task<bool> SendTurnAsync(string message, GameObject selected, double now)
        {
            if (IsBusy)
            {
                AddLog(UiLogLevel.Warning, "A turn is already in progress.");
                return false;
            }

            if (selected == null)
            {
                AddLog(UiLogLevel.Error, "Pre-flight failed: please select a target GameObject in Hierarchy.");
                return true;
            }

            if (string.IsNullOrWhiteSpace(message))
            {
                AddLog(UiLogLevel.Warning, "Message is empty.");
                return false;
            }

            if (string.IsNullOrWhiteSpace(ThreadId))
            {
                ThreadId = "t_default";
            }

            if (!_sessionStarted)
            {
                await EnsureSessionStartedAsync();
                if (!_sessionStarted)
                {
                    AddLog(UiLogLevel.Error, "Cannot send turn before session.start succeeds.");
                    return false;
                }
            }

            LogUserMessage(message);

            _activeRequestId = "req_" + Guid.NewGuid().ToString("N");
            _turnId = "u_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            IsBusy = true;
            BusyReason = "Planning/Executing";
            _runtimeState = TurnRuntimeState.CodexPending;
            _codexDeadlineAt = now + CodexTimeoutSeconds;
            _compileDeadlineAt = 0d;
            _nextPollAt = now + 0.2d;
            _pendingUnityActionRequest = null;
            _lastSeenEventSeq = 0;
            _lastAssistantMessageSignature = string.Empty;
            SaveState();
            EmitChanged();

            var request = new TurnSendRequest
            {
                @event = "turn.send",
                request_id = _activeRequestId,
                thread_id = ThreadId,
                turn_id = _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new TurnSendPayload
                {
                    user_message = message,
                    context = _contextBuilder.BuildContext(selected, 2)
                }
            };

            AddLog(UiLogLevel.Info, "turn.send => " + _activeRequestId);

            var result = await _sidecarGateway.SendTurnAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                HandleLocalFailure("E_NETWORK", "turn.send failed: " + result.ErrorMessage);
                return false;
            }

            if (result.StatusCode == 429)
            {
                HandleLocalFailure("E_TOO_MANY_ACTIVE_TURNS", "Sidecar rejected new turn (429): " + ReadErrorCode(result));
                return false;
            }

            if (!result.IsHttpSuccess)
            {
                HandleLocalFailure("E_HTTP_" + result.StatusCode, "turn.send rejected: " + ReadErrorCode(result));
                return false;
            }

            var status = result.Data;
            if (status == null)
            {
                HandleLocalFailure("E_PARSE", "turn.send response parse failed.");
                return false;
            }

            LogStatusDiagnostics("turn.send.response", status);
            ProcessTurnEvents(status);
            LogTurnSendPlan(status);
            if (IsTerminalStatus(status))
            {
                HandleTerminalStatus(status);
                return false;
            }

            if (TryCapturePendingUnityActionRequest(
                    status.unity_action_request,
                    status.pending_visual_action,
                    "turn.send",
                    status.request_id,
                    status.stage,
                    status.pending_visual_action_count))
            {
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                AddLog(UiLogLevel.Info, "Received unity.action.request. Waiting for confirmation.");
                return false;
            }

            ApplyStage(status.stage, now);
            if (_runtimeState == TurnRuntimeState.CompilePending)
            {
                HandleCompileGateFromTurnSend(status, now);
            }

            BusyReason = BuildBusyReasonForRuntimeState();
            SaveState();
            EmitChanged();
            return false;
        }

        public async Task CancelTurnAsync()
        {
            if (!IsBusy || string.IsNullOrEmpty(_activeRequestId))
            {
                AddLog(UiLogLevel.Warning, "No active turn to cancel.");
                return;
            }

            var request = new TurnCancelRequest
            {
                @event = "turn.cancel",
                request_id = _activeRequestId,
                thread_id = ThreadId,
                turn_id = _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new TurnCancelPayload
                {
                    reason = "user_clicked_cancel"
                }
            };

            var result = await _sidecarGateway.CancelTurnAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "turn.cancel failed: " + result.ErrorMessage);
                if (!_processManager.IsRunning)
                {
                    ForceLocalCancel("Sidecar is offline. Turn cancelled locally.");
                }
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "turn.cancel rejected: " + ReadErrorCode(result));
                if (result.StatusCode == 0)
                {
                    ForceLocalCancel("turn.cancel could not reach sidecar. Turn cancelled locally.");
                }
                return;
            }

            var status = result.Data;
            if (status != null && (status.@event == "turn.cancelled" || status.state == "cancelled"))
            {
                HandleTerminalStatus(status);
                return;
            }

            AddLog(UiLogLevel.Warning, "turn.cancel acknowledged, waiting for terminal status.");
        }

        public bool ShouldPoll(double now)
        {
            if (!IsBusy || string.IsNullOrEmpty(_activeRequestId))
            {
                return false;
            }

            if (_pollInFlight)
            {
                return false;
            }

            return now >= _nextPollAt;
        }

        public async Task PollTurnStatusAsync(double now)
        {
            if (!IsBusy || string.IsNullOrEmpty(_activeRequestId))
            {
                return;
            }

            if (TryTripTimeout(now))
            {
                return;
            }

            _pollInFlight = true;
            try
            {
                var result = await _sidecarGateway.GetTurnStatusAsync(SidecarUrl, _activeRequestId, _lastSeenEventSeq);
                if (!result.TransportSuccess)
                {
                    _transportErrorStreak += 1;
                    if (result.StatusCode == 404)
                    {
                        AddLog(UiLogLevel.Warning, "turn.status: request not found yet.");
                    }
                    else
                    {
                        MaybeLogTransportFailure(now, result.ErrorMessage);
                    }

                    if (_transportErrorStreak >= 5)
                    {
                        ForceLocalAbort(
                            "E_SIDECAR_UNREACHABLE",
                            "Lost connection to sidecar during active turn. Local turn state has been cleared.");
                    }
                    return;
                }

                _transportErrorStreak = 0;

                if (!result.IsHttpSuccess)
                {
                    if (result.StatusCode == 404)
                    {
                        AddLog(UiLogLevel.Warning, "turn.status: request not found yet.");
                    }
                    else
                    {
                        AddLog(UiLogLevel.Error, "turn.status returned HTTP " + result.StatusCode + ".");
                    }
                    return;
                }

                var status = result.Data;
                if (status == null)
                {
                    AddLog(UiLogLevel.Error, "turn.status parse failed.");
                    return;
                }

                LogStatusDiagnostics("turn.status.poll", status);
                ProcessTurnEvents(status);
                if (IsTerminalStatus(status))
                {
                    HandleTerminalStatus(status);
                    return;
                }

                ApplyStage(status.stage, now);
                if (_runtimeState == TurnRuntimeState.ActionConfirmPending)
                {
                    if (_pendingUnityActionRequest == null &&
                        TryCapturePendingUnityActionRequest(
                            null,
                            status.pending_visual_action,
                            "turn.status.poll",
                            status.request_id,
                            status.stage,
                            status.pending_visual_action_count))
                    {
                        AddLog(UiLogLevel.Info, "Recovered pending unity.action.request from turn.status.");
                    }
                }

                if (_runtimeState == TurnRuntimeState.CompilePending)
                {
                    if (status.pending_visual_action != null &&
                        !string.IsNullOrEmpty(status.pending_visual_action.component_assembly_qualified_name))
                    {
                        _pendingCompileComponentAssemblyQualifiedName =
                            status.pending_visual_action.component_assembly_qualified_name;
                    }

                    MaybeLogCompilePendingHeartbeat(now);
                }

                BusyReason = BuildBusyReasonForRuntimeState();
                SaveState();
                EmitChanged();

                if (_runtimeState == TurnRuntimeState.CompilePending)
                {
                    await TryAutoReportCompileResultAsync();
                }
            }
            finally
            {
                _pollInFlight = false;
                _nextPollAt = now + PollIntervalSeconds;
            }
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

        private async Task EnsureSessionStartedAsync()
        {
            var requestId = "req_session_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var request = new SessionStartRequest
            {
                @event = "session.start",
                request_id = requestId,
                thread_id = string.IsNullOrWhiteSpace(ThreadId) ? "t_default" : ThreadId,
                turn_id = "u_000",
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new SessionStartPayload
                {
                    workspace_root = "UnityProject",
                    model = "codex"
                }
            };

            var result = await _sidecarGateway.StartSessionAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "session.start failed: " + result.ErrorMessage);
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "session.start rejected: " + ReadErrorCode(result));
                return;
            }

            _sessionStarted = true;
            AddLog(UiLogLevel.Info, "session.started");
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
                _lastSeenEventSeq = 0;
                if (_runtimeState == TurnRuntimeState.Idle)
                {
                    _runtimeState = TurnRuntimeState.CodexPending;
                    _codexDeadlineAt = now + CodexTimeoutSeconds;
                }
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

            if (!_sessionStarted)
            {
                await EnsureSessionStartedAsync();
                if (!_sessionStarted)
                {
                    return;
                }
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
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping failed: " + result.ErrorMessage);
                }
                return;
            }

            if (!result.IsHttpSuccess)
            {
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping rejected: " + ReadErrorCode(result));
                }
                return;
            }

            var pong = result.Data;
            if (pong == null)
            {
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping response parse failed.");
                }
                return;
            }

            ProcessTurnEvents(
                new TurnStatusResponse
                {
                    events = pong.events,
                    latest_event_seq = pong.latest_event_seq
                });

            AddLog(
                UiLogLevel.Info,
                "diag.runtime.ping.response: request_id=" + SafeString(pong.request_id) +
                ", state=" + SafeString(pong.state) +
                ", stage=" + SafeString(pong.stage) +
                ", recovered=" + pong.recovered +
                ", has_unity_action_request=" +
                (pong.unity_action_request != null &&
                 pong.unity_action_request.payload != null &&
                 pong.unity_action_request.payload.action != null) +
                ", has_pending_visual_action=" + IsActionPayloadValid(pong.pending_visual_action) + ".");

            var now = EditorApplicationTimeFallback();
            if (!string.IsNullOrEmpty(pong.request_id) && pong.state == "running")
            {
                _activeRequestId = pong.request_id;
                if (string.IsNullOrEmpty(_turnId))
                {
                    _turnId = request.turn_id;
                }

                IsBusy = true;
                ApplyStage(pong.stage, now);
                if (pong.pending_visual_action != null &&
                    !string.IsNullOrEmpty(pong.pending_visual_action.component_assembly_qualified_name))
                {
                    _pendingCompileComponentAssemblyQualifiedName =
                        pong.pending_visual_action.component_assembly_qualified_name;
                }
                if (_runtimeState == TurnRuntimeState.ActionConfirmPending)
                {
                    TryCapturePendingUnityActionRequest(
                        pong.unity_action_request,
                        pong.pending_visual_action,
                        "unity.runtime.ping",
                        pong.request_id,
                        pong.stage,
                        pong.pending_visual_action_count);
                }
                BusyReason = BuildBusyReasonForRuntimeState();
                _nextPollAt = now + PollIntervalSeconds;
                SaveState();
                EmitChanged();
            }

            if (pong.recovered)
            {
                AddLog(UiLogLevel.Warning, "unity.runtime.ping recovered pending action from sidecar.");
                return;
            }

            if (logWhenNoRecovery)
            {
                AddLog(UiLogLevel.Info, "unity.runtime.ping: " + SafeString(pong.message));
            }
        }

        private void ApplyStage(string stage, double now)
        {
            if (string.IsNullOrEmpty(stage))
            {
                return;
            }

            if (stage == "codex_pending")
            {
                _runtimeState = TurnRuntimeState.CodexPending;
                _codexDeadlineAt = now + CodexTimeoutSeconds;
                _compileDeadlineAt = 0d;
                _pendingUnityActionRequest = null;
                return;
            }

            if (stage == "compile_pending")
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

            if (stage == "auto_fix_pending")
            {
                _runtimeState = TurnRuntimeState.AutoFixPending;
                _codexDeadlineAt = now + CodexTimeoutSeconds;
                _compileDeadlineAt = 0d;
                return;
            }

            if (stage == "action_confirm_pending")
            {
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                _codexDeadlineAt = 0d;
                _compileDeadlineAt = 0d;
                return;
            }

            if (stage == "action_executing")
            {
                _runtimeState = TurnRuntimeState.ActionExecuting;
                _codexDeadlineAt = 0d;
                _compileDeadlineAt = 0d;
                return;
            }

            if (stage == "running")
            {
                _runtimeState = TurnRuntimeState.Running;
                _pendingUnityActionRequest = null;
            }
        }

        private bool TryTripTimeout(double now)
        {
            if (_runtimeState == TurnRuntimeState.CodexPending && _codexDeadlineAt > 0d && now > _codexDeadlineAt)
            {
                HandleLocalTimeout("E_CODEX_TIMEOUT", "Codex phase timed out after 60s");
                return true;
            }

            if (_runtimeState == TurnRuntimeState.CompilePending && _compileDeadlineAt > 0d && now > _compileDeadlineAt)
            {
                HandleLocalTimeout("E_COMPILE_TIMEOUT", "Compile phase timed out after 120s");
                return true;
            }

            if (_runtimeState == TurnRuntimeState.AutoFixPending && _codexDeadlineAt > 0d && now > _codexDeadlineAt)
            {
                HandleLocalTimeout("E_CODEX_TIMEOUT", "Auto-fix phase timed out after 60s");
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
                stage = "error",
                replay = false
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
            var state = SafeString(status.state);
            var message = string.IsNullOrEmpty(status.message) ? "(no message)" : status.message;
            var eventName = string.IsNullOrEmpty(status.@event) ? state : status.@event;

            _lastTerminalEvent = eventName;
            _lastErrorCode = status.error_code ?? string.Empty;
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

            UnlockTurn();
            SaveState();
        }

        private void UnlockTurn()
        {
            IsBusy = false;
            _pollInFlight = false;
            BusyReason = "Idle";
            _activeRequestId = string.Empty;
            _turnId = string.Empty;
            _runtimeState = TurnRuntimeState.Idle;
            _codexDeadlineAt = 0d;
            _compileDeadlineAt = 0d;
            _compileGateOpenedAtUtcTicks = 0L;
            _compileResultAutoReportInFlight = false;
            _lastCompilePendingHeartbeatAt = 0d;
            _compileRefreshIssued = false;
            _lastCompileRefreshAt = 0d;
            _pendingCompileComponentAssemblyQualifiedName = string.Empty;
            _nextPollAt = 0d;
            _pendingUnityActionRequest = null;
            _transportErrorStreak = 0;
            _lastTransportErrorLogAt = 0d;
            _lastSeenEventSeq = 0;
            _lastStatusDiagnosticSignature = string.Empty;
            _lastAssistantMessageSignature = string.Empty;
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
                _codexDeadlineAt = 0d;
                return;
            }

            if (_runtimeState == TurnRuntimeState.CodexPending || _runtimeState == TurnRuntimeState.Running)
            {
                _codexDeadlineAt = now + CodexTimeoutSeconds;
                _compileDeadlineAt = 0d;
                return;
            }

            if (_runtimeState == TurnRuntimeState.AutoFixPending)
            {
                _codexDeadlineAt = now + CodexTimeoutSeconds;
                _compileDeadlineAt = 0d;
                return;
            }

            if (_runtimeState == TurnRuntimeState.ActionConfirmPending ||
                _runtimeState == TurnRuntimeState.ActionExecuting)
            {
                _codexDeadlineAt = 0d;
                _compileDeadlineAt = 0d;
                return;
            }

            _codexDeadlineAt = 0d;
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
            var hasPendingVisualAction = IsActionPayloadValid(status.pending_visual_action);
            var signature =
                SafeString(source) + "|" +
                SafeString(status.request_id) + "|" +
                SafeString(status.state) + "|" +
                SafeString(status.stage) + "|" +
                status.latest_event_seq + "|" +
                status.pending_visual_action_count + "|" +
                hasUnityActionRequest + "|" +
                hasPendingVisualAction;

            if (string.Equals(signature, _lastStatusDiagnosticSignature, StringComparison.Ordinal))
            {
                return;
            }

            _lastStatusDiagnosticSignature = signature;
            AddLog(
                UiLogLevel.Info,
                "diag.status[" + SafeString(source) + "]: request_id=" + SafeString(status.request_id) +
                ", state=" + SafeString(status.state) +
                ", stage=" + SafeString(status.stage) +
                ", latest_event_seq=" + status.latest_event_seq +
                ", pending_visual_action_count=" + status.pending_visual_action_count +
                ", has_unity_action_request=" + hasUnityActionRequest +
                ", has_pending_visual_action=" + hasPendingVisualAction + ".");
        }

        private static string BuildActionDebugText(VisualLayerActionItem action)
        {
            if (action == null)
            {
                return "null";
            }

            return
                "type=" + SafeString(action.type) +
                ", target=" + SafeString(action.target) +
                ", target_object_path=" + SafeString(action.target_object_path) +
                ", component=" + SafeString(action.component_assembly_qualified_name) +
                ", source_component=" + SafeString(action.source_component_assembly_qualified_name) +
                ", name=" + SafeString(action.name) +
                ", parent_object_path=" + SafeString(action.parent_object_path) +
                ", primitive_type=" + SafeString(action.primitive_type) +
                ", ui_type=" + SafeString(action.ui_type);
        }

        private bool TryCapturePendingUnityActionRequest(
            UnityActionRequestEnvelope envelope,
            VisualLayerActionItem fallbackAction,
            string source,
            string statusRequestId,
            string statusStage,
            int pendingVisualActionCount)
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
                    return false;
                }

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

            if (fallbackAction == null)
            {
                LogDiagnostic(
                    UiLogLevel.Info,
                    "diag.action.capture[" + sourceTag + "]: no envelope and no fallback action.");
                return false;
            }

            var allowFallbackStage =
                string.Equals(statusStage, "action_confirm_pending", StringComparison.Ordinal) ||
                string.Equals(statusStage, "action_executing", StringComparison.Ordinal);
            if (!allowFallbackStage)
            {
                LogDiagnostic(
                    UiLogLevel.Warning,
                    "diag.action.capture[" + sourceTag + "]: fallback action ignored due to stage=" +
                    SafeString(statusStage) + ".");
                return false;
            }

            if (pendingVisualActionCount <= 0)
            {
                LogDiagnostic(
                    UiLogLevel.Warning,
                    "diag.action.capture[" + sourceTag + "]: fallback action ignored because pending_visual_action_count=" +
                    pendingVisualActionCount + ".");
                return false;
            }

            if (!IsActionPayloadValid(fallbackAction))
            {
                LogDiagnostic(
                    UiLogLevel.Warning,
                    "diag.action.capture[" + sourceTag + "]: fallback action is incomplete, ignored. action=" +
                    BuildActionDebugText(fallbackAction) + ".");
                return false;
            }

            LogDiagnostic(
                UiLogLevel.Warning,
                "diag.action.capture[" + sourceTag + "]: using fallback pending_visual_action, source_request_id=" +
                SafeString(statusRequestId) + ", action=" + BuildActionDebugText(fallbackAction) + ".");

            _pendingUnityActionRequest = new UnityActionRequestEnvelope
            {
                @event = "unity.action.request",
                request_id = _activeRequestId,
                thread_id = ThreadId,
                turn_id = _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityActionRequestPayload
                {
                    requires_confirmation = true,
                    action = fallbackAction
                }
            };

            if (!string.IsNullOrEmpty(fallbackAction.component_assembly_qualified_name))
            {
                _pendingCompileComponentAssemblyQualifiedName =
                    fallbackAction.component_assembly_qualified_name;
            }
            return true;
        }

        private static bool IsActionPayloadValid(VisualLayerActionItem action)
        {
            if (action == null)
            {
                return false;
            }

            if (string.IsNullOrWhiteSpace(action.type) ||
                string.IsNullOrWhiteSpace(action.target))
            {
                return false;
            }

            if (string.Equals(action.type, "add_component", StringComparison.Ordinal) ||
                string.Equals(action.type, "remove_component", StringComparison.Ordinal))
            {
                return !string.IsNullOrWhiteSpace(action.target_object_path) &&
                       !string.IsNullOrWhiteSpace(action.component_assembly_qualified_name);
            }

            if (string.Equals(action.type, "replace_component", StringComparison.Ordinal))
            {
                return !string.IsNullOrWhiteSpace(action.target_object_path) &&
                       !string.IsNullOrWhiteSpace(action.source_component_assembly_qualified_name) &&
                       !string.IsNullOrWhiteSpace(action.component_assembly_qualified_name);
            }

            if (string.Equals(action.type, "create_gameobject", StringComparison.Ordinal))
            {
                if (string.IsNullOrWhiteSpace(action.name))
                {
                    return false;
                }

                return string.IsNullOrWhiteSpace(action.primitive_type) ||
                       string.IsNullOrWhiteSpace(action.ui_type);
            }

            return false;
        }

        private void ProcessTurnEvents(TurnStatusResponse status)
        {
            if (status == null)
            {
                return;
            }

            if (status.events == null || status.events.Length == 0)
            {
                if (status.latest_event_seq > _lastSeenEventSeq)
                {
                    _lastSeenEventSeq = status.latest_event_seq;
                }
                return;
            }

            for (var i = 0; i < status.events.Length; i++)
            {
                var item = status.events[i];
                if (item == null || item.seq <= _lastSeenEventSeq)
                {
                    continue;
                }

                _lastSeenEventSeq = item.seq;
                ProcessTurnEventItem(item);
            }

            if (status.latest_event_seq > _lastSeenEventSeq)
            {
                _lastSeenEventSeq = status.latest_event_seq;
            }
        }

        private void ProcessTurnEventItem(TurnEventItem item)
        {
            if (item == null || string.IsNullOrEmpty(item.@event))
            {
                return;
            }

            if (item.@event == "chat.delta")
            {
                return;
            }

            if (item.@event == "chat.message")
            {
                var text = !string.IsNullOrEmpty(item.message) ? item.message : item.delta;
                LogAssistantMessage(text);
                return;
            }

            if (item.@event == "turn.completed" && string.Equals(item.phase, "planning", StringComparison.Ordinal))
            {
                if (!EnableDiagnosticLogs)
                {
                    return;
                }

                var message = string.IsNullOrEmpty(item.message)
                    ? "Planning phase completed."
                    : item.message;
                AddLog(UiLogLevel.Info, "turn.completed(planning): " + message);

                if (item.task_allocation != null)
                {
                    var fileCount = item.task_allocation.file_actions != null
                        ? item.task_allocation.file_actions.Length
                        : 0;
                    var visualCount = item.task_allocation.visual_layer_actions != null
                        ? item.task_allocation.visual_layer_actions.Length
                        : 0;
                    AddLog(
                        UiLogLevel.Info,
                        "planning payload: file_actions=" + fileCount +
                        ", visual_layer_actions=" + visualCount + ".");
                }

                if (item.files_changed != null && item.files_changed.Length > 0)
                {
                    AddLog(UiLogLevel.Info, "planning files.changed: " + item.files_changed.Length + " file(s).");
                }

                return;
            }

            if (item.@event == "unity.query.components.request")
            {
                _ = HandleUnityQueryComponentsRequestAsync(item.unity_query_components_request);
                return;
            }

            if (item.@event == "unity.action.request")
            {
                AddLog(UiLogLevel.Info, "unity.action.request: waiting for user confirmation.");
            }
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

            lock (_unityComponentQueryLock)
            {
                if (_inflightUnityComponentQueryIds.Contains(queryId))
                {
                    return;
                }
                _inflightUnityComponentQueryIds.Add(queryId);
            }

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
                    errorCode = snapshot != null && !string.IsNullOrEmpty(snapshot.error_code)
                        ? snapshot.error_code
                        : string.Empty;
                    errorMessage = snapshot != null && !string.IsNullOrEmpty(snapshot.error_message)
                        ? snapshot.error_message
                        : string.Empty;
                }
                catch (Exception ex)
                {
                    errorCode = UnityQueryErrorFailed;
                    errorMessage = ex.Message;
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
                        error_code = errorCode ?? string.Empty,
                        error_message = errorMessage ?? string.Empty
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
            finally
            {
                lock (_unityComponentQueryLock)
                {
                    _inflightUnityComponentQueryIds.Remove(queryId);
                }
            }
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
                snapshot.error_message = "Unity is compiling scripts; component query is temporarily unavailable.";
                return snapshot;
            }

            var target = FindSceneObjectByPath(targetPath);
            if (target == null)
            {
                snapshot.error_code = UnityQueryErrorTargetNotFound;
                snapshot.error_message = "Target object path not found in scene: " + targetPath;
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
                snapshot.error_message = ex.Message;
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
            if (status == null)
            {
                return;
            }

            LogAssistantMessage(status.assistant_summary);

            if (!EnableDiagnosticLogs)
            {
                return;
            }

            if (!string.IsNullOrEmpty(status.phase))
            {
                AddLog(UiLogLevel.Info, "turn.phase=" + status.phase);
            }

            if (status.task_allocation != null)
            {
                var fileCount = status.task_allocation.file_actions != null
                    ? status.task_allocation.file_actions.Length
                    : 0;
                var visualCount = status.task_allocation.visual_layer_actions != null
                    ? status.task_allocation.visual_layer_actions.Length
                    : 0;
                AddLog(
                    UiLogLevel.Info,
                    "task_allocation: file_actions=" + fileCount +
                    ", visual_layer_actions=" + visualCount + ".");
            }

            if (status.files_changed == null || status.files_changed.Length == 0)
            {
                return;
            }

            AddLog(UiLogLevel.Info, "files.changed: " + status.files_changed.Length + " file(s).");
            for (var i = 0; i < status.files_changed.Length; i++)
            {
                var item = status.files_changed[i];
                if (item == null)
                {
                    continue;
                }

                AddLog(UiLogLevel.Info, " - " + item.type + ": " + item.path);
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

            if (string.Equals(normalized, _lastAssistantMessageSignature, StringComparison.Ordinal))
            {
                return;
            }

            _lastAssistantMessageSignature = normalized;
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
                status.pending_visual_action != null &&
                !string.IsNullOrEmpty(status.pending_visual_action.component_assembly_qualified_name))
            {
                _pendingCompileComponentAssemblyQualifiedName =
                    status.pending_visual_action.component_assembly_qualified_name;
            }

            if (_compileGateOpenedAtUtcTicks <= 0L)
            {
                _compileGateOpenedAtUtcTicks = DateTime.UtcNow.Ticks;
            }

            _compileDeadlineAt = now + CompileTimeoutSeconds;
            _compileResultAutoReportInFlight = false;
            _lastCompilePendingHeartbeatAt = now;

            var shouldRefresh = status != null &&
                                status.compile_request != null &&
                                status.compile_request.refresh_assets;
            if (!shouldRefresh && _compileRefreshIssued)
            {
                return;
            }

            var reason = status != null && status.compile_request != null
                ? status.compile_request.reason
                : string.Empty;
            if (string.IsNullOrEmpty(reason))
            {
                reason = "compile_gate_opened";
            }

            AddLog(UiLogLevel.Info, "Compile gate opened (" + reason + "). Step 2/3: refreshing assets.");
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            _compileRefreshIssued = true;
            _lastCompileRefreshAt = now;
            AddLog(UiLogLevel.Info, "Compile result will be auto-reported when Unity finishes compiling.");
        }

        private string BuildBusyReasonForRuntimeState()
        {
            if (_runtimeState == TurnRuntimeState.CompilePending)
            {
                return "Compile Pending";
            }

            if (_runtimeState == TurnRuntimeState.AutoFixPending)
            {
                return "Auto Fix Pending";
            }

            if (_runtimeState == TurnRuntimeState.ActionConfirmPending)
            {
                return "Action Confirmation";
            }

            if (_runtimeState == TurnRuntimeState.ActionExecuting)
            {
                return "Action Executing";
            }

            if (_runtimeState == TurnRuntimeState.CodexPending)
            {
                return "Planning/Executing";
            }

            return "Running";
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
                        message = snapshot == null || string.IsNullOrEmpty(snapshot.message)
                            ? "Compilation failed"
                            : snapshot.message
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
        }

        private TurnStatusResponse ToTurnStatus(UnityCompileReportResponse report)
        {
            if (report == null)
            {
                return null;
            }

            return new TurnStatusResponse
            {
                request_id = report.request_id,
                state = report.state,
                @event = report.@event,
                message = report.message,
                error_code = report.error_code,
                stage = report.stage,
                phase = report.phase,
                pending_visual_action_count = report.pending_visual_action_count,
                pending_visual_action = report.pending_visual_action,
                files_changed = report.files_changed,
                compile_request = report.compile_request,
                unity_action_request = report.unity_action_request,
                events = report.events,
                latest_event_seq = report.latest_event_seq,
                auto_fix_attempts = report.auto_fix_attempts,
                max_auto_fix_attempts = report.auto_fix_max_attempts,
                replay = false
            };
        }

        private TurnStatusResponse ToTurnStatus(UnityActionReportResponse report)
        {
            if (report == null)
            {
                return null;
            }

            return new TurnStatusResponse
            {
                request_id = report.request_id,
                state = report.state,
                @event = report.@event,
                message = report.message,
                error_code = report.error_code,
                stage = report.stage,
                phase = report.phase,
                pending_visual_action_count = report.pending_visual_action_count,
                pending_visual_action = report.pending_visual_action,
                unity_action_request = report.unity_action_request,
                events = report.events,
                latest_event_seq = report.latest_event_seq,
                auto_fix_attempts = report.auto_fix_attempts,
                max_auto_fix_attempts = report.auto_fix_max_attempts,
                replay = false
            };
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

        private static bool IsTerminalStatus(TurnStatusResponse status)
        {
            if (status == null)
            {
                return false;
            }

            return status.state == "completed" || status.state == "cancelled" || status.state == "error";
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

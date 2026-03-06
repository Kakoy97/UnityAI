using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Queries;
using UnityAI.Editor.Codex.Ports;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Application
{
    public sealed partial class ConversationController
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
        private const double CapabilityHeartbeatIntervalSeconds = 30d;

        private readonly ISidecarGateway _sidecarGateway;
        private readonly ISidecarProcessManager _processManager;
        private readonly ISelectionContextBuilder _contextBuilder;
        private readonly IConversationStateStore _stateStore;
        private readonly UnityRagReadService _ragReadService;
        private readonly UnityQueryRegistry _unityQueryRegistry;
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
        private bool _capabilityReportInFlight;
        private string _lastReportedCapabilityVersion = string.Empty;
        private bool _capabilityHeartbeatInFlight;
        private double _lastCapabilityHeartbeatAt;
        private bool _onboardingScriptInFlight;

        public ConversationController(
            ISidecarGateway sidecarGateway,
            ISidecarProcessManager processManager,
            ISelectionContextBuilder contextBuilder,
            IConversationStateStore stateStore)
        {
            _sidecarGateway = sidecarGateway;
            _processManager = processManager;
            _contextBuilder = contextBuilder;
            _stateStore = stateStore;
            _ragReadService = new UnityRagReadService();
            _unityQueryRegistry = UnityQueryRegistryBootstrap.Registry;
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
        public bool IsOnboardingScriptInFlight
        {
            get { return _onboardingScriptInFlight; }
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
                if (!string.IsNullOrEmpty(persisted.pending_compile_request_id))
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
                await ReportCapabilitiesAsync("startup_sync", true);
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
            await ReportCapabilitiesAsync("startup_sync", true);
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
                    var errorCode = result.TransportSuccess ? ReadErrorCode(result) : string.Empty;
                    if (string.Equals(errorCode, "E_GONE", StringComparison.Ordinal))
                    {
                        return;
                    }

                    if (force)
                    {
                        AddLog(
                            UiLogLevel.Warning,
                            "unity.selection.snapshot failed: " +
                            (result.TransportSuccess
                                ? errorCode
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
                    var errorCode = result.TransportSuccess ? ReadErrorCode(result) : string.Empty;
                    if (string.Equals(errorCode, "E_GONE", StringComparison.Ordinal))
                    {
                        return;
                    }

                    if (force)
                    {
                        AddLog(
                            UiLogLevel.Warning,
                            "unity.console.snapshot failed: " +
                            (result.TransportSuccess
                                ? errorCode
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
                pending_visual_action = report.pending_visual_action
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
                pending_visual_action = response.pending_visual_action
            };
        }

        private Task<UnityQueryRegistryDispatchResult> DispatchPulledReadQueryViaRegistryAsync(
            string queryType,
            UnityPulledQuery pulledQuery)
        {
            return _unityQueryRegistry.DispatchAsync(
                queryType,
                pulledQuery,
                BuildUnityQueryExecutionContext());
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

using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;

namespace UnityAI.Editor.Codex.Application
{
    public sealed partial class ConversationController
    {
        public string GetStatusText(double now)
        {
            return GetStatusTextCore(now);
        }

        private string GetStatusTextCore(double now)
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
                return;
            }

            if (string.Equals(stage, "action_confirm_pending", StringComparison.OrdinalIgnoreCase))
            {
                _runtimeState = TurnRuntimeState.ActionExecuting;
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

            if (_runtimeState == TurnRuntimeState.ActionExecuting)
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

            AddLog(
                UiLogLevel.Info,
                "diag.status[" + SafeString(source) + "]: request_id=" + SafeString(status.request_id) +
                ", state=" + SafeString(status.state) +
                ", stage=" + SafeString(status.stage) + ".");
        }

    }
}

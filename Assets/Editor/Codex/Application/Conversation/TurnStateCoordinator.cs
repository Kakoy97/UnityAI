using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

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
                string validationErrorCode;
                string validationErrorMessage;
                if (!TryValidateActionRequestPayload(
                        envelope.payload,
                        out validationErrorCode,
                        out validationErrorMessage))
                {
                    LogDiagnostic(
                        UiLogLevel.Warning,
                        "diag.action.capture[" + sourceTag + "]: envelope action is incomplete, ignored. action=" +
                        BuildActionDebugText(envelope.payload.action) +
                        ", write_anchor=" +
                        FormatAnchorDebug(envelope.payload.write_anchor) +
                        ", error_code=" +
                        SafeString(validationErrorCode) +
                        ", message=" +
                        SafeString(validationErrorMessage) +
                        ".");
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
                "[Codex] 閺€璺哄煂閺屻儴顕楃拠閿嬬湴娴滃棴绱?query_id=" + queryId +
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

    }
}
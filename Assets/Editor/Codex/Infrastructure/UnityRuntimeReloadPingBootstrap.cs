using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;

namespace UnityAI.Editor.Codex.Infrastructure
{
    [InitializeOnLoad]
    public static class UnityRuntimeReloadPingBootstrap
    {
        private const string SidecarUrlEditorPrefKey = "CodexUnity.SidecarUrl";
        private const string ThreadIdEditorPrefKey = "CodexUnity.ThreadId";
        private const string DefaultSidecarUrl = "http://127.0.0.1:46321";
        private const string DefaultThreadId = "t_default";
        private const double RecoveryProbeIntervalSeconds = 5d;
        private const double RecoveryProbeWindowSeconds = 120d;

        private static bool _needsRecoveryProbe;
        private static bool _recoveryProbeInFlight;
        private static double _lastRecoveryProbeAt;
        private static double _recoveryProbeStartedAt;

        static UnityRuntimeReloadPingBootstrap()
        {
            EditorApplication.delayCall += OnEditorDelayCall;
            EditorApplication.update += OnEditorUpdate;
        }

        private static void OnEditorDelayCall()
        {
            _recoveryProbeStartedAt = GetNowSeconds();
            _needsRecoveryProbe = HasPendingBusyState();
            if (_needsRecoveryProbe)
            {
                _ = TryPingAfterReloadAsync();
            }
        }

        private static void OnEditorUpdate()
        {
            if (!_needsRecoveryProbe || _recoveryProbeInFlight)
            {
                return;
            }

            var now = GetNowSeconds();
            if (_recoveryProbeStartedAt > 0d &&
                now - _recoveryProbeStartedAt > RecoveryProbeWindowSeconds)
            {
                _needsRecoveryProbe = false;
                return;
            }

            if (_lastRecoveryProbeAt > 0d &&
                now - _lastRecoveryProbeAt < RecoveryProbeIntervalSeconds)
            {
                return;
            }

            _ = TryPingAfterReloadAsync();
        }

        private static async Task TryPingAfterReloadAsync()
        {
            if (_recoveryProbeInFlight)
            {
                return;
            }

            _recoveryProbeInFlight = true;
            _lastRecoveryProbeAt = GetNowSeconds();
            try
            {
                var stateStore = new EditorPrefsConversationStateStore();
                var state = stateStore.Load();
                if (state == null || !state.is_busy || string.IsNullOrEmpty(state.active_request_id))
                {
                    _needsRecoveryProbe = false;
                    return;
                }

                var controller = UnityRagQueryPollingBootstrap.GetController();
                if (controller == null)
                {
                    return;
                }

                controller.SidecarUrl = EditorPrefs.GetString(SidecarUrlEditorPrefKey, DefaultSidecarUrl);
                var threadId = !string.IsNullOrEmpty(state.thread_id)
                    ? state.thread_id
                    : EditorPrefs.GetString(ThreadIdEditorPrefKey, DefaultThreadId);
                controller.ThreadId = string.IsNullOrEmpty(threadId) ? DefaultThreadId : threadId;
                await controller.SendRuntimePingAsync();

                var refreshed = stateStore.Load();
                if (refreshed == null || !refreshed.is_busy || string.IsNullOrEmpty(refreshed.active_request_id))
                {
                    _needsRecoveryProbe = false;
                }
            }
            finally
            {
                _recoveryProbeInFlight = false;
            }
        }

        private static bool HasPendingBusyState()
        {
            var stateStore = new EditorPrefsConversationStateStore();
            var state = stateStore.Load();
            return state != null &&
                   state.is_busy &&
                   !string.IsNullOrEmpty(state.active_request_id);
        }

        private static TurnRuntimeState MapRuntimeState(string stage)
        {
            if (string.Equals(stage, "compile_pending", StringComparison.OrdinalIgnoreCase))
            {
                return TurnRuntimeState.CompilePending;
            }

            if (string.Equals(stage, "action_confirm_pending", StringComparison.OrdinalIgnoreCase))
            {
                return TurnRuntimeState.ActionConfirmPending;
            }

            if (string.Equals(stage, "action_executing", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "action_pending", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "waiting_for_unity_reboot", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "dispatch_pending", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "queued", StringComparison.OrdinalIgnoreCase))
            {
                return TurnRuntimeState.ActionExecuting;
            }

            return TurnRuntimeState.Idle;
        }

        private static string MapBusyReason(string stage)
        {
            if (string.Equals(stage, "compile_pending", StringComparison.OrdinalIgnoreCase))
            {
                return "Compile Pending";
            }

            if (string.Equals(stage, "action_confirm_pending", StringComparison.OrdinalIgnoreCase))
            {
                return "Action Confirmation";
            }

            if (string.Equals(stage, "waiting_for_unity_reboot", StringComparison.OrdinalIgnoreCase))
            {
                return "Waiting For Unity Reboot";
            }

            if (string.Equals(stage, "action_executing", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "action_pending", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "dispatch_pending", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(stage, "queued", StringComparison.OrdinalIgnoreCase))
            {
                return "Action Executing";
            }

            return "Idle";
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

        private static double GetNowSeconds()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
        }
    }
}

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

        static UnityRuntimeReloadPingBootstrap()
        {
            EditorApplication.delayCall += OnEditorDelayCall;
        }

        private static void OnEditorDelayCall()
        {
            _ = TryPingAfterReloadAsync();
        }

        private static async Task TryPingAfterReloadAsync()
        {
            var stateStore = new EditorPrefsConversationStateStore();
            var state = stateStore.Load();
            if (state == null || !state.is_busy || string.IsNullOrEmpty(state.active_request_id))
            {
                return;
            }

            var sidecarUrl = EditorPrefs.GetString(SidecarUrlEditorPrefKey, DefaultSidecarUrl);
            var threadId = !string.IsNullOrEmpty(state.thread_id)
                ? state.thread_id
                : EditorPrefs.GetString(ThreadIdEditorPrefKey, DefaultThreadId);
            if (string.IsNullOrEmpty(threadId))
            {
                threadId = DefaultThreadId;
            }

            var turnId = string.IsNullOrEmpty(state.turn_id) ? "u_recovered" : state.turn_id;
            var request = new UnityRuntimePingRequest
            {
                @event = "unity.runtime.ping",
                request_id = "req_ping_" + Guid.NewGuid().ToString("N"),
                thread_id = threadId,
                turn_id = turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityRuntimePingPayload
                {
                    status = "just_recompiled"
                }
            };

            var gateway = new HttpSidecarGateway();
            var response = await gateway.ReportRuntimePingAsync(sidecarUrl, request);
            if (!response.TransportSuccess || !response.IsHttpSuccess || response.Data == null)
            {
                return;
            }

            var pong = response.Data;
            if (!string.Equals(pong.state, "running", StringComparison.Ordinal) || string.IsNullOrEmpty(pong.request_id))
            {
                return;
            }

            state.active_request_id = pong.request_id;
            state.pending_compile_request_id = string.Equals(pong.stage, "compile_pending", StringComparison.Ordinal)
                ? pong.request_id
                : string.Empty;
            state.pending_action_request_id =
                string.Equals(pong.stage, "action_confirm_pending", StringComparison.Ordinal) ||
                string.Equals(pong.stage, "action_executing", StringComparison.Ordinal)
                    ? pong.request_id
                    : string.Empty;
            state.runtime_state = MapRuntimeState(pong.stage).ToString();
            state.busy_reason = MapBusyReason(pong.stage);
            state.updated_at = DateTime.UtcNow.ToString("o");
            stateStore.Save(state);
        }

        private static TurnRuntimeState MapRuntimeState(string stage)
        {
            if (string.Equals(stage, "compile_pending", StringComparison.Ordinal))
            {
                return TurnRuntimeState.CompilePending;
            }

            if (string.Equals(stage, "action_confirm_pending", StringComparison.Ordinal))
            {
                return TurnRuntimeState.ActionConfirmPending;
            }

            if (string.Equals(stage, "action_executing", StringComparison.Ordinal))
            {
                return TurnRuntimeState.ActionExecuting;
            }

            if (string.Equals(stage, "auto_fix_pending", StringComparison.Ordinal))
            {
                return TurnRuntimeState.AutoFixPending;
            }

            if (string.Equals(stage, "codex_pending", StringComparison.Ordinal))
            {
                return TurnRuntimeState.CodexPending;
            }

            return TurnRuntimeState.Running;
        }

        private static string MapBusyReason(string stage)
        {
            if (string.Equals(stage, "compile_pending", StringComparison.Ordinal))
            {
                return "Compile Pending";
            }

            if (string.Equals(stage, "action_confirm_pending", StringComparison.Ordinal))
            {
                return "Action Confirmation";
            }

            if (string.Equals(stage, "action_executing", StringComparison.Ordinal))
            {
                return "Action Executing";
            }

            if (string.Equals(stage, "auto_fix_pending", StringComparison.Ordinal))
            {
                return "Auto Fix Pending";
            }

            if (string.Equals(stage, "codex_pending", StringComparison.Ordinal))
            {
                return "Planning/Executing";
            }

            return "Running";
        }
    }
}

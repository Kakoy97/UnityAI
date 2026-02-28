using System;
using UnityAI.Editor.Codex.Application;
using UnityEditor;

namespace UnityAI.Editor.Codex.Infrastructure
{
    [InitializeOnLoad]
    public static class UnityRagQueryPollingBootstrap
    {
        private const string SidecarUrlEditorPrefKey = "CodexUnity.SidecarUrl";
        private const string ThreadIdEditorPrefKey = "CodexUnity.ThreadId";
        private const string DefaultSidecarUrl = "http://127.0.0.1:46321";
        private const string DefaultThreadId = "t_default";

        private static readonly ConversationController SharedController;
        private static bool _updateHooked;

        static UnityRagQueryPollingBootstrap()
        {
            SharedController = new ConversationController(
                new HttpSidecarGateway(),
                new SidecarProcessManager(),
                new UnitySelectionContextBuilder(),
                new EditorPrefsConversationStateStore(),
                new UnityVisualActionExecutor());

            SharedController.SidecarUrl = EditorPrefs.GetString(SidecarUrlEditorPrefKey, DefaultSidecarUrl);
            SharedController.ThreadId = EditorPrefs.GetString(ThreadIdEditorPrefKey, DefaultThreadId);
            SharedController.InitializeFromPersistedState();

            HookEditorUpdate();
        }

        public static ConversationController GetController()
        {
            return SharedController;
        }

        private static void OnEditorUpdate()
        {
            if (SharedController == null)
            {
                return;
            }

            _ = SharedController.PollRagQueriesAsync(GetNowSeconds());
        }

        private static double GetNowSeconds()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
        }

        private static void HookEditorUpdate()
        {
            if (_updateHooked)
            {
                return;
            }

            EditorApplication.update += OnEditorUpdate;
            _updateHooked = true;
        }
    }
}

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
        private const double SelectionSnapshotProbeIntervalSeconds = 8d;

        private static readonly ConversationController SharedController;
        private static bool _updateHooked;
        private static bool _selectionHooked;
        private static double _lastSelectionProbeAt;

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
            HookSelectionChanged();
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

            var now = GetNowSeconds();
            _ = SharedController.PollRagQueriesAsync(now);
            MaybeProbeSelectionSnapshot(now);
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

        private static void HookSelectionChanged()
        {
            if (_selectionHooked)
            {
                return;
            }

            Selection.selectionChanged += OnSelectionChanged;
            _selectionHooked = true;
            OnSelectionChanged();
        }

        private static void OnSelectionChanged()
        {
            if (SharedController == null)
            {
                return;
            }

            SharedController.NotifySelectionChanged(Selection.activeGameObject);
        }

        private static void MaybeProbeSelectionSnapshot(double now)
        {
            if (_lastSelectionProbeAt > 0d &&
                now - _lastSelectionProbeAt < SelectionSnapshotProbeIntervalSeconds)
            {
                return;
            }

            _lastSelectionProbeAt = now;
            OnSelectionChanged();
        }
    }
}

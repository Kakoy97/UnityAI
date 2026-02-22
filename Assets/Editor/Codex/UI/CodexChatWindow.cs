using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Application;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.UI
{
    public sealed class CodexChatWindow : EditorWindow
    {
        private const string SidecarUrlEditorPrefKey = "CodexUnity.SidecarUrl";
        private const string ThreadIdEditorPrefKey = "CodexUnity.ThreadId";
        private const string DefaultSidecarUrl = "http://127.0.0.1:46321";
        private const string DefaultThreadId = "t_default";

        private ConversationController _controller;
        private Vector2 _logScrollPosition;
        private string _messageInput = string.Empty;
        private GUIStyle _logStyle;

        [MenuItem("Tools/Codex/Chat MVP")]
        public static void OpenWindow()
        {
            GetWindow<CodexChatWindow>("Codex Chat");
        }

        private void OnEnable()
        {
            if (_controller == null)
            {
                _controller = new ConversationController(
                    new HttpSidecarGateway(),
                    new SidecarProcessManager(),
                    new UnitySelectionContextBuilder(),
                    new EditorPrefsConversationStateStore(),
                    new UnityVisualActionExecutor());
            }

            _controller.SidecarUrl = EditorPrefs.GetString(SidecarUrlEditorPrefKey, DefaultSidecarUrl);
            _controller.ThreadId = EditorPrefs.GetString(ThreadIdEditorPrefKey, DefaultThreadId);
            _controller.InitializeFromPersistedState();
            _controller.Changed += OnControllerChanged;
            EditorApplication.update += OnEditorUpdate;

            if (_logStyle == null)
            {
                _logStyle = new GUIStyle(EditorStyles.label);
                _logStyle.richText = true;
                _logStyle.wordWrap = true;
            }
        }

        private void OnDisable()
        {
            if (_controller != null)
            {
                EditorPrefs.SetString(SidecarUrlEditorPrefKey, _controller.SidecarUrl);
                EditorPrefs.SetString(ThreadIdEditorPrefKey, _controller.ThreadId);
                _controller.Changed -= OnControllerChanged;
            }
            EditorApplication.update -= OnEditorUpdate;
        }

        private void OnEditorUpdate()
        {
            var now = GetNowSeconds();
            if (_controller != null && _controller.ShouldPoll(now))
            {
                _ = _controller.PollTurnStatusAsync(now);
            }
        }

        private void OnGUI()
        {
            EditorGUILayout.LabelField("Codex Unity MVP - Phase 6", EditorStyles.boldLabel);
            EditorGUILayout.Space(4);

            var sidecarUrl = EditorGUILayout.TextField("Sidecar URL", _controller.SidecarUrl);
            if (sidecarUrl != _controller.SidecarUrl)
            {
                _controller.SidecarUrl = sidecarUrl;
            }

            var threadId = EditorGUILayout.TextField("Thread ID", _controller.ThreadId);
            if (threadId != _controller.ThreadId)
            {
                _controller.ThreadId = threadId;
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Start Sidecar", GUILayout.Height(22)))
                {
                    _ = _controller.StartSidecarAsync();
                }

                if (GUILayout.Button("Stop Sidecar", GUILayout.Height(22)))
                {
                    _controller.StopSidecar();
                }

                if (GUILayout.Button("Health", GUILayout.Height(22)))
                {
                    _ = _controller.CheckHealthAsync();
                }

                if (GUILayout.Button("Runtime Ping", GUILayout.Height(22)))
                {
                    _ = _controller.SendRuntimePingAsync();
                }
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Phase6 Smoke Write+Action", GUILayout.Height(22)))
                {
                    _ = _controller.ApplyPhase6SmokeWriteAsync(Selection.activeGameObject);
                }
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(!_controller.CanReportCompileSuccess))
                {
                    if (GUILayout.Button("Report Compile Success", GUILayout.Height(22)))
                    {
                        _ = _controller.ReportCompileResultAsync(true);
                    }
                }

                using (new EditorGUI.DisabledScope(!_controller.CanReportCompileFailure))
                {
                    if (GUILayout.Button("Report Compile Failure", GUILayout.Height(22)))
                    {
                        _ = _controller.ReportCompileResultAsync(false);
                    }
                }
            }

            if (_controller.IsWaitingForCompileGateCompletion)
            {
                EditorGUILayout.HelpBox("Compile gate is open. Unity compile result will be auto-reported.", MessageType.Info);
            }
            else if (_controller.HasCompileGateErrors)
            {
                EditorGUILayout.HelpBox("Last compile contains errors. Report Compile Failure instead of Success.", MessageType.Warning);
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(!_controller.CanConfirmPendingAction || _controller.IsEditorCompiling))
                {
                    if (GUILayout.Button("Approve Action", GUILayout.Height(22)))
                    {
                        _ = _controller.ConfirmPendingActionAsync(Selection.activeGameObject);
                    }

                    if (GUILayout.Button("Reject Action", GUILayout.Height(22)))
                    {
                        _ = _controller.RejectPendingActionAsync(Selection.activeGameObject);
                    }
                }
            }

            if (_controller.CanConfirmPendingAction && _controller.IsEditorCompiling)
            {
                EditorGUILayout.HelpBox("Unity is compiling. Wait for compile to complete, then approve action.", MessageType.Warning);
            }

            EditorGUILayout.HelpBox("Status: " + _controller.GetStatusText(GetNowSeconds()), MessageType.Info);

            EditorGUILayout.LabelField("Message");
            _messageInput = EditorGUILayout.TextArea(_messageInput, GUILayout.MinHeight(90));

            using (new EditorGUILayout.HorizontalScope())
            {
                using (new EditorGUI.DisabledScope(_controller.IsBusy))
                {
                    if (GUILayout.Button("Send", GUILayout.Height(28)))
                    {
                        _ = SendAsync();
                    }
                }

                var previousColor = GUI.backgroundColor;
                GUI.backgroundColor = new Color(0.85f, 0.35f, 0.35f);
                using (new EditorGUI.DisabledScope(!_controller.IsBusy))
                {
                    if (GUILayout.Button("Cancel", GUILayout.Height(28)))
                    {
                        _ = _controller.CancelTurnAsync();
                    }
                }

                GUI.backgroundColor = previousColor;
            }

            if (_controller.IsWaitingForCodexReply)
            {
                var dots = BuildTypingDots(GetNowSeconds());
                EditorGUILayout.LabelField("Codex is replying" + dots, EditorStyles.miniLabel);
            }

            EditorGUILayout.Space(8);
            EditorGUILayout.LabelField("Logs", EditorStyles.boldLabel);
            _logScrollPosition = EditorGUILayout.BeginScrollView(_logScrollPosition);
            var logs = _controller.Logs;
            for (var i = 0; i < logs.Count; i++)
            {
                EditorGUILayout.LabelField(logs[i].ToRichText(), _logStyle);
            }

            EditorGUILayout.EndScrollView();
        }

        private async Task SendAsync()
        {
            var pendingInput = _messageInput;
            _messageInput = string.Empty;
            Repaint();

            var notifySelection = await _controller.SendTurnAsync(
                pendingInput,
                Selection.activeGameObject,
                GetNowSeconds());

            if (notifySelection)
            {
                ShowNotification(new GUIContent("Select a target object first."));
            }
        }

        private void OnControllerChanged()
        {
            _logScrollPosition.y = float.MaxValue;
            Repaint();
        }

        private static double GetNowSeconds()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
        }

        private static string BuildTypingDots(double now)
        {
            var index = (int)(now * 2d) % 4;
            if (index == 0)
            {
                return ".";
            }
            if (index == 1)
            {
                return "..";
            }
            if (index == 2)
            {
                return "...";
            }
            return "";
        }
    }
}

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
                _controller = UnityRagQueryPollingBootstrap.GetController();
            }

            _controller.SidecarUrl = EditorPrefs.GetString(SidecarUrlEditorPrefKey, DefaultSidecarUrl);
            _controller.ThreadId = EditorPrefs.GetString(ThreadIdEditorPrefKey, DefaultThreadId);
            _controller.Changed += OnControllerChanged;

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
            }

            EditorGUILayout.Space(4);
            EditorGUILayout.LabelField("Onboarding", EditorStyles.boldLabel);
            using (new EditorGUI.DisabledScope(_controller.IsOnboardingScriptInFlight))
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    if (GUILayout.Button("Setup MCP (Native)", GUILayout.Height(22)))
                    {
                        _ = _controller.SetupCursorMcpNativeAsync();
                    }

                    if (GUILayout.Button("Setup MCP (Cline)", GUILayout.Height(22)))
                    {
                        _ = _controller.SetupCursorMcpClineAsync();
                    }

                    if (GUILayout.Button("Verify MCP", GUILayout.Height(22)))
                    {
                        _ = _controller.VerifyMcpSetupAsync();
                    }
                }
            }

            using (new EditorGUILayout.HorizontalScope())
            {
                if (GUILayout.Button("Open Native Config", GUILayout.Height(20)))
                {
                    _controller.RevealCursorMcpConfig(true);
                }

                if (GUILayout.Button("Open Cline Config", GUILayout.Height(20)))
                {
                    _controller.RevealCursorMcpConfig(false);
                }
            }

            EditorGUILayout.LabelField(
                "Native MCP Config",
                _controller.GetCursorMcpConfigPathPreview(true));
            EditorGUILayout.LabelField(
                "Cline MCP Config",
                _controller.GetCursorMcpConfigPathPreview(false));
            if (_controller.IsOnboardingScriptInFlight)
            {
                EditorGUILayout.HelpBox(
                    "Onboarding script is running. Please wait for completion.",
                    MessageType.Info);
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

            EditorGUILayout.HelpBox("Status: " + _controller.GetStatusText(GetNowSeconds()), MessageType.Info);

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


        private void OnControllerChanged()
        {
            _logScrollPosition.y = float.MaxValue;
            Repaint();
        }

        private static double GetNowSeconds()
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000d;
        }

    }
}

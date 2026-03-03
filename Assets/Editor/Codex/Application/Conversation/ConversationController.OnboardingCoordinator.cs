using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Application
{
    public sealed partial class ConversationController
    {
        private const string DefaultCursorNativeMcpConfigRelativePath = "Cursor/mcp.json";
        private const string DefaultCursorClineMcpConfigRelativePath =
            "Cursor/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json";

        public Task SetupCursorMcpNativeAsync()
        {
            return RunOnboardingScriptAsync(
                "setup-cursor-mcp.js",
                "--native " + SidecarUrl,
                "setup_cursor_mcp(native)");
        }

        public Task SetupCursorMcpClineAsync()
        {
            return RunOnboardingScriptAsync(
                "setup-cursor-mcp.js",
                SidecarUrl,
                "setup_cursor_mcp(cline)");
        }

        public Task VerifyMcpSetupAsync()
        {
            return RunOnboardingScriptAsync(
                "verify-mcp-setup.js",
                "--auto",
                "verify_mcp_setup");
        }

        public void RevealCursorMcpConfig(bool useNative)
        {
            try
            {
                var configPath = ResolveCursorMcpConfigPath(useNative);
                if (string.IsNullOrWhiteSpace(configPath))
                {
                    AddLog(UiLogLevel.Warning, "Cannot resolve Cursor MCP config path.");
                    return;
                }

                var normalized = configPath.Trim();
                if (File.Exists(normalized))
                {
                    EditorUtility.RevealInFinder(normalized);
                    return;
                }

                var directory = Path.GetDirectoryName(normalized);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    if (!Directory.Exists(directory))
                    {
                        Directory.CreateDirectory(directory);
                    }

                    EditorUtility.RevealInFinder(directory);
                    return;
                }

                AddLog(UiLogLevel.Warning, "Cannot open Cursor MCP config location.");
            }
            catch (Exception ex)
            {
                if (ex is ExitGUIException)
                {
                    throw;
                }

                AddLog(UiLogLevel.Error, "Open MCP config failed: " + ex.Message);
            }
        }

        public string GetCursorMcpConfigPathPreview(bool useNative)
        {
            return ResolveCursorMcpConfigPath(useNative);
        }

        private async Task RunOnboardingScriptAsync(
            string scriptFileName,
            string arguments,
            string operationName)
        {
            if (_onboardingScriptInFlight)
            {
                AddLog(UiLogLevel.Warning, "Onboarding script is already running.");
                return;
            }

            _onboardingScriptInFlight = true;
            EmitChanged();

            try
            {
                var projectRoot = Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, ".."));
                var scriptPath = Path.Combine(projectRoot, "sidecar", "scripts", scriptFileName);
                if (!File.Exists(scriptPath))
                {
                    AddLog(
                        UiLogLevel.Error,
                        "Onboarding script not found: " + scriptPath);
                    return;
                }

                AddLog(UiLogLevel.Info, operationName + " started.");
                var result = await Task.Run(
                    () => ExecuteNodeScript(projectRoot, scriptPath, arguments));

                if (result.ExitCode == 0)
                {
                    AddLog(UiLogLevel.Info, operationName + " succeeded.");
                }
                else
                {
                    AddLog(
                        UiLogLevel.Warning,
                        operationName + " failed (exit=" + result.ExitCode + ").");
                }

                if (!string.IsNullOrWhiteSpace(result.Stdout))
                {
                    AddLog(UiLogLevel.Info, TrimMultiline(result.Stdout, 360));
                }

                if (!string.IsNullOrWhiteSpace(result.Stderr))
                {
                    AddLog(UiLogLevel.Warning, TrimMultiline(result.Stderr, 360));
                }
            }
            catch (Exception ex)
            {
                AddLog(UiLogLevel.Error, operationName + " exception: " + ex.Message);
            }
            finally
            {
                _onboardingScriptInFlight = false;
                EmitChanged();
            }
        }

        private static LocalScriptRunResult ExecuteNodeScript(
            string projectRoot,
            string scriptPath,
            string arguments)
        {
            var result = new LocalScriptRunResult
            {
                ExitCode = -1,
                Stdout = string.Empty,
                Stderr = string.Empty,
            };

            var processStartInfo = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "\"" + scriptPath + "\" " + (arguments ?? string.Empty),
                WorkingDirectory = projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };

            using (var process = Process.Start(processStartInfo))
            {
                if (process == null)
                {
                    result.Stderr = "Failed to start node process.";
                    return result;
                }

                var stdout = process.StandardOutput.ReadToEnd();
                var stderr = process.StandardError.ReadToEnd();
                process.WaitForExit(15000);
                result.ExitCode = process.ExitCode;
                result.Stdout = stdout ?? string.Empty;
                result.Stderr = stderr ?? string.Empty;
                return result;
            }
        }

        private static string TrimMultiline(string value, int maxLength)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            var normalized = value.Replace("\r", "\n");
            while (normalized.Contains("\n\n"))
            {
                normalized = normalized.Replace("\n\n", "\n");
            }

            var builder = new StringBuilder();
            var lines = normalized.Split('\n');
            for (var i = 0; i < lines.Length; i++)
            {
                var line = lines[i].Trim();
                if (string.IsNullOrEmpty(line))
                {
                    continue;
                }

                if (builder.Length > 0)
                {
                    builder.Append(" | ");
                }
                builder.Append(line);
            }

            var compact = builder.ToString();
            if (compact.Length <= maxLength)
            {
                return compact;
            }

            return compact.Substring(0, maxLength).TrimEnd();
        }

        private static string ResolveCursorMcpConfigPath(bool useNative)
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrWhiteSpace(appData))
            {
                return string.Empty;
            }

            var relative = useNative
                ? DefaultCursorNativeMcpConfigRelativePath
                : DefaultCursorClineMcpConfigRelativePath;
            return Path.Combine(appData, relative);
        }

        private struct LocalScriptRunResult
        {
            public int ExitCode;
            public string Stdout;
            public string Stderr;
        }
    }
}

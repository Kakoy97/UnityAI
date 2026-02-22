using System;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Ports;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class SidecarProcessManager : ISidecarProcessManager
    {
        private const string ManagedPidKey = "CodexUnity.Sidecar.ManagedPid";
        private const string ManagedPortKey = "CodexUnity.Sidecar.ManagedPort";
        private const int PortProbeAttempts = 12;
        private const int PortProbeDelayMs = 200;
        private const int ShutdownProbeAttempts = 12;

        private static readonly HttpClient HttpClient = CreateHttpClient();

        private Process _process;
        private int _managedPort;

        public SidecarProcessManager()
        {
            TryRecoverManagedProcess();
        }

        public bool IsRunning
        {
            get
            {
                TryRecoverManagedProcess();
                return _process != null && !_process.HasExited;
            }
        }

        public async Task<SidecarStartResult> StartAsync(string sidecarUrl)
        {
            TryRecoverManagedProcess();

            if (IsRunning)
            {
                return new SidecarStartResult
                {
                    Success = true,
                    AlreadyRunning = true,
                    Message = "Sidecar process is already running (pid=" + _process.Id + ")."
                };
            }

            Uri sidecarUri;
            if (!Uri.TryCreate(sidecarUrl, UriKind.Absolute, out sidecarUri))
            {
                return new SidecarStartResult
                {
                    Success = false,
                    AlreadyRunning = false,
                    Message = "Invalid Sidecar URL: " + sidecarUrl
                };
            }

            _managedPort = sidecarUri.Port;

            if (IsPortOpen(_managedPort))
            {
                if (!TryProbeSidecarHealth(_managedPort))
                {
                    ClearManagedProcess();
                    return new SidecarStartResult
                    {
                        Success = false,
                        AlreadyRunning = false,
                        Message = "Port " + _managedPort + " is occupied by a non-sidecar process."
                    };
                }

                Process existingByPort;
                if (TryGetProcessByPort(_managedPort, out existingByPort))
                {
                    SaveManagedProcess(existingByPort, _managedPort);
                    return new SidecarStartResult
                    {
                        Success = true,
                        AlreadyRunning = true,
                        Message = "Sidecar is already reachable on port " + _managedPort + " (pid=" + existingByPort.Id + ")."
                    };
                }

                SaveManagedPortOnly(_managedPort);
                return new SidecarStartResult
                {
                    Success = true,
                    AlreadyRunning = true,
                    Message = "Sidecar is already reachable on port " + _managedPort + "."
                };
            }

            var projectRoot = GetProjectRoot();
            var sidecarPath = Path.Combine(projectRoot, "sidecar", "index.js");
            if (!File.Exists(sidecarPath))
            {
                return new SidecarStartResult
                {
                    Success = false,
                    AlreadyRunning = false,
                    Message = "Cannot find sidecar script at: " + sidecarPath
                };
            }

            var startInfo = new ProcessStartInfo
            {
                FileName = "node",
                Arguments = "\"" + sidecarPath + "\" --port " + sidecarUri.Port,
                WorkingDirectory = projectRoot,
                UseShellExecute = false,
                CreateNoWindow = true
            };
            ConfigureCodexEnvironment(startInfo);

            try
            {
                _process = Process.Start(startInfo);
                if (_process == null)
                {
                    ClearManagedProcess();
                    return new SidecarStartResult
                    {
                        Success = false,
                        AlreadyRunning = false,
                        Message = "Failed to start sidecar process."
                    };
                }

                SaveManagedProcess(_process, _managedPort);

                for (var i = 0; i < PortProbeAttempts; i++)
                {
                    if (_process.HasExited)
                    {
                        var exitCode = _process.ExitCode;
                        ClearManagedProcess();
                        return new SidecarStartResult
                        {
                            Success = false,
                            AlreadyRunning = false,
                            Message = "Sidecar process exited early (exit code " + exitCode + ")."
                        };
                    }

                    if (IsPortOpen(_managedPort))
                    {
                        return new SidecarStartResult
                        {
                            Success = true,
                            AlreadyRunning = false,
                            Message = "Sidecar started on port " + sidecarUri.Port + "."
                        };
                    }

                    await Task.Delay(PortProbeDelayMs);
                }

                if (!_process.HasExited)
                {
                    _process.Kill();
                }

                ClearManagedProcess();
                return new SidecarStartResult
                {
                    Success = false,
                    AlreadyRunning = false,
                    Message = "Sidecar did not become reachable on port " + sidecarUri.Port + "."
                };
            }
            catch (Exception ex)
            {
                ClearManagedProcess();
                return new SidecarStartResult
                {
                    Success = false,
                    AlreadyRunning = false,
                    Message = "Failed to start sidecar: " + ex.Message
                };
            }
        }

        public SidecarStopResult Stop()
        {
            TryRecoverManagedProcess();

            if (!IsRunning)
            {
                if (_managedPort > 0 && IsPortOpen(_managedPort))
                {
                    if (TryRequestShutdown(_managedPort))
                    {
                        if (WaitForPortClosed(_managedPort))
                        {
                            ClearManagedProcess();
                            return new SidecarStopResult
                            {
                                Success = true,
                                WasRunning = true,
                                Message = "Sidecar process stopped via local shutdown endpoint."
                            };
                        }

                        return new SidecarStopResult
                        {
                            Success = false,
                            WasRunning = true,
                            Message = "Shutdown request sent but sidecar port " + _managedPort + " did not close in time."
                        };
                    }

                    if (TryKillProcessByPort(_managedPort, out var killedPid))
                    {
                        if (WaitForPortClosed(_managedPort))
                        {
                            ClearManagedProcess();
                            return new SidecarStopResult
                            {
                                Success = true,
                                WasRunning = true,
                                Message = "Sidecar process stopped by pid " + killedPid + " on port " + _managedPort + "."
                            };
                        }
                    }

                    return new SidecarStopResult
                    {
                        Success = true,
                        WasRunning = false,
                        Message = "Sidecar is reachable on port " + _managedPort + " but is not managed by this Unity session."
                    };
                }

                ClearManagedProcess();
                return new SidecarStopResult
                {
                    Success = true,
                    WasRunning = false,
                    Message = "No sidecar process is currently running."
                };
            }

            try
            {
                _process.Kill();
                ClearManagedProcess();
                return new SidecarStopResult
                {
                    Success = true,
                    WasRunning = true,
                    Message = "Sidecar process stopped."
                };
            }
            catch (Exception ex)
            {
                return new SidecarStopResult
                {
                    Success = false,
                    WasRunning = true,
                    Message = "Failed to stop sidecar: " + ex.Message
                };
            }
        }

        private static string GetProjectRoot()
        {
            return Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, ".."));
        }

        private static void ConfigureCodexEnvironment(ProcessStartInfo startInfo)
        {
            if (startInfo == null)
            {
                return;
            }

            var pathValue = startInfo.EnvironmentVariables["PATH"];
            if (string.IsNullOrEmpty(pathValue))
            {
                pathValue = Environment.GetEnvironmentVariable("PATH");
            }

            var npmBinPath = GetNpmBinPath();
            if (!string.IsNullOrEmpty(npmBinPath))
            {
                if (string.IsNullOrEmpty(pathValue))
                {
                    pathValue = npmBinPath;
                }
                else if (pathValue.IndexOf(npmBinPath, StringComparison.OrdinalIgnoreCase) < 0)
                {
                    pathValue = npmBinPath + ";" + pathValue;
                }
            }

            if (!string.IsNullOrEmpty(pathValue))
            {
                startInfo.EnvironmentVariables["PATH"] = pathValue;
            }

            if (!string.IsNullOrEmpty(startInfo.EnvironmentVariables["CODEX_EXECUTABLE"]))
            {
                return;
            }

            var codexCommandPath = GetCodexCommandPath(npmBinPath);
            startInfo.EnvironmentVariables["CODEX_EXECUTABLE"] =
                string.IsNullOrEmpty(codexCommandPath)
                    ? "codex"
                    : codexCommandPath;
        }

        private static string GetNpmBinPath()
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            if (string.IsNullOrEmpty(appData))
            {
                return string.Empty;
            }

            var npmPath = Path.Combine(appData, "npm");
            return Directory.Exists(npmPath) ? npmPath : string.Empty;
        }

        private static string GetCodexCommandPath(string npmBinPath)
        {
            if (string.IsNullOrEmpty(npmBinPath))
            {
                return string.Empty;
            }

            var codexCmd = Path.Combine(npmBinPath, "codex.cmd");
            if (File.Exists(codexCmd))
            {
                return codexCmd;
            }

            var codexExe = Path.Combine(npmBinPath, "codex.exe");
            if (File.Exists(codexExe))
            {
                return codexExe;
            }

            return string.Empty;
        }

        private void TryRecoverManagedProcess()
        {
            if (_process != null && !_process.HasExited)
            {
                return;
            }

            _process = null;
            _managedPort = EditorPrefs.GetInt(ManagedPortKey, _managedPort);

            var pid = EditorPrefs.GetInt(ManagedPidKey, -1);
            if (pid <= 0)
            {
                return;
            }

            try
            {
                var existing = Process.GetProcessById(pid);
                if (!existing.HasExited)
                {
                    _process = existing;
                    return;
                }
            }
            catch
            {
            }

            ClearManagedProcess();
        }

        private void SaveManagedProcess(Process process, int port)
        {
            _process = process;
            _managedPort = port;
            EditorPrefs.SetInt(ManagedPidKey, process.Id);
            EditorPrefs.SetInt(ManagedPortKey, port);
        }

        private void SaveManagedPortOnly(int port)
        {
            _managedPort = port;
            EditorPrefs.SetInt(ManagedPortKey, port);
            if (EditorPrefs.HasKey(ManagedPidKey))
            {
                EditorPrefs.DeleteKey(ManagedPidKey);
            }
        }

        private void ClearManagedProcess()
        {
            _process = null;
            if (EditorPrefs.HasKey(ManagedPidKey))
            {
                EditorPrefs.DeleteKey(ManagedPidKey);
            }
        }

        private static HttpClient CreateHttpClient()
        {
            var client = new HttpClient();
            client.Timeout = TimeSpan.FromSeconds(2);
            return client;
        }

        private static bool TryRequestShutdown(int port)
        {
            try
            {
                var url = "http://127.0.0.1:" + port + "/admin/shutdown";
                var response = HttpClient.PostAsync(
                        url,
                        new StringContent("{}", Encoding.UTF8, "application/json"))
                    .GetAwaiter()
                    .GetResult();
                return response.IsSuccessStatusCode;
            }
            catch
            {
                return false;
            }
        }

        private static bool WaitForPortClosed(int port)
        {
            for (var i = 0; i < ShutdownProbeAttempts; i++)
            {
                if (!IsPortOpen(port))
                {
                    return true;
                }

                System.Threading.Thread.Sleep(PortProbeDelayMs);
            }

            return !IsPortOpen(port);
        }

        private static bool TryKillProcessByPort(int port, out int killedPid)
        {
            killedPid = -1;

            Process target;
            if (!TryGetProcessByPort(port, out target))
            {
                return false;
            }

            try
            {
                if (target == null || target.HasExited)
                {
                    return false;
                }

                // Only kill node to avoid accidental termination of unrelated services.
                if (!string.Equals(target.ProcessName, "node", StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }

                killedPid = target.Id;
                target.Kill();
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool TryGetProcessByPort(int port, out Process processByPort)
        {
            processByPort = null;

            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = "netstat",
                    Arguments = "-ano -p tcp",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };

                using (var process = Process.Start(info))
                {
                    if (process == null)
                    {
                        return false;
                    }

                    var output = process.StandardOutput.ReadToEnd();
                    process.WaitForExit(1500);
                    var pid = ParseListeningPidForPort(output, port);
                    if (pid <= 0)
                    {
                        return false;
                    }

                    var target = Process.GetProcessById(pid);
                    if (target == null || target.HasExited)
                    {
                        return false;
                    }

                    processByPort = target;
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private static int ParseListeningPidForPort(string netstatOutput, int port)
        {
            if (string.IsNullOrEmpty(netstatOutput) || port <= 0)
            {
                return -1;
            }

            var lines = Regex.Split(netstatOutput, "\\r?\\n");
            var suffix = ":" + port;

            for (var i = 0; i < lines.Length; i++)
            {
                var line = lines[i];
                if (string.IsNullOrWhiteSpace(line))
                {
                    continue;
                }

                if (!line.Contains(suffix))
                {
                    continue;
                }

                var parts = Regex.Split(line.Trim(), "\\s+");
                if (parts.Length < 5)
                {
                    continue;
                }

                if (!string.Equals(parts[0], "TCP", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var localAddress = parts[1];
                var foreignAddress = parts[2];
                if (!localAddress.EndsWith(suffix, StringComparison.Ordinal))
                {
                    continue;
                }

                // Netstat localization can change the state label text, so rely on "foreign :0"
                // to identify listening socket rows.
                if (!(foreignAddress == "0.0.0.0:0" ||
                      foreignAddress == "[::]:0" ||
                      foreignAddress.EndsWith(":0", StringComparison.Ordinal)))
                {
                    continue;
                }

                int pid;
                if (int.TryParse(parts[parts.Length - 1], out pid) && pid > 0)
                {
                    return pid;
                }
            }

            return -1;
        }

        private static bool TryProbeSidecarHealth(int port)
        {
            if (port <= 0)
            {
                return false;
            }

            try
            {
                var url = "http://127.0.0.1:" + port + "/health";
                var response = HttpClient.GetAsync(url).GetAwaiter().GetResult();
                if (!response.IsSuccessStatusCode)
                {
                    return false;
                }

                var body = response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                return !string.IsNullOrEmpty(body) &&
                       body.IndexOf("codex-unity-sidecar-mvp", StringComparison.OrdinalIgnoreCase) >= 0;
            }
            catch
            {
                return false;
            }
        }

        private static bool IsPortOpen(int port)
        {
            if (port <= 0)
            {
                return false;
            }

            try
            {
                using (var client = new TcpClient())
                {
                    var asyncResult = client.BeginConnect("127.0.0.1", port, null, null);
                    var success = asyncResult.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(250));
                    if (!success)
                    {
                        return false;
                    }

                    client.EndConnect(asyncResult);
                    return client.Connected;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}

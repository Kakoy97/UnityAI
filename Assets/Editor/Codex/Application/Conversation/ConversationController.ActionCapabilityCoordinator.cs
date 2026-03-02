using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Application
{
    public sealed partial class ConversationController
    {
        public async Task ApplyPhase6SmokeWriteAsync(GameObject selected)
        {
            if (IsBusy)
            {
                AddLog(UiLogLevel.Warning, "Cannot run file action smoke test while a turn is in progress.");
                return;
            }

            if (selected == null)
            {
                AddLog(UiLogLevel.Error, "Pre-flight failed: please select a target GameObject in Hierarchy.");
                return;
            }

            var requestId = "req_file_" + Guid.NewGuid().ToString("N");
            var turnId = "u_file_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var smokeSuffix = requestId.Replace("req_file_", string.Empty).Substring(0, 8);
            var className = "HelloPhase6_" + smokeSuffix;
            var scriptPath = "Assets/Scripts/AIGenerated/Phase6Smoke/" + className + ".cs";
            var selectedPath = BuildSelectedPath(selected);
            var selectedObjectId = BuildObjectId(selected);
            _lastSmokeScriptPath = scriptPath;
            _pendingCompileComponentAssemblyQualifiedName = className + ", Assembly-CSharp";
            var request = new FileActionsApplyRequest
            {
                @event = "file_actions.apply",
                request_id = requestId,
                thread_id = ThreadId,
                turn_id = turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new FileActionsApplyPayload
                {
                    file_actions = new[]
                    {
                        new FileActionItem
                        {
                            type = "create_file",
                            path = scriptPath,
                            content =
                                "using UnityEngine;\n\n" +
                                "public class " + className + " : MonoBehaviour\n" +
                                "{\n" +
                                "    private void Start()\n" +
                                "    {\n" +
                                "        Debug.Log(\"Hello from Phase 6 smoke file action\");\n" +
                                "    }\n" +
                                "}\n",
                            overwrite_if_exists = true
                        }
                    },
                    visual_layer_actions = new[]
                    {
                        new VisualLayerActionItem
                        {
                            type = "add_component",
                            target_anchor = new UnityObjectAnchor
                            {
                                object_id = selectedObjectId,
                                path = selectedPath
                            },
                            component_assembly_qualified_name = _pendingCompileComponentAssemblyQualifiedName
                        }
                    }
                }
            };

            AddLog(UiLogLevel.Info, "file_actions.apply => " + requestId);

            var result = await _sidecarGateway.ApplyFileActionsAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "file_actions.apply failed: " + result.ErrorMessage);
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "file_actions.apply rejected: " + ReadErrorCode(result));
                return;
            }

            var response = result.Data;
            if (response == null || response.payload == null || response.payload.changes == null)
            {
                AddLog(UiLogLevel.Error, "file_actions.apply response parse failed.");
                return;
            }

            var count = response.payload.changes.Length;
            AddLog(UiLogLevel.Info, "files.changed: " + count + " file(s).");
            for (var i = 0; i < response.payload.changes.Length; i++)
            {
                var item = response.payload.changes[i];
                AddLog(UiLogLevel.Info, " - " + item.type + ": " + item.path);
            }

            _activeRequestId = requestId;
            _turnId = turnId;
            IsBusy = true;
            BusyReason = "Compile Pending";
            _runtimeState = TurnRuntimeState.CompilePending;
            _compileDeadlineAt = EditorApplicationTimeFallback() + CompileTimeoutSeconds;
            _compileGateOpenedAtUtcTicks = DateTime.UtcNow.Ticks;
            _compileResultAutoReportInFlight = false;
            _lastCompilePendingHeartbeatAt = EditorApplicationTimeFallback();
            _compileRefreshIssued = true;
            _lastCompileRefreshAt = EditorApplicationTimeFallback();
            _pendingUnityActionRequest = null;
            SaveState();
            EmitChanged();
            AddLog(UiLogLevel.Info, "Compile gate opened. Step 2/3: refreshing assets and waiting Unity compile.");
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
            AddLog(UiLogLevel.Info, "Compile result will be auto-reported when Unity finishes compiling.");
        }


        public async Task ReportCompileResultAsync(bool success)
        {
            if (!CanReportCompileResult)
            {
                AddLog(UiLogLevel.Warning, "No compile_pending turn to report.");
                return;
            }

            if (success && EditorApplication.isCompiling)
            {
                AddLog(UiLogLevel.Warning, "Unity is still compiling. Wait for compile to finish before reporting success.");
                return;
            }

            if (success && !HasCompileFinishedForCurrentGate())
            {
                if (!CanInferCompileSuccessFromLoadedType())
                {
                    AddLog(UiLogLevel.Warning, "No completed compile detected for this turn yet. Wait until Unity finishes compiling.");
                    return;
                }

                AddLog(UiLogLevel.Warning, "Compile finish event missing; continue with inferred success from resolved component type.");
            }

            if (success && HasCompileErrorsForCurrentGate())
            {
                var errorCount = UnityCompilationStateTracker.GetLastCompilationErrorCountSince(_compileGateOpenedAtUtcTicks);
                AddLog(
                    UiLogLevel.Warning,
                    "Last compile finished with " + errorCount + " error(s). Report failure instead of success.");
                return;
            }

            var request = new UnityCompileResultRequest
            {
                @event = "unity.compile.result",
                request_id = _activeRequestId,
                thread_id = ThreadId,
                turn_id = _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityCompileResultPayload
                {
                    success = success,
                    duration_ms = 0,
                    errors = BuildCompileErrorItemsForReport(success)
                }
            };

            AddLog(
                UiLogLevel.Info,
                "unity.compile.result => " + _activeRequestId + " success=" + success);

            await ReportConsoleSnapshotAsync("compile_result", true);

            var result = await _sidecarGateway.ReportCompileResultAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.compile.result failed: " + result.ErrorMessage);
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.compile.result rejected: " + ReadErrorCode(result));
                return;
            }

            var report = result.Data;
            if (report == null)
            {
                AddLog(UiLogLevel.Error, "unity.compile.result response parse failed.");
                return;
            }

            // AutoFix removed - no longer logging auto fix progress

            var status = ToTurnStatus(report);
            LogStatusDiagnostics("unity.compile.result.response", status);
            if (IsTerminalStatus(status))
            {
                HandleTerminalStatus(status);
                return;
            }

            if (TryCapturePendingUnityActionRequest(
                    report.unity_action_request,
                    "unity.compile.result",
                    status != null ? status.request_id : string.Empty))
            {
                await HandleCapturedPendingActionAsync(
                    "unity.compile.result",
                    "Received unity.action.request. Waiting for confirmation.");
                return;
            }

            ApplyStage(status.stage, EditorApplicationTimeFallback());
            BusyReason = BuildBusyReasonForRuntimeState();
            SaveState();
            EmitChanged();
        }


    }
}
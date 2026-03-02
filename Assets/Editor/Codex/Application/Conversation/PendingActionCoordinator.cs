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
        public Task ConfirmPendingActionAsync(GameObject selected)
        {
            return ConfirmPendingActionCoreAsync(selected);
        }

        public Task RejectPendingActionAsync(GameObject selected)
        {
            return RejectPendingActionCoreAsync(selected);
        }

        private async Task ConfirmPendingActionCoreAsync(GameObject selected)
        {
            await ExecutePendingActionAndReportAsync(selected, true);
        }


        private async Task RejectPendingActionCoreAsync(GameObject selected)
        {
            await ExecutePendingActionAndReportAsync(selected, false);
        }


        private async Task ExecutePendingActionAndReportAsync(GameObject selected, bool approved)
        {
            if (!CanConfirmPendingAction)
            {
                AddLog(UiLogLevel.Warning, "No pending unity.action.request to handle.");
                Debug.LogWarning("[Codex] No pending unity.action.request to handle.");
                return;
            }

            if (approved && EditorApplication.isCompiling)
            {
                AddLog(UiLogLevel.Warning, "Unity is still compiling. Please approve action after compile completes.");
                Debug.LogWarning("[Codex] Pending action blocked because Unity is compiling.");
                return;
            }

            var actionEnvelope = _pendingUnityActionRequest;
            var actionPayload = actionEnvelope.payload;
            var action = actionPayload == null ? null : actionPayload.action;

            UnityActionExecutionResult execution;
            string actionValidationErrorCode;
            string actionValidationErrorMessage;
            if (approved &&
                !TryValidateActionRequestPayload(
                    actionPayload,
                    out actionValidationErrorCode,
                    out actionValidationErrorMessage))
            {
                AddLog(
                    UiLogLevel.Warning,
                    "Pending action schema check failed on execution gate. Execution blocked. error_code=" +
                    SafeString(actionValidationErrorCode) +
                    ", message=" +
                    SafeString(actionValidationErrorMessage));
                execution = new UnityActionExecutionResult
                {
                    actionType = action != null ? action.type : string.Empty,
                    targetObjectPath = action == null ? string.Empty : ReadAnchorPath(action.target_anchor),
                    targetObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.target_anchor),
                    componentAssemblyQualifiedName =
                        action == null ? string.Empty : action.component_assembly_qualified_name,
                    sourceComponentAssemblyQualifiedName =
                        action == null ? string.Empty : action.source_component_assembly_qualified_name,
                    createdObjectPath = string.Empty,
                    createdObjectId = string.Empty,
                    name = action == null ? string.Empty : action.name,
                    parentObjectPath = action == null ? string.Empty : ReadAnchorPath(action.parent_anchor),
                    parentObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.parent_anchor),
                    primitiveType = action == null ? string.Empty : action.primitive_type,
                    uiType = action == null ? string.Empty : action.ui_type,
                    success = false,
                    errorCode = string.IsNullOrWhiteSpace(actionValidationErrorCode)
                        ? "E_ACTION_SCHEMA_INVALID"
                        : actionValidationErrorCode,
                    errorMessage = string.IsNullOrWhiteSpace(actionValidationErrorMessage)
                        ? "Visual action payload failed L3 pre-execution schema validation."
                        : actionValidationErrorMessage,
                    durationMs = 0
                };
            }
            else if (approved)
            {
                execution = _visualActionExecutor.Execute(action, selected);
                if (!execution.success && execution.errorCode == "E_ACTION_COMPONENT_RESOLVE_FAILED")
                {
                    AddLog(UiLogLevel.Warning, "Component unresolved on first try. Refreshing assets and retrying once.");
                    AssetDatabase.Refresh();
                    await Task.Delay(300);
                    execution = _visualActionExecutor.Execute(action, selected);
                    if (!execution.success && execution.errorCode == "E_ACTION_COMPONENT_RESOLVE_FAILED")
                    {
                        AddLog(
                            UiLogLevel.Warning,
                            "Component is still unresolved after retry. This usually means compile did not actually succeed for this script.");
                    }
                }
            }
            else
            {
                var rejectedTargetPath = ReadAnchorPath(action.target_anchor);
                var rejectedTargetObjectId = ReadAnchorObjectId(action.target_anchor);
                var rejectedParentPath = ReadAnchorPath(action.parent_anchor);
                var rejectedParentObjectId = ReadAnchorObjectId(action.parent_anchor);
                execution = new UnityActionExecutionResult
                {
                    actionType = action.type,
                    targetObjectPath = rejectedTargetPath,
                    targetObjectId = rejectedTargetObjectId,
                    componentAssemblyQualifiedName = action.component_assembly_qualified_name,
                    sourceComponentAssemblyQualifiedName = action.source_component_assembly_qualified_name,
                    createdObjectPath = string.Empty,
                    createdObjectId = string.Empty,
                    name = action.name,
                    parentObjectPath = rejectedParentPath,
                    parentObjectId = rejectedParentObjectId,
                    primitiveType = action.primitive_type,
                    uiType = action.ui_type,
                    success = false,
                    errorCode = "E_ACTION_CONFIRM_REJECTED",
                    errorMessage = "User rejected visual action confirmation.",
                    durationMs = 0
                };
            }

            if (approved && execution.success)
            {
                var postWriteSelection = selected != null
                    ? selected
                    : Selection.activeGameObject;
                if (postWriteSelection != null)
                {
                    await ReportSelectionSnapshotAsync(postWriteSelection, "action_post_write", true);
                }
            }

            var reportTarget = !string.IsNullOrWhiteSpace(execution.targetObjectPath)
                    ? execution.targetObjectPath
                    : execution.targetObjectId;
            var normalizedActionErrorCode = execution.success
                ? string.Empty
                : NormalizeErrorCodeForTransport(execution.errorCode, "E_ACTION_RESULT_MISSING_ERROR_CODE");
            var normalizedActionErrorMessage = execution.success
                ? string.Empty
                : NormalizeErrorMessageForTransport(
                    execution.errorMessage,
                    "Visual action execution failed.");

            var request = new UnityActionResultRequest
            {
                @event = "unity.action.result",
                request_id = _activeRequestId,
                thread_id = ThreadId,
                turn_id = _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityActionResultPayload
                {
                    action_type = execution.actionType,
                    target = reportTarget,
                    target_object_path = execution.targetObjectPath,
                    target_object_id = execution.targetObjectId,
                    object_id = execution.targetObjectId,
                    component_assembly_qualified_name = execution.componentAssemblyQualifiedName,
                    source_component_assembly_qualified_name = execution.sourceComponentAssemblyQualifiedName,
                    created_object_path = execution.createdObjectPath,
                    created_object_id = execution.createdObjectId,
                    name = execution.name,
                    parent_object_path = execution.parentObjectPath,
                    parent_object_id = execution.parentObjectId,
                    primitive_type = execution.primitiveType,
                    ui_type = execution.uiType,
                    success = execution.success,
                    error_code = normalizedActionErrorCode,
                    error_message = normalizedActionErrorMessage,
                    duration_ms = execution.durationMs
                }
            };

            AddLog(
                UiLogLevel.Info,
                "unity.action.result => " + _activeRequestId +
                " success=" + execution.success +
                (execution.success ? string.Empty : " code=" + normalizedActionErrorCode));
            Debug.Log(
                "[Codex] unity.action.result => " + _activeRequestId +
                " success=" + execution.success +
                (execution.success ? string.Empty : " code=" + normalizedActionErrorCode));

            _runtimeState = TurnRuntimeState.ActionExecuting;
            BusyReason = "Action Executing";
            SaveState();
            EmitChanged();

            var result = await _sidecarGateway.ReportUnityActionResultAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.action.result failed: " + result.ErrorMessage);
                Debug.LogWarning("[Codex] unity.action.result failed: " + result.ErrorMessage);
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                return;
            }

            if (!result.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Error, "unity.action.result rejected: " + ReadErrorCode(result));
                Debug.LogWarning("[Codex] unity.action.result rejected: " + ReadErrorCode(result));
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                return;
            }

            var report = result.Data;
            if (report == null)
            {
                AddLog(UiLogLevel.Error, "unity.action.result response parse failed.");
                Debug.LogWarning("[Codex] unity.action.result response parse failed.");
                _runtimeState = TurnRuntimeState.ActionConfirmPending;
                BusyReason = "Action Confirmation";
                SaveState();
                EmitChanged();
                return;
            }

            // AutoFix removed - no longer logging auto fix progress

            var status = ToTurnStatus(report);
            LogStatusDiagnostics("unity.action.result.response", status);
            if (IsTerminalStatus(status))
            {
                HandleTerminalStatus(status);
                return;
            }

            if (TryCapturePendingUnityActionRequest(
                    report.unity_action_request,
                    "unity.action.result",
                    status != null ? status.request_id : string.Empty))
            {
                await HandleCapturedPendingActionAsync(
                    "unity.action.result",
                    "Next unity.action.request received. Waiting for confirmation.");
                return;
            }

            ApplyStage(status.stage, EditorApplicationTimeFallback());
            BusyReason = BuildBusyReasonForRuntimeState();
            SaveState();
            EmitChanged();
        }


        private async Task HandleCapturedPendingActionAsync(string source, string waitMessage)
        {
            _runtimeState = TurnRuntimeState.ActionConfirmPending;
            BusyReason = "Action Confirmation";
            SaveState();
            EmitChanged();

            if (!ShouldAutoApprovePendingAction())
            {
                AddLog(UiLogLevel.Info, waitMessage);
                Debug.Log("[Codex] " + waitMessage);
                return;
            }

            AddLog(
                UiLogLevel.Info,
                "Auto-approving unity.action.request (" + SafeString(source) + ").");
            Debug.Log(
                "[Codex] Auto-approving unity.action.request (" + SafeString(source) +
                "), request_id=" + SafeString(_activeRequestId));
            await ExecutePendingActionAndReportAsync(Selection.activeGameObject, true);
        }


        private bool ShouldAutoApprovePendingAction()
        {
            return _pendingUnityActionRequest != null &&
                   _pendingUnityActionRequest.payload != null &&
                   !_pendingUnityActionRequest.payload.requires_confirmation;
        }


        private static string FormatAnchorDebug(UnityObjectAnchor anchor)
        {
            if (anchor == null)
            {
                return "null";
            }

            return "{object_id=" + SafeString(anchor.object_id) + ", path=" + SafeString(anchor.path) + "}";
        }


        private static string ReadAnchorObjectId(UnityObjectAnchor anchor)
        {
            return anchor == null || string.IsNullOrWhiteSpace(anchor.object_id)
                ? string.Empty
                : anchor.object_id.Trim();
        }


        private static string ReadAnchorPath(UnityObjectAnchor anchor)
        {
            return anchor == null || string.IsNullOrWhiteSpace(anchor.path)
                ? string.Empty
                : anchor.path.Trim();
        }


        private static bool HasCompleteAnchor(UnityObjectAnchor anchor)
        {
            return !string.IsNullOrEmpty(ReadAnchorObjectId(anchor)) &&
                   !string.IsNullOrEmpty(ReadAnchorPath(anchor));
        }


        private static bool TryValidateActionRequestPayload(
            UnityActionRequestPayload payload,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (payload == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "unity.action.request payload is required.";
                return false;
            }

            if (!HasCompleteAnchor(payload.write_anchor))
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "write_anchor with object_id/path is required.";
                return false;
            }

            if (!TryValidateActionPayload(payload.action, out errorCode, out errorMessage))
            {
                return false;
            }

            string consistencyError;
            if (!TryValidateWriteAnchorConsistency(payload.write_anchor, payload.action.target_anchor, "target_anchor", out consistencyError) ||
                !TryValidateWriteAnchorConsistency(payload.write_anchor, payload.action.parent_anchor, "parent_anchor", out consistencyError))
            {
                errorCode = "E_TARGET_ANCHOR_CONFLICT";
                errorMessage = consistencyError;
                return false;
            }

            return true;
        }


        private static bool TryValidateActionPayload(
            VisualLayerActionItem action,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (action == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action is required.";
                return false;
            }

            if (string.IsNullOrWhiteSpace(action.type))
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action.type is required.";
                return false;
            }

            var hasTargetAnchor = HasCompleteAnchor(action.target_anchor);
            var hasParentAnchor = HasCompleteAnchor(action.parent_anchor);
            var hasInvalidTargetAnchor = action.target_anchor != null && !hasTargetAnchor;
            var hasInvalidParentAnchor = action.parent_anchor != null && !hasParentAnchor;
            if (hasInvalidTargetAnchor || hasInvalidParentAnchor)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action target_anchor/parent_anchor must include object_id and path.";
                return false;
            }

            if (!hasTargetAnchor && !hasParentAnchor)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action requires target_anchor or parent_anchor.";
                return false;
            }

            return true;
        }


        private static bool TryValidateWriteAnchorConsistency(
            UnityObjectAnchor writeAnchor,
            UnityObjectAnchor actionAnchor,
            string anchorName,
            out string errorMessage)
        {
            errorMessage = string.Empty;
            if (!HasCompleteAnchor(actionAnchor))
            {
                return true;
            }

            var writeObjectId = ReadAnchorObjectId(writeAnchor);
            var writePath = ReadAnchorPath(writeAnchor);
            var actionObjectId = ReadAnchorObjectId(actionAnchor);
            var actionPath = ReadAnchorPath(actionAnchor);

            var sameObjectId = string.Equals(writeObjectId, actionObjectId, StringComparison.Ordinal);
            var samePath = string.Equals(writePath, actionPath, StringComparison.Ordinal);
            if (sameObjectId == samePath)
            {
                return true;
            }

            errorMessage =
                "write_anchor conflicts with action." +
                (string.IsNullOrWhiteSpace(anchorName) ? "anchor" : anchorName.Trim()) +
                ": object_id/path pair mismatch.";
            return false;
        }

    }
}
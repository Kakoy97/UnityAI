using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SubmitUnityTaskSsotExecutor
    {
        public SsotDispatchResponse Execute(SubmitUnityTaskRequestDto request)
        {
            UnityTaskRuntimeStatus status;
            if (!UnityTaskRuntime.TrySubmit(request, out status))
            {
                return SsotRequestDispatcher.Failure(
                    status.error_code,
                    status.error_message,
                    SubmitUnityTaskRequestDto.ToolName,
                    status.ToResultData(false));
            }

            return SsotRequestDispatcher.Success(
                SubmitUnityTaskRequestDto.ToolName,
                status.ToResultData(status.idempotent_replay));
        }
    }

    public sealed class GetUnityTaskStatusSsotExecutor
    {
        public SsotDispatchResponse Execute(GetUnityTaskStatusRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "get_unity_task_status request payload is required.",
                    GetUnityTaskStatusRequestDto.ToolName);
            }

            var jobId = SsotExecutorCommon.Normalize(request.job_id);
            if (string.IsNullOrEmpty(jobId))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "get_unity_task_status requires job_id.",
                    GetUnityTaskStatusRequestDto.ToolName);
            }

            UnityTaskRuntimeStatus status;
            if (!UnityTaskRuntime.TryGetStatus(
                    jobId,
                    SsotExecutorCommon.Normalize(request.thread_id),
                    out status))
            {
                return SsotRequestDispatcher.Failure(
                    status.error_code,
                    status.error_message,
                    GetUnityTaskStatusRequestDto.ToolName,
                    status.ToResultData(false));
            }

            return SsotRequestDispatcher.Success(
                GetUnityTaskStatusRequestDto.ToolName,
                status.ToResultData(false));
        }
    }

    public sealed class CancelUnityTaskSsotExecutor
    {
        public SsotDispatchResponse Execute(CancelUnityTaskRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "cancel_unity_task request payload is required.",
                    CancelUnityTaskRequestDto.ToolName);
            }

            var jobId = SsotExecutorCommon.Normalize(request.job_id);
            if (string.IsNullOrEmpty(jobId))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "cancel_unity_task requires job_id.",
                    CancelUnityTaskRequestDto.ToolName);
            }

            UnityTaskRuntimeStatus status;
            if (!UnityTaskRuntime.TryCancel(
                    jobId,
                    SsotExecutorCommon.Normalize(request.thread_id),
                    out status))
            {
                return SsotRequestDispatcher.Failure(
                    status.error_code,
                    status.error_message,
                    CancelUnityTaskRequestDto.ToolName,
                    status.ToResultData(false));
            }

            return SsotRequestDispatcher.Success(
                CancelUnityTaskRequestDto.ToolName,
                status.ToResultData(false));
        }
    }

    internal static class UnityTaskRuntime
    {
        private const int NoCompileWaitGraceMs = 1500;
        private const int MaxCompileErrors = 5;
        private const string RuntimeStateSessionKey = "codex.ssot.unity_task_runtime.v1";
        private const string RuntimeStateFileName = "unity_task_runtime_state.json";

        private static readonly object SyncRoot = new object();
        private static readonly Dictionary<string, UnityTaskRuntimeRecord> JobsById =
            new Dictionary<string, UnityTaskRuntimeRecord>(StringComparer.Ordinal);
        private static readonly Dictionary<string, string> IdempotencyToJobId =
            new Dictionary<string, string>(StringComparer.Ordinal);
        private static bool _stateLoaded;

        internal static bool TrySubmit(
            SubmitUnityTaskRequestDto request,
            out UnityTaskRuntimeStatus status)
        {
            EnsureStateLoaded();
            status = UnityTaskRuntimeStatus.Failure(
                "E_SSOT_SCHEMA_INVALID",
                "submit_unity_task request payload is required.");
            if (request == null)
            {
                return false;
            }

            var threadId = Normalize(request.thread_id);
            var idempotencyKey = Normalize(request.idempotency_key);
            var userIntent = Normalize(request.user_intent);
            if (string.IsNullOrEmpty(threadId) ||
                string.IsNullOrEmpty(idempotencyKey) ||
                string.IsNullOrEmpty(userIntent))
            {
                status = UnityTaskRuntimeStatus.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "submit_unity_task requires thread_id, idempotency_key, and user_intent.");
                return false;
            }

            var hasFileActions = request.file_actions != null && request.file_actions.Length > 0;
            var hasVisualLayerActions =
                request.visual_layer_actions != null && request.visual_layer_actions.Length > 0;
            if (hasFileActions == hasVisualLayerActions)
            {
                status = UnityTaskRuntimeStatus.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "submit_unity_task requires exactly one of file_actions or visual_layer_actions.");
                return false;
            }

            UnityTaskRuntimeRecord existingRecord = null;
            lock (SyncRoot)
            {
                EnsureStateLoadedLocked();
                string existingJobId;
                if (IdempotencyToJobId.TryGetValue(idempotencyKey, out existingJobId))
                {
                    JobsById.TryGetValue(existingJobId, out existingRecord);
                }
            }

            if (existingRecord != null)
            {
                RefreshStatus(existingRecord);
                status = BuildStatus(existingRecord, true);
                return true;
            }

            var record = new UnityTaskRuntimeRecord
            {
                job_id = BuildJobId(),
                thread_id = threadId,
                idempotency_key = idempotencyKey,
                user_intent = userIntent,
                task_kind = hasFileActions ? "file_actions" : "visual_layer_actions",
                status = "running",
                state = "running",
                stage = hasFileActions ? "file_actions_apply" : "visual_actions_apply",
                phase = hasFileActions ? "file_actions_apply" : "visual_actions_apply",
                message = hasFileActions
                    ? "Task accepted. File actions are being applied."
                    : "Task accepted. Visual actions are being applied.",
                progress_message = "accepted",
                created_at_utc_ticks = DateTime.UtcNow.Ticks,
                updated_at_utc_ticks = DateTime.UtcNow.Ticks
            };

            lock (SyncRoot)
            {
                EnsureStateLoadedLocked();
                JobsById[record.job_id] = record;
                IdempotencyToJobId[idempotencyKey] = record.job_id;
                SaveStateLocked();
            }

            bool applyOk;
            if (hasFileActions)
            {
                applyOk = ApplyFileActions(record, request.file_actions);
                if (applyOk)
                {
                    record.compile_gate_opened_at_utc_ticks = DateTime.UtcNow.Ticks;
                    record.stage = "compile_wait";
                    record.phase = "compile_wait";
                    record.message = "File actions applied. Waiting Unity compile.";
                    record.progress_message = "waiting_compile";
                    PersistState();
                    AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
                    RefreshStatus(record);
                }
            }
            else
            {
                applyOk = ApplyVisualActions(record, request.visual_layer_actions, request.write_anchor);
            }

            if (!applyOk)
            {
                status = BuildStatus(record, false);
                return false;
            }

            status = BuildStatus(record, false);
            return true;
        }
        internal static bool TryGetStatus(
            string jobId,
            string threadId,
            out UnityTaskRuntimeStatus status)
        {
            EnsureStateLoaded();
            status = UnityTaskRuntimeStatus.Failure(
                "E_TASK_NOT_FOUND",
                "job_id not found.");
            UnityTaskRuntimeRecord record;
            lock (SyncRoot)
            {
                EnsureStateLoadedLocked();
                if (!JobsById.TryGetValue(jobId, out record) || record == null)
                {
                    return false;
                }
            }

            if (!ValidateThreadScope(record, threadId, out status))
            {
                return false;
            }

            RefreshStatus(record);
            status = BuildStatus(record, false);
            return true;
        }

        internal static bool TryCancel(
            string jobId,
            string threadId,
            out UnityTaskRuntimeStatus status)
        {
            EnsureStateLoaded();
            status = UnityTaskRuntimeStatus.Failure(
                "E_TASK_NOT_FOUND",
                "job_id not found.");
            UnityTaskRuntimeRecord record;
            lock (SyncRoot)
            {
                EnsureStateLoadedLocked();
                if (!JobsById.TryGetValue(jobId, out record) || record == null)
                {
                    return false;
                }
            }

            if (!ValidateThreadScope(record, threadId, out status))
            {
                return false;
            }

            RefreshStatus(record);
            if (!record.IsTerminal)
            {
                MarkCancelled(record, "Task cancelled by user request.");
            }

            status = BuildStatus(record, false);
            return true;
        }

        private static bool ValidateThreadScope(
            UnityTaskRuntimeRecord record,
            string requestThreadId,
            out UnityTaskRuntimeStatus status)
        {
            status = UnityTaskRuntimeStatus.Failure(
                "E_TASK_THREAD_MISMATCH",
                "thread_id does not match the submitted task.");
            if (record == null)
            {
                status = UnityTaskRuntimeStatus.Failure("E_TASK_NOT_FOUND", "job_id not found.");
                return false;
            }

            if (string.IsNullOrEmpty(requestThreadId))
            {
                return true;
            }

            if (string.Equals(record.thread_id, requestThreadId, StringComparison.Ordinal))
            {
                return true;
            }

            return false;
        }

        private static UnityTaskRuntimeStatus BuildStatus(
            UnityTaskRuntimeRecord record,
            bool idempotentReplay)
        {
            var source = record ?? new UnityTaskRuntimeRecord();
            var status = new UnityTaskRuntimeStatus
            {
                job_id = source.job_id,
                status = source.status,
                state = source.state,
                stage = source.stage,
                phase = source.phase,
                message = source.message,
                progress_message = source.progress_message,
                task_kind = source.task_kind,
                compile_started = source.compile_started,
                compile_finished = source.compile_finished,
                compile_error_count = source.compile_error_count,
                cancelled = source.cancelled,
                idempotent_replay = idempotentReplay,
                terminal_error_code = source.terminal_error_code,
                terminal_error_message = source.terminal_error_message
            };
            if (string.Equals(source.status, "failed", StringComparison.Ordinal))
            {
                status.error_code = string.IsNullOrEmpty(source.terminal_error_code)
                    ? "E_TASK_FAILED"
                    : source.terminal_error_code;
                status.error_message = string.IsNullOrEmpty(source.terminal_error_message)
                    ? "Task execution failed."
                    : source.terminal_error_message;
            }
            return status;
        }

        private static void RefreshStatus(UnityTaskRuntimeRecord record)
        {
            if (record == null || record.IsTerminal)
            {
                return;
            }

            if (!string.Equals(record.task_kind, "file_actions", StringComparison.Ordinal))
            {
                return;
            }

            var gateTicks = record.compile_gate_opened_at_utc_ticks;
            if (gateTicks <= 0L)
            {
                MarkCompleted(record, "Task completed.");
                return;
            }

            record.compile_started =
                UnityCompilationStateTracker.HasCompilationStartedSince(gateTicks) ||
                EditorApplication.isCompiling;

            if (EditorApplication.isCompiling)
            {
                record.status = "running";
                record.state = "running";
                record.stage = "compile_wait";
                record.phase = "compile_wait";
                record.progress_message = "compiling";
                record.message = "Unity is compiling scripts.";
                record.updated_at_utc_ticks = DateTime.UtcNow.Ticks;
                return;
            }

            if (UnityCompilationStateTracker.HasCompilationFinishedSince(gateTicks))
            {
                record.compile_finished = true;
                record.compile_error_count =
                    UnityCompilationStateTracker.GetLastCompilationErrorCountSince(gateTicks);
                if (record.compile_error_count > 0)
                {
                    var snapshots = UnityCompilationStateTracker.GetLastCompilationErrorsSince(
                        gateTicks,
                        MaxCompileErrors);
                    var firstMessage =
                        snapshots != null && snapshots.Length > 0
                            ? Normalize(snapshots[0].message)
                            : string.Empty;
                    MarkFailed(
                        record,
                        "E_TASK_COMPILE_FAILED",
                        string.IsNullOrEmpty(firstMessage)
                            ? "Compilation finished with errors."
                            : firstMessage);
                    return;
                }

                MarkCompleted(record, "Compilation succeeded and task completed.");
                return;
            }

            var elapsedMs =
                (int)Math.Max(
                    0d,
                    (DateTime.UtcNow.Ticks - gateTicks) / TimeSpan.TicksPerMillisecond);
            if (!record.compile_started && elapsedMs >= NoCompileWaitGraceMs)
            {
                MarkCompleted(record, "No compile was required. Task completed.");
                return;
            }

            record.status = "running";
            record.state = "running";
            record.stage = "compile_wait";
            record.phase = "compile_wait";
            record.progress_message = "waiting_compile";
            record.message = "Waiting for Unity compile state update.";
            record.updated_at_utc_ticks = DateTime.UtcNow.Ticks;
        }
        private static bool ApplyFileActions(UnityTaskRuntimeRecord record, string[] rawActions)
        {
            var actions = rawActions ?? Array.Empty<string>();
            if (actions.Length <= 0)
            {
                MarkFailed(
                    record,
                    "E_TASK_FILE_ACTIONS_EMPTY",
                    "file_actions must contain at least one action.");
                return false;
            }

            for (var i = 0; i < actions.Length; i += 1)
            {
                if (!TryParseFileAction(actions[i], out var action, out var parseError))
                {
                    MarkFailed(
                        record,
                        "E_TASK_FILE_ACTION_INVALID",
                        "file_actions[" + i + "] parse failed: " + parseError);
                    return false;
                }

                if (!ApplyFileAction(action, out var applyErrorCode, out var applyErrorMessage))
                {
                    MarkFailed(
                        record,
                        applyErrorCode,
                        "file_actions[" + i + "] failed: " + applyErrorMessage);
                    return false;
                }
            }

            return true;
        }

        private static bool ApplyVisualActions(
            UnityTaskRuntimeRecord record,
            string[] rawActions,
            SubmitUnityTaskRequestDtoWriteAnchorDto defaultAnchor)
        {
            var actions = rawActions ?? Array.Empty<string>();
            if (actions.Length <= 0)
            {
                MarkFailed(
                    record,
                    "E_TASK_VISUAL_ACTIONS_EMPTY",
                    "visual_layer_actions must contain at least one action.");
                return false;
            }

            for (var i = 0; i < actions.Length; i += 1)
            {
                if (!TryParseVisualAction(actions[i], out var action, out var parseError))
                {
                    MarkFailed(
                        record,
                        "E_TASK_VISUAL_ACTION_INVALID",
                        "visual_layer_actions[" + i + "] parse failed: " + parseError);
                    return false;
                }

                var actionType = Normalize(action.type);
                if (!string.Equals(actionType, "add_component", StringComparison.Ordinal))
                {
                    MarkFailed(
                        record,
                        "E_TASK_VISUAL_ACTION_UNSUPPORTED",
                        "visual_layer_actions only supports add_component in Phase2A.");
                    return false;
                }

                var targetPath = Normalize(action.target_anchor == null ? string.Empty : action.target_anchor.path);
                var targetObjectId = Normalize(action.target_anchor == null ? string.Empty : action.target_anchor.object_id);
                if (string.IsNullOrEmpty(targetPath) && defaultAnchor != null)
                {
                    targetPath = Normalize(defaultAnchor.path);
                }
                if (string.IsNullOrEmpty(targetObjectId) && defaultAnchor != null)
                {
                    targetObjectId = Normalize(defaultAnchor.object_id);
                }

                var componentType = Normalize(action.component_assembly_qualified_name);
                if (string.IsNullOrEmpty(componentType))
                {
                    MarkFailed(
                        record,
                        "E_COMPONENT_TYPE_INVALID",
                        "visual_layer_actions.add_component requires component_assembly_qualified_name.");
                    return false;
                }

                var addResponse = new AddComponentSsotExecutor().Execute(
                    new AddComponentRequestDto
                    {
                        target_object_id = targetObjectId,
                        target_path = targetPath,
                        component_type = componentType
                    });
                if (addResponse == null || addResponse.ok != true)
                {
                    MarkFailed(
                        record,
                        addResponse == null ? "E_COMPONENT_ADD_FAILED" : Normalize(addResponse.error_code),
                        addResponse == null
                            ? "add_component failed."
                            : Normalize(addResponse.error_message));
                    return false;
                }
            }

            MarkCompleted(record, "Visual actions completed.");
            return true;
        }

        private static bool ApplyFileAction(
            UnityTaskFileAction action,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var actionType = Normalize(action == null ? string.Empty : action.type);
            if (string.IsNullOrEmpty(actionType))
            {
                errorCode = "E_TASK_FILE_ACTION_INVALID";
                errorMessage = "file action type is required.";
                return false;
            }

            if (string.Equals(actionType, "create_file", StringComparison.Ordinal) ||
                string.Equals(actionType, "update_file", StringComparison.Ordinal) ||
                string.Equals(actionType, "write_file", StringComparison.Ordinal))
            {
                if (!TryResolveProjectPath(action.path, out var fullPath, out errorMessage))
                {
                    errorCode = "E_TASK_FILE_ACTION_INVALID_PATH";
                    return false;
                }

                if (File.Exists(fullPath) && !action.overwrite_if_exists)
                {
                    errorCode = "E_TASK_FILE_ALREADY_EXISTS";
                    errorMessage = "File already exists and overwrite_if_exists is false: " + action.path;
                    return false;
                }

                try
                {
                    var directory = Path.GetDirectoryName(fullPath);
                    if (!string.IsNullOrEmpty(directory))
                    {
                        Directory.CreateDirectory(directory);
                    }

                    File.WriteAllText(fullPath, action.content ?? string.Empty, new UTF8Encoding(false));
                    return true;
                }
                catch (Exception ex)
                {
                    errorCode = "E_TASK_FILE_WRITE_FAILED";
                    errorMessage = ex.Message;
                    return false;
                }
            }

            if (string.Equals(actionType, "delete_file", StringComparison.Ordinal))
            {
                if (!TryResolveProjectPath(action.path, out var fullPath, out errorMessage))
                {
                    errorCode = "E_TASK_FILE_ACTION_INVALID_PATH";
                    return false;
                }

                try
                {
                    if (File.Exists(fullPath))
                    {
                        File.Delete(fullPath);
                    }
                    return true;
                }
                catch (Exception ex)
                {
                    errorCode = "E_TASK_FILE_DELETE_FAILED";
                    errorMessage = ex.Message;
                    return false;
                }
            }
            if (string.Equals(actionType, "rename_file", StringComparison.Ordinal) ||
                string.Equals(actionType, "move_file", StringComparison.Ordinal))
            {
                if (!TryResolveProjectPath(action.old_path, out var oldFullPath, out errorMessage) ||
                    !TryResolveProjectPath(action.new_path, out var newFullPath, out errorMessage))
                {
                    errorCode = "E_TASK_FILE_ACTION_INVALID_PATH";
                    return false;
                }

                if (!File.Exists(oldFullPath))
                {
                    errorCode = "E_TASK_FILE_NOT_FOUND";
                    errorMessage = "File does not exist: " + action.old_path;
                    return false;
                }

                try
                {
                    var directory = Path.GetDirectoryName(newFullPath);
                    if (!string.IsNullOrEmpty(directory))
                    {
                        Directory.CreateDirectory(directory);
                    }

                    File.Move(oldFullPath, newFullPath);
                    return true;
                }
                catch (Exception ex)
                {
                    errorCode = "E_TASK_FILE_MOVE_FAILED";
                    errorMessage = ex.Message;
                    return false;
                }
            }

            errorCode = "E_TASK_FILE_ACTION_UNSUPPORTED";
            errorMessage = "Unsupported file action type: " + actionType;
            return false;
        }

        private static bool TryResolveProjectPath(
            string relativePath,
            out string fullPath,
            out string errorMessage)
        {
            fullPath = string.Empty;
            errorMessage = string.Empty;
            var normalizedRelative = Normalize(relativePath).Replace('\\', '/');
            if (string.IsNullOrEmpty(normalizedRelative))
            {
                errorMessage = "path is required.";
                return false;
            }

            if (Path.IsPathRooted(normalizedRelative))
            {
                errorMessage = "absolute path is not allowed: " + normalizedRelative;
                return false;
            }

            var projectRoot = Path.GetDirectoryName(global::UnityEngine.Application.dataPath) ?? string.Empty;
            if (string.IsNullOrEmpty(projectRoot))
            {
                errorMessage = "cannot resolve Unity project root path.";
                return false;
            }

            try
            {
                var combined = Path.Combine(projectRoot, normalizedRelative);
                var candidate = Path.GetFullPath(combined);
                var normalizedRoot = Path.GetFullPath(projectRoot + Path.DirectorySeparatorChar);
                if (!candidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
                {
                    errorMessage = "path is outside Unity project: " + normalizedRelative;
                    return false;
                }

                fullPath = candidate;
                return true;
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }
        }

        private static bool TryParseFileAction(
            string rawJson,
            out UnityTaskFileAction action,
            out string errorMessage)
        {
            action = null;
            errorMessage = string.Empty;
            var payload = Normalize(rawJson);
            if (string.IsNullOrEmpty(payload))
            {
                errorMessage = "action payload must be non-empty JSON string.";
                return false;
            }

            try
            {
                action = JsonUtility.FromJson<UnityTaskFileAction>(payload);
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }

            if (action == null)
            {
                errorMessage = "action JSON deserialization returned null.";
                return false;
            }

            return true;
        }

        private static bool TryParseVisualAction(
            string rawJson,
            out UnityTaskVisualAction action,
            out string errorMessage)
        {
            action = null;
            errorMessage = string.Empty;
            var payload = Normalize(rawJson);
            if (string.IsNullOrEmpty(payload))
            {
                errorMessage = "action payload must be non-empty JSON string.";
                return false;
            }

            try
            {
                action = JsonUtility.FromJson<UnityTaskVisualAction>(payload);
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }

            if (action == null)
            {
                errorMessage = "action JSON deserialization returned null.";
                return false;
            }

            return true;
        }

        private static void MarkCompleted(UnityTaskRuntimeRecord record, string message)
        {
            record.status = "completed";
            record.state = "completed";
            record.stage = "done";
            record.phase = "done";
            record.progress_message = "completed";
            record.message = message;
            record.updated_at_utc_ticks = DateTime.UtcNow.Ticks;
            PersistState();
        }

        private static void MarkCancelled(UnityTaskRuntimeRecord record, string message)
        {
            record.cancelled = true;
            record.status = "cancelled";
            record.state = "cancelled";
            record.stage = "cancelled";
            record.phase = "cancelled";
            record.progress_message = "cancelled";
            record.message = message;
            record.updated_at_utc_ticks = DateTime.UtcNow.Ticks;
            PersistState();
        }

        private static void MarkFailed(UnityTaskRuntimeRecord record, string errorCode, string errorMessage)
        {
            record.status = "failed";
            record.state = "failed";
            record.stage = "failed";
            record.phase = "failed";
            record.progress_message = "failed";
            record.message = errorMessage;
            record.terminal_error_code = Normalize(errorCode);
            record.terminal_error_message = Normalize(errorMessage);
            record.updated_at_utc_ticks = DateTime.UtcNow.Ticks;
            PersistState();
        }

        private static void EnsureStateLoaded()
        {
            lock (SyncRoot)
            {
                EnsureStateLoadedLocked();
            }
        }

        private static void EnsureStateLoadedLocked()
        {
            if (_stateLoaded)
            {
                return;
            }

            LoadStateLocked();
            _stateLoaded = true;
        }

        private static void PersistState()
        {
            lock (SyncRoot)
            {
                EnsureStateLoadedLocked();
                SaveStateLocked();
            }
        }

        private static void LoadStateLocked()
        {
            JobsById.Clear();
            IdempotencyToJobId.Clear();

            var raw = SessionState.GetString(RuntimeStateSessionKey, string.Empty);
            if (string.IsNullOrEmpty(raw))
            {
                raw = TryReadRuntimeStateFromDisk();
            }
            if (string.IsNullOrEmpty(raw))
            {
                return;
            }

            UnityTaskRuntimeStateSnapshot snapshot;
            try
            {
                snapshot = JsonUtility.FromJson<UnityTaskRuntimeStateSnapshot>(raw);
            }
            catch
            {
                return;
            }

            if (snapshot == null)
            {
                return;
            }

            var jobs = snapshot.jobs ?? Array.Empty<UnityTaskRuntimeRecord>();
            for (var i = 0; i < jobs.Length; i += 1)
            {
                var record = jobs[i];
                var jobId = Normalize(record == null ? string.Empty : record.job_id);
                if (string.IsNullOrEmpty(jobId))
                {
                    continue;
                }

                JobsById[jobId] = record;
            }

            var links = snapshot.idempotency_links ?? Array.Empty<UnityTaskRuntimeIdempotencyLink>();
            for (var i = 0; i < links.Length; i += 1)
            {
                var link = links[i];
                var idempotencyKey = Normalize(link == null ? string.Empty : link.idempotency_key);
                var jobId = Normalize(link == null ? string.Empty : link.job_id);
                if (string.IsNullOrEmpty(idempotencyKey) || string.IsNullOrEmpty(jobId))
                {
                    continue;
                }

                if (!JobsById.ContainsKey(jobId))
                {
                    continue;
                }

                IdempotencyToJobId[idempotencyKey] = jobId;
            }
        }

        private static void SaveStateLocked()
        {
            if (JobsById.Count <= 0)
            {
                SessionState.SetString(RuntimeStateSessionKey, string.Empty);
                TryDeleteRuntimeStateFile();
                return;
            }

            var jobs = new UnityTaskRuntimeRecord[JobsById.Count];
            var jobIndex = 0;
            foreach (var pair in JobsById)
            {
                jobs[jobIndex] = pair.Value;
                jobIndex += 1;
            }

            var links = new UnityTaskRuntimeIdempotencyLink[IdempotencyToJobId.Count];
            var linkIndex = 0;
            foreach (var pair in IdempotencyToJobId)
            {
                links[linkIndex] = new UnityTaskRuntimeIdempotencyLink
                {
                    idempotency_key = pair.Key,
                    job_id = pair.Value
                };
                linkIndex += 1;
            }

            var snapshot = new UnityTaskRuntimeStateSnapshot
            {
                jobs = jobs,
                idempotency_links = links
            };

            var payload = JsonUtility.ToJson(snapshot);
            SessionState.SetString(RuntimeStateSessionKey, payload);
            TryWriteRuntimeStateToDisk(payload);
        }

        private static string TryReadRuntimeStateFromDisk()
        {
            try
            {
                var path = ResolveRuntimeStateFilePath();
                if (string.IsNullOrEmpty(path) || !File.Exists(path))
                {
                    return string.Empty;
                }

                return File.ReadAllText(path);
            }
            catch
            {
                return string.Empty;
            }
        }

        private static void TryWriteRuntimeStateToDisk(string payload)
        {
            try
            {
                var path = ResolveRuntimeStateFilePath();
                if (string.IsNullOrEmpty(path))
                {
                    return;
                }

                var directory = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                File.WriteAllText(path, payload ?? string.Empty, new UTF8Encoding(false));
            }
            catch
            {
                // Keep runtime best-effort; memory/session state path remains primary.
            }
        }

        private static void TryDeleteRuntimeStateFile()
        {
            try
            {
                var path = ResolveRuntimeStateFilePath();
                if (string.IsNullOrEmpty(path) || !File.Exists(path))
                {
                    return;
                }

                File.Delete(path);
            }
            catch
            {
                // Ignore cleanup failure.
            }
        }

        private static string ResolveRuntimeStateFilePath()
        {
            try
            {
                var projectRoot = Path.GetDirectoryName(global::UnityEngine.Application.dataPath);
                if (string.IsNullOrEmpty(projectRoot))
                {
                    return string.Empty;
                }

                return Path.Combine(projectRoot, "Library", "Codex", RuntimeStateFileName);
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string BuildJobId()
        {
            return "job_ssot_" + Guid.NewGuid().ToString("N");
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }
    }
    [Serializable]
    internal sealed class UnityTaskFileAction
    {
        public string type;
        public string path;
        public string old_path;
        public string new_path;
        public string content;
        public bool overwrite_if_exists;
    }

    [Serializable]
    internal sealed class UnityTaskVisualActionAnchor
    {
        public string object_id;
        public string path;
    }

    [Serializable]
    internal sealed class UnityTaskVisualAction
    {
        public string type;
        public UnityTaskVisualActionAnchor target_anchor;
        public string component_assembly_qualified_name;
    }

    [Serializable]
    internal sealed class UnityTaskRuntimeStateSnapshot
    {
        public UnityTaskRuntimeRecord[] jobs;
        public UnityTaskRuntimeIdempotencyLink[] idempotency_links;
    }

    [Serializable]
    internal sealed class UnityTaskRuntimeIdempotencyLink
    {
        public string idempotency_key;
        public string job_id;
    }

    [Serializable]
    internal sealed class UnityTaskRuntimeRecord
    {
        public string job_id;
        public string thread_id;
        public string idempotency_key;
        public string user_intent;
        public string task_kind;
        public string status;
        public string state;
        public string stage;
        public string phase;
        public string message;
        public string progress_message;
        public bool compile_started;
        public bool compile_finished;
        public int compile_error_count;
        public bool cancelled;
        public string terminal_error_code;
        public string terminal_error_message;
        public long created_at_utc_ticks;
        public long updated_at_utc_ticks;
        public long compile_gate_opened_at_utc_ticks;

        public bool IsTerminal
        {
            get
            {
                return string.Equals(status, "completed", StringComparison.Ordinal) ||
                       string.Equals(status, "failed", StringComparison.Ordinal) ||
                       string.Equals(status, "cancelled", StringComparison.Ordinal);
            }
        }
    }

    internal sealed class UnityTaskRuntimeStatus
    {
        public string job_id;
        public string status;
        public string state;
        public string stage;
        public string phase;
        public string message;
        public string progress_message;
        public string task_kind;
        public bool compile_started;
        public bool compile_finished;
        public int compile_error_count;
        public bool cancelled;
        public bool idempotent_replay;
        public string terminal_error_code;
        public string terminal_error_message;
        public string error_code;
        public string error_message;

        public static UnityTaskRuntimeStatus Failure(string errorCode, string errorMessage)
        {
            return new UnityTaskRuntimeStatus
            {
                status = "failed",
                state = "failed",
                phase = "failed",
                stage = "failed",
                error_code = Normalize(errorCode),
                error_message = Normalize(errorMessage),
                terminal_error_code = Normalize(errorCode),
                terminal_error_message = Normalize(errorMessage)
            };
        }

        public SsotDispatchResultData ToResultData(bool includeIdempotentReplay)
        {
            var data = new SsotDispatchResultData
            {
                job_id = job_id,
                status = status,
                state = state,
                stage = stage,
                phase = phase,
                message = message,
                progress_message = progress_message,
                task_kind = task_kind,
                compile_started = compile_started,
                compile_finished = compile_finished,
                compile_error_count = compile_error_count,
                cancelled = cancelled,
                idempotent_replay = includeIdempotentReplay,
                terminal_error_code = terminal_error_code,
                terminal_error_message = terminal_error_message
            };
            return data;
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }
    }
}

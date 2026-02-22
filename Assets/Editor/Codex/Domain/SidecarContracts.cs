using System;

namespace UnityAI.Editor.Codex.Domain
{
    public enum TurnRuntimeState
    {
        Idle,
        CodexPending,
        CompilePending,
        AutoFixPending,
        ActionConfirmPending,
        ActionExecuting,
        Running,
        Completed,
        Cancelled,
        Failed
    }

    public enum UiLogLevel
    {
        Info,
        Warning,
        Error
    }

    public enum UiLogSource
    {
        System,
        User,
        Codex
    }

    public sealed class UiLogEntry
    {
        public UiLogEntry(
            UiLogLevel level,
            string message,
            DateTime timestamp,
            UiLogSource source = UiLogSource.System)
        {
            Level = level;
            Message = message;
            Timestamp = timestamp;
            Source = source;
        }

        public UiLogLevel Level { get; private set; }
        public string Message { get; private set; }
        public DateTime Timestamp { get; private set; }
        public UiLogSource Source { get; private set; }

        public string ToRichText()
        {
            var color = "#D7D7D7";
            if (Level == UiLogLevel.Warning)
            {
                color = "#FFD166";
            }
            else if (Level == UiLogLevel.Error)
            {
                color = "#FF6B6B";
            }
            else if (Source == UiLogSource.User)
            {
                color = "#8ECAE6";
            }
            else if (Source == UiLogSource.Codex)
            {
                color = "#A7D88D";
            }

            var sourceTag = "SYSTEM";
            if (Source == UiLogSource.User)
            {
                sourceTag = "USER";
            }
            else if (Source == UiLogSource.Codex)
            {
                sourceTag = "CODEX";
            }

            return "<color=" + color + ">[" + Timestamp.ToString("HH:mm:ss") + "] [" + sourceTag + "] " + Message + "</color>";
        }
    }

    public sealed class GatewayResponse<T> where T : class
    {
        public bool TransportSuccess;
        public int StatusCode;
        public string RawBody;
        public string ErrorMessage;
        public T Data;
        public ErrorResponse Error;

        public bool IsHttpSuccess
        {
            get { return StatusCode >= 200 && StatusCode <= 299; }
        }
    }

    public sealed class SidecarStartResult
    {
        public bool Success;
        public bool AlreadyRunning;
        public string Message;
    }

    public sealed class SidecarStopResult
    {
        public bool Success;
        public bool WasRunning;
        public string Message;
    }

    [Serializable]
    public sealed class ErrorResponse
    {
        public string error_code;
        public string message;
    }

    [Serializable]
    public sealed class HealthResponse
    {
        public bool ok;
        public string service;
        public string active_request_id;
        public string active_state;
    }

    [Serializable]
    public sealed class SessionStartResponse
    {
        public bool ok;
        public string @event;
        public string timestamp;
        public bool replay;
    }

    [Serializable]
    public sealed class TurnStatusResponse
    {
        public string request_id;
        public string state;
        public string @event;
        public string message;
        public string error_code;
        public string stage;
        public string phase;
        public string assistant_summary;
        public TaskAllocationPayload task_allocation;
        public FileChangeItem[] files_changed;
        public UnityCompileRequestEnvelope compile_request;
        public UnityActionRequestEnvelope unity_action_request;
        public TurnEventItem[] events;
        public int latest_event_seq;
        public int pending_visual_action_count;
        public VisualLayerActionItem pending_visual_action;
        public int auto_fix_attempts;
        public int max_auto_fix_attempts;
        public bool replay;
    }

    [Serializable]
    public sealed class SidecarStateSnapshotResponse
    {
        public bool ok;
        public string timestamp;
        public string active_request_id;
        public string active_state;
        public int turn_count;
        public TurnSnapshotItem[] turns;
    }

    [Serializable]
    public sealed class TurnSnapshotItem
    {
        public string request_id;
        public string state;
        public string @event;
        public string message;
        public string error_code;
        public string stage;
        public string phase;
        public int latest_event_seq;
        public string updated_at;
        public string expires_at;
    }

    [Serializable]
    public sealed class TurnEventItem
    {
        public int seq;
        public string @event;
        public string timestamp;
        public string phase;
        public string message;
        public string delta;
        public string role;
        public string error_code;
        public string stage;
        public TaskAllocationPayload task_allocation;
        public FileChangeItem[] files_changed;
        public UnityCompileRequestEnvelope compile_request;
        public UnityActionRequestEnvelope unity_action_request;
        public UnityQueryComponentsRequestEnvelope unity_query_components_request;
    }

    [Serializable]
    public sealed class PersistedConversationState
    {
        public string thread_id;
        public bool is_busy;
        public string active_request_id;
        public string turn_id;
        public string busy_reason;
        public string runtime_state;
        public string last_terminal_event;
        public string last_error_code;
        public string last_message;
        public string updated_at;
        public string pending_compile_request_id;
        public string pending_action_request_id;
    }

    [Serializable]
    public sealed class SessionStartRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public SessionStartPayload payload;
    }

    [Serializable]
    public sealed class SessionStartPayload
    {
        public string workspace_root;
        public string model;
    }

    [Serializable]
    public sealed class TurnSendRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public TurnSendPayload payload;
    }

    [Serializable]
    public sealed class TurnSendPayload
    {
        public string user_message;
        public TurnContext context;
    }

    [Serializable]
    public sealed class TurnContext
    {
        public SelectionInfo selection;
        public SelectionTreeInfo selection_tree;
    }

    [Serializable]
    public sealed class SelectionInfo
    {
        public string mode;
        public string target_object_path;
        public string prefab_path;
    }

    [Serializable]
    public sealed class SelectionTreeInfo
    {
        public int max_depth;
        public SelectionTreeNode root;
        public int truncated_node_count;
        public string truncated_reason;
    }

    [Serializable]
    public sealed class SelectionTreeNode
    {
        public string name;
        public string path;
        public int depth;
        public string[] components;
        public SelectionTreeNode[] children;
        public int children_truncated_count;
    }

    [Serializable]
    public sealed class TurnCancelRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public TurnCancelPayload payload;
    }

    [Serializable]
    public sealed class TurnCancelPayload
    {
        public string reason;
    }

    [Serializable]
    public sealed class FileActionsApplyRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public FileActionsApplyPayload payload;
    }

    [Serializable]
    public sealed class FileActionsApplyPayload
    {
        public FileActionItem[] file_actions;
        public VisualLayerActionItem[] visual_layer_actions;
    }

    [Serializable]
    public sealed class TaskAllocationPayload
    {
        public FileActionItem[] file_actions;
        public VisualLayerActionItem[] visual_layer_actions;
    }

    [Serializable]
    public sealed class FileActionItem
    {
        public string type;
        public string path;
        public string old_path;
        public string new_path;
        public string content;
        public bool overwrite_if_exists;
    }

    [Serializable]
    public sealed class VisualLayerActionItem
    {
        public string type;
        public string target;
        public string target_object_path;
        public string component_assembly_qualified_name;
        public string source_component_assembly_qualified_name;
        public string name;
        public string parent_object_path;
        public string primitive_type;
        public string ui_type;
    }

    [Serializable]
    public sealed class FilesChangedEnvelopeResponse
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public bool replay;
        public FilesChangedPayload payload;
    }

    [Serializable]
    public sealed class FilesChangedPayload
    {
        public FileChangeItem[] changes;
        public UnityCompileRequestEnvelope compile_request;
    }

    [Serializable]
    public sealed class FileChangeItem
    {
        public string type;
        public string path;
    }

    [Serializable]
    public sealed class UnityCompileRequestEnvelope
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string reason;
        public bool refresh_assets;
    }

    [Serializable]
    public sealed class UnityRuntimePingRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityRuntimePingPayload payload;
    }

    [Serializable]
    public sealed class UnityRuntimePingPayload
    {
        public string status;
    }

    [Serializable]
    public sealed class UnityRuntimePingResponse
    {
        public bool ok;
        public string @event;
        public bool recovered;
        public string message;
        public string request_id;
        public string state;
        public string error_code;
        public string stage;
        public string phase;
        public int pending_visual_action_count;
        public VisualLayerActionItem pending_visual_action;
        public UnityActionRequestEnvelope unity_action_request;
        public TurnEventItem[] events;
        public int latest_event_seq;
    }

    [Serializable]
    public sealed class UnityCompileResultRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityCompileResultPayload payload;
    }

    [Serializable]
    public sealed class UnityCompileResultPayload
    {
        public bool success;
        public int duration_ms;
        public UnityCompileErrorItem[] errors;
    }

    [Serializable]
    public sealed class UnityCompileErrorItem
    {
        public string code;
        public string file;
        public int line;
        public int column;
        public string message;
    }

    [Serializable]
    public sealed class UnityCompileReportResponse
    {
        public bool ok;
        public bool compile_success;
        public bool auto_fix_applied;
        public int auto_fix_attempts;
        public int auto_fix_max_attempts;
        public string auto_fix_reason;
        public bool recoverable;
        public string request_id;
        public string state;
        public string @event;
        public string message;
        public string error_code;
        public string stage;
        public string phase;
        public int pending_visual_action_count;
        public VisualLayerActionItem pending_visual_action;
        public FileChangeItem[] files_changed;
        public UnityCompileRequestEnvelope compile_request;
        public UnityActionRequestEnvelope unity_action_request;
        public TurnEventItem[] events;
        public int latest_event_seq;
    }

    [Serializable]
    public sealed class UnityActionRequestEnvelope
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityActionRequestPayload payload;
    }

    [Serializable]
    public sealed class UnityQueryComponentsRequestEnvelope
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityQueryComponentsRequestPayload payload;
    }

    [Serializable]
    public sealed class UnityQueryComponentsRequestPayload
    {
        public string query_id;
        public string target_path;
    }

    [Serializable]
    public sealed class UnityComponentDescriptor
    {
        public string short_name;
        public string assembly_qualified_name;
    }

    [Serializable]
    public sealed class UnityQueryComponentsResultRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityQueryComponentsResultPayload payload;
    }

    [Serializable]
    public sealed class UnityQueryComponentsResultPayload
    {
        public string query_id;
        public string target_path;
        public UnityComponentDescriptor[] components;
        public string error_message;
    }

    [Serializable]
    public sealed class UnityQueryComponentsReportResponse
    {
        public bool ok;
        public string request_id;
        public string query_id;
        public int components_count;
    }

    [Serializable]
    public sealed class UnityActionRequestPayload
    {
        public bool requires_confirmation;
        public VisualLayerActionItem action;
    }

    [Serializable]
    public sealed class UnityActionResultRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityActionResultPayload payload;
    }

    [Serializable]
    public sealed class UnityActionResultPayload
    {
        public string action_type;
        public string target;
        public string target_object_path;
        public string component_assembly_qualified_name;
        public string source_component_assembly_qualified_name;
        public string created_object_path;
        public string name;
        public string parent_object_path;
        public string primitive_type;
        public string ui_type;
        public bool success;
        public string error_code;
        public string error_message;
        public int duration_ms;
    }

    [Serializable]
    public sealed class UnityActionReportResponse
    {
        public bool ok;
        public bool action_success;
        public bool auto_fix_applied;
        public int auto_fix_attempts;
        public int auto_fix_max_attempts;
        public string auto_fix_reason;
        public bool recoverable;
        public string request_id;
        public string state;
        public string @event;
        public string message;
        public string error_code;
        public string stage;
        public string phase;
        public int pending_visual_action_count;
        public VisualLayerActionItem pending_visual_action;
        public UnityActionRequestEnvelope unity_action_request;
        public TurnEventItem[] events;
        public int latest_event_seq;
    }

    [Serializable]
    public sealed class UnityActionExecutionResult
    {
        public string actionType;
        public string targetObjectPath;
        public string componentAssemblyQualifiedName;
        public string sourceComponentAssemblyQualifiedName;
        public string createdObjectPath;
        public string name;
        public string parentObjectPath;
        public string primitiveType;
        public string uiType;
        public bool success;
        public string errorCode;
        public string errorMessage;
        public int durationMs;
    }
}

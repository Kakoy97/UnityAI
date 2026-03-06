using System;

namespace UnityAI.Editor.Codex.Domain
{
    [Serializable]
    public sealed class TurnStatusResponse
    {
        public string job_id;
        public string request_id;
        public string status;
        public string state;
        public string @event;
        public string message;
        public string progress_message;
        public string error_code;
        public string error_message;
        public string suggestion;
        public bool recoverable;
        public string stage;
        public string phase;
        public string auto_cancel_reason;
        public string lease_state;
        public string lease_owner_client_id;
        public string lease_last_heartbeat_at;
        public int lease_heartbeat_timeout_ms;
        public int lease_max_runtime_ms;
        public bool lease_orphaned;
        public int pending_visual_action_count;
        public VisualLayerActionItem pending_visual_action;
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
        public string job_id;
        public string status;
        public string message;
        public string progress_message;
        public string request_id;
        public string state;
        public string error_code;
        public string error_message;
        public string suggestion;
        public bool recoverable;
        public string stage;
        public string phase;
        public string auto_cancel_reason;
        public string lease_state;
        public string lease_owner_client_id;
        public string lease_last_heartbeat_at;
        public int lease_heartbeat_timeout_ms;
        public int lease_max_runtime_ms;
        public bool lease_orphaned;
        public int pending_visual_action_count;
        public VisualLayerActionItem pending_visual_action;
    }


    [Serializable]
    public sealed class UnitySelectionSnapshotRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnitySelectionSnapshotPayload payload;
    }


    [Serializable]
    public sealed class UnitySelectionSnapshotPayload
    {
        public string reason;
        public bool selection_empty;
        public TurnContext context;
        public UnitySelectionComponentIndexItem[] component_index;
    }


    [Serializable]
    public sealed class UnitySelectionComponentIndexItem
    {
        public string object_id;
        public string path;
        public string name;
        public int depth;
        public string prefab_path;
        public UnityComponentDescriptor[] components;
    }


    [Serializable]
    public sealed class UnitySelectionSnapshotResponse
    {
        public bool ok;
        public string @event;
        public bool selection_empty;
        public string reason;
        public string message;
        public string scene_revision;
        public string target_object_id;
        public string target_object_path;
        public string captured_at;
        public string error_code;
    }


    [Serializable]
    public sealed class UnityConsoleSnapshotRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityConsoleSnapshotPayload payload;
    }


    [Serializable]
    public sealed class UnityConsoleSnapshotPayload
    {
        public string reason;
        public UnityConsoleErrorItem[] errors;
    }


    [Serializable]
    public sealed class UnityConsoleErrorItem
    {
        public string timestamp;
        public string log_type;
        public string condition;
        public string stack_trace;
        public string file;
        public int line;
        public string error_code;
    }


    [Serializable]
    public sealed class UnityConsoleSnapshotResponse
    {
        public bool ok;
        public string @event;
        public string reason;
        public int total_errors;
        public string captured_at;
        public string error_code;
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
        public bool recoverable;
        public string job_id;
        public string request_id;
        public string status;
        public string state;
        public string @event;
        public string message;
        public string progress_message;
        public string error_code;
        public string error_message;
        public string suggestion;
        public string stage;
        public string phase;
        public string auto_cancel_reason;
        public string lease_state;
        public string lease_owner_client_id;
        public string lease_last_heartbeat_at;
        public int lease_heartbeat_timeout_ms;
        public int lease_max_runtime_ms;
        public bool lease_orphaned;
        public int pending_visual_action_count;
        public VisualLayerActionItem pending_visual_action;
    }

}

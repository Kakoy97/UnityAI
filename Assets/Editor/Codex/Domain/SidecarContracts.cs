using System;

namespace UnityAI.Editor.Codex.Domain
{
    public enum TurnRuntimeState
    {
        Idle,
        CompilePending,
        ActionConfirmPending,
        ActionExecuting,
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
        public string status;
        public string error_code;
        public string message;
        public string error_message;
        public string suggestion;
        public bool recoverable;
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
        public UnityActionRequestEnvelope unity_action_request;
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
        public string pending_action_request_id;
    }

    [Serializable]
    public sealed class TurnContext
    {
        public string scene_revision;
        public SelectionInfo selection;
        public SelectionTreeInfo selection_tree;
    }

    [Serializable]
    public sealed class SelectionInfo
    {
        public string mode;
        public string object_id;
        public string target_object_path;
        public bool active;
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
        public string object_id;
        public string path;
        public int depth;
        public bool active;
        public string prefab_path;
        public UnityComponentDescriptor[] components;
        public SelectionTreeNode[] children;
        public int children_truncated_count;
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
    public sealed class UnityObjectAnchor
    {
        public string object_id;
        public string path;
    }

    [Serializable]
    public sealed class VisualLayerActionItem
    {
        public string type;
        public UnityObjectAnchor target_anchor;
        public UnityObjectAnchor parent_anchor;
        public string component_assembly_qualified_name;
        public string source_component_assembly_qualified_name;
        public string name;
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
        public UnityActionRequestEnvelope unity_action_request;
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
        public UnityActionRequestEnvelope unity_action_request;
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
        public string error_code;
        public string error_message;
    }

    [Serializable]
    public sealed class UnityQueryComponentsReportResponse
    {
        public bool ok;
        public string request_id;
        public string query_id;
        public int components_count;
        public string error_code;
    }

    [Serializable]
    public sealed class UnityQueryPullRequest
    {
        public string[] accepted_query_types;
    }

    [Serializable]
    public sealed class UnityQueryPullResponse
    {
        public bool ok;
        public bool pending;
        public UnityPulledQuery query;
    }

    [Serializable]
    public sealed class UnityPulledQuery
    {
        public string query_id;
        public string query_type;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public int timeout_ms;
        public string created_at;
        public int pull_count;
        public UnityPulledQueryPayload payload;
    }

    [Serializable]
    public sealed class UnityPulledQueryPayload
    {
        public string folder_path;
        public bool recursive;
        public bool include_meta;
        public int limit;

        public string scene_path;
        public bool include_inactive;

        public string component_query;
        public string under_path;

        public string prefab_path;
        public int max_depth;
        public int node_budget;
        public int char_budget;
        public bool include_components;
        public bool include_missing_scripts;
    }

    [Serializable]
    public sealed class UnityQueryReportResponse
    {
        public bool ok;
        public bool accepted;
        public bool replay;
        public string query_id;
        public string status;
        public string error_code;
        public string message;
    }

    [Serializable]
    public sealed class UnityReadToken
    {
        public string token;
        public string issued_at;
        public int hard_max_age_ms;
        public UnityReadTokenRevisionVector revision_vector;
        public UnityReadTokenScope scope;
    }

    [Serializable]
    public sealed class UnityReadTokenRevisionVector
    {
        public string scene_revision;
        public string asset_revision;
        public int compile_epoch;
    }

    [Serializable]
    public sealed class UnityReadTokenScope
    {
        public string kind;
        public string object_id;
        public string path;
    }

    [Serializable]
    public sealed class UnityListAssetsInFolderRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityListAssetsInFolderPayload payload;
    }

    [Serializable]
    public sealed class UnityListAssetsInFolderPayload
    {
        public string folder_path;
        public bool recursive;
        public bool include_meta;
        public int limit;
    }

    [Serializable]
    public sealed class UnityListAssetsInFolderResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityListAssetsInFolderData data;
    }

    [Serializable]
    public sealed class UnityListAssetsInFolderData
    {
        public string folder_path;
        public bool recursive;
        public bool include_meta;
        public int limit;
        public int returned_count;
        public int total_count;
        public UnityAssetInfo[] assets;
    }

    [Serializable]
    public sealed class UnityAssetInfo
    {
        public string guid;
        public string path;
        public string asset_type;
        public bool is_folder;
    }

    [Serializable]
    public sealed class UnityGetSceneRootsRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityGetSceneRootsPayload payload;
    }

    [Serializable]
    public sealed class UnityGetSceneRootsPayload
    {
        public string scene_path;
        public bool include_inactive;
    }

    [Serializable]
    public sealed class UnityGetSceneRootsResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityGetSceneRootsData data;
    }

    [Serializable]
    public sealed class UnityGetSceneRootsData
    {
        public string scene_path;
        public bool include_inactive;
        public string scene_revision;
        public int returned_count;
        public UnitySceneRootInfo[] roots;
    }

    [Serializable]
    public sealed class UnitySceneRootInfo
    {
        public string object_id;
        public string path;
        public string name;
        public bool active;
        public int child_count;
    }

    [Serializable]
    public sealed class UnityFindObjectsByComponentRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityFindObjectsByComponentPayload payload;
    }

    [Serializable]
    public sealed class UnityFindObjectsByComponentPayload
    {
        public string component_query;
        public string scene_path;
        public string under_path;
        public bool include_inactive;
        public int limit;
    }

    [Serializable]
    public sealed class UnityFindObjectsByComponentResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityFindObjectsByComponentData data;
    }

    [Serializable]
    public sealed class UnityFindObjectsByComponentData
    {
        public string component_query;
        public string scene_path;
        public string under_path;
        public bool include_inactive;
        public int limit;
        public int returned_count;
        public UnityComponentMatchItem[] matches;
    }

    [Serializable]
    public sealed class UnityComponentMatchItem
    {
        public string object_id;
        public string path;
        public string name;
        public string scene_path;
        public bool active;
        public UnityComponentDescriptor[] matched_components;
    }

    [Serializable]
    public sealed class UnityQueryPrefabInfoRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityQueryPrefabInfoPayload payload;
    }

    [Serializable]
    public sealed class UnityQueryPrefabInfoPayload
    {
        public string prefab_path;
        public int max_depth;
        public int node_budget;
        public int char_budget;
        public bool include_components;
        public bool include_missing_scripts;
    }

    [Serializable]
    public sealed class UnityQueryPrefabInfoResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityQueryPrefabInfoData data;
    }

    [Serializable]
    public sealed class UnityQueryPrefabInfoData
    {
        public string prefab_path;
        public int max_depth;
        public int node_budget;
        public int char_budget;
        public bool include_components;
        public bool include_missing_scripts;
        public int returned_node_count;
        public bool truncated;
        public string truncated_reason;
        public UnityPrefabTreeNode root;
    }

    [Serializable]
    public sealed class UnityPrefabTreeNode
    {
        public string name;
        public string object_id;
        public string path;
        public int depth;
        public bool active;
        public string prefab_path;
        public UnityComponentDescriptor[] components;
        public UnityPrefabTreeNode[] children;
        public int children_truncated_count;
    }

    [Serializable]
    public sealed class UnityActionRequestPayload
    {
        public string based_on_read_token;
        public UnityObjectAnchor write_anchor;
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
        public string target_object_id;
        public string object_id;
        public string component_assembly_qualified_name;
        public string source_component_assembly_qualified_name;
        public string created_object_path;
        public string created_object_id;
        public string name;
        public string parent_object_path;
        public string parent_object_id;
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
        public UnityActionRequestEnvelope unity_action_request;
    }

    [Serializable]
    public sealed class UnityActionExecutionResult
    {
        public string actionType;
        public string targetObjectPath;
        public string targetObjectId;
        public string componentAssemblyQualifiedName;
        public string sourceComponentAssemblyQualifiedName;
        public string createdObjectPath;
        public string createdObjectId;
        public string name;
        public string parentObjectPath;
        public string parentObjectId;
        public string primitiveType;
        public string uiType;
        public bool success;
        public string errorCode;
        public string errorMessage;
        public int durationMs;
    }
}

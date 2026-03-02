using System;

namespace UnityAI.Editor.Codex.Domain
{
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
    public sealed class VisualLayerActionItem
    {
        public string type;
        public UnityObjectAnchor target_anchor;
        public UnityObjectAnchor parent_anchor;
        public string target_anchor_ref;
        public string parent_anchor_ref;
        public string action_data_json;
        public string component_assembly_qualified_name;
        public string source_component_assembly_qualified_name;
        public string name;
        public string primitive_type;
        public string ui_type;
    }


    [Serializable]
    public sealed class CompositeVisualActionData
    {
        public string schema_version;
        public string transaction_id;
        public string atomic_mode;
        public int max_step_ms;
        public CompositeVisualActionStep[] steps;
    }


    [Serializable]
    public sealed class CompositeVisualActionStep
    {
        public string step_id;
        public string type;
        public UnityObjectAnchor target_anchor;
        public string target_anchor_ref;
        public UnityObjectAnchor parent_anchor;
        public string parent_anchor_ref;
        public CompositeVisualActionBindOutput[] bind_outputs;
        public string action_data_json;
    }


    [Serializable]
    public sealed class CompositeVisualActionBindOutput
    {
        public string source;
        public string alias;
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
    public sealed class UnityCapabilitiesReportRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityCapabilitiesReportPayload payload;
    }


    [Serializable]
    public sealed class UnityCapabilitiesReportPayload
    {
        public string capability_version;
        public UnityCapabilityActionItem[] actions;
    }


    [Serializable]
    public sealed class UnityCapabilityActionItem
    {
        public string type;
        public string anchor_policy;
        public string description;
        public string domain;
        public string tier;
        public string lifecycle;
        public string undo_safety;
        public string replacement_action_type;
        public UnityActionDataSchema action_data_schema;
    }


    [Serializable]
    public sealed class UnityActionDataSchema
    {
        public string type;
        public string[] required;
        public UnityActionDataSchemaProperty[] properties;
    }


    [Serializable]
    public sealed class UnityActionDataSchemaProperty
    {
        public string name;
        public string type;
        public string description;
    }


    [Serializable]
    public sealed class UnityCapabilitiesReportResponse
    {
        public bool ok;
        public string @event;
        public string unity_connection_state;
        public string capability_version;
        public string capability_updated_at;
        public int action_count;
        public string error_code;
        public string message;
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

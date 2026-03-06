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
        public string action_data;
        public string component_assembly_qualified_name;
        public string source_component_assembly_qualified_name;
        public string name;
        public string primitive_type;
        public string ui_type;
    }


    [Serializable]
    public sealed class SerializedPropertyActionData
    {
        public SerializedPropertyComponentSelector component_selector;
        public SerializedPropertyPatchItem[] patches;
        public bool dry_run;
    }


    [Serializable]
    public sealed class SerializedPropertyComponentSelector
    {
        public string component_assembly_qualified_name;
        public int component_index;
    }


    [Serializable]
    public sealed class SerializedPropertyPatchItem
    {
        public string property_path;
        public string value_kind;
        public string op;
        public int index;
        public int[] indices;
        public int int_value;
        public float float_value;
        public string string_value;
        public bool bool_value;
        public int enum_value;
        public string enum_name;
        public SerializedPropertyQuaternionDto quaternion_value;
        public SerializedPropertyVector4Dto vector4_value;
        public SerializedPropertyVector2Dto vector2_value;
        public SerializedPropertyVector3Dto vector3_value;
        public SerializedPropertyRectDto rect_value;
        public SerializedPropertyColorDto color_value;
        public SerializedPropertyAnimationCurveDto animation_curve_value;
        public int array_size;
        public SerializedPropertyObjectReferenceDto object_ref;
    }


    [Serializable]
    public sealed class SerializedPropertyVector2Dto
    {
        public float x;
        public float y;
    }


    [Serializable]
    public sealed class SerializedPropertyVector3Dto
    {
        public float x;
        public float y;
        public float z;
    }


    [Serializable]
    public sealed class SerializedPropertyVector4Dto
    {
        public float x;
        public float y;
        public float z;
        public float w;
    }


    [Serializable]
    public sealed class SerializedPropertyQuaternionDto
    {
        public float x;
        public float y;
        public float z;
        public float w;
    }


    [Serializable]
    public sealed class SerializedPropertyColorDto
    {
        public float r;
        public float g;
        public float b;
        public float a;
    }


    [Serializable]
    public sealed class SerializedPropertyRectDto
    {
        public float x;
        public float y;
        public float width;
        public float height;
    }


    [Serializable]
    public sealed class SerializedPropertyAnimationCurveDto
    {
        public SerializedPropertyAnimationCurveKeyDto[] keys;
    }


    [Serializable]
    public sealed class SerializedPropertyAnimationCurveKeyDto
    {
        public float time;
        public float value;
        public float in_tangent;
        public float out_tangent;
    }


    [Serializable]
    public sealed class SerializedPropertyObjectReferenceDto
    {
        public UnityObjectAnchor scene_anchor;
        public string asset_guid;
        public string asset_path;
        public string sub_asset_name;
    }


    [Serializable]
    public sealed class SerializedPropertyPatchResultItem
    {
        public int patch_index;
        public string property_path;
        public string value_kind;
        public string status;
        public string error_code;
        public string error_message;
    }


    [Serializable]
    public sealed class SerializedPropertyActionResultData
    {
        public bool dry_run;
        public bool validation_passed;
        public int patch_count;
        public SerializedPropertyPatchResultItem[] patch_results;
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
        public string action_data;
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

}

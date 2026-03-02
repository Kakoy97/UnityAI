using System;

namespace UnityAI.Editor.Codex.Domain
{
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
        public string query_contract_version;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public int timeout_ms;
        public string created_at;
        public int pull_count;
        public string query_payload_json;
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
        public string ui_system;
        public string root_path;
        public bool include_layout;
        public bool include_interaction;
        public bool include_text_metrics;

        public string view_mode;
        public string capture_mode;
        public string output_mode;
        public string image_format;
        public int width;
        public int height;
        public int jpeg_quality;
        public int timeout_ms;
        public bool include_ui;

        public int x;
        public int y;
        public int reference_width;
        public int reference_height;
        public int max_results;

        public string coord_space;
        public string coord_origin;
        public UnityQueryResolution resolution;
        public UnityQueryScope scope;
        public bool include_non_interactable;

        public UnityQueryResolutionItem[] resolutions;
        public string[] checks;
        public int max_issues;
        public int time_budget_ms;
        public string layout_refresh_mode;

        public UnityObjectAnchor target_anchor;
        public SerializedPropertyComponentSelector component_selector;
        public string root_property_path;
        public int depth;
        public string after_property_path;
        public int page_size;
        public bool include_value_summary;
        public bool include_non_visible;
    }


    [Serializable]
    public sealed class UnityQueryScope
    {
        public string root_path;
    }


    [Serializable]
    public sealed class UnityQueryResolution
    {
        public int width;
        public int height;
    }


    [Serializable]
    public sealed class UnityQueryResolutionItem
    {
        public string name;
        public int width;
        public int height;
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
    public sealed class UnityGetSerializedPropertyTreeRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityGetSerializedPropertyTreePayload payload;
    }


    [Serializable]
    public sealed class UnityGetSerializedPropertyTreePayload
    {
        public UnityObjectAnchor target_anchor;
        public SerializedPropertyComponentSelector component_selector;
        public string root_property_path;
        public int depth;
        public string after_property_path;
        public int page_size;
        public int node_budget;
        public int char_budget;
        public bool include_value_summary;
        public bool include_non_visible;
        public int timeout_ms;
    }


    [Serializable]
    public sealed class UnityGetSerializedPropertyTreeResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityGetSerializedPropertyTreeData data;
    }


    [Serializable]
    public sealed class UnityGetSerializedPropertyTreeData
    {
        public UnitySerializedPropertyTreeComponentInfo component;
        public string root_property_path;
        public int depth;
        public string after_property_path;
        public int page_size;
        public int node_budget;
        public int char_budget;
        public bool include_value_summary;
        public bool include_non_visible;
        public int returned_count;
        public bool truncated;
        public string truncated_reason;
        public string next_cursor;
        public UnitySerializedPropertyTreeNode[] nodes;
    }


    [Serializable]
    public sealed class UnitySerializedPropertyTreeComponentInfo
    {
        public string type;
        public string target_path;
        public string target_object_id;
    }


    [Serializable]
    public sealed class UnitySerializedPropertyTreeNode
    {
        public string property_path;
        public string display_name;
        public string property_type;
        public bool is_array;
        public int array_size;
        public int depth;
        public bool writable;
        public string read_only_reason;
        public string value_summary;
        public bool has_visible_children;
    }

}

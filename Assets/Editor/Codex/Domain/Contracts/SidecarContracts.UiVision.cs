using System;

namespace UnityAI.Editor.Codex.Domain
{
    [Serializable]
    public sealed class UnityGetUiTreeRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityGetUiTreePayload payload;
    }


    [Serializable]
    public sealed class UnityGetUiTreePayload
    {
        public string ui_system;
        public string root_path;
        public bool include_inactive;
        public bool include_components;
        public bool include_layout;
        public bool include_interaction;
        public bool include_text_metrics;
        public int max_depth;
        public int node_budget;
        public int char_budget;
        public UnityQueryResolution resolution;
        public int timeout_ms;
    }


    [Serializable]
    public sealed class UnityGetUiTreeResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityGetUiTreeData data;
    }


    [Serializable]
    public sealed class UnityGetUiTreeData
    {
        public string ui_system;
        public string root_path;
        public bool include_inactive;
        public bool include_components;
        public bool include_layout;
        public bool include_interaction;
        public bool include_text_metrics;
        public int max_depth;
        public int node_budget;
        public int char_budget;
        public int returned_node_count;
        public bool truncated;
        public string truncated_reason;
        public UnityQueryResolution runtime_resolution;
        public string runtime_source;
        public UnityUiCanvasInfo[] canvases;
        public UnityUiTreeNode[] roots;
    }


    [Serializable]
    public sealed class UnityUiCanvasInfo
    {
        public string object_id;
        public string path;
        public string name;
        public bool active;
        public string render_mode;
        public int sorting_layer_id;
        public int sorting_order;
        public bool is_root_canvas;
        public UnityQueryResolution reference_resolution;
    }


    [Serializable]
    public sealed class UnityUiTreeNode
    {
        public UnityObjectAnchor anchor;
        public string object_id;
        public string path;
        public string name;
        public int depth;
        public bool active_self;
        public bool active_in_hierarchy;
        public int sibling_index;
        public UnityUiRectTransformInfo rect_transform;
        public UnityScreenshotRect rect_screen_px;
        public UnityUiInteractionSummary interaction;
        public UnityUiTextMetrics text_metrics;
        public UnityUiComponentSummary[] components;
        public UnityUiComponentSummary[] components_summary;
        public UnityUiTreeNode[] children;
        public int children_truncated_count;
    }


    [Serializable]
    public sealed class UnityUiRectTransformInfo
    {
        public float anchor_min_x;
        public float anchor_min_y;
        public float anchor_max_x;
        public float anchor_max_y;
        public float pivot_x;
        public float pivot_y;
        public float anchored_position_x;
        public float anchored_position_y;
        public float size_delta_x;
        public float size_delta_y;
        public float offset_min_x;
        public float offset_min_y;
        public float offset_max_x;
        public float offset_max_y;
    }


    [Serializable]
    public sealed class UnityUiComponentSummary
    {
        public string type;
        public string assembly_qualified_name;
        public bool enabled;
    }


    [Serializable]
    public sealed class UnityUiInteractionSummary
    {
        public bool raycast_target;
        public bool interactable;
        public bool blocks_raycast;
        public bool has_graphic_raycaster;
    }


    [Serializable]
    public sealed class UnityUiTextMetrics
    {
        public bool overflowing;
        public float preferred_width;
        public float preferred_height;
    }


    [Serializable]
    public sealed class UnityCaptureSceneScreenshotRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityCaptureSceneScreenshotPayload payload;
    }


    [Serializable]
    public sealed class UnityCaptureSceneScreenshotPayload
    {
        public string view_mode;
        public string capture_mode;
        public string output_mode;
        public string image_format;
        public int width;
        public int height;
        public int jpeg_quality;
        public int timeout_ms;
        public bool include_ui;
    }


    [Serializable]
    public sealed class UnityCaptureSceneScreenshotResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityCaptureSceneScreenshotData data;
    }


    [Serializable]
    public sealed class UnityCaptureSceneScreenshotData
    {
        public string requested_mode;
        public string view_mode;
        public string effective_mode;
        public string capture_mode_effective;
        public string fallback_reason;
        public string[] diagnosis_tags;
        public string output_mode;
        public string image_format;
        public string mime_type;
        public int width;
        public int height;
        public int byte_size;
        public string artifact_uri;
        public string image_base64;
        public UnityScreenshotUnityState unity_state;
        public UnityScreenshotPixelSanity pixel_sanity;
        public UnityScreenshotCameraUsed camera_used;
        public UnityScreenshotRect game_view_rect_screen_px;
        public UnityScreenshotRect read_rect_screen_px;
        public float pixels_per_point;
        public int display_index;
        public string read_timing;
        public UnityScreenshotRect editor_window_rect_screen_px;
        public bool include_gizmos_effective;
    }


    [Serializable]
    public sealed class UnityScreenshotRect
    {
        public int x;
        public int y;
        public int width;
        public int height;
    }


    [Serializable]
    public sealed class UnityScreenshotUnityState
    {
        public bool is_playing;
        public bool is_paused;
        public string focused_view;
    }


    [Serializable]
    public sealed class UnityScreenshotPixelSanity
    {
        public bool is_all_black;
        public float avg_luma;
        public float std_luma;
        public int unique_color_estimate;
    }


    [Serializable]
    public sealed class UnityScreenshotCameraUsed
    {
        public string path;
        public int instance_id;
        public int target_display;
        public int culling_mask;
        public string clear_flags;
        public string background_color;
    }


    [Serializable]
    public sealed class UnityHitTestUiAtScreenPointRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityHitTestUiAtScreenPointPayload payload;
    }


    [Serializable]
    public sealed class UnityHitTestUiAtScreenPointPayload
    {
        public string view_mode;
        public int x;
        public int y;
        public int reference_width;
        public int reference_height;
        public int max_results;
        public int timeout_ms;
    }


    [Serializable]
    public sealed class UnityHitTestUiAtScreenPointResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityHitTestUiAtScreenPointData data;
    }


    [Serializable]
    public sealed class UnityHitTestUiAtScreenPointData
    {
        public string view_mode;
        public int requested_x;
        public int requested_y;
        public int mapped_screen_x;
        public int mapped_screen_y;
        public int reference_width;
        public int reference_height;
        public UnityScreenshotRect game_view_rect_screen_px;
        public UnityScreenshotRect read_rect_screen_px;
        public bool hit_found;
        public int hit_count;
        public UnityUiHitTestItem[] hits;
    }


    [Serializable]
    public sealed class UnityHitTestUiAtViewportPointRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityHitTestUiAtViewportPointPayload payload;
    }


    [Serializable]
    public sealed class UnityHitTestUiAtViewportPointPayload
    {
        public string view;
        public string coord_space;
        public string coord_origin;
        public float x;
        public float y;
        public UnityQueryResolution resolution;
        public UnityQueryScope scope;
        public int max_results;
        public bool include_non_interactable;
        public int timeout_ms;
    }


    [Serializable]
    public sealed class UnityHitTestUiAtViewportPointResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityHitTestUiAtViewportPointData data;
    }


    [Serializable]
    public sealed class UnityHitTestUiAtViewportPointData
    {
        public string view;
        public string coord_space;
        public string coord_origin;
        public UnityViewportPoint requested_point;
        public UnityViewportPoint mapped_point;
        public UnityQueryResolution resolution;
        public UnityQueryResolution runtime_resolution;
        public string runtime_source;
        public bool approximate;
        public string approx_reason;
        public string confidence;
        public int hit_count;
        public UnityUiHitTestStackItem[] hits;
    }


    [Serializable]
    public sealed class UnityViewportPoint
    {
        public float x;
        public float y;
    }


    [Serializable]
    public sealed class UnityUiHitTestStackItem
    {
        public int rank;
        public UnityObjectAnchor anchor;
        public string object_id;
        public string path;
        public string name;
        public string component;
        public bool interactable;
        public bool raycast_target;
        public UnityScreenshotRect rect_screen_px;
        public int z_order_hint;
    }


    [Serializable]
    public sealed class UnityValidateUiLayoutRequest
    {
        public string @event;
        public string request_id;
        public string thread_id;
        public string turn_id;
        public string timestamp;
        public UnityValidateUiLayoutPayload payload;
    }


    [Serializable]
    public sealed class UnityValidateUiLayoutPayload
    {
        public UnityQueryScope scope;
        public UnityQueryResolutionItem[] resolutions;
        public string[] checks;
        public int max_issues;
        public int time_budget_ms;
        public string layout_refresh_mode;
        public int timeout_ms;
    }


    [Serializable]
    public sealed class UnityValidateUiLayoutResponse
    {
        public bool ok;
        public string request_id;
        public string captured_at;
        public string error_code;
        public string error_message;
        public UnityReadToken read_token;
        public UnityValidateUiLayoutData data;
    }


    [Serializable]
    public sealed class UnityValidateUiLayoutData
    {
        public UnityQueryScope scope;
        public UnityQueryResolutionItem[] resolutions;
        public int time_budget_ms;
        public UnityQueryResolution runtime_resolution;
        public string runtime_source;
        public bool partial;
        public string truncated_reason;
        public int issue_count;
        public string runtime_resolution_name;
        public UnityUiLayoutIssue[] issues;
    }


    [Serializable]
    public sealed class UnityUiLayoutIssue
    {
        public UnityObjectAnchor anchor;
        public string issue_type;
        public string severity;
        public string resolution;
        public string details;
        public string suggestion;
        public string mode;
        public string confidence;
        public bool approximate;
        public string approx_reason;
    }


    [Serializable]
    public sealed class UnityUiHitTestItem
    {
        public string object_id;
        public string path;
        public string name;
        public UnityScreenshotRect rect_screen_px;
        public int z_order_hint;
    }

}

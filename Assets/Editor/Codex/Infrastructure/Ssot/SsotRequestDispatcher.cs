using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Generated.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot
{
    [Serializable]
    public sealed class SsotDispatchResponse
    {
        public bool ok;
        public bool success;
        public string tool_name;
        public string error_code;
        public string error_message;
        public string captured_at;
        public SsotDispatchResultData data;
    }

    [Serializable]
    public sealed class SsotSceneNodeSummary
    {
        public string object_id;
        public string path;
        public bool active_self;
        public int child_count;
    }

    [Serializable]
    public sealed class SsotComponentSummary
    {
        public string short_name;
        public string assembly_qualified_name;
    }

    [Serializable]
    public sealed class SsotHierarchyNodeSummary
    {
        public string name;
        public string object_id;
        public string path;
        public int depth;
        public int component_count;
        public bool active;
        public int children_truncated_count;
        public SsotHierarchyNodeSummary[] children;
    }

    [Serializable]
    public sealed class SsotAssetEntrySummary
    {
        public string path;
    }

    [Serializable]
    public sealed class SsotUiOverlayCanvasSummary
    {
        public string object_id;
        public string path;
        public string name;
        public bool active;
        public string render_mode;
        public int sorting_order;
        public int interactable_elements;
        public float screen_coverage_percent;
    }

    [Serializable]
    public sealed class SsotUiHitSummary
    {
        public int rank;
        public string object_id;
        public string path;
        public string name;
        public string component;
        public bool interactable;
        public bool raycast_target;
        public int z_order_hint;
    }

    [Serializable]
    public sealed class SsotLayoutIssueSummary
    {
        public string issue_type;
        public string severity;
        public string resolution;
        public string details;
        public string suggestion;
        public string mode;
        public string confidence;
        public bool approximate;
        public string approx_reason;
        public string object_id;
        public string path;
    }

    [Serializable]
    public sealed class SsotSerializedPropertyNodeSummary
    {
        public string property_path;
        public string display_name;
        public string property_type;
        public int depth;
        public bool writable;
        public string value_summary;
        public bool has_visible_children;
        public bool common_use;
        public string llm_hint;
    }

    [Serializable]
    public sealed class SsotSerializedPropertyComponentSummary
    {
        public int selector_index;
        public string type;
        public string target_object_id;
        public string target_path;
        public int returned_count;
        public bool truncated;
        public string truncated_reason;
        public string next_cursor;
    }

    [Serializable]
    public sealed class SsotDispatchResultData
    {
        public string scene_revision;
        public string prefab_path;
        public int max_depth;
        public string target_object_id;
        public string target_path;
        public string target_object_name;
        public bool target_object_active;
        public string ui_system;
        public string root_path;
        public float anchored_x;
        public float anchored_y;
        public float width;
        public float height;
        public int component_count;
        public SsotComponentSummary[] components;
        public string component_type;
        public string property_path;
        public string value_kind;
        public string value_string;
        public double value_number;
        public bool value_boolean;
        public int depth;
        public int node_budget;
        public int char_budget;
        public int returned_node_count;
        public bool truncated;
        public string truncated_reason;
        public SsotHierarchyNodeSummary root;
        public string scene_path;
        public bool include_inactive;
        public int total_count;
        public string folder_path;
        public bool recursive;
        public bool include_meta;
        public bool include_components;
        public bool include_missing_scripts;
        public bool include_layout;
        public bool include_interaction;
        public bool include_text_metrics;
        public bool include_value_summary;
        public bool include_non_visible;
        public int returned_canvas_count;
        public float overlay_total_coverage_percent;
        public string diagnosis;
        public string recommended_capture_mode;
        public string view;
        public string coord_space;
        public string coord_origin;
        public float requested_x;
        public float requested_y;
        public float mapped_x;
        public float mapped_y;
        public int resolution_width;
        public int resolution_height;
        public int runtime_resolution_width;
        public int runtime_resolution_height;
        public string runtime_source;
        public bool approximate;
        public string approx_reason;
        public string confidence;
        public int hit_count;
        public int issue_count;
        public bool partial;
        public string runtime_resolution_name;
        public string next_cursor;
        public string capture_mode_effective;
        public string output_mode;
        public string image_format;
        public string mime_type;
        public int byte_size;
        public string artifact_uri;
        public string image_base64;
        public string fallback_reason;
        public string[] diagnosis_tags;
        public SsotAssetEntrySummary[] assets;
        public string component_query;
        public string under_path;
        public SsotHierarchyNodeSummary[] ui_roots;
        public SsotSceneNodeSummary[] found_objects;
        public SsotUiOverlayCanvasSummary[] overlay_canvases;
        public SsotUiHitSummary[] hits;
        public SsotLayoutIssueSummary[] layout_issues;
        public SsotSerializedPropertyNodeSummary[] serialized_property_nodes;
        public SsotSerializedPropertyComponentSummary[] serialized_property_components;
        public string read_token_candidate;
        public string scope_path;
        public SsotSceneNodeSummary[] scene_roots;
        public int failed_step_index;
        public string failed_step_id;
        public string failed_tool_name;
        public bool rollback_applied;
        public string failed_error_code;
        public string failed_error_message;
        public int resolved_ref_count;
        public int executed_step_count;
    }

    public sealed class SsotRequestDispatcher
    {
        private readonly IReadOnlyDictionary<string, ISsotDispatchBinding> _bindings;

        public SsotRequestDispatcher()
            : this(null, null)
        {
        }

        internal SsotRequestDispatcher(
            ISsotExecutorFactory executorFactory,
            IReadOnlyDictionary<string, ISsotDispatchBinding> bindings)
        {
            var resolvedExecutorFactory = executorFactory ?? new DefaultSsotExecutorFactory();
            _bindings = bindings ?? SsotDispatchBindings.CreateBindingMap(
                resolvedExecutorFactory,
                DispatchNestedToolForTransaction);
            if (_bindings == null)
            {
                _bindings = new Dictionary<string, ISsotDispatchBinding>(StringComparer.Ordinal);
            }
        }

        public SsotDispatchResponse Dispatch(string toolName, string payloadJson)
        {
            var normalizedToolName = Normalize(toolName);
            if (string.IsNullOrEmpty(normalizedToolName))
            {
                return Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "SSOT request tool_name is required.",
                    string.Empty);
            }

            object requestDto;
            string deserializeError;
            if (!SsotRequestRouter.TryDeserializeByToolName(
                    normalizedToolName,
                    payloadJson,
                    out requestDto,
                    out deserializeError))
            {
                if (IsUnsupportedToolError(deserializeError, normalizedToolName))
                {
                    return Failure(
                        "E_SSOT_TOOL_UNSUPPORTED",
                        "Unsupported SSOT tool: " + normalizedToolName,
                        normalizedToolName);
                }

                return Failure(
                    "E_SSOT_DESERIALIZE_FAILED",
                    string.IsNullOrEmpty(deserializeError)
                        ? "SSOT request payload deserialization failed."
                        : deserializeError,
                    normalizedToolName);
            }

            ISsotDispatchBinding binding;
            if (!_bindings.TryGetValue(normalizedToolName, out binding) || binding == null)
            {
                return Failure(
                    "E_SSOT_TOOL_UNSUPPORTED",
                    "Unsupported SSOT tool: " + normalizedToolName,
                    normalizedToolName);
            }

            var response = binding.Dispatch(requestDto, normalizedToolName);
            if (response == null)
            {
                return Failure(
                    "E_SSOT_EXECUTION_FAILED",
                    "SSOT dispatcher binding returned null response.",
                    normalizedToolName);
            }

            return response;
        }

        private SsotDispatchResponse DispatchNestedToolForTransaction(string toolName, string payloadJson)
        {
            var normalized = Normalize(toolName);
            if (string.Equals(
                    normalized,
                    ExecuteUnityTransactionRequestDto.ToolName,
                    StringComparison.Ordinal))
            {
                return Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "execute_unity_transaction cannot recursively invoke itself.",
                    ExecuteUnityTransactionRequestDto.ToolName);
            }

            return Dispatch(normalized, payloadJson);
        }

        internal static SsotDispatchResponse Success(string toolName, SsotDispatchResultData data)
        {
            return new SsotDispatchResponse
            {
                ok = true,
                success = true,
                tool_name = Normalize(toolName),
                error_code = string.Empty,
                error_message = string.Empty,
                captured_at = DateTime.UtcNow.ToString("o"),
                data = data
            };
        }

        internal static SsotDispatchResponse Failure(string errorCode, string errorMessage, string toolName)
        {
            return new SsotDispatchResponse
            {
                ok = false,
                success = false,
                tool_name = Normalize(toolName),
                error_code = NormalizeErrorCode(errorCode),
                error_message = NormalizeErrorMessage(errorMessage),
                captured_at = DateTime.UtcNow.ToString("o"),
                data = null
            };
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static bool IsUnsupportedToolError(string errorMessage, string normalizedToolName)
        {
            var normalizedError = Normalize(errorMessage);
            var expected = "Unsupported SSOT tool: " + Normalize(normalizedToolName);
            return string.Equals(normalizedError, expected, StringComparison.Ordinal);
        }

        private static string NormalizeErrorCode(string value)
        {
            var normalized = Normalize(value).ToUpperInvariant();
            return string.IsNullOrEmpty(normalized)
                ? "E_SSOT_EXECUTION_FAILED"
                : normalized;
        }

        private static string NormalizeErrorMessage(string value)
        {
            var normalized = Normalize(value);
            return string.IsNullOrEmpty(normalized)
                ? "SSOT request execution failed."
                : normalized;
        }
    }
}

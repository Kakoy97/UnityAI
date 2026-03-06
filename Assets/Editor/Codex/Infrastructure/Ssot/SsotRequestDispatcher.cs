using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Executors;

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
    }

    public sealed class SsotRequestDispatcher
    {
        private readonly ModifyUiLayoutSsotExecutor _modifyUiLayoutExecutor;
        private readonly SetComponentPropertiesSsotExecutor _setComponentPropertiesExecutor;
        private readonly AddComponentSsotExecutor _addComponentExecutor;
        private readonly RemoveComponentSsotExecutor _removeComponentExecutor;
        private readonly ReplaceComponentSsotExecutor _replaceComponentExecutor;
        private readonly CreateObjectSsotExecutor _createObjectExecutor;
        private readonly DuplicateObjectSsotExecutor _duplicateObjectExecutor;
        private readonly DeleteObjectSsotExecutor _deleteObjectExecutor;
        private readonly RenameObjectSsotExecutor _renameObjectExecutor;
        private readonly SetActiveSsotExecutor _setActiveExecutor;
        private readonly SetParentSsotExecutor _setParentExecutor;
        private readonly SetSiblingIndexSsotExecutor _setSiblingIndexExecutor;
        private readonly SetLocalPositionSsotExecutor _setLocalPositionExecutor;
        private readonly SetLocalRotationSsotExecutor _setLocalRotationExecutor;
        private readonly SetLocalScaleSsotExecutor _setLocalScaleExecutor;
        private readonly SetWorldPositionSsotExecutor _setWorldPositionExecutor;
        private readonly SetWorldRotationSsotExecutor _setWorldRotationExecutor;
        private readonly ResetTransformSsotExecutor _resetTransformExecutor;
        private readonly SetRectAnchoredPositionSsotExecutor _setRectAnchoredPositionExecutor;
        private readonly SetRectSizeDeltaSsotExecutor _setRectSizeDeltaExecutor;
        private readonly SetRectPivotSsotExecutor _setRectPivotExecutor;
        private readonly SetRectAnchorsSsotExecutor _setRectAnchorsExecutor;
        private readonly SetCanvasGroupAlphaSsotExecutor _setCanvasGroupAlphaExecutor;
        private readonly SetLayoutElementSsotExecutor _setLayoutElementExecutor;
        private readonly SetUiImageColorSsotExecutor _setUiImageColorExecutor;
        private readonly SetUiImageRaycastTargetSsotExecutor _setUiImageRaycastTargetExecutor;
        private readonly SetUiTextContentSsotExecutor _setUiTextContentExecutor;
        private readonly SetUiTextColorSsotExecutor _setUiTextColorExecutor;
        private readonly SetUiTextFontSizeSsotExecutor _setUiTextFontSizeExecutor;
        private readonly ExecuteUnityTransactionSsotExecutor _executeUnityTransactionExecutor;
        private readonly SetSerializedPropertySsotExecutor _setSerializedPropertyExecutor;
        private readonly GetSceneSnapshotForWriteSsotExecutor _getSceneSnapshotForWriteExecutor;
        private readonly GetCurrentSelectionSsotExecutor _getCurrentSelectionExecutor;
        private readonly GetGameobjectComponentsSsotExecutor _getGameobjectComponentsExecutor;
        private readonly GetHierarchySubtreeSsotExecutor _getHierarchySubtreeExecutor;
        private readonly GetSceneRootsSsotExecutor _getSceneRootsExecutor;
        private readonly ListAssetsInFolderSsotExecutor _listAssetsInFolderExecutor;
        private readonly FindObjectsByComponentSsotExecutor _findObjectsByComponentExecutor;
        private readonly QueryPrefabInfoSsotExecutor _queryPrefabInfoExecutor;
        private readonly GetUiTreeSsotExecutor _getUiTreeExecutor;
        private readonly GetUiOverlayReportSsotExecutor _getUiOverlayReportExecutor;
        private readonly HitTestUiAtScreenPointSsotExecutor _hitTestUiAtScreenPointExecutor;
        private readonly HitTestUiAtViewportPointSsotExecutor _hitTestUiAtViewportPointExecutor;
        private readonly ValidateUiLayoutSsotExecutor _validateUiLayoutExecutor;
        private readonly GetSerializedPropertyTreeSsotExecutor _getSerializedPropertyTreeExecutor;
        private readonly CaptureSceneScreenshotSsotExecutor _captureSceneScreenshotExecutor;

        public SsotRequestDispatcher()
            : this(
                new ModifyUiLayoutSsotExecutor(),
                new SetComponentPropertiesSsotExecutor(),
                new AddComponentSsotExecutor(),
                new RemoveComponentSsotExecutor(),
                new ReplaceComponentSsotExecutor(),
                new CreateObjectSsotExecutor(),
                new DuplicateObjectSsotExecutor(),
                new DeleteObjectSsotExecutor(),
                new RenameObjectSsotExecutor(),
                new SetActiveSsotExecutor(),
                new SetParentSsotExecutor(),
                new SetSiblingIndexSsotExecutor(),
                new SetLocalPositionSsotExecutor(),
                new SetLocalRotationSsotExecutor(),
                new SetLocalScaleSsotExecutor(),
                new SetWorldPositionSsotExecutor(),
                new SetWorldRotationSsotExecutor(),
                new ResetTransformSsotExecutor(),
                new SetRectAnchoredPositionSsotExecutor(),
                new SetRectSizeDeltaSsotExecutor(),
                new SetRectPivotSsotExecutor(),
                new SetRectAnchorsSsotExecutor(),
                new SetCanvasGroupAlphaSsotExecutor(),
                new SetLayoutElementSsotExecutor(),
                new SetUiImageColorSsotExecutor(),
                new SetUiImageRaycastTargetSsotExecutor(),
                new SetUiTextContentSsotExecutor(),
                new SetUiTextColorSsotExecutor(),
                new SetUiTextFontSizeSsotExecutor(),
                null,
                new SetSerializedPropertySsotExecutor(),
                new GetSceneSnapshotForWriteSsotExecutor(),
                new GetCurrentSelectionSsotExecutor(),
                new GetGameobjectComponentsSsotExecutor(),
                new GetHierarchySubtreeSsotExecutor(),
                new GetSceneRootsSsotExecutor(),
                new ListAssetsInFolderSsotExecutor(),
                new FindObjectsByComponentSsotExecutor(),
                new QueryPrefabInfoSsotExecutor(),
                new GetUiTreeSsotExecutor(),
                new GetUiOverlayReportSsotExecutor(),
                new HitTestUiAtScreenPointSsotExecutor(),
                new HitTestUiAtViewportPointSsotExecutor(),
                new ValidateUiLayoutSsotExecutor(),
                new GetSerializedPropertyTreeSsotExecutor(),
                new CaptureSceneScreenshotSsotExecutor())
        {
        }

        internal SsotRequestDispatcher(
            ModifyUiLayoutSsotExecutor modifyUiLayoutExecutor,
            SetComponentPropertiesSsotExecutor setComponentPropertiesExecutor,
            AddComponentSsotExecutor addComponentExecutor,
            RemoveComponentSsotExecutor removeComponentExecutor,
            ReplaceComponentSsotExecutor replaceComponentExecutor,
            CreateObjectSsotExecutor createObjectExecutor,
            DuplicateObjectSsotExecutor duplicateObjectExecutor,
            DeleteObjectSsotExecutor deleteObjectExecutor,
            RenameObjectSsotExecutor renameObjectExecutor,
            SetActiveSsotExecutor setActiveExecutor,
            SetParentSsotExecutor setParentExecutor,
            SetSiblingIndexSsotExecutor setSiblingIndexExecutor,
            SetLocalPositionSsotExecutor setLocalPositionExecutor,
            SetLocalRotationSsotExecutor setLocalRotationExecutor,
            SetLocalScaleSsotExecutor setLocalScaleExecutor,
            SetWorldPositionSsotExecutor setWorldPositionExecutor,
            SetWorldRotationSsotExecutor setWorldRotationExecutor,
            ResetTransformSsotExecutor resetTransformExecutor,
            SetRectAnchoredPositionSsotExecutor setRectAnchoredPositionExecutor,
            SetRectSizeDeltaSsotExecutor setRectSizeDeltaExecutor,
            SetRectPivotSsotExecutor setRectPivotExecutor,
            SetRectAnchorsSsotExecutor setRectAnchorsExecutor,
            SetCanvasGroupAlphaSsotExecutor setCanvasGroupAlphaExecutor,
            SetLayoutElementSsotExecutor setLayoutElementExecutor,
            SetUiImageColorSsotExecutor setUiImageColorExecutor,
            SetUiImageRaycastTargetSsotExecutor setUiImageRaycastTargetExecutor,
            SetUiTextContentSsotExecutor setUiTextContentExecutor,
            SetUiTextColorSsotExecutor setUiTextColorExecutor,
            SetUiTextFontSizeSsotExecutor setUiTextFontSizeExecutor,
            ExecuteUnityTransactionSsotExecutor executeUnityTransactionExecutor,
            SetSerializedPropertySsotExecutor setSerializedPropertyExecutor,
            GetSceneSnapshotForWriteSsotExecutor getSceneSnapshotForWriteExecutor,
            GetCurrentSelectionSsotExecutor getCurrentSelectionExecutor,
            GetGameobjectComponentsSsotExecutor getGameobjectComponentsExecutor,
            GetHierarchySubtreeSsotExecutor getHierarchySubtreeExecutor,
            GetSceneRootsSsotExecutor getSceneRootsExecutor,
            ListAssetsInFolderSsotExecutor listAssetsInFolderExecutor,
            FindObjectsByComponentSsotExecutor findObjectsByComponentExecutor,
            QueryPrefabInfoSsotExecutor queryPrefabInfoExecutor,
            GetUiTreeSsotExecutor getUiTreeExecutor,
            GetUiOverlayReportSsotExecutor getUiOverlayReportExecutor,
            HitTestUiAtScreenPointSsotExecutor hitTestUiAtScreenPointExecutor,
            HitTestUiAtViewportPointSsotExecutor hitTestUiAtViewportPointExecutor,
            ValidateUiLayoutSsotExecutor validateUiLayoutExecutor,
            GetSerializedPropertyTreeSsotExecutor getSerializedPropertyTreeExecutor,
            CaptureSceneScreenshotSsotExecutor captureSceneScreenshotExecutor)
        {
            _modifyUiLayoutExecutor = modifyUiLayoutExecutor ?? new ModifyUiLayoutSsotExecutor();
            _setComponentPropertiesExecutor =
                setComponentPropertiesExecutor ?? new SetComponentPropertiesSsotExecutor();
            _addComponentExecutor =
                addComponentExecutor ?? new AddComponentSsotExecutor();
            _removeComponentExecutor =
                removeComponentExecutor ?? new RemoveComponentSsotExecutor();
            _replaceComponentExecutor =
                replaceComponentExecutor ?? new ReplaceComponentSsotExecutor();
            _createObjectExecutor =
                createObjectExecutor ?? new CreateObjectSsotExecutor();
            _duplicateObjectExecutor =
                duplicateObjectExecutor ?? new DuplicateObjectSsotExecutor();
            _deleteObjectExecutor =
                deleteObjectExecutor ?? new DeleteObjectSsotExecutor();
            _renameObjectExecutor =
                renameObjectExecutor ?? new RenameObjectSsotExecutor();
            _setActiveExecutor =
                setActiveExecutor ?? new SetActiveSsotExecutor();
            _setParentExecutor =
                setParentExecutor ?? new SetParentSsotExecutor();
            _setSiblingIndexExecutor =
                setSiblingIndexExecutor ?? new SetSiblingIndexSsotExecutor();
            _setLocalPositionExecutor =
                setLocalPositionExecutor ?? new SetLocalPositionSsotExecutor();
            _setLocalRotationExecutor =
                setLocalRotationExecutor ?? new SetLocalRotationSsotExecutor();
            _setLocalScaleExecutor =
                setLocalScaleExecutor ?? new SetLocalScaleSsotExecutor();
            _setWorldPositionExecutor =
                setWorldPositionExecutor ?? new SetWorldPositionSsotExecutor();
            _setWorldRotationExecutor =
                setWorldRotationExecutor ?? new SetWorldRotationSsotExecutor();
            _resetTransformExecutor =
                resetTransformExecutor ?? new ResetTransformSsotExecutor();
            _setRectAnchoredPositionExecutor =
                setRectAnchoredPositionExecutor ?? new SetRectAnchoredPositionSsotExecutor();
            _setRectSizeDeltaExecutor =
                setRectSizeDeltaExecutor ?? new SetRectSizeDeltaSsotExecutor();
            _setRectPivotExecutor =
                setRectPivotExecutor ?? new SetRectPivotSsotExecutor();
            _setRectAnchorsExecutor =
                setRectAnchorsExecutor ?? new SetRectAnchorsSsotExecutor();
            _setCanvasGroupAlphaExecutor =
                setCanvasGroupAlphaExecutor ?? new SetCanvasGroupAlphaSsotExecutor();
            _setLayoutElementExecutor =
                setLayoutElementExecutor ?? new SetLayoutElementSsotExecutor();
            _setUiImageColorExecutor =
                setUiImageColorExecutor ?? new SetUiImageColorSsotExecutor();
            _setUiImageRaycastTargetExecutor =
                setUiImageRaycastTargetExecutor ?? new SetUiImageRaycastTargetSsotExecutor();
            _setUiTextContentExecutor =
                setUiTextContentExecutor ?? new SetUiTextContentSsotExecutor();
            _setUiTextColorExecutor =
                setUiTextColorExecutor ?? new SetUiTextColorSsotExecutor();
            _setUiTextFontSizeExecutor =
                setUiTextFontSizeExecutor ?? new SetUiTextFontSizeSsotExecutor();
            _executeUnityTransactionExecutor =
                executeUnityTransactionExecutor ?? new ExecuteUnityTransactionSsotExecutor(DispatchNestedToolForTransaction);
            _setSerializedPropertyExecutor =
                setSerializedPropertyExecutor ?? new SetSerializedPropertySsotExecutor();
            _getSceneSnapshotForWriteExecutor =
                getSceneSnapshotForWriteExecutor ?? new GetSceneSnapshotForWriteSsotExecutor();
            _getCurrentSelectionExecutor =
                getCurrentSelectionExecutor ?? new GetCurrentSelectionSsotExecutor();
            _getGameobjectComponentsExecutor =
                getGameobjectComponentsExecutor ?? new GetGameobjectComponentsSsotExecutor();
            _getHierarchySubtreeExecutor =
                getHierarchySubtreeExecutor ?? new GetHierarchySubtreeSsotExecutor();
            _getSceneRootsExecutor =
                getSceneRootsExecutor ?? new GetSceneRootsSsotExecutor();
            _listAssetsInFolderExecutor =
                listAssetsInFolderExecutor ?? new ListAssetsInFolderSsotExecutor();
            _findObjectsByComponentExecutor =
                findObjectsByComponentExecutor ?? new FindObjectsByComponentSsotExecutor();
            _queryPrefabInfoExecutor =
                queryPrefabInfoExecutor ?? new QueryPrefabInfoSsotExecutor();
            _getUiTreeExecutor =
                getUiTreeExecutor ?? new GetUiTreeSsotExecutor();
            _getUiOverlayReportExecutor =
                getUiOverlayReportExecutor ?? new GetUiOverlayReportSsotExecutor();
            _hitTestUiAtScreenPointExecutor =
                hitTestUiAtScreenPointExecutor ?? new HitTestUiAtScreenPointSsotExecutor();
            _hitTestUiAtViewportPointExecutor =
                hitTestUiAtViewportPointExecutor ?? new HitTestUiAtViewportPointSsotExecutor();
            _validateUiLayoutExecutor =
                validateUiLayoutExecutor ?? new ValidateUiLayoutSsotExecutor();
            _getSerializedPropertyTreeExecutor =
                getSerializedPropertyTreeExecutor ?? new GetSerializedPropertyTreeSsotExecutor();
            _captureSceneScreenshotExecutor =
                captureSceneScreenshotExecutor ?? new CaptureSceneScreenshotSsotExecutor();
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
                return Failure(
                    "E_SSOT_DESERIALIZE_FAILED",
                    string.IsNullOrEmpty(deserializeError)
                        ? "SSOT request payload deserialization failed."
                        : deserializeError,
                    normalizedToolName);
            }

            if (string.Equals(normalizedToolName, ModifyUiLayoutRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as ModifyUiLayoutRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for modify_ui_layout.",
                        normalizedToolName);
                }

                return _modifyUiLayoutExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetComponentPropertiesRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetComponentPropertiesRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_component_properties.",
                        normalizedToolName);
                }

                return _setComponentPropertiesExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, AddComponentRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as AddComponentRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for add_component.",
                        normalizedToolName);
                }

                return _addComponentExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, RemoveComponentRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as RemoveComponentRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for remove_component.",
                        normalizedToolName);
                }

                return _removeComponentExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, ReplaceComponentRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as ReplaceComponentRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for replace_component.",
                        normalizedToolName);
                }

                return _replaceComponentExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, CreateObjectRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as CreateObjectRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for create_object.",
                        normalizedToolName);
                }

                return _createObjectExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, DuplicateObjectRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as DuplicateObjectRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for duplicate_object.",
                        normalizedToolName);
                }

                return _duplicateObjectExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, DeleteObjectRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as DeleteObjectRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for delete_object.",
                        normalizedToolName);
                }

                return _deleteObjectExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, RenameObjectRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as RenameObjectRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for rename_object.",
                        normalizedToolName);
                }

                return _renameObjectExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetActiveRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetActiveRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_active.",
                        normalizedToolName);
                }

                return _setActiveExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetParentRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetParentRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_parent.",
                        normalizedToolName);
                }

                return _setParentExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetSiblingIndexRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetSiblingIndexRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_sibling_index.",
                        normalizedToolName);
                }

                return _setSiblingIndexExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetLocalPositionRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetLocalPositionRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_local_position.",
                        normalizedToolName);
                }

                return _setLocalPositionExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetLocalRotationRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetLocalRotationRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_local_rotation.",
                        normalizedToolName);
                }

                return _setLocalRotationExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetLocalScaleRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetLocalScaleRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_local_scale.",
                        normalizedToolName);
                }

                return _setLocalScaleExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetWorldPositionRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetWorldPositionRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_world_position.",
                        normalizedToolName);
                }

                return _setWorldPositionExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetWorldRotationRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetWorldRotationRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_world_rotation.",
                        normalizedToolName);
                }

                return _setWorldRotationExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, ResetTransformRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as ResetTransformRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for reset_transform.",
                        normalizedToolName);
                }

                return _resetTransformExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetRectAnchoredPositionRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetRectAnchoredPositionRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_rect_anchored_position.",
                        normalizedToolName);
                }

                return _setRectAnchoredPositionExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetRectSizeDeltaRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetRectSizeDeltaRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_rect_size_delta.",
                        normalizedToolName);
                }

                return _setRectSizeDeltaExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetRectPivotRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetRectPivotRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_rect_pivot.",
                        normalizedToolName);
                }

                return _setRectPivotExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetRectAnchorsRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetRectAnchorsRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_rect_anchors.",
                        normalizedToolName);
                }

                return _setRectAnchorsExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetCanvasGroupAlphaRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetCanvasGroupAlphaRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_canvas_group_alpha.",
                        normalizedToolName);
                }

                return _setCanvasGroupAlphaExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetLayoutElementRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetLayoutElementRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_layout_element.",
                        normalizedToolName);
                }

                return _setLayoutElementExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetUiImageColorRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetUiImageColorRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_ui_image_color.",
                        normalizedToolName);
                }

                return _setUiImageColorExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetUiImageRaycastTargetRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetUiImageRaycastTargetRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_ui_image_raycast_target.",
                        normalizedToolName);
                }

                return _setUiImageRaycastTargetExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetUiTextContentRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetUiTextContentRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_ui_text_content.",
                        normalizedToolName);
                }

                return _setUiTextContentExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetUiTextColorRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetUiTextColorRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_ui_text_color.",
                        normalizedToolName);
                }

                return _setUiTextColorExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, SetUiTextFontSizeRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetUiTextFontSizeRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_ui_text_font_size.",
                        normalizedToolName);
                }

                return _setUiTextFontSizeExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, ExecuteUnityTransactionRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as ExecuteUnityTransactionRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for execute_unity_transaction.",
                        normalizedToolName);
                }

                return _executeUnityTransactionExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, ApplyVisualActionsRequestDto.ToolName, StringComparison.Ordinal))
            {
                if (!(requestDto is ApplyVisualActionsRequestDto))
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for apply_visual_actions.",
                        normalizedToolName);
                }

                return Failure(
                    "E_SSOT_TOOL_DEPRECATED",
                    "apply_visual_actions is deprecated in SSOT-only mode. Use fine-grained SSOT write tools or execute_unity_transaction.",
                    normalizedToolName);
            }

            if (string.Equals(normalizedToolName, SetUiPropertiesRequestDto.ToolName, StringComparison.Ordinal))
            {
                if (!(requestDto is SetUiPropertiesRequestDto))
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_ui_properties.",
                        normalizedToolName);
                }

                return Failure(
                    "E_SSOT_TOOL_DEPRECATED",
                    "set_ui_properties is deprecated in SSOT-only mode. Use fine-grained SSOT UI tools.",
                    normalizedToolName);
            }

            if (string.Equals(normalizedToolName, SetSerializedPropertyRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as SetSerializedPropertyRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for set_serialized_property.",
                        normalizedToolName);
                }

                return _setSerializedPropertyExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, GetSceneSnapshotForWriteRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as GetSceneSnapshotForWriteRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for get_scene_snapshot_for_write.",
                        normalizedToolName);
                }

                return _getSceneSnapshotForWriteExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, GetCurrentSelectionRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as GetCurrentSelectionRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for get_current_selection.",
                        normalizedToolName);
                }

                return _getCurrentSelectionExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, GetGameobjectComponentsRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as GetGameobjectComponentsRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for get_gameobject_components.",
                        normalizedToolName);
                }

                return _getGameobjectComponentsExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, GetHierarchySubtreeRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as GetHierarchySubtreeRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for get_hierarchy_subtree.",
                        normalizedToolName);
                }

                return _getHierarchySubtreeExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, GetSceneRootsRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as GetSceneRootsRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for get_scene_roots.",
                        normalizedToolName);
                }

                return _getSceneRootsExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, ListAssetsInFolderRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as ListAssetsInFolderRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for list_assets_in_folder.",
                        normalizedToolName);
                }

                return _listAssetsInFolderExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, FindObjectsByComponentRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as FindObjectsByComponentRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for find_objects_by_component.",
                        normalizedToolName);
                }

                return _findObjectsByComponentExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, QueryPrefabInfoRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as QueryPrefabInfoRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for query_prefab_info.",
                        normalizedToolName);
                }

                return _queryPrefabInfoExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, GetUiTreeRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as GetUiTreeRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for get_ui_tree.",
                        normalizedToolName);
                }

                return _getUiTreeExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, GetUiOverlayReportRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as GetUiOverlayReportRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for get_ui_overlay_report.",
                        normalizedToolName);
                }

                return _getUiOverlayReportExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, HitTestUiAtViewportPointRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as HitTestUiAtViewportPointRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for hit_test_ui_at_viewport_point.",
                        normalizedToolName);
                }

                return _hitTestUiAtViewportPointExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, HitTestUiAtScreenPointRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as HitTestUiAtScreenPointRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for hit_test_ui_at_screen_point.",
                        normalizedToolName);
                }

                return _hitTestUiAtScreenPointExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, ValidateUiLayoutRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as ValidateUiLayoutRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for validate_ui_layout.",
                        normalizedToolName);
                }

                return _validateUiLayoutExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, GetSerializedPropertyTreeRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as GetSerializedPropertyTreeRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for get_serialized_property_tree.",
                        normalizedToolName);
                }

                return _getSerializedPropertyTreeExecutor.Execute(typedRequest);
            }

            if (string.Equals(normalizedToolName, CaptureSceneScreenshotRequestDto.ToolName, StringComparison.Ordinal))
            {
                var typedRequest = requestDto as CaptureSceneScreenshotRequestDto;
                if (typedRequest == null)
                {
                    return Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        "SSOT request type mismatch for capture_scene_screenshot.",
                        normalizedToolName);
                }

                return _captureSceneScreenshotExecutor.Execute(typedRequest);
            }

            return Failure(
                "E_SSOT_TOOL_UNSUPPORTED",
                "Unsupported SSOT tool: " + normalizedToolName,
                normalizedToolName);
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

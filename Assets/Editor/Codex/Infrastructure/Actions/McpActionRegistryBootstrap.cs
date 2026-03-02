using System.Collections.Generic;
using System.Text;
using UnityEditor;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    [InitializeOnLoad]
    public static class McpActionRegistryBootstrap
    {
        private static McpActionRegistry _registry;

        static McpActionRegistryBootstrap()
        {
            _registry = BuildDefaultRegistry();
        }

        public static McpActionRegistry Registry
        {
            get { return _registry; }
        }

        public static IReadOnlyList<McpActionCapability> GetCapabilities()
        {
            return _registry.GetCapabilities();
        }

        public static void Rebuild()
        {
            _registry = BuildDefaultRegistry();
        }

        private static McpActionRegistry BuildDefaultRegistry()
        {
            var registry = new McpActionRegistry();

            RegisterBuiltInCoreActions(registry);
            RegisterTransformAndLayoutValuePack(registry);
            RegisterUiValuePack(registry);
            RegisterCompositeAction(registry);

            return registry;
        }

        private static void RegisterBuiltInCoreActions(McpActionRegistry registry)
        {
            var createObjectSchema = SchemaObject(
                new[] { "name" },
                new SchemaProperty("name", "string", "New game object name."),
                new SchemaProperty("primitive_type", "string", "Optional primitive type."),
                new SchemaProperty("ui_type", "string", "Optional UI type."));
            var setActiveSchema = SchemaObject(
                new[] { "active" },
                new SchemaProperty("active", "boolean", "True to activate, false to deactivate."));
            var renameObjectSchema = SchemaObject(
                new[] { "name" },
                new SchemaProperty("name", "string", "New object name."));
            var destroyObjectSchema = SchemaObject(new string[0]);
            var setParentSchema = SchemaObject(
                new string[0],
                new SchemaProperty(
                    "world_position_stays",
                    "boolean",
                    "Optional. True keeps world transform, false keeps local transform."));
            var setSiblingIndexSchema = SchemaObject(
                new[] { "sibling_index" },
                new SchemaProperty("sibling_index", "integer", "Target sibling index (>=0)."));
            var duplicateObjectSchema = SchemaObject(
                new string[0],
                new SchemaProperty("name", "string", "Optional duplicate name override."));
            var resetTransformSchema = SchemaObject(new string[0]);

            registry.Register<AddComponentHandler>(
                "add_component",
                CreateCapability(
                    "add_component",
                    "Add a component to target_anchor.",
                    "target_required",
                    McpActionGovernance.DomainComponent,
                    SchemaObject(
                        new[] { "component_assembly_qualified_name" },
                        new SchemaProperty("component_assembly_qualified_name", "string", "Assembly qualified component type name."))));
            registry.Register<RemoveComponentHandler>(
                "remove_component",
                CreateCapability(
                    "remove_component",
                    "Remove a component from target_anchor.",
                    "target_required",
                    McpActionGovernance.DomainComponent,
                    SchemaObject(
                        new[] { "component_assembly_qualified_name" },
                        new SchemaProperty("component_assembly_qualified_name", "string", "Assembly qualified component type name."))));
            registry.Register<ReplaceComponentHandler>(
                "replace_component",
                CreateCapability(
                    "replace_component",
                    "Replace source component with another component on target_anchor.",
                    "target_required",
                    McpActionGovernance.DomainComponent,
                    SchemaObject(
                        new[] { "source_component_assembly_qualified_name", "component_assembly_qualified_name" },
                        new SchemaProperty("source_component_assembly_qualified_name", "string", "Source component type."),
                        new SchemaProperty("component_assembly_qualified_name", "string", "Target component type."))));
            registry.Register<SerializedPropertyActionHandler>(
                "set_serialized_property",
                CreateCapability(
                    "set_serialized_property",
                    "Write component SerializedProperty values through component_selector + patches.",
                    "target_required",
                    McpActionGovernance.DomainComponent,
                    SchemaSetSerializedProperty(),
                    McpActionGovernance.TierAdvanced,
                    McpActionGovernance.LifecycleExperimental));

            registry.Register<CreateObjectHandler>(
                "create_object",
                CreateCapability(
                    "create_object",
                    "Create a game object under parent_anchor.",
                    "parent_required",
                    McpActionGovernance.DomainGameObject,
                    createObjectSchema));
            registry.Register<SetActiveHandler>(
                "set_active",
                CreateCapability(
                    "set_active",
                    "Set active state on target_anchor.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    setActiveSchema));
            registry.Register<RenameObjectHandler>(
                "rename_object",
                CreateCapability(
                    "rename_object",
                    "Rename target_anchor game object.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    renameObjectSchema));
            registry.Register<DestroyObjectHandler>(
                "destroy_object",
                CreateCapability(
                    "destroy_object",
                    "Destroy target_anchor game object.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    destroyObjectSchema));
            registry.Register<SetParentHandler>(
                "set_parent",
                CreateCapability(
                    "set_parent",
                    "Re-parent target_anchor under parent_anchor.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    setParentSchema));
            registry.Register<SetSiblingIndexHandler>(
                "set_sibling_index",
                CreateCapability(
                    "set_sibling_index",
                    "Set sibling index on target_anchor transform.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    setSiblingIndexSchema));
            registry.Register<DuplicateObjectHandler>(
                "duplicate_object",
                CreateCapability(
                    "duplicate_object",
                    "Duplicate target_anchor and create a sibling copy.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    duplicateObjectSchema));

            registry.Register<CreateGameObjectHandler>(
                "create_gameobject",
                CreateDeprecatedAliasCapability(
                    "create_gameobject",
                    "create_object",
                    "Deprecated alias of create_object.",
                    "parent_required",
                    McpActionGovernance.DomainGameObject,
                    createObjectSchema));
            registry.Register<SetGameObjectActiveHandler>(
                "set_gameobject_active",
                CreateDeprecatedAliasCapability(
                    "set_gameobject_active",
                    "set_active",
                    "Deprecated alias of set_active.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    setActiveSchema));
            registry.Register<RenameGameObjectHandler>(
                "rename_gameobject",
                CreateDeprecatedAliasCapability(
                    "rename_gameobject",
                    "rename_object",
                    "Deprecated alias of rename_object.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    renameObjectSchema));
            registry.Register<DestroyGameObjectHandler>(
                "destroy_gameobject",
                CreateDeprecatedAliasCapability(
                    "destroy_gameobject",
                    "destroy_object",
                    "Deprecated alias of destroy_object.",
                    "target_required",
                    McpActionGovernance.DomainGameObject,
                    destroyObjectSchema));
        }

        private static void RegisterTransformAndLayoutValuePack(McpActionRegistry registry)
        {
            var vector3Schema = SchemaVector3();
            var vector2Schema = SchemaVector2();
            var rectAnchorsSchema = SchemaObject(
                new[] { "min_x", "min_y", "max_x", "max_y" },
                new SchemaProperty("min_x", "number", "Anchor min x."),
                new SchemaProperty("min_y", "number", "Anchor min y."),
                new SchemaProperty("max_x", "number", "Anchor max x."),
                new SchemaProperty("max_y", "number", "Anchor max y."));

            registry.Register<SetLocalPositionHandler>(
                "set_local_position",
                CreateCapability(
                    "set_local_position",
                    "Set local position of target transform.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema));
            registry.Register<SetLocalRotationHandler>(
                "set_local_rotation",
                CreateCapability(
                    "set_local_rotation",
                    "Set local Euler rotation of target transform.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema));
            registry.Register<SetLocalScaleHandler>(
                "set_local_scale",
                CreateCapability(
                    "set_local_scale",
                    "Set local scale of target transform.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema));
            registry.Register<SetWorldPositionHandler>(
                "set_world_position",
                CreateCapability(
                    "set_world_position",
                    "Set world position of target transform.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema,
                    McpActionGovernance.TierAdvanced));
            registry.Register<SetWorldRotationHandler>(
                "set_world_rotation",
                CreateCapability(
                    "set_world_rotation",
                    "Set world Euler rotation of target transform.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema,
                    McpActionGovernance.TierAdvanced));
            registry.Register<ResetTransformHandler>(
                "reset_transform",
                CreateCapability(
                    "reset_transform",
                    "Reset target transform local position/rotation/scale.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    SchemaObject(new string[0]),
                    McpActionGovernance.TierAdvanced));

            registry.Register<SetRectAnchoredPositionHandler>(
                "set_rect_anchored_position",
                CreateCapability(
                    "set_rect_anchored_position",
                    "Set RectTransform anchored position.",
                    "target_required",
                    McpActionGovernance.DomainRectTransform,
                    vector2Schema));
            registry.Register<SetRectSizeDeltaHandler>(
                "set_rect_size_delta",
                CreateCapability(
                    "set_rect_size_delta",
                    "Set RectTransform sizeDelta.",
                    "target_required",
                    McpActionGovernance.DomainRectTransform,
                    vector2Schema));
            registry.Register<SetRectPivotHandler>(
                "set_rect_pivot",
                CreateCapability(
                    "set_rect_pivot",
                    "Set RectTransform pivot in [0,1].",
                    "target_required",
                    McpActionGovernance.DomainRectTransform,
                    vector2Schema));
            registry.Register<SetRectAnchorsHandler>(
                "set_rect_anchors",
                CreateCapability(
                    "set_rect_anchors",
                    "Set RectTransform anchorMin/anchorMax.",
                    "target_required",
                    McpActionGovernance.DomainRectTransform,
                    rectAnchorsSchema));

            registry.Register<SetTransformLocalPositionHandler>(
                "set_transform_local_position",
                CreateDeprecatedAliasCapability(
                    "set_transform_local_position",
                    "set_local_position",
                    "Deprecated alias of set_local_position.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema));
            registry.Register<SetTransformLocalRotationHandler>(
                "set_transform_local_rotation",
                CreateDeprecatedAliasCapability(
                    "set_transform_local_rotation",
                    "set_local_rotation",
                    "Deprecated alias of set_local_rotation.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema));
            registry.Register<SetTransformLocalScaleHandler>(
                "set_transform_local_scale",
                CreateDeprecatedAliasCapability(
                    "set_transform_local_scale",
                    "set_local_scale",
                    "Deprecated alias of set_local_scale.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema));
            registry.Register<SetTransformWorldPositionHandler>(
                "set_transform_world_position",
                CreateDeprecatedAliasCapability(
                    "set_transform_world_position",
                    "set_world_position",
                    "Deprecated alias of set_world_position.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema,
                    McpActionGovernance.TierAdvanced));
            registry.Register<SetTransformWorldRotationHandler>(
                "set_transform_world_rotation",
                CreateDeprecatedAliasCapability(
                    "set_transform_world_rotation",
                    "set_world_rotation",
                    "Deprecated alias of set_world_rotation.",
                    "target_required",
                    McpActionGovernance.DomainTransform,
                    vector3Schema,
                    McpActionGovernance.TierAdvanced));
            registry.Register<SetRectTransformAnchoredPositionHandler>(
                "set_rect_transform_anchored_position",
                CreateDeprecatedAliasCapability(
                    "set_rect_transform_anchored_position",
                    "set_rect_anchored_position",
                    "Deprecated alias of set_rect_anchored_position.",
                    "target_required",
                    McpActionGovernance.DomainRectTransform,
                    vector2Schema));
            registry.Register<SetRectTransformSizeDeltaHandler>(
                "set_rect_transform_size_delta",
                CreateDeprecatedAliasCapability(
                    "set_rect_transform_size_delta",
                    "set_rect_size_delta",
                    "Deprecated alias of set_rect_size_delta.",
                    "target_required",
                    McpActionGovernance.DomainRectTransform,
                    vector2Schema));
            registry.Register<SetRectTransformPivotHandler>(
                "set_rect_transform_pivot",
                CreateDeprecatedAliasCapability(
                    "set_rect_transform_pivot",
                    "set_rect_pivot",
                    "Deprecated alias of set_rect_pivot.",
                    "target_required",
                    McpActionGovernance.DomainRectTransform,
                    vector2Schema));
            registry.Register<SetRectTransformAnchorsHandler>(
                "set_rect_transform_anchors",
                CreateDeprecatedAliasCapability(
                    "set_rect_transform_anchors",
                    "set_rect_anchors",
                    "Deprecated alias of set_rect_anchors.",
                    "target_required",
                    McpActionGovernance.DomainRectTransform,
                    rectAnchorsSchema));

            registry.Register<SetCanvasGroupAlphaHandler>(
                "set_canvas_group_alpha",
                CreateCapability(
                    "set_canvas_group_alpha",
                    "Set CanvasGroup alpha in [0,1].",
                    "target_required",
                    McpActionGovernance.DomainUi,
                    SchemaObject(
                        new[] { "alpha" },
                        new SchemaProperty("alpha", "number", "Alpha in [0,1]."))));
            registry.Register<SetLayoutElementHandler>(
                "set_layout_element",
                CreateCapability(
                    "set_layout_element",
                    "Set LayoutElement width/height/flexible constraints.",
                    "target_required",
                    McpActionGovernance.DomainUi,
                    SchemaObject(
                        new[]
                        {
                            "min_width",
                            "min_height",
                            "preferred_width",
                            "preferred_height",
                            "flexible_width",
                            "flexible_height",
                            "ignore_layout",
                        },
                        new SchemaProperty("min_width", "number", "LayoutElement.minWidth."),
                        new SchemaProperty("min_height", "number", "LayoutElement.minHeight."),
                        new SchemaProperty("preferred_width", "number", "LayoutElement.preferredWidth."),
                        new SchemaProperty("preferred_height", "number", "LayoutElement.preferredHeight."),
                        new SchemaProperty("flexible_width", "number", "LayoutElement.flexibleWidth."),
                        new SchemaProperty("flexible_height", "number", "LayoutElement.flexibleHeight."),
                        new SchemaProperty("ignore_layout", "boolean", "LayoutElement.ignoreLayout.")),
                    McpActionGovernance.TierAdvanced));
        }

        private static void RegisterUiValuePack(McpActionRegistry registry)
        {
            registry.Register<SetUiImageColorHandler>(
                "set_ui_image_color",
                CreateCapability(
                    "set_ui_image_color",
                    "Set UnityEngine.UI.Image RGBA color.",
                    "target_required",
                    McpActionGovernance.DomainUi,
                    SchemaColor()));
            registry.Register<SetUiImageRaycastTargetHandler>(
                "set_ui_image_raycast_target",
                CreateCapability(
                    "set_ui_image_raycast_target",
                    "Set UnityEngine.UI.Image raycastTarget.",
                    "target_required",
                    McpActionGovernance.DomainUi,
                    SchemaObject(
                        new[] { "raycast_target" },
                        new SchemaProperty("raycast_target", "boolean", "Image.raycastTarget value."))));
            registry.Register<SetUiTextContentHandler>(
                "set_ui_text_content",
                CreateCapability(
                    "set_ui_text_content",
                    "Set Text/TMP_Text content string.",
                    "target_required",
                    McpActionGovernance.DomainUi,
                    SchemaObject(
                        new[] { "text" },
                        new SchemaProperty("text", "string", "Text content."))));
            registry.Register<SetUiTextColorHandler>(
                "set_ui_text_color",
                CreateCapability(
                    "set_ui_text_color",
                    "Set Text/TMP_Text RGBA color.",
                    "target_required",
                    McpActionGovernance.DomainUi,
                    SchemaColor()));
            registry.Register<SetUiTextFontSizeHandler>(
                "set_ui_text_font_size",
                CreateCapability(
                    "set_ui_text_font_size",
                    "Set Text/TMP_Text font size.",
                    "target_required",
                    McpActionGovernance.DomainUi,
                    SchemaObject(
                        new[] { "font_size" },
                        new SchemaProperty("font_size", "number", "Font size (>0)."))));
        }

        private static void RegisterCompositeAction(McpActionRegistry registry)
        {
            registry.Register(
                "composite_visual_action",
                new CompositeVisualActionHandler(registry),
                CreateCapability(
                    "composite_visual_action",
                    "Execute multiple visual steps atomically with alias references.",
                    "target_or_parent_required",
                    McpActionGovernance.DomainComposite,
                    SchemaObject(
                        new[] { "schema_version", "transaction_id", "steps" },
                        new SchemaProperty("schema_version", "string", "Composite payload schema version."),
                        new SchemaProperty("transaction_id", "string", "Composite transaction id."),
                        new SchemaProperty("atomic_mode", "string", "Atomic execution mode."),
                        new SchemaProperty("max_step_ms", "integer", "Per-step timeout in milliseconds."),
                        new SchemaProperty("steps", "array", "Composite step list.")),
                    McpActionGovernance.TierAdvanced));
        }

        private static McpActionCapability CreateCapability(
            string actionType,
            string description,
            string anchorPolicy,
            string domain,
            string actionDataSchemaJson,
            string tier = McpActionGovernance.TierCore,
            string lifecycle = McpActionGovernance.LifecycleStable,
            string undoSafety = McpActionGovernance.UndoSafetyAtomicSafe,
            string replacementActionType = "")
        {
            return new McpActionCapability(
                actionType,
                description,
                anchorPolicy,
                actionDataSchemaJson,
                domain,
                tier,
                lifecycle,
                undoSafety,
                replacementActionType);
        }

        private static McpActionCapability CreateDeprecatedAliasCapability(
            string actionType,
            string replacementActionType,
            string description,
            string anchorPolicy,
            string domain,
            string actionDataSchemaJson,
            string tier = McpActionGovernance.TierCore,
            string undoSafety = McpActionGovernance.UndoSafetyAtomicSafe)
        {
            return CreateCapability(
                actionType,
                description,
                anchorPolicy,
                domain,
                actionDataSchemaJson,
                tier,
                McpActionGovernance.LifecycleDeprecated,
                undoSafety,
                replacementActionType);
        }

        private static string SchemaVector3()
        {
            return SchemaObject(
                new[] { "x", "y", "z" },
                new SchemaProperty("x", "number", "X axis value."),
                new SchemaProperty("y", "number", "Y axis value."),
                new SchemaProperty("z", "number", "Z axis value."));
        }

        private static string SchemaVector2()
        {
            return SchemaObject(
                new[] { "x", "y" },
                new SchemaProperty("x", "number", "X axis value."),
                new SchemaProperty("y", "number", "Y axis value."));
        }

        private static string SchemaColor()
        {
            return SchemaObject(
                new[] { "r", "g", "b", "a" },
                new SchemaProperty("r", "number", "Red channel [0,1]."),
                new SchemaProperty("g", "number", "Green channel [0,1]."),
                new SchemaProperty("b", "number", "Blue channel [0,1]."),
                new SchemaProperty("a", "number", "Alpha channel [0,1]."));
        }

        private static string SchemaSetSerializedProperty()
        {
            return SchemaObject(
                new[] { "component_selector", "patches" },
                new SchemaProperty(
                    "component_selector",
                    "object",
                    "Component selector with component_assembly_qualified_name and optional component_index."),
                new SchemaProperty(
                    "patches",
                    "array",
                    "Ordered property patches with property_path/value_kind and typed value fields."),
                new SchemaProperty(
                    "object_ref",
                    "object",
                    "Object reference payload template used by patches[].object_ref."),
                new SchemaProperty(
                    "patches[].property_path",
                    "string",
                    "SerializedProperty path, for example m_Color or m_Items.Array.size."),
                new SchemaProperty(
                    "patches[].value_kind",
                    "string",
                    "One of integer/float/string/enum/vector2/vector3/color/array/object_reference."));
        }

        private static string SchemaObject(string[] required, params SchemaProperty[] properties)
        {
            var sb = new StringBuilder();
            sb.Append("{\"type\":\"object\"");

            if (required != null)
            {
                sb.Append(",\"required\":[");
                for (var i = 0; i < required.Length; i++)
                {
                    if (i > 0)
                    {
                        sb.Append(',');
                    }

                    sb.Append('\"');
                    sb.Append(EscapeJson(required[i]));
                    sb.Append('\"');
                }

                sb.Append(']');
            }

            sb.Append(",\"properties\":[");
            if (properties != null)
            {
                for (var i = 0; i < properties.Length; i++)
                {
                    if (i > 0)
                    {
                        sb.Append(',');
                    }

                    sb.Append("{\"name\":\"");
                    sb.Append(EscapeJson(properties[i].Name));
                    sb.Append("\",\"type\":\"");
                    sb.Append(EscapeJson(properties[i].Type));
                    sb.Append("\"");
                    if (!string.IsNullOrWhiteSpace(properties[i].Description))
                    {
                        sb.Append(",\"description\":\"");
                        sb.Append(EscapeJson(properties[i].Description));
                        sb.Append('\"');
                    }

                    sb.Append('}');
                }
            }

            sb.Append("]}");
            return sb.ToString();
        }

        private static string EscapeJson(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private struct SchemaProperty
        {
            public readonly string Name;
            public readonly string Type;
            public readonly string Description;

            public SchemaProperty(string name, string type, string description)
            {
                Name = string.IsNullOrWhiteSpace(name) ? string.Empty : name.Trim();
                Type = string.IsNullOrWhiteSpace(type) ? "string" : type.Trim();
                Description = string.IsNullOrWhiteSpace(description) ? string.Empty : description.Trim();
            }
        }
    }
}

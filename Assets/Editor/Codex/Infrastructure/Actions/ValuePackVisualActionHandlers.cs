using System;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    [Serializable]
    internal sealed class SetGameObjectActiveActionData
    {
        public bool active;
    }

    [Serializable]
    internal sealed class RenameGameObjectActionData
    {
        public string name;
    }

    [Serializable]
    internal sealed class EmptyActionData
    {
    }

    [Serializable]
    internal sealed class Vector3ActionData
    {
        public float x;
        public float y;
        public float z;
    }

    [Serializable]
    internal sealed class Vector2ActionData
    {
        public float x;
        public float y;
    }

    [Serializable]
    internal sealed class RectTransformAnchorsActionData
    {
        public float min_x;
        public float min_y;
        public float max_x;
        public float max_y;
    }

    [Serializable]
    internal sealed class ColorActionData
    {
        public float r;
        public float g;
        public float b;
        public float a;
    }

    [Serializable]
    internal sealed class TextContentActionData
    {
        public string text;
    }

    [Serializable]
    internal sealed class FontSizeActionData
    {
        public float font_size;
    }

    [Serializable]
    internal sealed class AlphaActionData
    {
        public float alpha;
    }

    [Serializable]
    internal sealed class ImageRaycastTargetActionData
    {
        public bool raycast_target;
    }

    [Serializable]
    internal sealed class LayoutElementActionData
    {
        public float min_width;
        public float min_height;
        public float preferred_width;
        public float preferred_height;
        public float flexible_width;
        public float flexible_height;
        public bool ignore_layout;
    }

    internal sealed class SetGameObjectActiveHandler
        : McpVisualActionHandler<SetGameObjectActiveActionData>
    {
        public override string ActionType
        {
            get { return "set_gameobject_active"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            SetGameObjectActiveActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var result = LegacyPrimitiveActionHandlers.RunSetGameObjectActive(action, data != null && data.active);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class RenameGameObjectHandler
        : McpVisualActionHandler<RenameGameObjectActionData>
    {
        public override string ActionType
        {
            get { return "rename_gameobject"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            RenameGameObjectActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            action.name =
                data != null && !string.IsNullOrWhiteSpace(data.name)
                    ? data.name.Trim()
                    : string.Empty;
            var result = LegacyPrimitiveActionHandlers.RunRenameGameObject(action, action.name);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class DestroyGameObjectHandler
        : McpVisualActionHandler<EmptyActionData>
    {
        public override string ActionType
        {
            get { return "destroy_gameobject"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            EmptyActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var result = LegacyPrimitiveActionHandlers.RunDestroyGameObject(action);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetTransformLocalPositionHandler
        : McpVisualActionHandler<Vector3ActionData>
    {
        public override string ActionType
        {
            get { return "set_transform_local_position"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            Vector3ActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var vector = new Vector3(
                data == null ? 0f : data.x,
                data == null ? 0f : data.y,
                data == null ? 0f : data.z);
            var result = LegacyPrimitiveActionHandlers.RunSetTransformLocalPosition(action, vector);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetTransformLocalRotationHandler
        : McpVisualActionHandler<Vector3ActionData>
    {
        public override string ActionType
        {
            get { return "set_transform_local_rotation"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            Vector3ActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var vector = new Vector3(
                data == null ? 0f : data.x,
                data == null ? 0f : data.y,
                data == null ? 0f : data.z);
            var result = LegacyPrimitiveActionHandlers.RunSetTransformLocalRotation(action, vector);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetTransformLocalScaleHandler
        : McpVisualActionHandler<Vector3ActionData>
    {
        public override string ActionType
        {
            get { return "set_transform_local_scale"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            Vector3ActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var vector = new Vector3(
                data == null ? 0f : data.x,
                data == null ? 0f : data.y,
                data == null ? 0f : data.z);
            var result = LegacyPrimitiveActionHandlers.RunSetTransformLocalScale(action, vector);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetTransformWorldPositionHandler
        : McpVisualActionHandler<Vector3ActionData>
    {
        public override string ActionType
        {
            get { return "set_transform_world_position"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            Vector3ActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var vector = new Vector3(
                data == null ? 0f : data.x,
                data == null ? 0f : data.y,
                data == null ? 0f : data.z);
            var result = LegacyPrimitiveActionHandlers.RunSetTransformWorldPosition(action, vector);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetTransformWorldRotationHandler
        : McpVisualActionHandler<Vector3ActionData>
    {
        public override string ActionType
        {
            get { return "set_transform_world_rotation"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            Vector3ActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var vector = new Vector3(
                data == null ? 0f : data.x,
                data == null ? 0f : data.y,
                data == null ? 0f : data.z);
            var result = LegacyPrimitiveActionHandlers.RunSetTransformWorldRotation(action, vector);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetRectTransformAnchoredPositionHandler
        : McpVisualActionHandler<Vector2ActionData>
    {
        public override string ActionType
        {
            get { return "set_rect_transform_anchored_position"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            Vector2ActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var value = new Vector2(
                data == null ? 0f : data.x,
                data == null ? 0f : data.y);
            var result = LegacyPrimitiveActionHandlers.RunSetRectTransformAnchoredPosition(action, value);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetRectTransformSizeDeltaHandler
        : McpVisualActionHandler<Vector2ActionData>
    {
        public override string ActionType
        {
            get { return "set_rect_transform_size_delta"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            Vector2ActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var value = new Vector2(
                data == null ? 0f : data.x,
                data == null ? 0f : data.y);
            var result = LegacyPrimitiveActionHandlers.RunSetRectTransformSizeDelta(action, value);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetRectTransformPivotHandler
        : McpVisualActionHandler<Vector2ActionData>
    {
        public override string ActionType
        {
            get { return "set_rect_transform_pivot"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            Vector2ActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var value = new Vector2(
                data == null ? 0f : data.x,
                data == null ? 0f : data.y);
            var result = LegacyPrimitiveActionHandlers.RunSetRectTransformPivot(action, value);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetRectTransformAnchorsHandler
        : McpVisualActionHandler<RectTransformAnchorsActionData>
    {
        public override string ActionType
        {
            get { return "set_rect_transform_anchors"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            RectTransformAnchorsActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var min = new Vector2(
                data == null ? 0f : data.min_x,
                data == null ? 0f : data.min_y);
            var max = new Vector2(
                data == null ? 1f : data.max_x,
                data == null ? 1f : data.max_y);
            var result = LegacyPrimitiveActionHandlers.RunSetRectTransformAnchors(action, min, max);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetUiImageColorHandler
        : McpVisualActionHandler<ColorActionData>
    {
        public override string ActionType
        {
            get { return "set_ui_image_color"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            ColorActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var color = new Color(
                data == null ? 0f : data.r,
                data == null ? 0f : data.g,
                data == null ? 0f : data.b,
                data == null ? 0f : data.a);
            var result = LegacyPrimitiveActionHandlers.RunSetUiImageColor(action, color);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetUiImageRaycastTargetHandler
        : McpVisualActionHandler<ImageRaycastTargetActionData>
    {
        public override string ActionType
        {
            get { return "set_ui_image_raycast_target"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            ImageRaycastTargetActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var result = LegacyPrimitiveActionHandlers.RunSetUiImageRaycastTarget(
                action,
                data != null && data.raycast_target);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetUiTextContentHandler
        : McpVisualActionHandler<TextContentActionData>
    {
        public override string ActionType
        {
            get { return "set_ui_text_content"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            TextContentActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var result = LegacyPrimitiveActionHandlers.RunSetUiTextContent(
                action,
                data == null ? string.Empty : data.text);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetUiTextColorHandler
        : McpVisualActionHandler<ColorActionData>
    {
        public override string ActionType
        {
            get { return "set_ui_text_color"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            ColorActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var color = new Color(
                data == null ? 0f : data.r,
                data == null ? 0f : data.g,
                data == null ? 0f : data.b,
                data == null ? 0f : data.a);
            var result = LegacyPrimitiveActionHandlers.RunSetUiTextColor(action, color);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetUiTextFontSizeHandler
        : McpVisualActionHandler<FontSizeActionData>
    {
        public override string ActionType
        {
            get { return "set_ui_text_font_size"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            FontSizeActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var result = LegacyPrimitiveActionHandlers.RunSetUiTextFontSize(
                action,
                data == null ? 0f : data.font_size);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetCanvasGroupAlphaHandler
        : McpVisualActionHandler<AlphaActionData>
    {
        public override string ActionType
        {
            get { return "set_canvas_group_alpha"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            AlphaActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var result = LegacyPrimitiveActionHandlers.RunSetCanvasGroupAlpha(
                action,
                data == null ? 0f : data.alpha);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class SetLayoutElementHandler
        : McpVisualActionHandler<LayoutElementActionData>
    {
        public override string ActionType
        {
            get { return "set_layout_element"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            LayoutElementActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            var result = LegacyPrimitiveActionHandlers.RunSetLayoutElement(
                action,
                data == null ? 0f : data.min_width,
                data == null ? 0f : data.min_height,
                data == null ? 0f : data.preferred_width,
                data == null ? 0f : data.preferred_height,
                data == null ? 0f : data.flexible_width,
                data == null ? 0f : data.flexible_height,
                data != null && data.ignore_layout);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }
}

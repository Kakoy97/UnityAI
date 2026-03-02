using System;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    internal static class McpBuiltInActionMapper
    {
        public static VisualLayerActionItem CloneAction(VisualLayerActionItem action)
        {
            if (action == null)
            {
                return new VisualLayerActionItem();
            }

            return new VisualLayerActionItem
            {
                type = action.type,
                target_anchor = CloneAnchor(action.target_anchor),
                parent_anchor = CloneAnchor(action.parent_anchor),
                target_anchor_ref = action.target_anchor_ref,
                parent_anchor_ref = action.parent_anchor_ref,
                action_data_json = action.action_data_json,
                component_assembly_qualified_name = action.component_assembly_qualified_name,
                source_component_assembly_qualified_name = action.source_component_assembly_qualified_name,
                name = action.name,
                primitive_type = action.primitive_type,
                ui_type = action.ui_type,
            };
        }

        private static UnityObjectAnchor CloneAnchor(UnityObjectAnchor anchor)
        {
            if (anchor == null)
            {
                return null;
            }

            return new UnityObjectAnchor
            {
                object_id = anchor.object_id,
                path = anchor.path,
            };
        }
    }

    [Serializable]
    internal sealed class AddComponentActionData
    {
        public string component_assembly_qualified_name;
    }

    [Serializable]
    internal sealed class RemoveComponentActionData
    {
        public string component_assembly_qualified_name;
    }

    [Serializable]
    internal sealed class ReplaceComponentActionData
    {
        public string source_component_assembly_qualified_name;
        public string component_assembly_qualified_name;
    }

    [Serializable]
    internal sealed class CreateGameObjectActionData
    {
        public string name;
        public string primitive_type;
        public string ui_type;
    }

    internal sealed class AddComponentHandler : McpVisualActionHandler<AddComponentActionData>
    {
        public override string ActionType
        {
            get { return "add_component"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            AddComponentActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            action.component_assembly_qualified_name =
                data != null && !string.IsNullOrWhiteSpace(data.component_assembly_qualified_name)
                    ? data.component_assembly_qualified_name.Trim()
                    : string.Empty;
            var result = LegacyPrimitiveActionHandlers.RunAddComponent(action);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class RemoveComponentHandler : McpVisualActionHandler<RemoveComponentActionData>
    {
        public override string ActionType
        {
            get { return "remove_component"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            RemoveComponentActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            action.component_assembly_qualified_name =
                data != null && !string.IsNullOrWhiteSpace(data.component_assembly_qualified_name)
                    ? data.component_assembly_qualified_name.Trim()
                    : string.Empty;
            var result = LegacyPrimitiveActionHandlers.RunRemoveComponent(action);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class ReplaceComponentHandler : McpVisualActionHandler<ReplaceComponentActionData>
    {
        public override string ActionType
        {
            get { return "replace_component"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            ReplaceComponentActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            action.source_component_assembly_qualified_name =
                data != null && !string.IsNullOrWhiteSpace(data.source_component_assembly_qualified_name)
                    ? data.source_component_assembly_qualified_name.Trim()
                    : string.Empty;
            action.component_assembly_qualified_name =
                data != null && !string.IsNullOrWhiteSpace(data.component_assembly_qualified_name)
                    ? data.component_assembly_qualified_name.Trim()
                    : string.Empty;
            var result = LegacyPrimitiveActionHandlers.RunReplaceComponent(action);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class CreateGameObjectHandler : McpVisualActionHandler<CreateGameObjectActionData>
    {
        public override string ActionType
        {
            get { return "create_gameobject"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            CreateGameObjectActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            action.name =
                data != null && !string.IsNullOrWhiteSpace(data.name)
                    ? data.name.Trim()
                    : string.Empty;
            action.primitive_type =
                data != null && !string.IsNullOrWhiteSpace(data.primitive_type)
                    ? data.primitive_type.Trim()
                    : string.Empty;
            action.ui_type =
                data != null && !string.IsNullOrWhiteSpace(data.ui_type)
                    ? data.ui_type.Trim()
                    : string.Empty;
            var result = LegacyPrimitiveActionHandlers.RunCreateGameObject(action);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }

    internal sealed class CreateObjectHandler : McpVisualActionHandler<CreateGameObjectActionData>
    {
        public override string ActionType
        {
            get { return "create_object"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            CreateGameObjectActionData data)
        {
            var action = McpBuiltInActionMapper.CloneAction(context == null ? null : context.RawAction);
            action.name =
                data != null && !string.IsNullOrWhiteSpace(data.name)
                    ? data.name.Trim()
                    : string.Empty;
            action.primitive_type =
                data != null && !string.IsNullOrWhiteSpace(data.primitive_type)
                    ? data.primitive_type.Trim()
                    : string.Empty;
            action.ui_type =
                data != null && !string.IsNullOrWhiteSpace(data.ui_type)
                    ? data.ui_type.Trim()
                    : string.Empty;
            var result = LegacyPrimitiveActionHandlers.RunCreateGameObject(action);
            return McpVisualActionExecutionResult.FromExecutionResult(result);
        }
    }
}

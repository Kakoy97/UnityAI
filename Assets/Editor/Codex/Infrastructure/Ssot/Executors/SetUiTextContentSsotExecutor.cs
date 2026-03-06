using System.Reflection;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetUiTextContentSsotExecutor
    {
        public SsotDispatchResponse Execute(SetUiTextContentRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_ui_text_content request payload is required.",
                    SetUiTextContentRequestDto.ToolName);
            }

            GameObject target;
            string errorCode;
            string errorMessage;
            if (!SsotExecutorCommon.TryResolveTargetFromAnchor(
                    request.target_path,
                    request.target_object_id,
                    out target,
                    out errorCode,
                    out errorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    errorCode,
                    errorMessage,
                    SetUiTextContentRequestDto.ToolName);
            }

            Component component;
            string componentType;
            if (!TrySetText(target, request.text ?? string.Empty, out component, out componentType))
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_ui_text_content requires Text or TMP_Text on target.",
                    SetUiTextContentRequestDto.ToolName);
            }

            EditorUtility.SetDirty(component);
            return SsotRequestDispatcher.Success(
                SetUiTextContentRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = componentType,
                    property_path = "text",
                    value_kind = "string",
                    value_string = request.text ?? string.Empty
                });
        }

        private static bool TrySetText(
            GameObject target,
            string text,
            out Component editedComponent,
            out string componentType)
        {
            editedComponent = null;
            componentType = string.Empty;

            var uiText = target.GetComponent<Text>();
            if (uiText != null)
            {
                Undo.RecordObject(uiText, "SSOT set_ui_text_content");
                uiText.text = text;
                editedComponent = uiText;
                componentType = typeof(Text).AssemblyQualifiedName;
                return true;
            }

            var components = target.GetComponents<Component>();
            for (var i = 0; i < components.Length; i += 1)
            {
                var component = components[i];
                if (component == null)
                {
                    continue;
                }

                var componentRuntimeType = component.GetType();
                if (!componentRuntimeType.FullName.StartsWith("TMPro.", System.StringComparison.Ordinal))
                {
                    continue;
                }

                var property = componentRuntimeType.GetProperty("text", BindingFlags.Public | BindingFlags.Instance);
                if (property == null || !property.CanWrite || property.PropertyType != typeof(string))
                {
                    continue;
                }

                Undo.RecordObject(component, "SSOT set_ui_text_content");
                property.SetValue(component, text, null);
                editedComponent = component;
                componentType = componentRuntimeType.AssemblyQualifiedName;
                return true;
            }

            return false;
        }
    }
}


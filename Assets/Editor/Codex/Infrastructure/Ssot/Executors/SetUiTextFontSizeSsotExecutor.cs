using System.Reflection;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetUiTextFontSizeSsotExecutor
    {
        public SsotDispatchResponse Execute(SetUiTextFontSizeRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_ui_text_font_size request payload is required.",
                    SetUiTextFontSizeRequestDto.ToolName);
            }

            if (!IsFinite(request.font_size) || request.font_size <= 0)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_ui_text_font_size requires font_size > 0.",
                    SetUiTextFontSizeRequestDto.ToolName);
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
                    SetUiTextFontSizeRequestDto.ToolName);
            }

            Component component;
            string componentType;
            if (!TrySetTextFontSize(target, request.font_size, out component, out componentType))
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_ui_text_font_size requires Text or TMP_Text on target.",
                    SetUiTextFontSizeRequestDto.ToolName);
            }

            EditorUtility.SetDirty(component);
            return SsotRequestDispatcher.Success(
                SetUiTextFontSizeRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = componentType,
                    property_path = "fontSize",
                    value_kind = "number",
                    value_number = request.font_size
                });
        }

        private static bool TrySetTextFontSize(
            GameObject target,
            double fontSize,
            out Component editedComponent,
            out string componentType)
        {
            editedComponent = null;
            componentType = string.Empty;

            var uiText = target.GetComponent<Text>();
            if (uiText != null)
            {
                Undo.RecordObject(uiText, "SSOT set_ui_text_font_size");
                uiText.fontSize = Mathf.Max(1, Mathf.RoundToInt((float)fontSize));
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

                var property = componentRuntimeType.GetProperty("fontSize", BindingFlags.Public | BindingFlags.Instance);
                if (property == null || !property.CanWrite)
                {
                    continue;
                }

                object convertedValue;
                if (property.PropertyType == typeof(float))
                {
                    convertedValue = (float)fontSize;
                }
                else if (property.PropertyType == typeof(double))
                {
                    convertedValue = fontSize;
                }
                else if (property.PropertyType == typeof(int))
                {
                    convertedValue = Mathf.Max(1, Mathf.RoundToInt((float)fontSize));
                }
                else
                {
                    continue;
                }

                Undo.RecordObject(component, "SSOT set_ui_text_font_size");
                property.SetValue(component, convertedValue, null);
                editedComponent = component;
                componentType = componentRuntimeType.AssemblyQualifiedName;
                return true;
            }

            return false;
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


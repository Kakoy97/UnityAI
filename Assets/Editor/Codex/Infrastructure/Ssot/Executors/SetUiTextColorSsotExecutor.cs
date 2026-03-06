using System.Reflection;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetUiTextColorSsotExecutor
    {
        public SsotDispatchResponse Execute(SetUiTextColorRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_ui_text_color request payload is required.",
                    SetUiTextColorRequestDto.ToolName);
            }

            if (!IsFinite(request.r) ||
                !IsFinite(request.g) ||
                !IsFinite(request.b) ||
                !IsFinite(request.a))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_ui_text_color requires finite rgba values.",
                    SetUiTextColorRequestDto.ToolName);
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
                    SetUiTextColorRequestDto.ToolName);
            }

            var nextColor = new Color(
                (float)request.r,
                (float)request.g,
                (float)request.b,
                (float)request.a);

            Component component;
            string componentType;
            if (!TrySetTextColor(target, nextColor, out component, out componentType))
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_ui_text_color requires Text or TMP_Text on target.",
                    SetUiTextColorRequestDto.ToolName);
            }

            EditorUtility.SetDirty(component);
            return SsotRequestDispatcher.Success(
                SetUiTextColorRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = componentType,
                    property_path = "color",
                    value_kind = "color",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1},{2},{3}",
                        request.r,
                        request.g,
                        request.b,
                        request.a)
                });
        }

        private static bool TrySetTextColor(
            GameObject target,
            Color color,
            out Component editedComponent,
            out string componentType)
        {
            editedComponent = null;
            componentType = string.Empty;

            var uiText = target.GetComponent<Text>();
            if (uiText != null)
            {
                Undo.RecordObject(uiText, "SSOT set_ui_text_color");
                uiText.color = color;
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

                var property = componentRuntimeType.GetProperty("color", BindingFlags.Public | BindingFlags.Instance);
                if (property == null || !property.CanWrite || property.PropertyType != typeof(Color))
                {
                    continue;
                }

                Undo.RecordObject(component, "SSOT set_ui_text_color");
                property.SetValue(component, color, null);
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


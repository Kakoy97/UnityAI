using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetComponentPropertiesSsotExecutor
    {
        public SsotDispatchResponse Execute(SetComponentPropertiesRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_component_properties request payload is required.",
                    SetComponentPropertiesRequestDto.ToolName);
            }

            var componentType = SsotExecutorCommon.Normalize(request.component_type);
            var propertyPath = SsotExecutorCommon.Normalize(request.property_path);
            var valueKind = SsotExecutorCommon.Normalize(request.value_kind).ToLowerInvariant();
            if (string.IsNullOrEmpty(componentType) ||
                string.IsNullOrEmpty(propertyPath) ||
                string.IsNullOrEmpty(valueKind))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_component_properties requires target_path, target_object_id, component_type, property_path, and value_kind.",
                    SetComponentPropertiesRequestDto.ToolName);
            }

            if (string.Equals(valueKind, "number", StringComparison.Ordinal) &&
                !IsFinite(request.value_number))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_component_properties value_number must be a finite number.",
                    SetComponentPropertiesRequestDto.ToolName);
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
                    SetComponentPropertiesRequestDto.ToolName);
            }

            var component = ResolveComponent(target, componentType);
            if (component == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "Component not found on target: " + componentType,
                    SetComponentPropertiesRequestDto.ToolName);
            }

            var serializedObject = new SerializedObject(component);
            var property = serializedObject.FindProperty(propertyPath);
            if (property == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_PROPERTY_NOT_FOUND",
                    "SerializedProperty not found: " + propertyPath,
                    SetComponentPropertiesRequestDto.ToolName);
            }

            string assignError;
            if (!TryAssignValue(property, request, valueKind, out assignError))
            {
                return SsotRequestDispatcher.Failure(
                    "E_PROPERTY_TYPE_MISMATCH",
                    assignError,
                    SetComponentPropertiesRequestDto.ToolName);
            }

            Undo.RecordObject(component, "SSOT set_component_properties");
            serializedObject.ApplyModifiedProperties();
            EditorUtility.SetDirty(component);

            return SsotRequestDispatcher.Success(
                SetComponentPropertiesRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = component.GetType().AssemblyQualifiedName,
                    property_path = property.propertyPath,
                    value_kind = valueKind,
                    value_string = string.Equals(valueKind, "string", StringComparison.Ordinal)
                        ? (request.value_string ?? string.Empty)
                        : string.Empty,
                    value_number = string.Equals(valueKind, "number", StringComparison.Ordinal)
                        ? request.value_number
                        : 0d,
                    value_boolean = string.Equals(valueKind, "boolean", StringComparison.Ordinal) &&
                        request.value_boolean
                });
        }

        private static bool TryAssignValue(
            SerializedProperty property,
            SetComponentPropertiesRequestDto request,
            string valueKind,
            out string errorMessage)
        {
            errorMessage = string.Empty;

            if (string.Equals(valueKind, "string", StringComparison.Ordinal))
            {
                if (property.propertyType != SerializedPropertyType.String)
                {
                    errorMessage = "Target property is not a string.";
                    return false;
                }

                property.stringValue = request.value_string ?? string.Empty;
                return true;
            }

            if (string.Equals(valueKind, "boolean", StringComparison.Ordinal))
            {
                if (property.propertyType != SerializedPropertyType.Boolean)
                {
                    errorMessage = "Target property is not a boolean.";
                    return false;
                }

                property.boolValue = request.value_boolean;
                return true;
            }

            if (string.Equals(valueKind, "number", StringComparison.Ordinal))
            {
                if (property.propertyType == SerializedPropertyType.Float)
                {
                    property.floatValue = (float)request.value_number;
                    return true;
                }

                if (property.propertyType == SerializedPropertyType.Integer ||
                    property.propertyType == SerializedPropertyType.ArraySize)
                {
                    property.intValue = Convert.ToInt32(Math.Round(request.value_number));
                    return true;
                }

                errorMessage = "Target property is not a numeric SerializedProperty.";
                return false;
            }

            errorMessage = "Unsupported value_kind: " + valueKind;
            return false;
        }

        private static Component ResolveComponent(GameObject target, string componentType)
        {
            if (target == null)
            {
                return null;
            }

            var normalizedType = SsotExecutorCommon.Normalize(componentType);
            if (string.IsNullOrEmpty(normalizedType))
            {
                return null;
            }

            var targetType = Type.GetType(normalizedType, false);
            var components = target.GetComponents<Component>();
            for (var i = 0; i < components.Length; i += 1)
            {
                var component = components[i];
                if (component == null)
                {
                    continue;
                }

                var componentTypeInstance = component.GetType();
                if (targetType != null &&
                    (ReferenceEquals(componentTypeInstance, targetType) ||
                     targetType.IsAssignableFrom(componentTypeInstance)))
                {
                    return component;
                }

                if (string.Equals(
                        SsotExecutorCommon.Normalize(componentTypeInstance.AssemblyQualifiedName),
                        normalizedType,
                        StringComparison.Ordinal) ||
                    string.Equals(
                        SsotExecutorCommon.Normalize(componentTypeInstance.FullName),
                        normalizedType,
                        StringComparison.Ordinal))
                {
                    return component;
                }
            }

            return null;
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}

using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetSerializedPropertySsotExecutor
    {
        public SsotDispatchResponse Execute(SetSerializedPropertyRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_serialized_property request payload is required.",
                    SetSerializedPropertyRequestDto.ToolName);
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
                    "set_serialized_property requires component_type, property_path, and value_kind.",
                    SetSerializedPropertyRequestDto.ToolName);
            }

            if (string.Equals(valueKind, "float", StringComparison.Ordinal) &&
                (!IsFinite(request.float_value)))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_serialized_property float_value must be finite.",
                    SetSerializedPropertyRequestDto.ToolName);
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
                    SetSerializedPropertyRequestDto.ToolName);
            }

            Component component;
            if (!TryResolveComponent(
                    target,
                    componentType,
                    request.component_index,
                    out component,
                    out errorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    errorMessage,
                    SetSerializedPropertyRequestDto.ToolName);
            }

            var serializedObject = new SerializedObject(component);
            var property = serializedObject.FindProperty(propertyPath);
            if (property == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_PROPERTY_NOT_FOUND",
                    "SerializedProperty not found: " + propertyPath,
                    SetSerializedPropertyRequestDto.ToolName);
            }

            if (!TryAssignValue(property, request, valueKind, out errorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    "E_PROPERTY_TYPE_MISMATCH",
                    errorMessage,
                    SetSerializedPropertyRequestDto.ToolName);
            }

            if (!request.dry_run)
            {
                Undo.RecordObject(component, "SSOT set_serialized_property");
                serializedObject.ApplyModifiedProperties();
                EditorUtility.SetDirty(component);
            }

            return SsotRequestDispatcher.Success(
                SetSerializedPropertyRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = component.GetType().AssemblyQualifiedName,
                    property_path = property.propertyPath,
                    value_kind = valueKind,
                    value_string = string.Equals(valueKind, "string", StringComparison.Ordinal)
                        ? (request.string_value ?? string.Empty)
                        : string.Empty,
                    value_number = string.Equals(valueKind, "float", StringComparison.Ordinal)
                        ? request.float_value
                        : string.Equals(valueKind, "integer", StringComparison.Ordinal)
                            ? request.int_value
                            : 0d,
                    value_boolean = string.Equals(valueKind, "bool", StringComparison.Ordinal) &&
                        request.bool_value
                });
        }

        private static bool TryAssignValue(
            SerializedProperty property,
            SetSerializedPropertyRequestDto request,
            string valueKind,
            out string errorMessage)
        {
            errorMessage = string.Empty;

            if (string.Equals(valueKind, "integer", StringComparison.Ordinal))
            {
                if (property.propertyType != SerializedPropertyType.Integer &&
                    property.propertyType != SerializedPropertyType.ArraySize)
                {
                    errorMessage = "Target property is not an integer SerializedProperty.";
                    return false;
                }

                property.intValue = request.int_value;
                return true;
            }

            if (string.Equals(valueKind, "float", StringComparison.Ordinal))
            {
                if (property.propertyType != SerializedPropertyType.Float)
                {
                    errorMessage = "Target property is not a float SerializedProperty.";
                    return false;
                }

                property.floatValue = (float)request.float_value;
                return true;
            }

            if (string.Equals(valueKind, "string", StringComparison.Ordinal))
            {
                if (property.propertyType != SerializedPropertyType.String)
                {
                    errorMessage = "Target property is not a string SerializedProperty.";
                    return false;
                }

                property.stringValue = request.string_value ?? string.Empty;
                return true;
            }

            if (string.Equals(valueKind, "bool", StringComparison.Ordinal))
            {
                if (property.propertyType != SerializedPropertyType.Boolean)
                {
                    errorMessage = "Target property is not a bool SerializedProperty.";
                    return false;
                }

                property.boolValue = request.bool_value;
                return true;
            }

            errorMessage = "Unsupported value_kind: " + valueKind;
            return false;
        }

        private static bool TryResolveComponent(
            GameObject target,
            string componentTypeName,
            int componentIndex,
            out Component component,
            out string errorMessage)
        {
            component = null;
            errorMessage = string.Empty;
            if (target == null)
            {
                errorMessage = "Target object is required.";
                return false;
            }

            var normalizedType = SsotExecutorCommon.Normalize(componentTypeName);
            if (string.IsNullOrEmpty(normalizedType))
            {
                errorMessage = "component_type is required.";
                return false;
            }

            var targetType = ResolveComponentType(normalizedType);
            var matches = target.GetComponents<Component>();
            if (matches == null || matches.Length == 0)
            {
                errorMessage = "Target has no components.";
                return false;
            }

            var filtered = new System.Collections.Generic.List<Component>(matches.Length);
            for (var i = 0; i < matches.Length; i += 1)
            {
                var current = matches[i];
                if (current == null)
                {
                    continue;
                }

                var currentType = current.GetType();
                if (targetType != null &&
                    (ReferenceEquals(currentType, targetType) ||
                     targetType.IsAssignableFrom(currentType)))
                {
                    filtered.Add(current);
                    continue;
                }

                if (string.Equals(currentType.AssemblyQualifiedName, normalizedType, StringComparison.Ordinal) ||
                    string.Equals(currentType.FullName, normalizedType, StringComparison.Ordinal) ||
                    string.Equals(currentType.Name, normalizedType, StringComparison.Ordinal))
                {
                    filtered.Add(current);
                }
            }

            if (filtered.Count == 0)
            {
                errorMessage = "Component not found on target: " + normalizedType;
                return false;
            }

            var normalizedIndex = componentIndex < 0 ? 0 : componentIndex;
            if (normalizedIndex >= filtered.Count)
            {
                errorMessage = "component_index is out of range for matched components.";
                return false;
            }

            component = filtered[normalizedIndex];
            return component != null;
        }

        private static Type ResolveComponentType(string componentTypeName)
        {
            var direct = Type.GetType(componentTypeName, false);
            if (direct != null)
            {
                return direct;
            }

            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (var i = 0; i < assemblies.Length; i += 1)
            {
                var candidate = assemblies[i].GetType(componentTypeName, false);
                if (candidate != null)
                {
                    return candidate;
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

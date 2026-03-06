using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

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

            var targetPath = Normalize(request.target_path);
            var targetObjectId = Normalize(request.target_object_id);
            var componentType = Normalize(request.component_type);
            var propertyPath = Normalize(request.property_path);
            var valueKind = Normalize(request.value_kind).ToLowerInvariant();

            if (string.IsNullOrEmpty(targetPath) ||
                string.IsNullOrEmpty(targetObjectId) ||
                string.IsNullOrEmpty(componentType) ||
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

            var targetByPath = FindGameObjectByScenePath(targetPath);
            var targetByObjectId = FindGameObjectByObjectId(targetObjectId);
            if (targetByPath == null && targetByObjectId == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_NOT_FOUND",
                    "Target object not found for set_component_properties.",
                    SetComponentPropertiesRequestDto.ToolName);
            }

            if (targetByPath != null &&
                targetByObjectId != null &&
                !ReferenceEquals(targetByPath, targetByObjectId))
            {
                return SsotRequestDispatcher.Failure(
                    "E_TARGET_ANCHOR_CONFLICT",
                    "target_path and target_object_id resolve to different objects.",
                    SetComponentPropertiesRequestDto.ToolName);
            }

            var target = targetByPath ?? targetByObjectId;
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
                    target_object_id = BuildObjectId(target),
                    target_path = BuildScenePath(target),
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

            var normalizedType = Normalize(componentType);
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
                        Normalize(componentTypeInstance.AssemblyQualifiedName),
                        normalizedType,
                        StringComparison.Ordinal) ||
                    string.Equals(
                        Normalize(componentTypeInstance.FullName),
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

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static string BuildObjectId(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            try
            {
                var globalId = GlobalObjectId.GetGlobalObjectIdSlow(gameObject);
                return globalId.ToString();
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string BuildScenePath(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            var transform = target.transform;
            var path = transform.name;
            while (transform.parent != null)
            {
                transform = transform.parent;
                path = transform.name + "/" + path;
            }

            return "Scene/" + path;
        }

        private static GameObject FindGameObjectByObjectId(string objectId)
        {
            var normalized = Normalize(objectId);
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            GlobalObjectId parsed;
            if (!GlobalObjectId.TryParse(normalized, out parsed))
            {
                return null;
            }

            return GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed) as GameObject;
        }

        private static GameObject FindGameObjectByScenePath(string scenePath)
        {
            var normalized = Normalize(scenePath).Replace('\\', '/');
            if (normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = normalized.Substring("Scene/".Length);
            }

            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            var segments = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (segments == null || segments.Length == 0)
            {
                return null;
            }

            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex += 1)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var i = 0; i < roots.Length; i += 1)
                {
                    var root = roots[i];
                    if (root == null || !string.Equals(root.name, segments[0], StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var found = FindChildByPathSegments(root.transform, segments, 1);
                    if (found != null)
                    {
                        return found.gameObject;
                    }
                }
            }

            return null;
        }

        private static Transform FindChildByPathSegments(Transform current, string[] segments, int index)
        {
            if (current == null || segments == null)
            {
                return null;
            }

            if (index >= segments.Length)
            {
                return current;
            }

            for (var i = 0; i < current.childCount; i += 1)
            {
                var child = current.GetChild(i);
                if (child == null || !string.Equals(child.name, segments[index], StringComparison.Ordinal))
                {
                    continue;
                }

                var found = FindChildByPathSegments(child, segments, index + 1);
                if (found != null)
                {
                    return found;
                }
            }

            return null;
        }
    }
}

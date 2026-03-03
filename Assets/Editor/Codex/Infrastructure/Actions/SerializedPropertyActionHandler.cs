using System;
using System.Collections.Generic;
using System.Reflection;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    internal sealed class SerializedPropertyActionHandler
        : McpVisualActionHandler<SerializedPropertyActionData>
    {
        private const int MaxPatchesPerAction = 64;
        private readonly SerializedObjectReferenceResolver _objectReferenceResolver;

        public SerializedPropertyActionHandler()
            : this(new SerializedObjectReferenceResolver())
        {
        }

        internal SerializedPropertyActionHandler(SerializedObjectReferenceResolver objectReferenceResolver)
        {
            _objectReferenceResolver = objectReferenceResolver ?? new SerializedObjectReferenceResolver();
        }

        public override string ActionType
        {
            get { return "set_serialized_property"; }
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            SerializedPropertyActionData data)
        {
            var action = context == null ? null : context.RawAction;
            var result = BuildInitialResult(action);

            string errorCode;
            string errorMessage;
            var target = ResolveTargetGameObject(action, out errorCode, out errorMessage);
            if (target == null)
            {
                return McpVisualActionExecutionResult.FromExecutionResult(
                    Fail(result, errorCode, errorMessage));
            }

            if (data == null)
            {
                return McpVisualActionExecutionResult.FromExecutionResult(
                    Fail(result, "E_ACTION_SCHEMA_INVALID", "action_data payload is required."));
            }

            var component = ResolveComponent(target, data.component_selector, out errorCode, out errorMessage);
            if (component == null)
            {
                return McpVisualActionExecutionResult.FromExecutionResult(
                    Fail(result, errorCode, errorMessage));
            }

            var patches = data.patches;
            if (patches == null || patches.Length == 0)
            {
                return McpVisualActionExecutionResult.FromExecutionResult(
                    Fail(result, "E_ACTION_SCHEMA_INVALID", "patches must be a non-empty array."));
            }
            if (patches.Length > MaxPatchesPerAction)
            {
                return McpVisualActionExecutionResult.FromExecutionResult(
                    Fail(
                        result,
                        "E_ACTION_SCHEMA_INVALID",
                        "patches length exceeds max allowed " + MaxPatchesPerAction + "."));
            }

            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.componentAssemblyQualifiedName = component.GetType().AssemblyQualifiedName;
            var dryRun = data.dry_run;

            try
            {
                var serializedObject = new SerializedObject(component);
                var dryRunPatchResults = dryRun
                    ? new List<SerializedPropertyPatchResultItem>(patches.Length)
                    : null;
                if (!dryRun)
                {
                    Undo.RecordObject(component, "Codex set_serialized_property");
                }

                for (var i = 0; i < patches.Length; i++)
                {
                    var patch = patches[i];
                    if (!TryApplyPatch(component, serializedObject, patch, i, out errorCode, out errorMessage))
                    {
                        if (dryRunPatchResults != null)
                        {
                            dryRunPatchResults.Add(
                                BuildPatchResultItem(
                                    patch,
                                    i,
                                    "error",
                                    errorCode,
                                    errorMessage));
                            AppendSkippedPatchResults(dryRunPatchResults, patches, i + 1);
                            result.resultData = BuildDryRunResultData(
                                dryRunPatchResults,
                                false);
                        }
                        serializedObject.Update();
                        return McpVisualActionExecutionResult.FromExecutionResult(
                            Fail(result, errorCode, errorMessage));
                    }
                    if (dryRunPatchResults != null)
                    {
                        dryRunPatchResults.Add(
                            BuildPatchResultItem(
                                patch,
                                i,
                                "ok",
                                string.Empty,
                                string.Empty));
                    }
                }

                if (dryRun)
                {
                    serializedObject.Update();
                    result.resultData = BuildDryRunResultData(dryRunPatchResults, true);
                    return McpVisualActionExecutionResult.FromExecutionResult(Succeed(result));
                }

                var applied = serializedObject.ApplyModifiedProperties();
                if (applied)
                {
                    EditorUtility.SetDirty(component);
                    if (target.scene.IsValid() && target.scene.isLoaded)
                    {
                        EditorSceneManager.MarkSceneDirty(target.scene);
                    }
                }

                return McpVisualActionExecutionResult.FromExecutionResult(Succeed(result));
            }
            catch (Exception ex)
            {
                return McpVisualActionExecutionResult.FromExecutionResult(
                    Fail(result, "E_ACTION_EXECUTION_FAILED", NormalizeExceptionMessage(ex)));
            }
        }

        private bool TryApplyPatch(
            Component component,
            SerializedObject serializedObject,
            SerializedPropertyPatchItem patch,
            int patchIndex,
            out string errorCode,
            out string errorMessage)
        {
            var itemPath = "patches[" + patchIndex + "]";
            if (patch == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = itemPath + " is required.";
                return false;
            }

            var propertyPath = NormalizeNonEmpty(patch.property_path);
            if (string.IsNullOrEmpty(propertyPath))
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = itemPath + ".property_path is required.";
                return false;
            }

            var property = serializedObject.FindProperty(propertyPath);
            if (property == null)
            {
                errorCode = "E_ACTION_PROPERTY_NOT_FOUND";
                errorMessage = "SerializedProperty not found: " + propertyPath;
                return false;
            }

            var kind = NormalizeLower(patch.value_kind);
            if (string.IsNullOrEmpty(kind))
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = itemPath + ".value_kind is required.";
                return false;
            }

            string restrictionReason;
            if (TryGetWriteRestrictionReason(serializedObject, property, out restrictionReason))
            {
                errorCode = "E_ACTION_PROPERTY_WRITE_RESTRICTED";
                errorMessage =
                    "Property " +
                    propertyPath +
                    " is write-restricted for set_serialized_property: " +
                    restrictionReason +
                    ".";
                return false;
            }

            if (kind == "integer")
            {
                if (property.propertyType != SerializedPropertyType.Integer &&
                    property.propertyType != SerializedPropertyType.ArraySize)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Integer.";
                    return false;
                }

                property.intValue = patch.int_value;
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "float")
            {
                if (property.propertyType != SerializedPropertyType.Float)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Float.";
                    return false;
                }

                property.floatValue = patch.float_value;
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "string")
            {
                if (property.propertyType != SerializedPropertyType.String)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not String.";
                    return false;
                }

                property.stringValue = patch.string_value ?? string.Empty;
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "bool")
            {
                if (property.propertyType != SerializedPropertyType.Boolean)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Boolean.";
                    return false;
                }

                property.boolValue = patch.bool_value;
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "enum")
            {
                if (property.propertyType != SerializedPropertyType.Enum)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Enum.";
                    return false;
                }

                var enumIndex = ResolveEnumIndex(property, patch.enum_name, patch.enum_value);
                if (enumIndex < 0 || enumIndex >= property.enumNames.Length)
                {
                    errorCode = "E_ACTION_PROPERTY_ENUM_INVALID";
                    errorMessage = "Enum value is invalid for property: " + propertyPath;
                    return false;
                }

                property.enumValueIndex = enumIndex;
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "quaternion")
            {
                if (property.propertyType != SerializedPropertyType.Quaternion)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Quaternion.";
                    return false;
                }

                property.quaternionValue = new Quaternion(
                    patch.quaternion_value == null ? 0f : patch.quaternion_value.x,
                    patch.quaternion_value == null ? 0f : patch.quaternion_value.y,
                    patch.quaternion_value == null ? 0f : patch.quaternion_value.z,
                    patch.quaternion_value == null ? 1f : patch.quaternion_value.w);
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "vector4")
            {
                if (property.propertyType != SerializedPropertyType.Vector4)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Vector4.";
                    return false;
                }

                property.vector4Value = new Vector4(
                    patch.vector4_value == null ? 0f : patch.vector4_value.x,
                    patch.vector4_value == null ? 0f : patch.vector4_value.y,
                    patch.vector4_value == null ? 0f : patch.vector4_value.z,
                    patch.vector4_value == null ? 0f : patch.vector4_value.w);
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "vector2")
            {
                if (property.propertyType != SerializedPropertyType.Vector2)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Vector2.";
                    return false;
                }

                property.vector2Value = new Vector2(
                    patch.vector2_value == null ? 0f : patch.vector2_value.x,
                    patch.vector2_value == null ? 0f : patch.vector2_value.y);
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "rect")
            {
                if (property.propertyType != SerializedPropertyType.Rect)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Rect.";
                    return false;
                }

                property.rectValue = new Rect(
                    patch.rect_value == null ? 0f : patch.rect_value.x,
                    patch.rect_value == null ? 0f : patch.rect_value.y,
                    patch.rect_value == null ? 0f : patch.rect_value.width,
                    patch.rect_value == null ? 0f : patch.rect_value.height);
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "vector3")
            {
                if (property.propertyType != SerializedPropertyType.Vector3)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Vector3.";
                    return false;
                }

                property.vector3Value = new Vector3(
                    patch.vector3_value == null ? 0f : patch.vector3_value.x,
                    patch.vector3_value == null ? 0f : patch.vector3_value.y,
                    patch.vector3_value == null ? 0f : patch.vector3_value.z);
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "color")
            {
                if (property.propertyType != SerializedPropertyType.Color)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not Color.";
                    return false;
                }

                property.colorValue = new Color(
                    patch.color_value == null ? 0f : patch.color_value.r,
                    patch.color_value == null ? 0f : patch.color_value.g,
                    patch.color_value == null ? 0f : patch.color_value.b,
                    patch.color_value == null ? 0f : patch.color_value.a);
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "array")
            {
                var op = NormalizeLower(patch.op);
                if (string.IsNullOrEmpty(op))
                {
                    op = "set";
                }

                if (op == "set")
                {
                    var size = patch.array_size < 0 ? 0 : patch.array_size;
                    if (property.isArray && property.propertyType != SerializedPropertyType.String)
                    {
                        property.arraySize = size;
                        errorCode = string.Empty;
                        errorMessage = string.Empty;
                        return true;
                    }

                    if (property.propertyType == SerializedPropertyType.ArraySize ||
                        property.propertyType == SerializedPropertyType.Integer)
                    {
                        property.intValue = size;
                        errorCode = string.Empty;
                        errorMessage = string.Empty;
                        return true;
                    }

                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage = "Property " + propertyPath + " is not an array size field.";
                    return false;
                }

                if (!property.isArray || property.propertyType == SerializedPropertyType.String)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage = "Property " + propertyPath + " is not an array field.";
                    return false;
                }

                if (op == "insert")
                {
                    var index = patch.index;
                    if (index < 0 || index > property.arraySize)
                    {
                        errorCode = "E_ACTION_SCHEMA_INVALID";
                        errorMessage = itemPath + ".index must be in [0," + property.arraySize + "].";
                        return false;
                    }

                    property.InsertArrayElementAtIndex(index);
                    errorCode = string.Empty;
                    errorMessage = string.Empty;
                    return true;
                }

                if (op == "remove")
                {
                    int[] removeIndices;
                    if (!TryResolveArrayRemoveIndices(patch, out removeIndices, out errorMessage))
                    {
                        errorCode = "E_ACTION_SCHEMA_INVALID";
                        return false;
                    }

                    for (var i = removeIndices.Length - 1; i >= 0; i--)
                    {
                        var removeIndex = removeIndices[i];
                        if (removeIndex < 0 || removeIndex >= property.arraySize)
                        {
                            errorCode = "E_ACTION_SCHEMA_INVALID";
                            errorMessage =
                                itemPath + ".indices contains out-of-range index " +
                                removeIndex +
                                ", current_size=" +
                                property.arraySize +
                                ".";
                            return false;
                        }

                        DeleteArrayElementAtIndex(property, removeIndex);
                    }

                    errorCode = string.Empty;
                    errorMessage = string.Empty;
                    return true;
                }

                if (op == "clear")
                {
                    property.arraySize = 0;
                    errorCode = string.Empty;
                    errorMessage = string.Empty;
                    return true;
                }

                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = itemPath + ".op is unsupported for value_kind=array: " + op;
                return false;
            }

            if (kind == "object_reference")
            {
                if (property.propertyType != SerializedPropertyType.ObjectReference)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not ObjectReference.";
                    return false;
                }

                Type expectedType;
                if (!TryResolveObjectReferenceExpectedType(component, propertyPath, out expectedType))
                {
                    expectedType = typeof(UnityEngine.Object);
                }

                UnityEngine.Object resolved;
                if (!_objectReferenceResolver.TryResolve(
                        patch.object_ref,
                        expectedType,
                        out resolved,
                        out errorCode,
                        out errorMessage))
                {
                    return false;
                }

                property.objectReferenceValue = resolved;
                if (resolved != null && !ReferenceEquals(property.objectReferenceValue, resolved))
                {
                    errorCode = "E_OBJECT_REF_TYPE_MISMATCH";
                    errorMessage =
                        "Object reference assignment rejected by SerializedProperty. expected=" +
                        (expectedType == null ? "UnityEngine.Object" : expectedType.FullName) +
                        ", actual=" +
                        resolved.GetType().FullName;
                    return false;
                }

                errorCode = string.Empty;
                errorMessage = string.Empty;
                return true;
            }

            if (kind == "animation_curve")
            {
                if (property.propertyType != SerializedPropertyType.AnimationCurve)
                {
                    errorCode = "E_ACTION_PROPERTY_TYPE_MISMATCH";
                    errorMessage =
                        "Property " + propertyPath + " is " + property.propertyType + ", not AnimationCurve.";
                    return false;
                }

                errorCode = "E_ACTION_PROPERTY_WRITE_RESTRICTED";
                errorMessage =
                    "Property " +
                    propertyPath +
                    " is write-restricted for set_serialized_property: AnimationCurve is read-only in this phase.";
                return false;
            }

            errorCode = "E_ACTION_SCHEMA_INVALID";
            errorMessage = itemPath + ".value_kind is unsupported: " + kind;
            return false;
        }

        private static bool TryGetWriteRestrictionReason(
            SerializedObject serializedObject,
            SerializedProperty property,
            out string restrictionReason)
        {
            restrictionReason = string.Empty;
            if (property == null)
            {
                return false;
            }

            if (property.propertyType == SerializedPropertyType.AnimationCurve)
            {
                restrictionReason = "AnimationCurve is read-only in this phase";
                return true;
            }

            if (property.propertyType == SerializedPropertyType.ManagedReference)
            {
                restrictionReason = "ManagedReference root is read-only";
                return true;
            }

            if (IsUnderManagedReference(serializedObject, property.propertyPath))
            {
                restrictionReason = "fields under ManagedReference are read-only";
                return true;
            }

            return false;
        }

        private static bool IsUnderManagedReference(
            SerializedObject serializedObject,
            string propertyPath)
        {
            if (serializedObject == null || string.IsNullOrWhiteSpace(propertyPath))
            {
                return false;
            }

            var currentPath = propertyPath;
            while (TryGetParentPropertyPath(currentPath, out currentPath))
            {
                var parent = serializedObject.FindProperty(currentPath);
                if (parent == null)
                {
                    continue;
                }

                if (parent.propertyType == SerializedPropertyType.ManagedReference)
                {
                    return true;
                }
            }

            return false;
        }

        private static bool TryGetParentPropertyPath(string propertyPath, out string parentPath)
        {
            parentPath = string.Empty;
            if (string.IsNullOrWhiteSpace(propertyPath))
            {
                return false;
            }

            var lastDot = propertyPath.LastIndexOf('.');
            if (lastDot <= 0)
            {
                return false;
            }

            parentPath = propertyPath.Substring(0, lastDot);
            return !string.IsNullOrEmpty(parentPath);
        }

        private static bool TryResolveArrayRemoveIndices(
            SerializedPropertyPatchItem patch,
            out int[] removeIndices,
            out string errorMessage)
        {
            removeIndices = Array.Empty<int>();
            errorMessage = string.Empty;

            var values = new List<int>();
            if (patch != null && patch.indices != null && patch.indices.Length > 0)
            {
                for (var i = 0; i < patch.indices.Length; i++)
                {
                    var value = patch.indices[i];
                    if (value < 0)
                    {
                        errorMessage = "indices contains negative index.";
                        return false;
                    }

                    if (!values.Contains(value))
                    {
                        values.Add(value);
                    }
                }
            }
            else if (patch != null && patch.index >= 0)
            {
                values.Add(patch.index);
            }

            if (values.Count == 0)
            {
                errorMessage = "remove op requires index or non-empty indices.";
                return false;
            }

            values.Sort();
            removeIndices = values.ToArray();
            return true;
        }

        private static void DeleteArrayElementAtIndex(SerializedProperty property, int index)
        {
            var beforeSize = property.arraySize;
            property.DeleteArrayElementAtIndex(index);
            if (property.arraySize == beforeSize && index >= 0 && index < property.arraySize)
            {
                property.DeleteArrayElementAtIndex(index);
            }
        }

        private static SerializedPropertyPatchResultItem BuildPatchResultItem(
            SerializedPropertyPatchItem patch,
            int patchIndex,
            string status,
            string errorCode,
            string errorMessage)
        {
            return new SerializedPropertyPatchResultItem
            {
                patch_index = patchIndex,
                property_path = patch == null ? string.Empty : patch.property_path,
                value_kind = patch == null ? string.Empty : patch.value_kind,
                status = string.IsNullOrWhiteSpace(status) ? string.Empty : status.Trim(),
                error_code = string.IsNullOrWhiteSpace(errorCode) ? string.Empty : errorCode.Trim(),
                error_message = string.IsNullOrWhiteSpace(errorMessage) ? string.Empty : errorMessage.Trim()
            };
        }

        private static void AppendSkippedPatchResults(
            List<SerializedPropertyPatchResultItem> results,
            SerializedPropertyPatchItem[] patches,
            int startIndex)
        {
            if (results == null || patches == null || startIndex < 0 || startIndex >= patches.Length)
            {
                return;
            }

            for (var i = startIndex; i < patches.Length; i++)
            {
                results.Add(
                    BuildPatchResultItem(
                        patches[i],
                        i,
                        "skipped",
                        "E_DRY_RUN_ABORTED",
                        "Skipped because a previous patch failed."));
            }
        }

        private static SerializedPropertyActionResultData BuildDryRunResultData(
            List<SerializedPropertyPatchResultItem> patchResults,
            bool validationPassed)
        {
            var items = patchResults == null
                ? Array.Empty<SerializedPropertyPatchResultItem>()
                : patchResults.ToArray();
            return new SerializedPropertyActionResultData
            {
                dry_run = true,
                validation_passed = validationPassed,
                patch_count = items.Length,
                patch_results = items
            };
        }

        private static bool TryResolveObjectReferenceExpectedType(
            Component component,
            string propertyPath,
            out Type expectedType)
        {
            expectedType = null;
            if (component == null || string.IsNullOrWhiteSpace(propertyPath))
            {
                return false;
            }

            var tokens = propertyPath.Split('.');
            var currentType = component.GetType();
            for (var i = 0; i < tokens.Length; i++)
            {
                var token = tokens[i];
                if (string.Equals(token, "Array", StringComparison.Ordinal) &&
                    i + 1 < tokens.Length &&
                    tokens[i + 1].StartsWith("data[", StringComparison.Ordinal))
                {
                    Type elementType;
                    if (!TryGetCollectionElementType(currentType, out elementType))
                    {
                        return false;
                    }

                    currentType = elementType;
                    i += 1;
                    continue;
                }

                var field = FindFieldInTypeHierarchy(currentType, token);
                if (field == null)
                {
                    return false;
                }

                currentType = field.FieldType;
            }

            if (currentType != null && typeof(UnityEngine.Object).IsAssignableFrom(currentType))
            {
                expectedType = currentType;
                return true;
            }

            return false;
        }

        private static FieldInfo FindFieldInTypeHierarchy(Type type, string fieldName)
        {
            var current = type;
            while (current != null)
            {
                var field = current.GetField(
                    fieldName,
                    BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (field != null)
                {
                    return field;
                }
                current = current.BaseType;
            }

            return null;
        }

        private static bool TryGetCollectionElementType(Type collectionType, out Type elementType)
        {
            elementType = null;
            if (collectionType == null)
            {
                return false;
            }

            if (collectionType.IsArray)
            {
                elementType = collectionType.GetElementType();
                return elementType != null;
            }

            if (collectionType.IsGenericType &&
                collectionType.GetGenericTypeDefinition() == typeof(List<>))
            {
                var args = collectionType.GetGenericArguments();
                if (args != null && args.Length == 1)
                {
                    elementType = args[0];
                    return elementType != null;
                }
            }

            return false;
        }

        private static int ResolveEnumIndex(SerializedProperty property, string enumName, int enumValue)
        {
            var requestedName = NormalizeNonEmpty(enumName);
            if (string.IsNullOrEmpty(requestedName))
            {
                return enumValue;
            }

            for (var i = 0; i < property.enumNames.Length; i++)
            {
                if (string.Equals(property.enumNames[i], requestedName, StringComparison.Ordinal))
                {
                    return i;
                }
            }

            for (var i = 0; i < property.enumDisplayNames.Length; i++)
            {
                if (string.Equals(property.enumDisplayNames[i], requestedName, StringComparison.Ordinal))
                {
                    return i;
                }
            }

            return -1;
        }

        private static Component ResolveComponent(
            GameObject target,
            SerializedPropertyComponentSelector selector,
            out string errorCode,
            out string errorMessage)
        {
            if (target == null)
            {
                errorCode = "E_ACTION_TARGET_NOT_FOUND";
                errorMessage = "Target object not found.";
                return null;
            }

            if (selector == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "component_selector is required.";
                return null;
            }

            var assemblyQualifiedName = NormalizeNonEmpty(selector.component_assembly_qualified_name);
            if (string.IsNullOrEmpty(assemblyQualifiedName))
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "component_selector.component_assembly_qualified_name is required.";
                return null;
            }

            var componentType = Type.GetType(assemblyQualifiedName, false);
            if (componentType == null || !typeof(Component).IsAssignableFrom(componentType))
            {
                errorCode = "E_ACTION_COMPONENT_TYPE_INVALID";
                errorMessage = "Component type cannot be resolved: " + assemblyQualifiedName;
                return null;
            }

            var components = target.GetComponents(componentType);
            if (components == null || components.Length == 0)
            {
                errorCode = "E_ACTION_COMPONENT_NOT_FOUND";
                errorMessage = "Component not found on target: " + assemblyQualifiedName;
                return null;
            }

            var index = selector.component_index;
            if (index < 0)
            {
                index = 0;
            }

            if (index >= components.Length)
            {
                errorCode = "E_ACTION_COMPONENT_INDEX_OUT_OF_RANGE";
                errorMessage =
                    "component_selector.component_index is out of range: " +
                    selector.component_index +
                    ", available=" +
                    components.Length;
                return null;
            }

            var resolved = components[index];
            if (resolved == null)
            {
                errorCode = "E_ACTION_COMPONENT_NOT_FOUND";
                errorMessage = "Resolved component is null.";
                return null;
            }

            errorCode = string.Empty;
            errorMessage = string.Empty;
            return resolved;
        }

        private static GameObject ResolveTargetGameObject(
            VisualLayerActionItem action,
            out string errorCode,
            out string errorMessage)
        {
            if (action == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "Action payload is required.";
                return null;
            }

            var anchor = action.target_anchor;
            if (anchor == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "target_anchor is required.";
                return null;
            }

            var requestedPath = ReadAnchorPath(anchor);
            var requestedObjectId = ReadAnchorObjectId(anchor);
            if (string.IsNullOrEmpty(requestedPath) || string.IsNullOrEmpty(requestedObjectId))
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "target_anchor requires both object_id and path.";
                return null;
            }

            var fromPath = FindGameObjectByScenePath(requestedPath);
            if (fromPath == null)
            {
                errorCode = "E_ACTION_TARGET_NOT_FOUND";
                errorMessage = "Target object path not found in scene: " + requestedPath;
                return null;
            }

            var fromObjectId = FindGameObjectByObjectId(requestedObjectId);
            if (fromObjectId == null)
            {
                var fromPathObjectId = BuildObjectId(fromPath);
                if (!string.IsNullOrEmpty(fromPathObjectId) &&
                    string.Equals(fromPathObjectId, requestedObjectId, StringComparison.Ordinal))
                {
                    fromObjectId = fromPath;
                }
                else
                {
                    errorCode = "E_ACTION_TARGET_NOT_FOUND";
                    errorMessage = "Target object_id not found in scene: " + requestedObjectId;
                    return null;
                }
            }

            if (!ReferenceEquals(fromPath, fromObjectId))
            {
                errorCode = "E_TARGET_ANCHOR_CONFLICT";
                errorMessage =
                    "target_anchor object_id and path resolve to different objects: object_id=" +
                    requestedObjectId +
                    ", path=" +
                    requestedPath;
                return null;
            }

            errorCode = string.Empty;
            errorMessage = string.Empty;
            return fromObjectId;
        }

        private static GameObject FindGameObjectByScenePath(string scenePath)
        {
            if (string.IsNullOrEmpty(scenePath))
            {
                return null;
            }

            var normalized = scenePath.Replace('\\', '/').Trim();
            if (normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = normalized.Substring("Scene/".Length);
            }

            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            var segments = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0)
            {
                return null;
            }

            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex++)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var rootIndex = 0; rootIndex < roots.Length; rootIndex++)
                {
                    var root = roots[rootIndex];
                    if (root == null || !string.Equals(root.name, segments[0], StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var found = FindChildBySegments(root.transform, segments, 1);
                    if (found != null)
                    {
                        return found.gameObject;
                    }
                }
            }

            return null;
        }

        private static GameObject FindGameObjectByObjectId(string objectId)
        {
            var normalized = NormalizeNonEmpty(objectId);
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            try
            {
                GlobalObjectId parsed;
                if (!GlobalObjectId.TryParse(normalized, out parsed))
                {
                    return null;
                }

                var obj = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
                var asGameObject = obj as GameObject;
                if (asGameObject != null)
                {
                    return asGameObject;
                }

                var asComponent = obj as Component;
                return asComponent != null ? asComponent.gameObject : null;
            }
            catch
            {
                return null;
            }
        }

        private static Transform FindChildBySegments(Transform current, string[] segments, int index)
        {
            if (current == null || segments == null)
            {
                return null;
            }

            if (index >= segments.Length)
            {
                return current;
            }

            var childName = segments[index];
            for (var i = 0; i < current.childCount; i++)
            {
                var child = current.GetChild(i);
                if (child == null || !string.Equals(child.name, childName, StringComparison.Ordinal))
                {
                    continue;
                }

                var found = FindChildBySegments(child, segments, index + 1);
                if (found != null)
                {
                    return found;
                }
            }

            return null;
        }

        private static UnityActionExecutionResult BuildInitialResult(VisualLayerActionItem action)
        {
            return new UnityActionExecutionResult
            {
                actionType = action == null ? string.Empty : action.type,
                targetObjectPath = action == null ? string.Empty : ReadAnchorPath(action.target_anchor),
                targetObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.target_anchor),
                componentAssemblyQualifiedName = string.Empty,
                sourceComponentAssemblyQualifiedName = string.Empty,
                createdObjectPath = string.Empty,
                createdObjectId = string.Empty,
                name = string.Empty,
                parentObjectPath = string.Empty,
                parentObjectId = string.Empty,
                primitiveType = string.Empty,
                uiType = string.Empty,
                success = false,
                errorCode = string.Empty,
                errorMessage = string.Empty,
                durationMs = 0,
                resultData = null
            };
        }

        private static UnityActionExecutionResult Succeed(UnityActionExecutionResult result)
        {
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        private static UnityActionExecutionResult Fail(
            UnityActionExecutionResult result,
            string errorCode,
            string errorMessage)
        {
            result.success = false;
            result.errorCode = NormalizeErrorCode(errorCode);
            result.errorMessage = NormalizeErrorMessage(errorMessage);
            return result;
        }

        private static string NormalizeErrorCode(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToUpperInvariant();
            return string.IsNullOrEmpty(normalized) ? "E_ACTION_EXECUTION_FAILED" : normalized;
        }

        private static string NormalizeErrorMessage(string value)
        {
            var text = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
            if (string.IsNullOrEmpty(text))
            {
                return "set_serialized_property failed.";
            }

            var lines = text.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return lines.Length == 0 ? text : lines[0].Trim();
        }

        private static string NormalizeExceptionMessage(Exception ex)
        {
            if (ex == null || string.IsNullOrWhiteSpace(ex.Message))
            {
                return "set_serialized_property failed.";
            }

            var lines = ex.Message.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return lines.Length == 0 ? ex.Message.Trim() : lines[0].Trim();
        }

        private static string ReadAnchorObjectId(UnityObjectAnchor anchor)
        {
            return anchor == null || string.IsNullOrWhiteSpace(anchor.object_id)
                ? string.Empty
                : anchor.object_id.Trim();
        }

        private static string ReadAnchorPath(UnityObjectAnchor anchor)
        {
            return anchor == null || string.IsNullOrWhiteSpace(anchor.path)
                ? string.Empty
                : anchor.path.Trim();
        }

        private static string BuildGameObjectPath(Transform transform)
        {
            if (transform == null)
            {
                return string.Empty;
            }

            var current = transform;
            var path = current.name;
            while (current.parent != null)
            {
                current = current.parent;
                path = current.name + "/" + path;
            }

            return "Scene/" + path;
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
                var text = globalId.ToString();
                return string.IsNullOrEmpty(text) ? string.Empty : text;
            }
            catch
            {
                return string.Empty;
            }
        }

        private static string NormalizeNonEmpty(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static string NormalizeLower(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
        }
    }
}

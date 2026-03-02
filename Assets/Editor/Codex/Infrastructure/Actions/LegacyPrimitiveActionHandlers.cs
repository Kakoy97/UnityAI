using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using Debug = UnityEngine.Debug;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    internal static class LegacyPrimitiveActionHandlers
    {
        private const string MissingScriptAssemblyQualifiedName = "UnityEditor.MissingScript";
        private const int MaxExecutionErrorMessageLength = 320;

        internal static UnityActionExecutionResult RunAddComponent(VisualLayerActionItem action)
        {
            return ExecuteAddComponent(action, BuildInitialResult(action));
        }

        internal static UnityActionExecutionResult RunRemoveComponent(VisualLayerActionItem action)
        {
            return ExecuteRemoveComponent(action, BuildInitialResult(action));
        }

        internal static UnityActionExecutionResult RunReplaceComponent(VisualLayerActionItem action)
        {
            return ExecuteReplaceComponent(action, BuildInitialResult(action));
        }

        internal static UnityActionExecutionResult RunCreateGameObject(VisualLayerActionItem action)
        {
            return ExecuteCreateGameObject(action, BuildInitialResult(action));
        }

        internal static UnityActionExecutionResult RunSetGameObjectActive(VisualLayerActionItem action, bool active)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            target.SetActive(active);
            MarkTargetDirty(target);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunRenameGameObject(VisualLayerActionItem action, string name)
        {
            var result = BuildInitialResult(action);
            if (string.IsNullOrWhiteSpace(name))
            {
                return Fail(result, "E_SCHEMA_INVALID", "name is required.");
            }

            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            target.name = name.Trim();
            MarkTargetDirty(target);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.name = target.name;
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunDestroyGameObject(VisualLayerActionItem action)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            Undo.DestroyObjectImmediate(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunSetTransformLocalPosition(
            VisualLayerActionItem action,
            Vector3 value)
        {
            return SetTransformVector3(action, value, (t, v) => t.localPosition = v);
        }

        internal static UnityActionExecutionResult RunSetTransformLocalRotation(
            VisualLayerActionItem action,
            Vector3 value)
        {
            return SetTransformVector3(action, value, (t, v) => t.localRotation = Quaternion.Euler(v));
        }

        internal static UnityActionExecutionResult RunSetTransformLocalScale(
            VisualLayerActionItem action,
            Vector3 value)
        {
            return SetTransformVector3(action, value, (t, v) => t.localScale = v);
        }

        internal static UnityActionExecutionResult RunSetTransformWorldPosition(
            VisualLayerActionItem action,
            Vector3 value)
        {
            return SetTransformVector3(action, value, (t, v) => t.position = v);
        }

        internal static UnityActionExecutionResult RunSetTransformWorldRotation(
            VisualLayerActionItem action,
            Vector3 value)
        {
            return SetTransformVector3(action, value, (t, v) => t.rotation = Quaternion.Euler(v));
        }

        internal static UnityActionExecutionResult RunSetRectTransformAnchoredPosition(
            VisualLayerActionItem action,
            Vector2 value)
        {
            return SetRectTransformVector2(action, value, (r, v) => r.anchoredPosition = v);
        }

        internal static UnityActionExecutionResult RunSetRectTransformSizeDelta(
            VisualLayerActionItem action,
            Vector2 value)
        {
            return SetRectTransformVector2(action, value, (r, v) => r.sizeDelta = v);
        }

        internal static UnityActionExecutionResult RunSetRectTransformPivot(
            VisualLayerActionItem action,
            Vector2 value)
        {
            return SetRectTransformVector2(action, value, (r, v) => r.pivot = v);
        }

        internal static UnityActionExecutionResult RunSetRectTransformAnchors(
            VisualLayerActionItem action,
            Vector2 min,
            Vector2 max)
        {
            var result = BuildInitialResult(action);
            if (min.x > max.x || min.y > max.y)
            {
                return Fail(
                    result,
                    "E_ACTION_SCHEMA_INVALID",
                    "RectTransform anchors require min <= max on both axes.");
            }

            RectTransform rectTransform;
            string code;
            string message;
            if (!ResolveRectTransform(action, out rectTransform, out code, out message))
            {
                return Fail(result, code, message);
            }

            rectTransform.anchorMin = min;
            rectTransform.anchorMax = max;
            MarkComponentAndTargetDirty(rectTransform);
            result.targetObjectPath = BuildGameObjectPath(rectTransform.transform);
            result.targetObjectId = BuildObjectId(rectTransform.gameObject);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunSetUiImageColor(
            VisualLayerActionItem action,
            Color color)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            var image = target.GetComponent<Image>();
            if (image == null)
            {
                return Fail(result, "E_ACTION_COMPONENT_NOT_FOUND", "Image component not found on target.");
            }

            image.color = color;
            MarkComponentAndTargetDirty(image);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunSetUiImageRaycastTarget(
            VisualLayerActionItem action,
            bool raycastTarget)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            var image = target.GetComponent<Image>();
            if (image == null)
            {
                return Fail(result, "E_ACTION_COMPONENT_NOT_FOUND", "Image component not found on target.");
            }

            image.raycastTarget = raycastTarget;
            MarkComponentAndTargetDirty(image);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunSetUiTextContent(
            VisualLayerActionItem action,
            string text)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            Component textLike;
            Type type;
            if (!TryResolveTextLikeComponent(target, out textLike, out type))
            {
                return Fail(result, "E_ACTION_COMPONENT_NOT_FOUND", "Text or TMP_Text component not found on target.");
            }

            string setError;
            if (!SetTextLikeProperty(type, textLike, "text", text ?? string.Empty, out setError))
            {
                return Fail(result, "E_ACTION_EXECUTION_FAILED", setError);
            }

            MarkComponentAndTargetDirty(textLike);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunSetUiTextColor(
            VisualLayerActionItem action,
            Color color)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            Component textLike;
            Type type;
            if (!TryResolveTextLikeComponent(target, out textLike, out type))
            {
                return Fail(result, "E_ACTION_COMPONENT_NOT_FOUND", "Text or TMP_Text component not found on target.");
            }

            string setError;
            if (!SetTextLikeProperty(type, textLike, "color", color, out setError))
            {
                return Fail(result, "E_ACTION_EXECUTION_FAILED", setError);
            }

            MarkComponentAndTargetDirty(textLike);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunSetUiTextFontSize(
            VisualLayerActionItem action,
            float fontSize)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            Component textLike;
            Type type;
            if (!TryResolveTextLikeComponent(target, out textLike, out type))
            {
                return Fail(result, "E_ACTION_COMPONENT_NOT_FOUND", "Text or TMP_Text component not found on target.");
            }

            string setError;
            if (!SetTextLikeProperty(type, textLike, "fontSize", fontSize, out setError))
            {
                return Fail(result, "E_ACTION_EXECUTION_FAILED", setError);
            }

            MarkComponentAndTargetDirty(textLike);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunSetCanvasGroupAlpha(
            VisualLayerActionItem action,
            float alpha)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            var canvasGroup = target.GetComponent<CanvasGroup>();
            if (canvasGroup == null)
            {
                return Fail(result, "E_ACTION_COMPONENT_NOT_FOUND", "CanvasGroup component not found on target.");
            }

            canvasGroup.alpha = alpha;
            MarkComponentAndTargetDirty(canvasGroup);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        internal static UnityActionExecutionResult RunSetLayoutElement(
            VisualLayerActionItem action,
            float minWidth,
            float minHeight,
            float preferredWidth,
            float preferredHeight,
            float flexibleWidth,
            float flexibleHeight,
            bool ignoreLayout)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            var layoutElement = target.GetComponent<LayoutElement>();
            if (layoutElement == null)
            {
                return Fail(result, "E_ACTION_COMPONENT_NOT_FOUND", "LayoutElement component not found on target.");
            }

            layoutElement.minWidth = minWidth;
            layoutElement.minHeight = minHeight;
            layoutElement.preferredWidth = preferredWidth;
            layoutElement.preferredHeight = preferredHeight;
            layoutElement.flexibleWidth = flexibleWidth;
            layoutElement.flexibleHeight = flexibleHeight;
            layoutElement.ignoreLayout = ignoreLayout;
            MarkComponentAndTargetDirty(layoutElement);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        private static UnityActionExecutionResult SetTransformVector3(
            VisualLayerActionItem action,
            Vector3 value,
            Action<Transform, Vector3> apply)
        {
            var result = BuildInitialResult(action);
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                return Fail(result, code, message);
            }

            if (apply != null)
            {
                apply(target.transform, value);
            }

            MarkTargetDirty(target);
            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        private static UnityActionExecutionResult SetRectTransformVector2(
            VisualLayerActionItem action,
            Vector2 value,
            Action<RectTransform, Vector2> apply)
        {
            var result = BuildInitialResult(action);
            RectTransform rectTransform;
            string code;
            string message;
            if (!ResolveRectTransform(action, out rectTransform, out code, out message))
            {
                return Fail(result, code, message);
            }

            if (apply != null)
            {
                apply(rectTransform, value);
            }

            MarkComponentAndTargetDirty(rectTransform);
            result.targetObjectPath = BuildGameObjectPath(rectTransform.transform);
            result.targetObjectId = BuildObjectId(rectTransform.gameObject);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        private static bool ResolveRectTransform(
            VisualLayerActionItem action,
            out RectTransform rectTransform,
            out string errorCode,
            out string errorMessage)
        {
            rectTransform = null;
            string code;
            string message;
            var target = ResolveTargetGameObject(action, out code, out message);
            if (target == null)
            {
                errorCode = code;
                errorMessage = message;
                return false;
            }

            rectTransform = target.GetComponent<RectTransform>();
            if (rectTransform == null)
            {
                errorCode = "E_ACTION_COMPONENT_NOT_FOUND";
                errorMessage = "RectTransform component not found on target.";
                return false;
            }

            errorCode = string.Empty;
            errorMessage = string.Empty;
            return true;
        }

        private static bool TryResolveTextLikeComponent(
            GameObject target,
            out Component component,
            out Type componentType)
        {
            component = null;
            componentType = null;
            if (target == null)
            {
                return false;
            }

            var text = target.GetComponent<Text>();
            if (text != null)
            {
                component = text;
                componentType = typeof(Text);
                return true;
            }

            var tmpType = Type.GetType("TMPro.TMP_Text, Unity.TextMeshPro", false) ??
                          Type.GetType("TMPro.TextMeshProUGUI, Unity.TextMeshPro", false);
            if (tmpType == null)
            {
                return false;
            }

            var tmp = target.GetComponent(tmpType);
            if (tmp == null)
            {
                return false;
            }

            component = tmp;
            componentType = tmpType;
            return true;
        }

        private static bool SetTextLikeProperty(
            Type componentType,
            Component component,
            string propertyName,
            object value,
            out string error)
        {
            error = string.Empty;
            if (componentType == null || component == null || string.IsNullOrEmpty(propertyName))
            {
                error = "Invalid text component state.";
                return false;
            }

            var prop = componentType.GetProperty(propertyName);
            if (prop == null || !prop.CanWrite)
            {
                error = "Property not writable: " + propertyName;
                return false;
            }

            object converted;
            if (!TryConvertPropertyValue(prop.PropertyType, value, out converted))
            {
                error = "Cannot convert property value: " + propertyName;
                return false;
            }

            prop.SetValue(component, converted, null);
            return true;
        }

        private static bool TryConvertPropertyValue(Type targetType, object input, out object converted)
        {
            converted = null;
            if (targetType == null)
            {
                return false;
            }

            if (input == null)
            {
                if (!targetType.IsValueType || Nullable.GetUnderlyingType(targetType) != null)
                {
                    return true;
                }
                return false;
            }

            var inputType = input.GetType();
            if (targetType.IsAssignableFrom(inputType))
            {
                converted = input;
                return true;
            }

            try
            {
                if (targetType == typeof(float))
                {
                    converted = Convert.ToSingle(input);
                    return true;
                }
                if (targetType == typeof(int))
                {
                    converted = Convert.ToInt32(input);
                    return true;
                }
                if (targetType == typeof(string))
                {
                    converted = Convert.ToString(input);
                    return true;
                }
                if (targetType == typeof(Color) && input is Color)
                {
                    converted = input;
                    return true;
                }
            }
            catch
            {
                return false;
            }

            return false;
        }

        private static void MarkTargetDirty(GameObject target)
        {
            if (target == null)
            {
                return;
            }

            EditorUtility.SetDirty(target);
            PrefabUtility.RecordPrefabInstancePropertyModifications(target);
            EditorSceneManager.MarkSceneDirty(target.scene);
        }

        private static void MarkComponentAndTargetDirty(Component component)
        {
            if (component == null)
            {
                return;
            }

            EditorUtility.SetDirty(component);
            if (component.gameObject != null)
            {
                MarkTargetDirty(component.gameObject);
            }
        }

        private static UnityActionExecutionResult ExecuteAddComponent(
            VisualLayerActionItem action,
            UnityActionExecutionResult result)
        {
            if (string.IsNullOrEmpty(action.component_assembly_qualified_name))
            {
                return Fail(
                    result,
                    "E_SCHEMA_INVALID",
                    "component_assembly_qualified_name is required.");
            }

            string targetResolveCode;
            string targetResolveError;
            var target = ResolveTargetGameObject(
                action,
                out targetResolveCode,
                out targetResolveError);
            if (target == null)
            {
                return Fail(result, targetResolveCode, targetResolveError);
            }

            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);

            string resolveErrorCode;
            string resolveErrorMessage;
            var componentType = ResolveComponentTypeWithFuzzyFallback(
                action.component_assembly_qualified_name,
                out resolveErrorCode,
                out resolveErrorMessage);
            if (componentType == null)
            {
                return Fail(result, resolveErrorCode, resolveErrorMessage);
            }

            var existing = target.GetComponent(componentType);
            if (existing == null)
            {
                Undo.AddComponent(target, componentType);
                EditorUtility.SetDirty(target);
                PrefabUtility.RecordPrefabInstancePropertyModifications(target);
                EditorSceneManager.MarkSceneDirty(target.scene);
            }

            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        private static UnityActionExecutionResult ExecuteRemoveComponent(
            VisualLayerActionItem action,
            UnityActionExecutionResult result)
        {
            if (string.IsNullOrEmpty(action.component_assembly_qualified_name))
            {
                return Fail(
                    result,
                    "E_SCHEMA_INVALID",
                    "component_assembly_qualified_name is required.");
            }

            string targetResolveCode;
            string targetResolveError;
            var target = ResolveTargetGameObject(
                action,
                out targetResolveCode,
                out targetResolveError);
            if (target == null)
            {
                return Fail(result, targetResolveCode, targetResolveError);
            }

            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);

            if (string.Equals(
                    action.component_assembly_qualified_name,
                    MissingScriptAssemblyQualifiedName,
                    StringComparison.Ordinal))
            {
                GameObjectUtility.RemoveMonoBehavioursWithMissingScript(target);
                EditorUtility.SetDirty(target);
                PrefabUtility.RecordPrefabInstancePropertyModifications(target);
                EditorSceneManager.MarkSceneDirty(target.scene);
                result.success = true;
                result.errorCode = string.Empty;
                result.errorMessage = string.Empty;
                return result;
            }

            string resolveErrorCode;
            string resolveErrorMessage;
            var existing = ResolveComponentInstanceOnTarget(
                target,
                action.component_assembly_qualified_name,
                out resolveErrorCode,
                out resolveErrorMessage);
            if (existing == null)
            {
                if (string.Equals(resolveErrorCode, "E_ACTION_COMPONENT_NOT_FOUND", StringComparison.Ordinal))
                {
                    int removedMissingCount;
                    if (TryCleanupMissingScriptsOnTarget(target, out removedMissingCount) &&
                        removedMissingCount > 0)
                    {
                        result.success = true;
                        result.errorCode = string.Empty;
                        result.errorMessage = string.Empty;
                        return result;
                    }
                }
                return Fail(result, resolveErrorCode, resolveErrorMessage);
            }

            if (existing is Transform)
            {
                return Fail(result, "E_SCHEMA_INVALID", "Transform component cannot be removed.");
            }

            Undo.DestroyObjectImmediate(existing);
            EditorUtility.SetDirty(target);
            PrefabUtility.RecordPrefabInstancePropertyModifications(target);
            EditorSceneManager.MarkSceneDirty(target.scene);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        private static UnityActionExecutionResult ExecuteReplaceComponent(
            VisualLayerActionItem action,
            UnityActionExecutionResult result)
        {
            if (string.IsNullOrEmpty(action.source_component_assembly_qualified_name))
            {
                return Fail(
                    result,
                    "E_SCHEMA_INVALID",
                    "source_component_assembly_qualified_name is required.");
            }
            if (string.IsNullOrEmpty(action.component_assembly_qualified_name))
            {
                return Fail(
                    result,
                    "E_SCHEMA_INVALID",
                    "component_assembly_qualified_name is required.");
            }

            string targetResolveCode;
            string targetResolveError;
            var target = ResolveTargetGameObject(
                action,
                out targetResolveCode,
                out targetResolveError);
            if (target == null)
            {
                return Fail(result, targetResolveCode, targetResolveError);
            }

            result.targetObjectPath = BuildGameObjectPath(target.transform);
            result.targetObjectId = BuildObjectId(target);

            string componentResolveCode;
            string componentResolveMessage;
            var targetType = ResolveComponentTypeWithFuzzyFallback(
                action.component_assembly_qualified_name,
                out componentResolveCode,
                out componentResolveMessage);
            if (targetType == null)
            {
                return Fail(result, componentResolveCode, componentResolveMessage);
            }

            string sourceResolveCode;
            string sourceResolveMessage;
            var existingSource = ResolveComponentInstanceOnTarget(
                target,
                action.source_component_assembly_qualified_name,
                out sourceResolveCode,
                out sourceResolveMessage);
            if (existingSource == null)
            {
                if (string.Equals(sourceResolveCode, "E_ACTION_COMPONENT_NOT_FOUND", StringComparison.Ordinal))
                {
                    int removedMissingCount;
                    if (TryCleanupMissingScriptsOnTarget(target, out removedMissingCount) &&
                        removedMissingCount > 0)
                    {
                        if (target.GetComponent(targetType) == null)
                        {
                            Undo.AddComponent(target, targetType);
                        }

                        EditorUtility.SetDirty(target);
                        PrefabUtility.RecordPrefabInstancePropertyModifications(target);
                        EditorSceneManager.MarkSceneDirty(target.scene);
                        result.success = true;
                        result.errorCode = string.Empty;
                        result.errorMessage = string.Empty;
                        return result;
                    }
                }
                return Fail(result, sourceResolveCode, sourceResolveMessage);
            }
            var sourceType = existingSource.GetType();

            if (sourceType == typeof(Transform))
            {
                return Fail(result, "E_SCHEMA_INVALID", "Transform component cannot be replaced.");
            }

            Undo.DestroyObjectImmediate(existingSource);
            if (target.GetComponent(targetType) == null)
            {
                Undo.AddComponent(target, targetType);
            }

            EditorUtility.SetDirty(target);
            PrefabUtility.RecordPrefabInstancePropertyModifications(target);
            EditorSceneManager.MarkSceneDirty(target.scene);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        private static bool TryCleanupMissingScriptsOnTarget(
            GameObject target,
            out int removedMissingCount)
        {
            removedMissingCount = 0;
            if (target == null)
            {
                return false;
            }

            if (!HasMissingScriptOnTarget(target))
            {
                return false;
            }

            removedMissingCount =
                GameObjectUtility.RemoveMonoBehavioursWithMissingScript(target);
            if (removedMissingCount <= 0)
            {
                return false;
            }

            EditorUtility.SetDirty(target);
            PrefabUtility.RecordPrefabInstancePropertyModifications(target);
            EditorSceneManager.MarkSceneDirty(target.scene);
            return true;
        }

        private static bool HasMissingScriptOnTarget(GameObject target)
        {
            if (target == null)
            {
                return false;
            }

            var components = target.GetComponents<Component>();
            for (var i = 0; i < components.Length; i++)
            {
                if (components[i] == null)
                {
                    return true;
                }
            }

            return false;
        }

        private static UnityActionExecutionResult ExecuteCreateGameObject(
            VisualLayerActionItem action,
            UnityActionExecutionResult result)
        {
            if (string.IsNullOrWhiteSpace(action.name))
            {
                return Fail(result, "E_SCHEMA_INVALID", "name is required for create_gameobject.");
            }
            if (!string.IsNullOrEmpty(action.primitive_type) && !string.IsNullOrEmpty(action.ui_type))
            {
                return Fail(
                    result,
                    "E_SCHEMA_INVALID",
                    "create_gameobject cannot set both primitive_type and ui_type.");
            }

            string parentResolveCode;
            string parentResolveError;
            var requestedParent = ResolveGameObjectByAnchor(
                action == null ? null : action.parent_anchor,
                "Parent",
                out parentResolveCode,
                out parentResolveError);
            if (requestedParent == null)
            {
                return Fail(result, parentResolveCode, parentResolveError);
            }

            var finalParent = requestedParent;
            if (!string.IsNullOrEmpty(action.ui_type) &&
                !string.Equals(action.ui_type, "Canvas", StringComparison.OrdinalIgnoreCase) &&
                !HasCanvasInAncestors(finalParent))
            {
                finalParent = EnsureRootCanvas();
            }

            GameObject created;
            if (!string.IsNullOrEmpty(action.primitive_type))
            {
                PrimitiveType primitiveType;
                if (!Enum.TryParse(action.primitive_type, true, out primitiveType))
                {
                    return Fail(
                        result,
                        "E_SCHEMA_INVALID",
                        "Unsupported primitive_type: " + action.primitive_type);
                }
                created = GameObject.CreatePrimitive(primitiveType);
                created.name = action.name;
            }
            else if (!string.IsNullOrEmpty(action.ui_type))
            {
                string createUiError;
                created = CreateUiGameObject(action.ui_type, action.name, out createUiError);
                if (created == null)
                {
                    return Fail(result, "E_SCHEMA_INVALID", createUiError);
                }
                if (finalParent == null &&
                    !string.Equals(action.ui_type, "Canvas", StringComparison.OrdinalIgnoreCase))
                {
                    finalParent = EnsureRootCanvas();
                }
                EnsureEventSystem();
            }
            else
            {
                created = new GameObject(action.name);
            }

            Undo.RegisterCreatedObjectUndo(created, "Codex create_gameobject");
            if (finalParent != null)
            {
                Undo.SetTransformParent(
                    created.transform,
                    finalParent.transform,
                    "Codex create_gameobject parent");
                created.transform.localPosition = Vector3.zero;
                created.transform.localRotation = Quaternion.identity;
                created.transform.localScale = Vector3.one;
            }

            EditorUtility.SetDirty(created);
            PrefabUtility.RecordPrefabInstancePropertyModifications(created);
            EditorSceneManager.MarkSceneDirty(created.scene);

            result.targetObjectPath = finalParent != null
                ? BuildGameObjectPath(finalParent.transform)
                : string.Empty;
            result.targetObjectId = BuildObjectId(finalParent);
            result.parentObjectPath = result.targetObjectPath;
            result.parentObjectId = result.targetObjectId;
            result.createdObjectPath = BuildGameObjectPath(created.transform);
            result.createdObjectId = BuildObjectId(created);
            result.success = true;
            result.errorCode = string.Empty;
            result.errorMessage = string.Empty;
            return result;
        }

        private static GameObject CreateUiGameObject(
            string uiType,
            string name,
            out string error)
        {
            error = string.Empty;
            var normalizedUiType = string.IsNullOrEmpty(uiType) ? string.Empty : uiType.Trim();
            if (string.IsNullOrEmpty(normalizedUiType))
            {
                error = "ui_type is required.";
                return null;
            }

            switch (normalizedUiType)
            {
                case "Canvas":
                    return BuildCanvasObject(name);
                case "Panel":
                    return new GameObject(name, typeof(RectTransform), typeof(Image));
                case "Button":
                    return new GameObject(name, typeof(RectTransform), typeof(Image), typeof(Button));
                case "Image":
                    return new GameObject(name, typeof(RectTransform), typeof(Image));
                case "Text":
                {
                    var textObject = new GameObject(name, typeof(RectTransform), typeof(Text));
                    var text = textObject.GetComponent<Text>();
                    if (text != null)
                    {
                        text.text = name;
                        text.color = Color.black;
                    }
                    return textObject;
                }
                case "TMP_Text":
                {
                    var tmpType = Type.GetType("TMPro.TextMeshProUGUI, Unity.TextMeshPro", false);
                    if (tmpType == null)
                    {
                        error =
                            "TMP_Text requires TextMeshPro package (TMPro.TextMeshProUGUI).";
                        return null;
                    }

                    var tmpObject = new GameObject(name, typeof(RectTransform), tmpType);
                    var textProperty = tmpType.GetProperty("text");
                    if (textProperty != null && textProperty.CanWrite)
                    {
                        textProperty.SetValue(tmpObject.GetComponent(tmpType), name, null);
                    }
                    return tmpObject;
                }
                default:
                    error = "Unsupported ui_type: " + normalizedUiType;
                    return null;
            }
        }

        private static GameObject BuildCanvasObject(string name)
        {
            var canvasObject = new GameObject(
                string.IsNullOrEmpty(name) ? "Canvas" : name,
                typeof(RectTransform),
                typeof(Canvas),
                typeof(CanvasScaler),
                typeof(GraphicRaycaster));
            var canvas = canvasObject.GetComponent<Canvas>();
            if (canvas != null)
            {
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            }
            return canvasObject;
        }

        private static GameObject EnsureRootCanvas()
        {
            var sceneCount = SceneManager.sceneCount;
            for (var i = 0; i < sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var j = 0; j < roots.Length; j++)
                {
                    var root = roots[j];
                    if (root == null)
                    {
                        continue;
                    }

                    var canvas = root.GetComponentInChildren<Canvas>(true);
                    if (canvas != null)
                    {
                        return canvas.gameObject;
                    }
                }
            }

            var created = BuildCanvasObject("Canvas");
            Undo.RegisterCreatedObjectUndo(created, "Codex create Canvas");
            EditorSceneManager.MarkSceneDirty(created.scene);
            return created;
        }

        private static void EnsureEventSystem()
        {
            if (UnityEngine.Object.FindObjectOfType<EventSystem>() != null)
            {
                return;
            }

            var eventSystem = new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
            Undo.RegisterCreatedObjectUndo(eventSystem, "Codex create EventSystem");
            EditorSceneManager.MarkSceneDirty(eventSystem.scene);
        }

        private static bool HasCanvasInAncestors(GameObject target)
        {
            if (target == null)
            {
                return false;
            }
            return target.GetComponentInParent<Canvas>(true) != null;
        }

        private static UnityActionExecutionResult BuildInitialResult(
            VisualLayerActionItem action)
        {
            return new UnityActionExecutionResult
            {
                actionType = action != null ? action.type : string.Empty,
                targetObjectPath = action == null ? string.Empty : ReadAnchorPath(action.target_anchor),
                targetObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.target_anchor),
                componentAssemblyQualifiedName =
                    action == null ? string.Empty : action.component_assembly_qualified_name,
                sourceComponentAssemblyQualifiedName =
                    action == null ? string.Empty : action.source_component_assembly_qualified_name,
                createdObjectPath = string.Empty,
                createdObjectId = string.Empty,
                name = action == null ? string.Empty : action.name,
                parentObjectPath = action == null ? string.Empty : ReadAnchorPath(action.parent_anchor),
                parentObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.parent_anchor),
                primitiveType = action == null ? string.Empty : action.primitive_type,
                uiType = action == null ? string.Empty : action.ui_type,
                success = false,
                errorCode = string.Empty,
                errorMessage = string.Empty,
                durationMs = 0
            };
        }

        private static UnityActionExecutionResult Fail(
            UnityActionExecutionResult result,
            string code,
            string message)
        {
            result.success = false;
            result.errorCode = NormalizeExecutionErrorCode(code);
            result.errorMessage = NormalizeExecutionErrorMessage(result.errorCode, message);
            return result;
        }

        private static string NormalizeExecutionErrorCode(string errorCode)
        {
            var normalized = string.IsNullOrWhiteSpace(errorCode)
                ? string.Empty
                : errorCode.Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(normalized))
            {
                return "E_ACTION_EXECUTION_FAILED";
            }

            if (string.Equals(normalized, "E_SCHEMA_INVALID", StringComparison.Ordinal))
            {
                return "E_ACTION_SCHEMA_INVALID";
            }

            if (string.Equals(normalized, "E_ACTION_TARGET_NOT_FOUND", StringComparison.Ordinal))
            {
                return "E_TARGET_NOT_FOUND";
            }

            if (string.Equals(normalized, "E_ACTION_SCHEMA_INVALID", StringComparison.Ordinal) ||
                string.Equals(normalized, "E_TARGET_ANCHOR_CONFLICT", StringComparison.Ordinal) ||
                string.Equals(normalized, "E_TARGET_NOT_FOUND", StringComparison.Ordinal) ||
                string.Equals(normalized, "E_ACTION_COMPONENT_RESOLVE_FAILED", StringComparison.Ordinal) ||
                string.Equals(normalized, "E_ACTION_COMPONENT_AMBIGUOUS", StringComparison.Ordinal) ||
                string.Equals(normalized, "E_ACTION_COMPONENT_NOT_FOUND", StringComparison.Ordinal) ||
                string.Equals(normalized, "E_ACTION_EXECUTION_FAILED", StringComparison.Ordinal))
            {
                return normalized;
            }

            return "E_ACTION_EXECUTION_FAILED";
        }

        private static string NormalizeExecutionErrorMessage(string errorCode, string errorMessage)
        {
            var normalizedInput = SanitizeSingleLine(errorMessage, MaxExecutionErrorMessageLength);
            if (!string.IsNullOrEmpty(normalizedInput))
            {
                return normalizedInput;
            }

            if (string.Equals(errorCode, "E_ACTION_SCHEMA_INVALID", StringComparison.Ordinal))
            {
                return "Visual action payload schema validation failed.";
            }

            if (string.Equals(errorCode, "E_TARGET_ANCHOR_CONFLICT", StringComparison.Ordinal))
            {
                return "Target anchor conflict: object_id and path resolve to different objects.";
            }

            if (string.Equals(errorCode, "E_TARGET_NOT_FOUND", StringComparison.Ordinal))
            {
                return "Target object not found.";
            }

            return "Visual action execution failed.";
        }

        private static string SanitizeSingleLine(string raw, int maxLength)
        {
            var value = string.IsNullOrWhiteSpace(raw) ? string.Empty : raw.Trim();
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            var lines = value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var singleLine = lines.Length > 0 ? lines[0].Trim() : value;
            if (singleLine.Length <= maxLength)
            {
                return singleLine;
            }
            return singleLine.Substring(0, maxLength).TrimEnd();
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

            return ResolveGameObjectByAnchor(
                action.target_anchor,
                "Target",
                out errorCode,
                out errorMessage);
        }

        private static GameObject ResolveGameObjectByAnchor(
            UnityObjectAnchor anchor,
            string anchorName,
            out string errorCode,
            out string errorMessage)
        {
            var label = string.IsNullOrWhiteSpace(anchorName) ? "Target" : anchorName;
            if (anchor == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = label + " anchor is required.";
                return null;
            }

            var requestedPath = ReadAnchorPath(anchor);
            var requestedObjectId = ReadAnchorObjectId(anchor);
            if (string.IsNullOrEmpty(requestedPath) || string.IsNullOrEmpty(requestedObjectId))
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = label + " anchor requires both object_id and path.";
                return null;
            }

            GameObject fromPath = null;
            GameObject fromObjectId = null;

            fromPath = FindGameObjectByScenePath(requestedPath);
            if (fromPath == null)
            {
                errorCode = "E_ACTION_TARGET_NOT_FOUND";
                errorMessage = label + " object path not found in scene: " + requestedPath;
                return null;
            }

            fromObjectId = FindGameObjectByObjectId(requestedObjectId);
            if (fromObjectId == null)
            {
                var fromPathObjectId = BuildObjectId(fromPath);
                if (!string.IsNullOrEmpty(fromPathObjectId) &&
                    string.Equals(fromPathObjectId, requestedObjectId, StringComparison.Ordinal))
                {
                    // Fallback for unsaved/transient objects where object_id reverse lookup can miss
                    // while the path-resolved object still carries the matching global id string.
                    fromObjectId = fromPath;
                }
                else if (!string.IsNullOrEmpty(fromPathObjectId))
                {
                    errorCode = "E_TARGET_ANCHOR_CONFLICT";
                    errorMessage =
                        label +
                        " object_id and path resolve to different objects: object_id=" +
                        requestedObjectId +
                        ", path=" +
                        requestedPath;
                    return null;
                }
                else
                {
                    errorCode = "E_ACTION_TARGET_NOT_FOUND";
                    errorMessage = label + " object_id not found in scene: " + requestedObjectId;
                    return null;
                }
            }

            if (!ReferenceEquals(fromPath, fromObjectId))
            {
                errorCode = "E_TARGET_ANCHOR_CONFLICT";
                errorMessage =
                    label +
                    " object_id and path resolve to different objects: object_id=" +
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

            var sceneCount = SceneManager.sceneCount;
            for (var i = 0; i < sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var j = 0; j < roots.Length; j++)
                {
                    var root = roots[j];
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
            if (string.IsNullOrWhiteSpace(objectId))
            {
                return null;
            }

            try
            {
                GlobalObjectId parsed;
                if (!GlobalObjectId.TryParse(objectId.Trim(), out parsed))
                {
                    return null;
                }

                var obj = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed);
                if (obj == null)
                {
                    return null;
                }

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

            for (var i = 0; i < current.childCount; i++)
            {
                var child = current.GetChild(i);
                if (child == null || !string.Equals(child.name, segments[index], StringComparison.Ordinal))
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

        private static Type ResolveComponentType(
            string componentAssemblyQualifiedName,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var exact = Type.GetType(componentAssemblyQualifiedName, false);
            if (IsValidComponentType(exact))
            {
                return exact;
            }

            var candidates = new List<Type>();
            var rawTypeName = ExtractRawTypeName(componentAssemblyQualifiedName);
            var shortTypeName = ExtractShortTypeName(rawTypeName);

            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (var i = 0; i < assemblies.Length; i++)
            {
                var assembly = assemblies[i];
                Type[] types;
                try
                {
                    types = assembly.GetTypes();
                }
                catch (ReflectionTypeLoadException rtl)
                {
                    types = rtl.Types;
                }
                catch (Exception ex)
                {
                    Debug.LogWarning("Skip assembly type scan: " + assembly.FullName + " error=" + ex.Message);
                    continue;
                }

                if (types == null)
                {
                    continue;
                }

                for (var j = 0; j < types.Length; j++)
                {
                    var type = types[j];
                    if (!IsValidComponentType(type))
                    {
                        continue;
                    }

                    if (IsNameMatch(type, componentAssemblyQualifiedName, rawTypeName, shortTypeName))
                    {
                        candidates.Add(type);
                    }
                }
            }

            if (candidates.Count == 1)
            {
                return candidates[0];
            }

            if (candidates.Count > 1)
            {
                errorCode = "E_ACTION_COMPONENT_AMBIGUOUS";
                errorMessage = "Component type is ambiguous: " + componentAssemblyQualifiedName;
                return null;
            }

            errorCode = "E_ACTION_COMPONENT_RESOLVE_FAILED";
            errorMessage = "Component type not found: " + componentAssemblyQualifiedName;
            return null;
        }

        private static Type ResolveComponentTypeWithFuzzyFallback(
            string componentQuery,
            out string errorCode,
            out string errorMessage)
        {
            var exact = ResolveComponentType(componentQuery, out errorCode, out errorMessage);
            if (exact != null)
            {
                return exact;
            }

            if (!string.Equals(errorCode, "E_ACTION_COMPONENT_RESOLVE_FAILED", StringComparison.Ordinal))
            {
                return null;
            }

            var fuzzyCandidates = FindFuzzyComponentTypeCandidates(componentQuery);
            if (fuzzyCandidates.Count == 1)
            {
                errorCode = string.Empty;
                errorMessage = string.Empty;
                return fuzzyCandidates[0];
            }

            if (fuzzyCandidates.Count > 1)
            {
                errorCode = "E_ACTION_COMPONENT_AMBIGUOUS";
                errorMessage =
                    "Fuzzy component type match is ambiguous: " +
                    componentQuery +
                    " matched [" +
                    string.Join(", ", fuzzyCandidates.ConvertAll(type => type.Name).ToArray()) +
                    "]";
                return null;
            }

            errorCode = "E_ACTION_COMPONENT_RESOLVE_FAILED";
            errorMessage = "Component type not found: " + componentQuery;
            return null;
        }

        private static Component ResolveComponentInstanceOnTarget(
            GameObject target,
            string componentQuery,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (target == null)
            {
                errorCode = "E_ACTION_TARGET_NOT_FOUND";
                errorMessage = "Target GameObject is null.";
                return null;
            }

            if (string.IsNullOrWhiteSpace(componentQuery))
            {
                errorCode = "E_SCHEMA_INVALID";
                errorMessage = "component_assembly_qualified_name is required.";
                return null;
            }

            string exactErrorCode;
            string exactErrorMessage;
            var exactType = ResolveComponentType(
                componentQuery,
                out exactErrorCode,
                out exactErrorMessage);
            if (exactType != null)
            {
                var exactComponent = target.GetComponent(exactType);
                if (exactComponent != null)
                {
                    return exactComponent;
                }
            }

            var fuzzyMatches = FindFuzzyComponentMatchesOnTarget(target, componentQuery);
            if (fuzzyMatches.Count == 1)
            {
                return fuzzyMatches[0];
            }

            if (fuzzyMatches.Count > 1)
            {
                errorCode = "E_ACTION_COMPONENT_AMBIGUOUS";
                errorMessage =
                    "Fuzzy component match is ambiguous: " +
                    componentQuery +
                    " matched [" +
                    string.Join(", ", fuzzyMatches.ConvertAll(comp => comp.GetType().Name).ToArray()) +
                    "]";
                return null;
            }

            errorCode = "E_ACTION_COMPONENT_NOT_FOUND";
            errorMessage = "Component not found on target: " + componentQuery;
            return null;
        }

        private static List<Component> FindFuzzyComponentMatchesOnTarget(GameObject target, string query)
        {
            var results = new List<Component>();
            var queryTokens = BuildFuzzyQueryTokens(query);
            if (queryTokens.Count == 0)
            {
                return results;
            }

            var components = target.GetComponents<Component>();
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    continue;
                }

                var type = component.GetType();
                if (IsTypeFuzzyMatched(type, queryTokens))
                {
                    results.Add(component);
                }
            }

            return results;
        }

        private static List<Type> FindFuzzyComponentTypeCandidates(string query)
        {
            var candidates = new List<Type>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var queryTokens = BuildFuzzyQueryTokens(query);
            if (queryTokens.Count == 0)
            {
                return candidates;
            }

            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            for (var i = 0; i < assemblies.Length; i++)
            {
                var assembly = assemblies[i];
                Type[] types;
                try
                {
                    types = assembly.GetTypes();
                }
                catch (ReflectionTypeLoadException rtl)
                {
                    types = rtl.Types;
                }
                catch
                {
                    continue;
                }

                if (types == null)
                {
                    continue;
                }

                for (var j = 0; j < types.Length; j++)
                {
                    var type = types[j];
                    if (!IsValidComponentType(type))
                    {
                        continue;
                    }

                    if (!IsTypeFuzzyMatched(type, queryTokens))
                    {
                        continue;
                    }

                    var key = string.IsNullOrEmpty(type.AssemblyQualifiedName)
                        ? type.FullName
                        : type.AssemblyQualifiedName;
                    if (string.IsNullOrEmpty(key) || !seen.Add(key))
                    {
                        continue;
                    }

                    candidates.Add(type);
                }
            }

            return candidates;
        }

        private static bool IsTypeFuzzyMatched(Type type, List<string> queryTokens)
        {
            if (type == null || queryTokens == null || queryTokens.Count == 0)
            {
                return false;
            }

            var normalizedName = NormalizeFuzzyToken(type.Name);
            var normalizedFullName = NormalizeFuzzyToken(type.FullName);
            for (var t = 0; t < queryTokens.Count; t++)
            {
                var token = queryTokens[t];
                if ((!string.IsNullOrEmpty(normalizedName) &&
                     normalizedName.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0) ||
                    (!string.IsNullOrEmpty(normalizedFullName) &&
                     normalizedFullName.IndexOf(token, StringComparison.OrdinalIgnoreCase) >= 0))
                {
                    return true;
                }
            }

            return false;
        }

        private static List<string> BuildFuzzyQueryTokens(string query)
        {
            var tokens = new List<string>();
            AddFuzzyToken(tokens, query);

            var rawTypeName = ExtractRawTypeName(query);
            AddFuzzyToken(tokens, rawTypeName);
            AddFuzzyToken(tokens, ExtractShortTypeName(rawTypeName));
            return tokens;
        }

        private static void AddFuzzyToken(List<string> tokens, string value)
        {
            var normalized = NormalizeFuzzyToken(value);
            if (string.IsNullOrEmpty(normalized) || normalized.Length < 3)
            {
                return;
            }

            for (var i = 0; i < tokens.Count; i++)
            {
                if (string.Equals(tokens[i], normalized, StringComparison.Ordinal))
                {
                    return;
                }
            }

            tokens.Add(normalized);
        }

        private static string NormalizeFuzzyToken(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            var sb = new StringBuilder(value.Length);
            for (var i = 0; i < value.Length; i++)
            {
                var ch = value[i];
                if (char.IsLetterOrDigit(ch))
                {
                    sb.Append(char.ToLowerInvariant(ch));
                }
            }

            return sb.ToString();
        }

        private static bool IsValidComponentType(Type type)
        {
            return type != null && !type.IsAbstract && typeof(Component).IsAssignableFrom(type);
        }

        private static bool IsNameMatch(
            Type type,
            string assemblyQualifiedName,
            string rawTypeName,
            string shortTypeName)
        {
            if (!string.IsNullOrEmpty(assemblyQualifiedName) &&
                string.Equals(type.AssemblyQualifiedName, assemblyQualifiedName, StringComparison.Ordinal))
            {
                return true;
            }

            if (!string.IsNullOrEmpty(rawTypeName) &&
                string.Equals(type.FullName, rawTypeName, StringComparison.Ordinal))
            {
                return true;
            }

            if (!string.IsNullOrEmpty(rawTypeName) &&
                string.Equals(type.Name, rawTypeName, StringComparison.Ordinal))
            {
                return true;
            }

            if (!string.IsNullOrEmpty(shortTypeName) &&
                string.Equals(type.Name, shortTypeName, StringComparison.Ordinal))
            {
                return true;
            }

            return false;
        }

        private static string ExtractRawTypeName(string assemblyQualifiedName)
        {
            if (string.IsNullOrEmpty(assemblyQualifiedName))
            {
                return string.Empty;
            }

            var commaIndex = assemblyQualifiedName.IndexOf(',');
            if (commaIndex <= 0)
            {
                return assemblyQualifiedName.Trim();
            }

            return assemblyQualifiedName.Substring(0, commaIndex).Trim();
        }

        private static string ExtractShortTypeName(string rawTypeName)
        {
            if (string.IsNullOrEmpty(rawTypeName))
            {
                return string.Empty;
            }

            var lastDotIndex = rawTypeName.LastIndexOf('.');
            if (lastDotIndex < 0 || lastDotIndex == rawTypeName.Length - 1)
            {
                return rawTypeName;
            }

            return rawTypeName.Substring(lastDotIndex + 1);
        }

        private static string BuildGameObjectPath(Transform transform)
        {
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
    }
}

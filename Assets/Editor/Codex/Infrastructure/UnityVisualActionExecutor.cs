using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Text;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Ports;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;
using Debug = UnityEngine.Debug;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class UnityVisualActionExecutor : IUnityVisualActionExecutor
    {
        private const string MissingScriptAssemblyQualifiedName = "UnityEditor.MissingScript";

        public UnityActionExecutionResult Execute(VisualLayerActionItem action, GameObject selected)
        {
            var watch = Stopwatch.StartNew();
            var result = BuildInitialResult(action, selected);

            try
            {
                var actionType = action != null && !string.IsNullOrWhiteSpace(action.type)
                    ? action.type
                    : string.Empty;
                if (string.IsNullOrEmpty(actionType))
                {
                    return Fail(result, "E_SCHEMA_INVALID", "Visual action type is required.");
                }

                switch (actionType)
                {
                    case "add_component":
                        return ExecuteAddComponent(action, selected, result);
                    case "remove_component":
                        return ExecuteRemoveComponent(action, selected, result);
                    case "replace_component":
                        return ExecuteReplaceComponent(action, selected, result);
                    case "create_gameobject":
                        return ExecuteCreateGameObject(action, selected, result);
                    default:
                        return Fail(
                            result,
                            "E_SCHEMA_INVALID",
                            "Unsupported visual action type: " + actionType);
                }
            }
            catch (Exception ex)
            {
                return Fail(result, "E_ACTION_EXECUTION_FAILED", ex.Message);
            }
            finally
            {
                watch.Stop();
                result.durationMs = (int)watch.ElapsedMilliseconds;
            }
        }

        private static UnityActionExecutionResult ExecuteAddComponent(
            VisualLayerActionItem action,
            GameObject selected,
            UnityActionExecutionResult result)
        {
            if (string.IsNullOrEmpty(action.component_assembly_qualified_name))
            {
                return Fail(
                    result,
                    "E_SCHEMA_INVALID",
                    "component_assembly_qualified_name is required.");
            }

            string targetResolveError;
            var target = ResolveTargetGameObject(selected, action, out targetResolveError);
            if (target == null)
            {
                return Fail(result, "E_ACTION_TARGET_NOT_FOUND", targetResolveError);
            }

            result.targetObjectPath = BuildGameObjectPath(target.transform);

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
            GameObject selected,
            UnityActionExecutionResult result)
        {
            if (string.IsNullOrEmpty(action.component_assembly_qualified_name))
            {
                return Fail(
                    result,
                    "E_SCHEMA_INVALID",
                    "component_assembly_qualified_name is required.");
            }

            string targetResolveError;
            var target = ResolveTargetGameObject(selected, action, out targetResolveError);
            if (target == null)
            {
                return Fail(result, "E_ACTION_TARGET_NOT_FOUND", targetResolveError);
            }

            result.targetObjectPath = BuildGameObjectPath(target.transform);

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
            GameObject selected,
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

            string targetResolveError;
            var target = ResolveTargetGameObject(selected, action, out targetResolveError);
            if (target == null)
            {
                return Fail(result, "E_ACTION_TARGET_NOT_FOUND", targetResolveError);
            }

            result.targetObjectPath = BuildGameObjectPath(target.transform);

            string targetResolveCode;
            string targetResolveMessage;
            var targetType = ResolveComponentTypeWithFuzzyFallback(
                action.component_assembly_qualified_name,
                out targetResolveCode,
                out targetResolveMessage);
            if (targetType == null)
            {
                return Fail(result, targetResolveCode, targetResolveMessage);
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
            GameObject selected,
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

            GameObject requestedParent = null;
            var parentHint = !string.IsNullOrWhiteSpace(action.parent_object_path)
                ? action.parent_object_path
                : action.target_object_path;
            if (!string.IsNullOrEmpty(parentHint))
            {
                requestedParent = FindGameObjectByScenePath(parentHint);
                if (requestedParent == null)
                {
                    return Fail(
                        result,
                        "E_ACTION_TARGET_NOT_FOUND",
                        "Parent object path not found in scene: " + parentHint);
                }
            }
            else if (selected != null)
            {
                requestedParent = selected;
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
            result.parentObjectPath = result.targetObjectPath;
            result.createdObjectPath = BuildGameObjectPath(created.transform);
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
            VisualLayerActionItem action,
            GameObject selected)
        {
            return new UnityActionExecutionResult
            {
                actionType = action != null ? action.type : string.Empty,
                targetObjectPath = selected == null ? string.Empty : BuildGameObjectPath(selected.transform),
                componentAssemblyQualifiedName =
                    action == null ? string.Empty : action.component_assembly_qualified_name,
                sourceComponentAssemblyQualifiedName =
                    action == null ? string.Empty : action.source_component_assembly_qualified_name,
                createdObjectPath = string.Empty,
                name = action == null ? string.Empty : action.name,
                parentObjectPath = action == null ? string.Empty : action.parent_object_path,
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
            result.errorCode = string.IsNullOrEmpty(code) ? "E_ACTION_EXECUTION_FAILED" : code;
            result.errorMessage = string.IsNullOrEmpty(message) ? "Visual action execution failed." : message;
            return result;
        }

        private static GameObject ResolveTargetGameObject(
            GameObject selected,
            VisualLayerActionItem action,
            out string errorMessage)
        {
            var requestedPath = action == null ? string.Empty : action.target_object_path;
            if (!string.IsNullOrEmpty(requestedPath))
            {
                var fromPath = FindGameObjectByScenePath(requestedPath);
                if (fromPath != null)
                {
                    errorMessage = string.Empty;
                    return fromPath;
                }

                errorMessage = "Target object path not found in scene: " + requestedPath;
                return null;
            }

            if (selected != null)
            {
                errorMessage = string.Empty;
                return selected;
            }

            errorMessage = "No selected GameObject found in Hierarchy.";
            return null;
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
    }
}

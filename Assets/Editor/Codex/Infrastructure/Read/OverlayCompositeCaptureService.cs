using System;
using System.Collections.Generic;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        private const string CompositeTempSceneMarkerName = "__CODEX_COMPOSITE_CAPTURE_TEMP_SCENE_MARKER__";
        private const string CompositeCloneNamePrefix = "__CODEX_COMPOSITE_CLONE__";
        private const float CompositeCanvasPlaneDistance = 100f;

        [InitializeOnLoadMethod]
        private static void CleanupResidualCompositeTempScenesOnLoad()
        {
            OverlayCompositeCaptureService.TryCleanupResidualTempScenes();
        }

        private static class OverlayCompositeCaptureService
        {
            internal static bool TryCaptureOverlayLayer(
                int width,
                int height,
                out OverlayCompositeLayer layer,
                out string errorCode,
                out string errorMessage)
            {
                layer = OverlayCompositeLayer.Empty;
                errorCode = string.Empty;
                errorMessage = string.Empty;

                var overlayRoots = CollectOverlayCanvasRoots();
                if (overlayRoots.Count <= 0)
                {
                    layer = new OverlayCompositeLayer
                    {
                        has_overlay_canvas = false,
                        width = width,
                        height = height,
                        pixels = null,
                        overlay_canvas_count = 0,
                        sanitized_component_count = 0,
                        blocked_component_count = 0,
                    };
                    return true;
                }

                TryCleanupResidualTempScenes();
                Scene tempScene = default(Scene);
                var tempSceneCreated = false;
                var tempSceneIsPreview = false;
                var previousActiveScene = SceneManager.GetActiveScene();
                GameObject cameraGo = null;
                RenderTexture targetTexture = null;
                Texture2D readTexture = null;
                var previousActive = RenderTexture.active;
                var cloneRoots = new List<GameObject>(overlayRoots.Count);
                try
                {
                    string createSceneError;
                    tempSceneCreated = TryCreateCompositeTempScene(
                        out tempScene,
                        out tempSceneIsPreview,
                        out createSceneError);
                    if (!tempSceneCreated)
                    {
                        errorCode = "E_COMPOSITE_CAPTURE_RESTRICTED";
                        errorMessage = string.IsNullOrWhiteSpace(createSceneError)
                            ? "Failed to create temp scene for composite capture."
                            : createSceneError;
                        return false;
                    }

                    var marker = new GameObject(CompositeTempSceneMarkerName);
                    marker.hideFlags = HideFlags.HideAndDontSave;
                    MoveGameObjectToSceneIfNeeded(marker, tempScene);

                    cameraGo = new GameObject("__CODEX_COMPOSITE_CAPTURE_CAMERA__");
                    cameraGo.hideFlags = HideFlags.HideAndDontSave;
                    MoveGameObjectToSceneIfNeeded(cameraGo, tempScene);
                    var normalizedWidth = ClampInRange(width, DefaultScreenshotWidth, MinScreenshotDimension, MaxScreenshotDimension);
                    var normalizedHeight = ClampInRange(height, DefaultScreenshotHeight, MinScreenshotDimension, MaxScreenshotDimension);

                    var camera = cameraGo.AddComponent<Camera>();
                    camera.orthographic = true;
                    camera.orthographicSize = normalizedHeight * 0.5f;
                    camera.aspect = normalizedWidth / (float)normalizedHeight;
                    camera.nearClipPlane = 0.01f;
                    camera.farClipPlane = 2000f;
                    camera.clearFlags = CameraClearFlags.SolidColor;
                    camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
                    camera.cullingMask = ~0;
                    camera.transform.position = new Vector3(0f, 0f, -1000f);
                    camera.transform.rotation = Quaternion.identity;
                    targetTexture = new RenderTexture(normalizedWidth, normalizedHeight, 24, RenderTextureFormat.ARGB32);
                    camera.targetTexture = targetTexture;

                    var sanitizedComponentCount = 0;
                    var blockedComponentCount = 0;
                    for (var i = 0; i < overlayRoots.Count; i++)
                    {
                        try
                        {
                            var sourceCanvas = overlayRoots[i];
                            if (sourceCanvas == null || sourceCanvas.gameObject == null)
                            {
                                continue;
                            }

                            var cloneRoot = CloneUiHierarchyWithSafetyFilter(
                                sourceCanvas.gameObject,
                                ref sanitizedComponentCount,
                                ref blockedComponentCount);
                            if (cloneRoot == null)
                            {
                                continue;
                            }

                            cloneRoot.name = CompositeCloneNamePrefix + sourceCanvas.gameObject.name;
                            ApplyHideFlagsRecursively(cloneRoot, HideFlags.HideAndDontSave);
                            MoveGameObjectToSceneIfNeeded(cloneRoot, tempScene);
                            ConfigureClonedCanvasTree(cloneRoot, camera);
                            cloneRoots.Add(cloneRoot);
                        }
                        catch
                        {
                            // Isolate problematic overlay roots. One canvas should not fail the whole capture.
                            blockedComponentCount += 1;
                            sanitizedComponentCount += 1;
                        }
                    }

                    if (cloneRoots.Count <= 0)
                    {
                        layer = new OverlayCompositeLayer
                        {
                            has_overlay_canvas = false,
                            width = normalizedWidth,
                            height = normalizedHeight,
                            pixels = null,
                            overlay_canvas_count = 0,
                            sanitized_component_count = sanitizedComponentCount,
                            blocked_component_count = blockedComponentCount,
                        };
                        return true;
                    }

                    ForceRebuildClonedLayoutTrees(cloneRoots);
                    camera.Render();
                    RenderTexture.active = targetTexture;
                    readTexture = new Texture2D(normalizedWidth, normalizedHeight, TextureFormat.RGBA32, false);
                    readTexture.ReadPixels(new Rect(0, 0, normalizedWidth, normalizedHeight), 0, 0);
                    readTexture.Apply(false, false);

                    layer = new OverlayCompositeLayer
                    {
                        has_overlay_canvas = cloneRoots.Count > 0,
                        width = normalizedWidth,
                        height = normalizedHeight,
                        pixels = readTexture.GetPixels32(),
                        overlay_canvas_count = cloneRoots.Count,
                        sanitized_component_count = sanitizedComponentCount,
                        blocked_component_count = blockedComponentCount,
                    };
                    return true;
                }
                catch (Exception ex)
                {
                    errorCode = "E_COMPOSITE_CAPTURE_RESTRICTED";
                    errorMessage = ex.Message;
                    return false;
                }
                finally
                {
                    RenderTexture.active = previousActive;
                    for (var i = 0; i < cloneRoots.Count; i++)
                    {
                        var clone = cloneRoots[i];
                        if (clone != null)
                        {
                            UnityEngine.Object.DestroyImmediate(clone);
                        }
                    }

                    if (readTexture != null)
                    {
                        UnityEngine.Object.DestroyImmediate(readTexture);
                    }
                    if (cameraGo != null)
                    {
                        UnityEngine.Object.DestroyImmediate(cameraGo);
                    }
                    if (targetTexture != null)
                    {
                        UnityEngine.Object.DestroyImmediate(targetTexture);
                    }
                    if (previousActiveScene.IsValid() && previousActiveScene.isLoaded)
                    {
                        SceneManager.SetActiveScene(previousActiveScene);
                    }
                    if (tempSceneCreated && tempScene.IsValid())
                    {
                        if (tempSceneIsPreview)
                        {
                            EditorSceneManager.ClosePreviewScene(tempScene);
                        }
                        else if (tempScene.isLoaded)
                        {
                            EditorSceneManager.CloseScene(tempScene, true);
                        }
                    }
                }
            }

            internal static void TryCleanupResidualTempScenes()
            {
                try
                {
                    for (var i = SceneManager.sceneCount - 1; i >= 0; i--)
                    {
                        var scene = SceneManager.GetSceneAt(i);
                        if (!scene.IsValid() || !scene.isLoaded)
                        {
                            continue;
                        }

                        var roots = scene.GetRootGameObjects();
                        var containsMarker = false;
                        for (var rootIndex = 0; rootIndex < roots.Length; rootIndex++)
                        {
                            var root = roots[rootIndex];
                            if (root == null)
                            {
                                continue;
                            }

                            if (string.Equals(root.name, CompositeTempSceneMarkerName, StringComparison.Ordinal))
                            {
                                containsMarker = true;
                                break;
                            }
                        }

                        if (!containsMarker)
                        {
                            continue;
                        }

                        EditorSceneManager.CloseScene(scene, true);
                    }
                }
                catch
                {
                    // best effort cleanup
                }
            }

            private static List<Canvas> CollectOverlayCanvasRoots()
            {
                var roots = new List<Canvas>();
                var activeScene = SceneManager.GetActiveScene();
                var filterByActiveScene = activeScene.IsValid() && activeScene.isLoaded;
                Canvas[] canvases;
#if UNITY_2020_1_OR_NEWER
                canvases = UnityEngine.Object.FindObjectsOfType<Canvas>(true);
#else
                canvases = UnityEngine.Object.FindObjectsOfType<Canvas>();
#endif

                for (var i = 0; i < canvases.Length; i++)
                {
                    var canvas = canvases[i];
                    if (canvas == null || canvas.gameObject == null)
                    {
                        continue;
                    }

                    if ((canvas.hideFlags & HideFlags.HideAndDontSave) != 0 ||
                        (canvas.gameObject.hideFlags & HideFlags.HideAndDontSave) != 0)
                    {
                        continue;
                    }

                    if (!canvas.gameObject.activeInHierarchy)
                    {
                        continue;
                    }

                    if (canvas.renderMode != RenderMode.ScreenSpaceOverlay)
                    {
                        continue;
                    }

                    if (!canvas.gameObject.scene.IsValid() || !canvas.gameObject.scene.isLoaded)
                    {
                        continue;
                    }

                    if (filterByActiveScene &&
                        canvas.gameObject.scene.handle != activeScene.handle)
                    {
                        continue;
                    }

                    var parentCanvas = canvas.transform.parent == null
                        ? null
                        : canvas.transform.parent.GetComponentInParent<Canvas>();
                    if (parentCanvas != null)
                    {
                        continue;
                    }

                    roots.Add(canvas);
                }

                return roots;
            }

            private static GameObject CloneUiHierarchyWithSafetyFilter(
                GameObject source,
                ref int sanitizedComponentCount,
                ref int blockedComponentCount)
            {
                if (source == null)
                {
                    return null;
                }

                var hasRectTransform = source.GetComponent<RectTransform>() != null;
                var clone = hasRectTransform
                    ? new GameObject(source.name, typeof(RectTransform))
                    : new GameObject(source.name);
                clone.SetActive(false);
                clone.layer = source.layer;
                try
                {
                    clone.tag = source.tag;
                }
                catch
                {
                    clone.tag = "Untagged";
                }

                CopyTransformValues(source.transform, clone.transform);
                CopySafeUiComponents(source, clone, ref sanitizedComponentCount, ref blockedComponentCount);

                for (var childIndex = 0; childIndex < source.transform.childCount; childIndex++)
                {
                    var sourceChild = source.transform.GetChild(childIndex);
                    if (sourceChild == null || sourceChild.gameObject == null)
                    {
                        continue;
                    }

                    var childClone = CloneUiHierarchyWithSafetyFilter(
                        sourceChild.gameObject,
                        ref sanitizedComponentCount,
                        ref blockedComponentCount);
                    if (childClone == null)
                    {
                        continue;
                    }

                    childClone.transform.SetParent(clone.transform, false);
                }

                clone.SetActive(source.activeSelf);
                return clone;
            }

            private static void CopyTransformValues(Transform source, Transform target)
            {
                if (source == null || target == null)
                {
                    return;
                }

                var sourceRect = source as RectTransform;
                var targetRect = target as RectTransform;
                if (sourceRect != null && targetRect != null)
                {
                    targetRect.anchorMin = sourceRect.anchorMin;
                    targetRect.anchorMax = sourceRect.anchorMax;
                    targetRect.pivot = sourceRect.pivot;
                    targetRect.anchoredPosition3D = sourceRect.anchoredPosition3D;
                    targetRect.sizeDelta = sourceRect.sizeDelta;
                    targetRect.offsetMin = sourceRect.offsetMin;
                    targetRect.offsetMax = sourceRect.offsetMax;
                    targetRect.localRotation = sourceRect.localRotation;
                    targetRect.localScale = sourceRect.localScale;
                    return;
                }

                target.localPosition = source.localPosition;
                target.localRotation = source.localRotation;
                target.localScale = source.localScale;
            }

            private static void CopySafeUiComponents(
                GameObject source,
                GameObject target,
                ref int sanitizedComponentCount,
                ref int blockedComponentCount)
            {
                var components = source.GetComponents<Component>();
                for (var i = 0; i < components.Length; i++)
                {
                    var component = components[i];
                    if (component == null)
                    {
                        blockedComponentCount += 1;
                        continue;
                    }

                    if (component is Transform)
                    {
                        continue;
                    }

                    var componentType = component.GetType();
                    if (!IsSafeUiComponentType(componentType))
                    {
                        blockedComponentCount += 1;
                        sanitizedComponentCount += 1;
                        continue;
                    }

                    try
                    {
                        var targetComponent = target.GetComponent(componentType);
                        if (targetComponent == null)
                        {
                            targetComponent = target.AddComponent(componentType);
                        }

                        if (targetComponent == null)
                        {
                            blockedComponentCount += 1;
                            continue;
                        }

                        EditorUtility.CopySerialized(component, targetComponent);
                    }
                    catch
                    {
                        blockedComponentCount += 1;
                    }
                }
            }

            private static bool IsSafeUiComponentType(Type type)
            {
                if (type == null)
                {
                    return false;
                }

                if (typeof(RectTransform).IsAssignableFrom(type) ||
                    typeof(Canvas).IsAssignableFrom(type) ||
                    typeof(CanvasRenderer).IsAssignableFrom(type) ||
                    typeof(CanvasGroup).IsAssignableFrom(type) ||
                    typeof(CanvasScaler).IsAssignableFrom(type) ||
                    typeof(Graphic).IsAssignableFrom(type) ||
                    typeof(Mask).IsAssignableFrom(type) ||
                    typeof(RectMask2D).IsAssignableFrom(type) ||
                    typeof(LayoutGroup).IsAssignableFrom(type))
                {
                    return true;
                }

                var fullName = type.FullName ?? string.Empty;
                if (string.Equals(fullName, "UnityEngine.UI.ContentSizeFitter", StringComparison.Ordinal) ||
                    string.Equals(fullName, "UnityEngine.UI.AspectRatioFitter", StringComparison.Ordinal) ||
                    string.Equals(fullName, "UnityEngine.UI.LayoutElement", StringComparison.Ordinal))
                {
                    return true;
                }

                return false;
            }

            private static void ConfigureClonedCanvasTree(GameObject cloneRoot, Camera captureCamera)
            {
                if (cloneRoot == null || captureCamera == null)
                {
                    return;
                }

                var canvases = cloneRoot.GetComponentsInChildren<Canvas>(true);
                for (var i = 0; i < canvases.Length; i++)
                {
                    var canvas = canvases[i];
                    if (canvas == null)
                    {
                        continue;
                    }

                    if (canvas.renderMode == RenderMode.ScreenSpaceOverlay)
                    {
                        canvas.renderMode = RenderMode.ScreenSpaceCamera;
                    }

                    if (canvas.renderMode == RenderMode.ScreenSpaceCamera)
                    {
                        canvas.worldCamera = captureCamera;
                        if (canvas.planeDistance <= 0f)
                        {
                            canvas.planeDistance = CompositeCanvasPlaneDistance;
                        }
                    }
                }
            }

            private static void ApplyHideFlagsRecursively(GameObject root, HideFlags hideFlags)
            {
                if (root == null)
                {
                    return;
                }

                var transforms = root.GetComponentsInChildren<Transform>(true);
                for (var i = 0; i < transforms.Length; i++)
                {
                    var transform = transforms[i];
                    if (transform == null || transform.gameObject == null)
                    {
                        continue;
                    }

                    transform.gameObject.hideFlags = hideFlags;
                    var components = transform.gameObject.GetComponents<Component>();
                    for (var componentIndex = 0; componentIndex < components.Length; componentIndex++)
                    {
                        var component = components[componentIndex];
                        if (component != null)
                        {
                            component.hideFlags = hideFlags;
                        }
                    }
                }
            }

            private static void ForceRebuildClonedLayoutTrees(List<GameObject> cloneRoots)
            {
                if (cloneRoots == null || cloneRoots.Count <= 0)
                {
                    return;
                }

                Canvas.ForceUpdateCanvases();
                for (var i = 0; i < cloneRoots.Count; i++)
                {
                    var root = cloneRoots[i];
                    if (root == null)
                    {
                        continue;
                    }

                    var rect = root.transform as RectTransform;
                    if (rect == null)
                    {
                        continue;
                    }

                    LayoutRebuilder.ForceRebuildLayoutImmediate(rect);
                }

                Canvas.ForceUpdateCanvases();
            }

            private static void MoveGameObjectToSceneIfNeeded(GameObject gameObject, Scene scene)
            {
                if (gameObject == null || !scene.IsValid())
                {
                    return;
                }

                if (!gameObject.scene.IsValid() || gameObject.scene.handle != scene.handle)
                {
                    SceneManager.MoveGameObjectToScene(gameObject, scene);
                }
            }

            private static bool TryCreateCompositeTempScene(
                out Scene tempScene,
                out bool isPreviewScene,
                out string errorMessage)
            {
                tempScene = default(Scene);
                isPreviewScene = false;
                errorMessage = string.Empty;

                try
                {
                    tempScene = EditorSceneManager.NewPreviewScene();
                    if (tempScene.IsValid())
                    {
                        isPreviewScene = true;
                        return true;
                    }
                }
                catch (Exception ex)
                {
                    errorMessage = "NewPreviewScene failed: " + ex.Message;
                }

                try
                {
                    tempScene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
                    if (tempScene.IsValid() && tempScene.isLoaded)
                    {
                        isPreviewScene = false;
                        return true;
                    }

                    if (string.IsNullOrWhiteSpace(errorMessage))
                    {
                        errorMessage = "NewScene(Additive) returned invalid scene.";
                    }
                }
                catch (Exception ex)
                {
                    if (string.IsNullOrWhiteSpace(errorMessage))
                    {
                        errorMessage = "NewScene(Additive) failed: " + ex.Message;
                    }
                    else
                    {
                        errorMessage = errorMessage + " | NewScene(Additive) failed: " + ex.Message;
                    }
                }

                tempScene = default(Scene);
                isPreviewScene = false;
                return false;
            }
        }
    }
}

using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        private static List<Transform> CollectUiTreeRoots(string rootPath, bool includeInactive)
        {
            var roots = new List<Transform>();
            if (!string.IsNullOrEmpty(rootPath))
            {
                var transform = FindTransformByScenePath(rootPath);
                if (transform == null)
                {
                    return roots;
                }
                if (!includeInactive && transform.gameObject != null && !transform.gameObject.activeInHierarchy)
                {
                    return roots;
                }
                roots.Add(transform);
                return roots;
            }

            var canvases = UnityEngine.Object.FindObjectsOfType<Canvas>(true);
            for (var i = 0; i < canvases.Length; i++)
            {
                var canvas = canvases[i];
                if (canvas == null || canvas.gameObject == null)
                {
                    continue;
                }
                var scene = canvas.gameObject.scene;
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }
                if (!includeInactive && !canvas.gameObject.activeInHierarchy)
                {
                    continue;
                }

                var parentCanvas = canvas.transform.parent == null
                    ? null
                    : canvas.transform.parent.GetComponentInParent<Canvas>();
                if (parentCanvas != null && parentCanvas != canvas)
                {
                    continue;
                }

                roots.Add(canvas.transform);
            }

            return roots;
        }

        private static Transform FindTransformByScenePath(string targetPath)
        {
            if (string.IsNullOrEmpty(targetPath))
            {
                return null;
            }

            for (var i = 0; i < SceneManager.sceneCount; i++)
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

                    Transform hit;
                    if (TryFindTransformByPathRecursive(root.transform, targetPath, out hit))
                    {
                        return hit;
                    }
                }
            }

            return null;
        }

        private static bool TryFindTransformByPathRecursive(
            Transform current,
            string targetPath,
            out Transform found)
        {
            found = null;
            if (current == null)
            {
                return false;
            }

            var path = BuildObjectPath(current, "Scene");
            if (string.Equals(path, targetPath, StringComparison.Ordinal))
            {
                found = current;
                return true;
            }

            for (var i = 0; i < current.childCount; i++)
            {
                if (TryFindTransformByPathRecursive(current.GetChild(i), targetPath, out found))
                {
                    return true;
                }
            }

            return false;
        }

        private static List<UnityUiCanvasInfo> CollectUiCanvasInfos(bool includeInactive, string rootPath)
        {
            var canvases = UnityEngine.Object.FindObjectsOfType<Canvas>(true);
            var result = new List<UnityUiCanvasInfo>(canvases.Length);
            for (var i = 0; i < canvases.Length; i++)
            {
                var canvas = canvases[i];
                if (canvas == null || canvas.gameObject == null)
                {
                    continue;
                }

                var scene = canvas.gameObject.scene;
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                if (!includeInactive && !canvas.gameObject.activeInHierarchy)
                {
                    continue;
                }

                var path = BuildObjectPath(canvas.transform, "Scene");
                if (!string.IsNullOrEmpty(rootPath) &&
                    !string.Equals(path, rootPath, StringComparison.Ordinal) &&
                    !path.StartsWith(rootPath + "/", StringComparison.Ordinal) &&
                    !rootPath.StartsWith(path + "/", StringComparison.Ordinal))
                {
                    continue;
                }

                result.Add(
                    new UnityUiCanvasInfo
                    {
                        object_id = BuildObjectId(canvas.gameObject),
                        path = path,
                        name = canvas.gameObject.name,
                        active = canvas.gameObject.activeInHierarchy,
                        render_mode = canvas.renderMode.ToString(),
                        sorting_layer_id = canvas.sortingLayerID,
                        sorting_order = canvas.sortingOrder,
                        is_root_canvas = canvas.rootCanvas == canvas,
                        reference_resolution = ResolveCanvasReferenceResolution(canvas)
                    });
            }

            result.Sort(
                (a, b) => string.CompareOrdinal(
                    a == null ? string.Empty : a.path,
                    b == null ? string.Empty : b.path));
            return result;
        }

        private static UnityQueryResolution ResolveCanvasReferenceResolution(Canvas canvas)
        {
            if (canvas == null)
            {
                return null;
            }

            CanvasScaler scaler = canvas.GetComponent<CanvasScaler>();
            if (scaler == null && canvas.rootCanvas != null && canvas.rootCanvas != canvas)
            {
                scaler = canvas.rootCanvas.GetComponent<CanvasScaler>();
            }

            if (scaler != null &&
                scaler.uiScaleMode == CanvasScaler.ScaleMode.ScaleWithScreenSize &&
                scaler.referenceResolution.x > 0.5f &&
                scaler.referenceResolution.y > 0.5f)
            {
                return new UnityQueryResolution
                {
                    width = Mathf.RoundToInt(scaler.referenceResolution.x),
                    height = Mathf.RoundToInt(scaler.referenceResolution.y)
                };
            }

            if (canvas.pixelRect.width > 0f && canvas.pixelRect.height > 0f)
            {
                return new UnityQueryResolution
                {
                    width = Mathf.RoundToInt(canvas.pixelRect.width),
                    height = Mathf.RoundToInt(canvas.pixelRect.height)
                };
            }

            return null;
        }

        private static UnityUiTreeNode BuildUiTreeNode(
            Transform transform,
            int depth,
            int maxDepth,
            bool includeInactive,
            bool includeComponents,
            bool includeLayout,
            bool includeInteraction,
            bool includeTextMetrics,
            ref int remainingBudget,
            ref UiTreeBuildStats stats,
            int runtimeWidth,
            int runtimeHeight)
        {
            if (transform == null || remainingBudget <= 0)
            {
                if (remainingBudget <= 0)
                {
                    stats.truncated_by_node_budget = true;
                }
                return null;
            }

            var gameObject = transform.gameObject;
            if (gameObject == null)
            {
                return null;
            }

            if (!includeInactive && !gameObject.activeInHierarchy)
            {
                return null;
            }

            remainingBudget -= 1;
            stats.returned_node_count += 1;

            var rectTransform = transform as RectTransform;
            var canvas = gameObject.GetComponentInParent<Canvas>();
            var rootCanvas = canvas == null ? null : (canvas.rootCanvas != null ? canvas.rootCanvas : canvas);
            var componentsSummary = includeComponents
                ? BuildUiComponentSummaries(gameObject)
                : new UnityUiComponentSummary[0];
            var node = new UnityUiTreeNode
            {
                anchor = new UnityObjectAnchor
                {
                    object_id = BuildObjectId(gameObject),
                    path = BuildObjectPath(transform, "Scene")
                },
                object_id = BuildObjectId(gameObject),
                path = BuildObjectPath(transform, "Scene"),
                name = gameObject.name,
                depth = depth,
                active_self = gameObject.activeSelf,
                active_in_hierarchy = gameObject.activeInHierarchy,
                sibling_index = transform.GetSiblingIndex(),
                rect_transform = includeLayout
                    ? BuildUiRectTransformInfo(rectTransform)
                    : null,
                rect_screen_px = includeLayout
                    ? BuildRectScreenPx(rectTransform, rootCanvas)
                    : null,
                interaction = includeInteraction
                    ? BuildUiInteractionSummary(gameObject, rootCanvas)
                    : null,
                text_metrics = includeTextMetrics
                    ? BuildUiTextMetricsSummary(gameObject, rectTransform, rootCanvas, runtimeWidth, runtimeHeight)
                    : null,
                components = componentsSummary,
                components_summary = componentsSummary,
                children = new UnityUiTreeNode[0],
                children_truncated_count = 0
            };

            if (depth >= maxDepth)
            {
                if (transform.childCount > 0)
                {
                    node.children_truncated_count = transform.childCount;
                    stats.truncated_by_depth = true;
                }
                return node;
            }

            var children = new List<UnityUiTreeNode>(transform.childCount);
            for (var i = 0; i < transform.childCount; i++)
            {
                if (remainingBudget <= 0)
                {
                    node.children_truncated_count += transform.childCount - i;
                    stats.truncated_by_node_budget = true;
                    break;
                }

                var child = transform.GetChild(i);
                if (child == null)
                {
                    continue;
                }

                if (!includeInactive && child.gameObject != null && !child.gameObject.activeInHierarchy)
                {
                    continue;
                }

                var childNode = BuildUiTreeNode(
                    child,
                    depth + 1,
                    maxDepth,
                    includeInactive,
                    includeComponents,
                    includeLayout,
                    includeInteraction,
                    includeTextMetrics,
                    ref remainingBudget,
                    ref stats,
                    runtimeWidth,
                    runtimeHeight);
                if (childNode != null)
                {
                    children.Add(childNode);
                }
            }

            node.children = children.ToArray();
            return node;
        }

        private static UnityUiRectTransformInfo BuildUiRectTransformInfo(RectTransform rectTransform)
        {
            if (rectTransform == null)
            {
                return null;
            }

            return new UnityUiRectTransformInfo
            {
                anchor_min_x = rectTransform.anchorMin.x,
                anchor_min_y = rectTransform.anchorMin.y,
                anchor_max_x = rectTransform.anchorMax.x,
                anchor_max_y = rectTransform.anchorMax.y,
                pivot_x = rectTransform.pivot.x,
                pivot_y = rectTransform.pivot.y,
                anchored_position_x = rectTransform.anchoredPosition.x,
                anchored_position_y = rectTransform.anchoredPosition.y,
                size_delta_x = rectTransform.sizeDelta.x,
                size_delta_y = rectTransform.sizeDelta.y,
                offset_min_x = rectTransform.offsetMin.x,
                offset_min_y = rectTransform.offsetMin.y,
                offset_max_x = rectTransform.offsetMax.x,
                offset_max_y = rectTransform.offsetMax.y
            };
        }

        private static UnityUiInteractionSummary BuildUiInteractionSummary(GameObject gameObject, Canvas rootCanvas)
        {
            if (gameObject == null)
            {
                return null;
            }

            var graphic = gameObject.GetComponent<Graphic>();
            var selectable = gameObject.GetComponent<Selectable>();
            var tmpInput = GetComponentByName(gameObject, "TMP_InputField");
            var hasInteractionComponent = graphic != null || selectable != null || tmpInput != null;
            var raycastTarget = graphic != null && graphic.enabled && graphic.raycastTarget;
            var interactable = hasInteractionComponent && IsGameObjectInteractable(gameObject);
            var blocksRaycast = raycastTarget;

            var canvasGroups = gameObject.GetComponentsInParent<CanvasGroup>(true);
            for (var i = 0; i < canvasGroups.Length; i++)
            {
                var group = canvasGroups[i];
                if (group == null || !group.enabled)
                {
                    continue;
                }

                if (!group.blocksRaycasts)
                {
                    blocksRaycast = false;
                }
                if (!group.interactable)
                {
                    interactable = false;
                }
                if (group.ignoreParentGroups)
                {
                    break;
                }
            }

            var raycaster = rootCanvas == null ? null : rootCanvas.GetComponent<GraphicRaycaster>();
            return new UnityUiInteractionSummary
            {
                raycast_target = raycastTarget,
                interactable = interactable,
                blocks_raycast = blocksRaycast,
                has_graphic_raycaster = raycaster != null && raycaster.isActiveAndEnabled
            };
        }

        private static UnityUiTextMetrics BuildUiTextMetricsSummary(
            GameObject gameObject,
            RectTransform rectTransform,
            Canvas rootCanvas,
            int runtimeWidth,
            int runtimeHeight)
        {
            if (gameObject == null || rectTransform == null)
            {
                return null;
            }

            var text = gameObject.GetComponent<Text>();
            var tmpText = ResolveTmpTextComponent(gameObject);
            if (text == null && tmpText == null)
            {
                return null;
            }

            var rectPx = BuildRectScreenPx(rectTransform, rootCanvas);
            var rectWidth = rectPx == null ? 0f : rectPx.width;
            var rectHeight = rectPx == null ? 0f : rectPx.height;
            if (runtimeWidth > 0)
            {
                rectWidth = Mathf.Min(rectWidth, runtimeWidth);
            }
            if (runtimeHeight > 0)
            {
                rectHeight = Mathf.Min(rectHeight, runtimeHeight);
            }

            var preferredWidth = 0f;
            var preferredHeight = 0f;
            var overflowing = false;
            if (text != null)
            {
                preferredWidth = Mathf.Max(0f, LayoutUtility.GetPreferredWidth(rectTransform));
                preferredHeight = Mathf.Max(0f, LayoutUtility.GetPreferredHeight(rectTransform));
                if (rectWidth > 0.5f && rectHeight > 0.5f)
                {
                    overflowing = preferredWidth > rectWidth + 0.5f ||
                                  preferredHeight > rectHeight + 0.5f;
                }
            }
            else if (tmpText != null)
            {
                ForceTmpMeshUpdate(tmpText);
                preferredWidth = Mathf.Max(0f, ReadFloatProperty(tmpText, "preferredWidth"));
                preferredHeight = Mathf.Max(0f, ReadFloatProperty(tmpText, "preferredHeight"));
                overflowing = ReadBoolProperty(tmpText, "isTextOverflowing", false);
                if (!overflowing && rectWidth > 0.5f && rectHeight > 0.5f)
                {
                    overflowing = preferredWidth > rectWidth + 0.5f ||
                                  preferredHeight > rectHeight + 0.5f;
                }
            }

            return new UnityUiTextMetrics
            {
                overflowing = overflowing,
                preferred_width = preferredWidth,
                preferred_height = preferredHeight
            };
        }

        private static UnityUiComponentSummary[] BuildUiComponentSummaries(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return new UnityUiComponentSummary[0];
            }

            Component[] components;
            try
            {
                components = gameObject.GetComponents<Component>();
            }
            catch
            {
                return new UnityUiComponentSummary[0];
            }

            var result = new List<UnityUiComponentSummary>(Math.Min(components.Length, 10));
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    continue;
                }

                var type = component.GetType();
                if (type == null || !IsUiComponentTypeIncluded(type))
                {
                    continue;
                }

                var behaviour = component as Behaviour;
                result.Add(
                    new UnityUiComponentSummary
                    {
                        type = string.IsNullOrEmpty(type.Name) ? "-" : type.Name,
                        assembly_qualified_name = BuildAssemblyQualifiedName(type),
                        enabled = behaviour == null || behaviour.enabled
                    });
            }

            return result.ToArray();
        }

        private static bool IsUiComponentTypeIncluded(Type type)
        {
            if (type == null)
            {
                return false;
            }

            if (UiComponentTypeAllowList.Contains(type.Name))
            {
                return true;
            }

            var fullName = type.FullName;
            if (string.IsNullOrEmpty(fullName))
            {
                return false;
            }

            if (fullName.StartsWith("UnityEngine.UI.", StringComparison.Ordinal))
            {
                return true;
            }
            if (fullName.StartsWith("TMPro.", StringComparison.Ordinal))
            {
                return true;
            }

            return false;
        }

        private static int CountUiNodes(List<UnityUiTreeNode> nodes)
        {
            if (nodes == null)
            {
                return 0;
            }

            var total = 0;
            for (var i = 0; i < nodes.Count; i++)
            {
                total += CountUiNodes(nodes[i]);
            }
            return total;
        }

        private static int CountUiNodes(UnityUiTreeNode[] nodes)
        {
            if (nodes == null)
            {
                return 0;
            }

            var total = 0;
            for (var i = 0; i < nodes.Length; i++)
            {
                total += CountUiNodes(nodes[i]);
            }
            return total;
        }

        private static int CountUiNodes(UnityUiTreeNode node)
        {
            if (node == null)
            {
                return 0;
            }

            var count = 1;
            if (node.children == null)
            {
                return count;
            }

            for (var i = 0; i < node.children.Length; i++)
            {
                count += CountUiNodes(node.children[i]);
            }

            return count;
        }

        private static void ApplyUiTreeCharBudget(
            UnityGetUiTreeData data,
            int charBudget,
            ref UiTreeBuildStats stats)
        {
            if (data == null || charBudget <= 0)
            {
                return;
            }

            if (JsonUtility.ToJson(data).Length <= charBudget)
            {
                return;
            }

            stats.truncated_by_char_budget = true;
            if (data.roots != null)
            {
                for (var i = 0; i < data.roots.Length; i++)
                {
                    CollapseUiChildren(data.roots[i]);
                }
            }

            if (JsonUtility.ToJson(data).Length <= charBudget)
            {
                return;
            }

            data.roots = new UnityUiTreeNode[0];
            data.canvases = new UnityUiCanvasInfo[0];
        }

        private static void CollapseUiChildren(UnityUiTreeNode node)
        {
            if (node == null || node.children == null || node.children.Length == 0)
            {
                return;
            }

            node.children_truncated_count += node.children.Length;
            node.children = new UnityUiTreeNode[0];
        }

        private static string BuildUiTreeTruncatedReason(UiTreeBuildStats stats)
        {
            var reasons = new List<string>(3);
            if (stats.truncated_by_depth)
            {
                reasons.Add("depth_limit");
            }
            if (stats.truncated_by_node_budget)
            {
                reasons.Add("node_budget");
            }
            if (stats.truncated_by_char_budget)
            {
                reasons.Add("char_budget");
            }

            return string.Join("+", reasons.ToArray());
        }

        private static string NormalizeUiSystem(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value)
                ? string.Empty
                : value.Trim().ToLowerInvariant();
            if (string.Equals(normalized, "ugui", StringComparison.Ordinal))
            {
                return "ugui";
            }
            if (string.Equals(normalized, "uitk", StringComparison.Ordinal))
            {
                return "uitk";
            }
            return "auto";
        }

        private struct UiTreeBuildStats
        {
            public int returned_node_count;
            public bool truncated_by_depth;
            public bool truncated_by_node_budget;
            public bool truncated_by_char_budget;
        }


    }
}
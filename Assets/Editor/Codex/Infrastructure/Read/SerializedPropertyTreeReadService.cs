using System;
using System.Collections.Generic;
using System.Globalization;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        public UnityGetSerializedPropertyTreeResponse GetSerializedPropertyTree(
            UnityGetSerializedPropertyTreeRequest request)
        {
            return SerializedPropertyTreeReadService.Execute(request);
        }

        private static class SerializedPropertyTreeReadService
        {
            private const int DefaultDepth = 1;
            private const int MaxDepth = 16;
            private const int DefaultPageSize = 64;
            private const int MaxPageSize = 256;
            private const int DefaultNodeBudget = 128;
            private const int MaxNodeBudget = 2048;
            private const int DefaultCharBudget = 12000;
            private const int MaxCharBudget = 120000;
            private const int MinCharBudget = 256;
            private const int MaxComponentSelectors = 8;
            private const int MaxValueSummaryLength = 120;

            internal static UnityGetSerializedPropertyTreeResponse Execute(
                UnityGetSerializedPropertyTreeRequest request)
            {
                var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
                var payload = request == null ? null : request.payload;
                if (payload == null)
                {
                    return BuildGetSerializedPropertyTreeFailure(
                        requestId,
                        "E_SCHEMA_INVALID",
                        "payload is required.");
                }

                string errorCode;
                string errorMessage;

                var target = ResolveTarget(payload.target_anchor, out errorCode, out errorMessage);
                if (target == null)
                {
                    return BuildGetSerializedPropertyTreeFailure(requestId, errorCode, errorMessage);
                }

                SerializedPropertyComponentSelector[] selectors;
                if (!TryResolveComponentSelectors(payload, out selectors, out errorCode, out errorMessage))
                {
                    return BuildGetSerializedPropertyTreeFailure(requestId, errorCode, errorMessage);
                }

                var depth = ClampInRange(payload.depth, DefaultDepth, 0, MaxDepth);
                var pageSize = ClampInRange(payload.page_size, DefaultPageSize, 1, MaxPageSize);
                var nodeBudget = ClampInRange(payload.node_budget, DefaultNodeBudget, 1, MaxNodeBudget);
                var charBudget = ClampInRange(payload.char_budget, DefaultCharBudget, MinCharBudget, MaxCharBudget);
                var includeValueSummary = payload.include_value_summary;
                var includeNonVisible = payload.include_non_visible;
                var rootPropertyPath = NormalizeText(payload.root_property_path);
                var afterPropertyPath = NormalizeText(payload.after_property_path);
                if (selectors.Length > 1 && !string.IsNullOrEmpty(afterPropertyPath))
                {
                    return BuildGetSerializedPropertyTreeFailure(
                        requestId,
                        "E_SCHEMA_INVALID",
                        "after_property_path is only supported when querying a single component.");
                }
                if (selectors.Length > nodeBudget)
                {
                    return BuildGetSerializedPropertyTreeFailure(
                        requestId,
                        "E_SCHEMA_INVALID",
                        "component selector count exceeds node_budget.");
                }

                var targetPath = BuildObjectPath(target.transform, "Scene");
                var targetObjectId = BuildObjectId(target);
                var componentResults = new List<UnitySerializedPropertyTreeComponentData>(selectors.Length);
                var selectorCount = selectors.Length;
                var multiComponentMode = selectorCount > 1;

                for (var selectorIndex = 0; selectorIndex < selectorCount; selectorIndex++)
                {
                    var selector = selectors[selectorIndex];
                    var selectorPath = selectorCount == 1
                        ? "component_selector"
                        : "component_selectors[" + selectorIndex.ToString(CultureInfo.InvariantCulture) + "]";
                    var component = ResolveComponent(
                        target,
                        selector,
                        selectorPath,
                        out errorCode,
                        out errorMessage);
                    if (component == null)
                    {
                        return BuildGetSerializedPropertyTreeFailure(requestId, errorCode, errorMessage);
                    }

                    var componentPageSize = multiComponentMode
                        ? Math.Min(pageSize, GetBudgetShare(nodeBudget, selectorCount, selectorIndex))
                        : pageSize;
                    var componentNodeBudget = multiComponentMode
                        ? GetBudgetShare(nodeBudget, selectorCount, selectorIndex)
                        : nodeBudget;
                    var componentCharBudget = multiComponentMode
                        ? GetBudgetShare(charBudget, selectorCount, selectorIndex)
                        : charBudget;
                    if (componentPageSize < 1)
                    {
                        componentPageSize = 1;
                    }
                    if (componentNodeBudget < 1)
                    {
                        componentNodeBudget = 1;
                    }
                    if (componentCharBudget < 1)
                    {
                        componentCharBudget = 1;
                    }

                    var serializedObject = new SerializedObject(component);
                    var rootProperty = ResolveRootProperty(
                        serializedObject,
                        rootPropertyPath,
                        out errorCode,
                        out errorMessage);
                    if (!string.IsNullOrEmpty(errorCode))
                    {
                        return BuildGetSerializedPropertyTreeFailure(requestId, errorCode, errorMessage);
                    }

                    var nodes = new List<UnitySerializedPropertyTreeNode>(
                        Math.Min(componentPageSize, componentNodeBudget));
                    var traversal = TraverseProperties(
                        serializedObject,
                        rootProperty,
                        afterPropertyPath,
                        depth,
                        componentPageSize,
                        componentNodeBudget,
                        componentCharBudget,
                        includeValueSummary,
                        includeNonVisible,
                        component.GetType(),
                        nodes);
                    if (!traversal.ok)
                    {
                        return BuildGetSerializedPropertyTreeFailure(requestId, traversal.error_code, traversal.error_message);
                    }

                    componentResults.Add(new UnitySerializedPropertyTreeComponentData
                    {
                        selector_index = selectorIndex,
                        component = new UnitySerializedPropertyTreeComponentInfo
                        {
                            type = BuildAssemblyQualifiedName(component.GetType()),
                            target_path = targetPath,
                            target_object_id = targetObjectId
                        },
                        returned_count = nodes.Count,
                        truncated = traversal.truncated,
                        truncated_reason = traversal.truncated_reason,
                        next_cursor = traversal.next_cursor,
                        nodes = nodes.ToArray()
                    });
                }

                var primaryResult = componentResults.Count > 0 ? componentResults[0] : null;
                var data = new UnityGetSerializedPropertyTreeData
                {
                    component = primaryResult == null ? null : primaryResult.component,
                    components = componentResults.ToArray(),
                    root_property_path = rootPropertyPath,
                    depth = depth,
                    after_property_path = afterPropertyPath,
                    page_size = pageSize,
                    node_budget = nodeBudget,
                    char_budget = charBudget,
                    include_value_summary = includeValueSummary,
                    include_non_visible = includeNonVisible,
                    returned_count = primaryResult == null ? 0 : primaryResult.returned_count,
                    truncated = primaryResult != null && primaryResult.truncated,
                    truncated_reason = primaryResult == null ? string.Empty : primaryResult.truncated_reason,
                    next_cursor = primaryResult == null ? string.Empty : primaryResult.next_cursor,
                    nodes = primaryResult == null ? new UnitySerializedPropertyTreeNode[0] : primaryResult.nodes
                };

                return new UnityGetSerializedPropertyTreeResponse
                {
                    ok = true,
                    request_id = requestId,
                    captured_at = NowIso(),
                    error_code = string.Empty,
                    error_message = string.Empty,
                    read_token = BuildReadToken("scene", targetObjectId, targetPath),
                    data = data
                };
            }

            private static SerializedProperty ResolveRootProperty(
                SerializedObject serializedObject,
                string rootPropertyPath,
                out string errorCode,
                out string errorMessage)
            {
                errorCode = string.Empty;
                errorMessage = string.Empty;
                if (serializedObject == null || string.IsNullOrEmpty(rootPropertyPath))
                {
                    return null;
                }

                var root = serializedObject.FindProperty(rootPropertyPath);
                if (root == null)
                {
                    errorCode = "E_PROPERTY_NOT_FOUND";
                    errorMessage = "root_property_path not found: " + rootPropertyPath;
                    return null;
                }

                return root;
            }

            private static TraversalOutcome TraverseProperties(
                SerializedObject serializedObject,
                SerializedProperty rootProperty,
                string afterPropertyPath,
                int depthLimit,
                int pageSize,
                int nodeBudget,
                int charBudget,
                bool includeValueSummary,
                bool includeNonVisible,
                Type componentType,
                List<UnitySerializedPropertyTreeNode> nodes)
            {
                if (serializedObject == null || nodes == null)
                {
                    return TraversalOutcome.Fail("E_QUERY_HANDLER_FAILED", "SerializedProperty traversal state is invalid.");
                }

                var iterator = rootProperty == null
                    ? serializedObject.GetIterator()
                    : rootProperty.Copy();
                var end = rootProperty == null ? null : rootProperty.GetEndProperty();
                var baseDepth = rootProperty == null ? 0 : rootProperty.depth;
                var hasCurrent = rootProperty != null;
                var isFirst = true;
                if (rootProperty == null)
                {
                    hasCurrent = MoveNextProperty(iterator, includeNonVisible, true);
                }

                var cursorSatisfied = string.IsNullOrEmpty(afterPropertyPath);
                var cursorFound = cursorSatisfied;
                var totalChars = 0;
                var lastReturnedPath = string.Empty;

                while (hasCurrent)
                {
                    if (rootProperty != null &&
                        !isFirst &&
                        SerializedProperty.EqualContents(iterator, end))
                    {
                        break;
                    }

                    var relativeDepth = rootProperty == null
                        ? iterator.depth
                        : iterator.depth - baseDepth;
                    if (relativeDepth >= 0 && relativeDepth <= depthLimit)
                    {
                        var propertyPath = NormalizeText(iterator.propertyPath);
                        if (cursorSatisfied)
                        {
                            if (nodes.Count >= pageSize)
                            {
                                return TraversalOutcome.Truncated(
                                    "PAGE_SIZE_EXCEEDED",
                                    lastReturnedPath,
                                    nodes.Count,
                                    totalChars);
                            }

                            if (nodes.Count >= nodeBudget)
                            {
                                return TraversalOutcome.Truncated(
                                    "NODE_BUDGET_EXCEEDED",
                                    lastReturnedPath,
                                    nodes.Count,
                                    totalChars);
                            }

                            var node = BuildNode(iterator, relativeDepth, includeValueSummary, componentType);
                            var estimated = EstimateNodeCost(node);
                            if (nodes.Count > 0 && totalChars + estimated > charBudget)
                            {
                                return TraversalOutcome.Truncated(
                                    "CHAR_BUDGET_EXCEEDED",
                                    lastReturnedPath,
                                    nodes.Count,
                                    totalChars);
                            }

                            nodes.Add(node);
                            totalChars += estimated;
                            lastReturnedPath = propertyPath;
                        }
                        else if (string.Equals(propertyPath, afterPropertyPath, StringComparison.Ordinal))
                        {
                            cursorSatisfied = true;
                            cursorFound = true;
                        }
                    }

                    var enterChildren = relativeDepth < depthLimit;
                    hasCurrent = MoveNextProperty(iterator, includeNonVisible, enterChildren);
                    isFirst = false;
                }

                if (!cursorFound)
                {
                    return TraversalOutcome.Fail(
                        "E_CURSOR_NOT_FOUND",
                        "after_property_path not found: " + afterPropertyPath);
                }

                return TraversalOutcome.Success(nodes.Count, totalChars);
            }

            private static bool MoveNextProperty(
                SerializedProperty iterator,
                bool includeNonVisible,
                bool enterChildren)
            {
                if (iterator == null)
                {
                    return false;
                }

                return includeNonVisible
                    ? iterator.Next(enterChildren)
                    : iterator.NextVisible(enterChildren);
            }

            private static UnitySerializedPropertyTreeNode BuildNode(
                SerializedProperty property,
                int depth,
                bool includeValueSummary,
                Type componentType)
            {
                var propertyPath = NormalizeText(property == null ? string.Empty : property.propertyPath);
                var displayName = NormalizeText(property == null ? string.Empty : property.displayName);
                var propertyType = property == null
                    ? string.Empty
                    : property.propertyType.ToString();
                var isArray = property != null &&
                              property.isArray &&
                              property.propertyType != SerializedPropertyType.String;
                var arraySize = isArray ? property.arraySize : 0;
                var writable = property != null && property.editable && !IsScriptProperty(propertyPath);
                var readOnlyReason = writable
                    ? string.Empty
                    : BuildReadOnlyReason(property, propertyPath);
                var valueSummary = includeValueSummary ? BuildValueSummary(property) : string.Empty;
                var hasVisibleChildren = property != null && property.hasVisibleChildren;
                var commonUse = IsCommonUseProperty(componentType, propertyPath, property);
                var llmHint = BuildLlmHint(componentType, propertyPath, property, writable, readOnlyReason, commonUse);

                return new UnitySerializedPropertyTreeNode
                {
                    property_path = propertyPath,
                    display_name = displayName,
                    property_type = propertyType,
                    is_array = isArray,
                    array_size = arraySize,
                    depth = depth < 0 ? 0 : depth,
                    writable = writable,
                    read_only_reason = readOnlyReason,
                    value_summary = valueSummary,
                    has_visible_children = hasVisibleChildren,
                    common_use = commonUse,
                    llm_hint = llmHint
                };
            }

            private static bool IsCommonUseProperty(
                Type componentType,
                string propertyPath,
                SerializedProperty property)
            {
                if (string.IsNullOrEmpty(propertyPath))
                {
                    return false;
                }

                if (string.Equals(propertyPath, "m_Enabled", StringComparison.Ordinal) ||
                    string.Equals(propertyPath, "m_IsActive", StringComparison.Ordinal) ||
                    string.Equals(propertyPath, "m_Name", StringComparison.Ordinal) ||
                    string.Equals(propertyPath, "m_TagString", StringComparison.Ordinal) ||
                    string.Equals(propertyPath, "m_Layer", StringComparison.Ordinal))
                {
                    return true;
                }

                var typeName = componentType == null ? string.Empty : NormalizeText(componentType.Name);
                if (string.Equals(typeName, "Transform", StringComparison.Ordinal) ||
                    string.Equals(typeName, "RectTransform", StringComparison.Ordinal))
                {
                    if (string.Equals(propertyPath, "m_LocalPosition", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_LocalRotation", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_LocalScale", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_AnchoredPosition", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_SizeDelta", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_AnchorMin", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_AnchorMax", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_Pivot", StringComparison.Ordinal))
                    {
                        return true;
                    }
                }

                if (string.Equals(typeName, "Image", StringComparison.Ordinal) ||
                    string.Equals(typeName, "RawImage", StringComparison.Ordinal))
                {
                    if (string.Equals(propertyPath, "m_Color", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_RaycastTarget", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_Sprite", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_Texture", StringComparison.Ordinal))
                    {
                        return true;
                    }
                }

                if (string.Equals(typeName, "Text", StringComparison.Ordinal) ||
                    string.Equals(typeName, "TMP_Text", StringComparison.Ordinal) ||
                    string.Equals(typeName, "TextMeshProUGUI", StringComparison.Ordinal))
                {
                    if (PathEndsWith(propertyPath, "m_Text") ||
                        PathEndsWith(propertyPath, "m_FontSize") ||
                        PathEndsWith(propertyPath, "m_Color"))
                    {
                        return true;
                    }
                }

                if (string.Equals(typeName, "CanvasGroup", StringComparison.Ordinal))
                {
                    if (string.Equals(propertyPath, "m_Alpha", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_Interactable", StringComparison.Ordinal) ||
                        string.Equals(propertyPath, "m_BlocksRaycasts", StringComparison.Ordinal))
                    {
                        return true;
                    }
                }

                return property != null &&
                       property.propertyType == SerializedPropertyType.Boolean &&
                       (PathEndsWith(propertyPath, "enabled") ||
                        PathEndsWith(propertyPath, "raycastTarget") ||
                        PathEndsWith(propertyPath, "interactable"));
            }

            private static string BuildLlmHint(
                Type componentType,
                string propertyPath,
                SerializedProperty property,
                bool writable,
                string readOnlyReason,
                bool commonUse)
            {
                if (!writable)
                {
                    if (string.Equals(readOnlyReason, "script_reference_read_only", StringComparison.Ordinal))
                    {
                        return "Read-only Unity script reference; cannot be changed via set_serialized_property.";
                    }

                    return string.Empty;
                }

                if (property == null)
                {
                    return string.Empty;
                }

                switch (property.propertyType)
                {
                    case SerializedPropertyType.Integer:
                    case SerializedPropertyType.ArraySize:
                        return "Use value_kind=integer with int_value.";

                    case SerializedPropertyType.Float:
                        return "Use value_kind=float with float_value.";

                    case SerializedPropertyType.Boolean:
                        return "Use value_kind=bool with bool_value.";

                    case SerializedPropertyType.String:
                        return "Use value_kind=string with string_value.";

                    case SerializedPropertyType.Enum:
                        return "Use value_kind=enum with enum_name or enum_value.";

                    case SerializedPropertyType.Vector2:
                        return "Use value_kind=vector2 with vector2_value{x,y}.";

                    case SerializedPropertyType.Vector3:
                        return "Use value_kind=vector3 with vector3_value{x,y,z}.";

                    case SerializedPropertyType.Vector4:
                        return "Use value_kind=vector4 with vector4_value{x,y,z,w}.";

                    case SerializedPropertyType.Quaternion:
                        return "Use value_kind=quaternion with quaternion_value{x,y,z,w}.";

                    case SerializedPropertyType.Color:
                        return "Use value_kind=color with color_value{r,g,b,a}.";

                    case SerializedPropertyType.Rect:
                        return "Use value_kind=rect with rect_value{x,y,width,height}.";

                    case SerializedPropertyType.ObjectReference:
                        return "Use value_kind=object_reference with scene_anchor or asset_guid/asset_path.";
                }

                if (property.isArray && property.propertyType != SerializedPropertyType.String)
                {
                    return "Use value_kind=array with op=set/insert/remove/clear.";
                }

                if (commonUse)
                {
                    var componentName = componentType == null ? "Component" : NormalizeText(componentType.Name);
                    if (string.IsNullOrEmpty(componentName))
                    {
                        componentName = "Component";
                    }

                    return componentName + " common-use property.";
                }

                return string.Empty;
            }

            private static bool PathEndsWith(string propertyPath, string suffix)
            {
                if (string.IsNullOrEmpty(propertyPath) || string.IsNullOrEmpty(suffix))
                {
                    return false;
                }

                if (propertyPath.EndsWith(suffix, StringComparison.Ordinal))
                {
                    return true;
                }

                return propertyPath.EndsWith("." + suffix, StringComparison.Ordinal);
            }

            private static string BuildReadOnlyReason(SerializedProperty property, string propertyPath)
            {
                if (IsScriptProperty(propertyPath))
                {
                    return "script_reference_read_only";
                }

                if (property == null)
                {
                    return "property_not_editable";
                }

                if (!property.editable)
                {
                    return "property_not_editable";
                }

                return "read_only";
            }

            private static bool IsScriptProperty(string propertyPath)
            {
                return string.Equals(propertyPath, "m_Script", StringComparison.Ordinal);
            }

            private static string BuildValueSummary(SerializedProperty property)
            {
                if (property == null)
                {
                    return string.Empty;
                }

                if (property.isArray && property.propertyType != SerializedPropertyType.String)
                {
                    return "size=" + property.arraySize.ToString(CultureInfo.InvariantCulture);
                }

                switch (property.propertyType)
                {
                    case SerializedPropertyType.Integer:
                    case SerializedPropertyType.ArraySize:
                        return property.intValue.ToString(CultureInfo.InvariantCulture);

                    case SerializedPropertyType.Boolean:
                        return property.boolValue ? "true" : "false";

                    case SerializedPropertyType.Float:
                        return property.floatValue.ToString("0.###", CultureInfo.InvariantCulture);

                    case SerializedPropertyType.String:
                        return TruncateSummary(property.stringValue);

                    case SerializedPropertyType.Enum:
                        return BuildEnumSummary(property);

                    case SerializedPropertyType.Vector2:
                    {
                        var value = property.vector2Value;
                        return "(" +
                               value.x.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               value.y.ToString("0.###", CultureInfo.InvariantCulture) +
                               ")";
                    }

                    case SerializedPropertyType.Vector3:
                    {
                        var value = property.vector3Value;
                        return "(" +
                               value.x.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               value.y.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               value.z.ToString("0.###", CultureInfo.InvariantCulture) +
                               ")";
                    }

                    case SerializedPropertyType.Color:
                    {
                        var value = property.colorValue;
                        return "(" +
                               value.r.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               value.g.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               value.b.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               value.a.ToString("0.###", CultureInfo.InvariantCulture) +
                               ")";
                    }

                    case SerializedPropertyType.ObjectReference:
                        return BuildObjectReferenceSummary(property.objectReferenceValue);

                    case SerializedPropertyType.LayerMask:
                        return property.intValue.ToString(CultureInfo.InvariantCulture);

                    case SerializedPropertyType.Rect:
                    {
                        var rect = property.rectValue;
                        return "(" +
                               rect.x.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               rect.y.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               rect.width.ToString("0.###", CultureInfo.InvariantCulture) +
                               "," +
                               rect.height.ToString("0.###", CultureInfo.InvariantCulture) +
                               ")";
                    }

                    case SerializedPropertyType.Character:
                        return property.intValue.ToString(CultureInfo.InvariantCulture);
                }

                return string.Empty;
            }

            private static string BuildEnumSummary(SerializedProperty property)
            {
                if (property == null)
                {
                    return string.Empty;
                }

                var index = property.enumValueIndex;
                var label = index >= 0 && property.enumDisplayNames != null && index < property.enumDisplayNames.Length
                    ? property.enumDisplayNames[index]
                    : index.ToString(CultureInfo.InvariantCulture);
                return TruncateSummary(label + "(" + index.ToString(CultureInfo.InvariantCulture) + ")");
            }

            private static string BuildObjectReferenceSummary(UnityEngine.Object obj)
            {
                if (obj == null)
                {
                    return "null";
                }

                var typeName = obj.GetType() == null || string.IsNullOrEmpty(obj.GetType().Name)
                    ? "Object"
                    : obj.GetType().Name;
                var name = string.IsNullOrEmpty(obj.name) ? "-" : obj.name;
                var assetPath = AssetDatabase.GetAssetPath(obj);
                if (!string.IsNullOrEmpty(assetPath))
                {
                    return TruncateSummary(typeName + ":" + name + "@" + NormalizePath(assetPath));
                }

                var gameObject = obj as GameObject;
                if (gameObject != null)
                {
                    return TruncateSummary(typeName + ":" + name + "@Scene/" + BuildObjectPath(gameObject.transform, string.Empty));
                }

                var component = obj as Component;
                if (component != null && component.gameObject != null)
                {
                    return TruncateSummary(typeName + ":" + name + "@Scene/" + BuildObjectPath(component.transform, string.Empty));
                }

                return TruncateSummary(typeName + ":" + name);
            }

            private static string TruncateSummary(string value)
            {
                var normalized = string.IsNullOrEmpty(value) ? string.Empty : value;
                if (normalized.Length <= MaxValueSummaryLength)
                {
                    return normalized;
                }

                return normalized.Substring(0, MaxValueSummaryLength).TrimEnd() + "...";
            }

            private static int EstimateNodeCost(UnitySerializedPropertyTreeNode node)
            {
                if (node == null)
                {
                    return 0;
                }

                var total = 48;
                total += StringLength(node.property_path);
                total += StringLength(node.display_name);
                total += StringLength(node.property_type);
                total += StringLength(node.read_only_reason);
                total += StringLength(node.value_summary);
                total += StringLength(node.llm_hint);
                total += 8;
                return total;
            }

            private static int StringLength(string value)
            {
                return string.IsNullOrEmpty(value) ? 0 : value.Length;
            }

            private static GameObject ResolveTarget(
                UnityObjectAnchor anchor,
                out string errorCode,
                out string errorMessage)
            {
                errorCode = string.Empty;
                errorMessage = string.Empty;
                if (anchor == null)
                {
                    errorCode = "E_SCHEMA_INVALID";
                    errorMessage = "target_anchor is required.";
                    return null;
                }

                var requestedObjectId = NormalizeText(anchor.object_id);
                var requestedPath = NormalizePath(anchor.path);
                if (string.IsNullOrEmpty(requestedObjectId) || string.IsNullOrEmpty(requestedPath))
                {
                    errorCode = "E_SCHEMA_INVALID";
                    errorMessage = "target_anchor requires both object_id and path.";
                    return null;
                }

                var fromPathTransform = FindTransformByScenePath(requestedPath);
                if (fromPathTransform == null || fromPathTransform.gameObject == null)
                {
                    errorCode = "E_TARGET_NOT_FOUND";
                    errorMessage = "target_anchor.path not found: " + requestedPath;
                    return null;
                }

                var fromPath = fromPathTransform.gameObject;
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
                        errorCode = "E_TARGET_NOT_FOUND";
                        errorMessage = "target_anchor.object_id not found: " + requestedObjectId;
                        return null;
                    }
                }

                if (!ReferenceEquals(fromPath, fromObjectId))
                {
                    errorCode = "E_TARGET_ANCHOR_CONFLICT";
                    errorMessage =
                        "target_anchor object_id/path resolve to different objects: object_id=" +
                        requestedObjectId +
                        ", path=" +
                        requestedPath;
                    return null;
                }

                return fromObjectId;
            }

            private static GameObject FindGameObjectByObjectId(string objectId)
            {
                var normalized = NormalizeText(objectId);
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

            private static bool TryResolveComponentSelectors(
                UnityGetSerializedPropertyTreePayload payload,
                out SerializedPropertyComponentSelector[] selectors,
                out string errorCode,
                out string errorMessage)
            {
                selectors = new SerializedPropertyComponentSelector[0];
                errorCode = string.Empty;
                errorMessage = string.Empty;
                if (payload == null)
                {
                    errorCode = "E_SCHEMA_INVALID";
                    errorMessage = "payload is required.";
                    return false;
                }

                var buffer = new List<SerializedPropertyComponentSelector>();
                if (payload.component_selector != null)
                {
                    buffer.Add(payload.component_selector);
                }

                var many = payload.component_selectors;
                if (many != null)
                {
                    for (var i = 0; i < many.Length; i++)
                    {
                        var selector = many[i];
                        if (selector == null)
                        {
                            errorCode = "E_SCHEMA_INVALID";
                            errorMessage =
                                "component_selectors[" +
                                i.ToString(CultureInfo.InvariantCulture) +
                                "] is required.";
                            return false;
                        }

                        buffer.Add(selector);
                    }
                }

                if (buffer.Count == 0)
                {
                    errorCode = "E_SCHEMA_INVALID";
                    errorMessage = "component_selector or component_selectors is required.";
                    return false;
                }

                var distinct = new List<SerializedPropertyComponentSelector>(buffer.Count);
                var seen = new HashSet<string>(StringComparer.Ordinal);
                for (var i = 0; i < buffer.Count; i++)
                {
                    var selector = buffer[i];
                    if (selector == null)
                    {
                        continue;
                    }

                    var key = NormalizeText(selector.component_assembly_qualified_name) +
                              "#" +
                              (selector.component_index < 0 ? 0 : selector.component_index).ToString(CultureInfo.InvariantCulture);
                    if (seen.Contains(key))
                    {
                        continue;
                    }

                    seen.Add(key);
                    distinct.Add(selector);
                }

                if (distinct.Count > MaxComponentSelectors)
                {
                    errorCode = "E_SCHEMA_INVALID";
                    errorMessage =
                        "component selectors exceed max limit: " +
                        MaxComponentSelectors.ToString(CultureInfo.InvariantCulture) +
                        ".";
                    return false;
                }

                selectors = distinct.ToArray();
                return true;
            }

            private static Component ResolveComponent(
                GameObject target,
                SerializedPropertyComponentSelector selector,
                string selectorFieldPath,
                out string errorCode,
                out string errorMessage)
            {
                errorCode = string.Empty;
                errorMessage = string.Empty;
                if (target == null)
                {
                    errorCode = "E_TARGET_NOT_FOUND";
                    errorMessage = "Target object not found.";
                    return null;
                }

                if (selector == null)
                {
                    errorCode = "E_SCHEMA_INVALID";
                    errorMessage = selectorFieldPath + " is required.";
                    return null;
                }

                var assemblyQualifiedName = NormalizeText(selector.component_assembly_qualified_name);
                if (string.IsNullOrEmpty(assemblyQualifiedName))
                {
                    errorCode = "E_SCHEMA_INVALID";
                    errorMessage = selectorFieldPath + ".component_assembly_qualified_name is required.";
                    return null;
                }

                var componentType = Type.GetType(assemblyQualifiedName, false);
                Component[] matches;
                if (componentType != null && typeof(Component).IsAssignableFrom(componentType))
                {
                    matches = target.GetComponents(componentType);
                }
                else
                {
                    matches = MatchComponentsByNameFallback(target, assemblyQualifiedName);
                }

                if (matches == null || matches.Length == 0)
                {
                    errorCode = "E_ACTION_COMPONENT_NOT_FOUND";
                    errorMessage = "Component not found on target: " + assemblyQualifiedName;
                    return null;
                }

                var index = selector.component_index < 0 ? 0 : selector.component_index;
                if (index >= matches.Length)
                {
                    errorCode = "E_ACTION_COMPONENT_INDEX_OUT_OF_RANGE";
                    errorMessage =
                        selectorFieldPath +
                        ".component_index is out of range: " +
                        selector.component_index +
                        ", available=" +
                        matches.Length;
                    return null;
                }

                var resolved = matches[index];
                if (resolved == null)
                {
                    errorCode = "E_ACTION_COMPONENT_NOT_FOUND";
                    errorMessage = "Resolved component is null.";
                    return null;
                }

                return resolved;
            }

            private static int GetBudgetShare(int totalBudget, int bucketCount, int bucketIndex)
            {
                var total = totalBudget < 1 ? 1 : totalBudget;
                var count = bucketCount < 1 ? 1 : bucketCount;
                var index = bucketIndex < 0 ? 0 : bucketIndex;

                var baseShare = total / count;
                var remainder = total % count;
                var share = baseShare + (index < remainder ? 1 : 0);
                return share < 1 ? 1 : share;
            }

            private static Component[] MatchComponentsByNameFallback(GameObject target, string query)
            {
                if (target == null || string.IsNullOrEmpty(query))
                {
                    return new Component[0];
                }

                var components = target.GetComponents<Component>();
                var result = new List<Component>(components.Length);
                for (var i = 0; i < components.Length; i++)
                {
                    var component = components[i];
                    if (component == null)
                    {
                        continue;
                    }

                    var type = component.GetType();
                    if (type == null)
                    {
                        continue;
                    }

                    if (string.Equals(BuildAssemblyQualifiedName(type), query, StringComparison.Ordinal) ||
                        string.Equals(type.FullName, query, StringComparison.Ordinal) ||
                        string.Equals(type.Name, query, StringComparison.Ordinal))
                    {
                        result.Add(component);
                    }
                }

                return result.ToArray();
            }

            private static string NormalizeText(string value)
            {
                return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
            }

            private struct TraversalOutcome
            {
                public bool ok;
                public bool truncated;
                public string truncated_reason;
                public string next_cursor;
                public int consumed_nodes;
                public int consumed_chars;
                public string error_code;
                public string error_message;

                public static TraversalOutcome Success(int consumedNodes, int consumedChars)
                {
                    return new TraversalOutcome
                    {
                        ok = true,
                        truncated = false,
                        truncated_reason = string.Empty,
                        next_cursor = string.Empty,
                        consumed_nodes = consumedNodes < 0 ? 0 : consumedNodes,
                        consumed_chars = consumedChars < 0 ? 0 : consumedChars,
                        error_code = string.Empty,
                        error_message = string.Empty
                    };
                }

                public static TraversalOutcome Truncated(
                    string reason,
                    string cursor,
                    int consumedNodes,
                    int consumedChars)
                {
                    return new TraversalOutcome
                    {
                        ok = true,
                        truncated = true,
                        truncated_reason = NormalizeText(reason),
                        next_cursor = NormalizeText(cursor),
                        consumed_nodes = consumedNodes < 0 ? 0 : consumedNodes,
                        consumed_chars = consumedChars < 0 ? 0 : consumedChars,
                        error_code = string.Empty,
                        error_message = string.Empty
                    };
                }

                public static TraversalOutcome Fail(string errorCode, string errorMessage)
                {
                    return new TraversalOutcome
                    {
                        ok = false,
                        truncated = false,
                        truncated_reason = string.Empty,
                        next_cursor = string.Empty,
                        consumed_nodes = 0,
                        consumed_chars = 0,
                        error_code = NormalizeText(errorCode),
                        error_message = NormalizeText(errorMessage)
                    };
                }
            }
        }
    }
}

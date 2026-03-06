using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetLayoutElementSsotExecutor
    {
        public SsotDispatchResponse Execute(SetLayoutElementRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_layout_element request payload is required.",
                    SetLayoutElementRequestDto.ToolName);
            }

            if (!IsFinite(request.min_width) ||
                !IsFinite(request.min_height) ||
                !IsFinite(request.preferred_width) ||
                !IsFinite(request.preferred_height) ||
                !IsFinite(request.flexible_width) ||
                !IsFinite(request.flexible_height))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_layout_element requires finite numeric values.",
                    SetLayoutElementRequestDto.ToolName);
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
                    SetLayoutElementRequestDto.ToolName);
            }

            var layoutElement = target.GetComponent<LayoutElement>();
            if (layoutElement == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_layout_element requires LayoutElement on target.",
                    SetLayoutElementRequestDto.ToolName);
            }

            Undo.RecordObject(layoutElement, "SSOT set_layout_element");
            layoutElement.minWidth = (float)request.min_width;
            layoutElement.minHeight = (float)request.min_height;
            layoutElement.preferredWidth = (float)request.preferred_width;
            layoutElement.preferredHeight = (float)request.preferred_height;
            layoutElement.flexibleWidth = (float)request.flexible_width;
            layoutElement.flexibleHeight = (float)request.flexible_height;
            layoutElement.ignoreLayout = request.ignore_layout;
            EditorUtility.SetDirty(layoutElement);

            return SsotRequestDispatcher.Success(
                SetLayoutElementRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = typeof(LayoutElement).AssemblyQualifiedName,
                    property_path =
                        "minWidth,minHeight,preferredWidth,preferredHeight,flexibleWidth,flexibleHeight,ignoreLayout",
                    value_kind = "layout_element"
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


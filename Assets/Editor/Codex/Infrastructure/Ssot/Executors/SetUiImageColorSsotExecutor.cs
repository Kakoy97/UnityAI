using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class SetUiImageColorSsotExecutor
    {
        public SsotDispatchResponse Execute(SetUiImageColorRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_ui_image_color request payload is required.",
                    SetUiImageColorRequestDto.ToolName);
            }

            if (!IsFinite(request.r) ||
                !IsFinite(request.g) ||
                !IsFinite(request.b) ||
                !IsFinite(request.a))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "set_ui_image_color requires finite rgba values.",
                    SetUiImageColorRequestDto.ToolName);
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
                    SetUiImageColorRequestDto.ToolName);
            }

            var image = target.GetComponent<Image>();
            if (image == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "set_ui_image_color requires UnityEngine.UI.Image on target.",
                    SetUiImageColorRequestDto.ToolName);
            }

            Undo.RecordObject(image, "SSOT set_ui_image_color");
            image.color = new Color(
                (float)request.r,
                (float)request.g,
                (float)request.b,
                (float)request.a);
            EditorUtility.SetDirty(image);

            return SsotRequestDispatcher.Success(
                SetUiImageColorRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = typeof(Image).AssemblyQualifiedName,
                    property_path = "color",
                    value_kind = "color",
                    value_string = string.Format(
                        System.Globalization.CultureInfo.InvariantCulture,
                        "{0},{1},{2},{3}",
                        request.r,
                        request.g,
                        request.b,
                        request.a)
                });
        }

        private static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}


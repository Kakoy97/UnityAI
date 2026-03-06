using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class ReplaceComponentSsotExecutor
    {
        public SsotDispatchResponse Execute(ReplaceComponentRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "replace_component request payload is required.",
                    ReplaceComponentRequestDto.ToolName);
            }

            var sourceTypeName = SsotExecutorCommon.Normalize(request.source_component_type);
            var newTypeName = SsotExecutorCommon.Normalize(request.new_component_type);
            if (string.IsNullOrEmpty(sourceTypeName) || string.IsNullOrEmpty(newTypeName))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "replace_component requires source_component_type and new_component_type.",
                    ReplaceComponentRequestDto.ToolName);
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
                    ReplaceComponentRequestDto.ToolName);
            }

            var sourceType = ResolveComponentType(sourceTypeName);
            var newType = ResolveComponentType(newTypeName);
            if (sourceType == null || !typeof(Component).IsAssignableFrom(sourceType))
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_TYPE_INVALID",
                    "replace_component cannot resolve source_component_type to a Unity Component.",
                    ReplaceComponentRequestDto.ToolName);
            }

            if (newType == null || !typeof(Component).IsAssignableFrom(newType))
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_TYPE_INVALID",
                    "replace_component cannot resolve new_component_type to a Unity Component.",
                    ReplaceComponentRequestDto.ToolName);
            }

            var sourceComponent = target.GetComponent(sourceType);
            if (sourceComponent == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "replace_component target does not contain source component.",
                    ReplaceComponentRequestDto.ToolName);
            }

            if (sourceType == newType)
            {
                return SsotRequestDispatcher.Success(
                    ReplaceComponentRequestDto.ToolName,
                    new SsotDispatchResultData
                    {
                        scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                        target_object_id = SsotExecutorCommon.BuildObjectId(target),
                        target_path = SsotExecutorCommon.BuildScenePath(target),
                        component_type = newType.AssemblyQualifiedName,
                        component_count = target.GetComponents<Component>().Length,
                        components = SsotExecutorCommon.BuildComponentSummaries(target)
                    });
            }

            Undo.DestroyObjectImmediate(sourceComponent);
            var newComponent = Undo.AddComponent(target, newType);
            if (newComponent == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_ADD_FAILED",
                    "replace_component failed to add new component type.",
                    ReplaceComponentRequestDto.ToolName);
            }

            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                ReplaceComponentRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = newComponent.GetType().AssemblyQualifiedName,
                    component_count = target.GetComponents<Component>().Length,
                    components = SsotExecutorCommon.BuildComponentSummaries(target)
                });
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
    }
}


using System;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class RemoveComponentSsotExecutor
    {
        public SsotDispatchResponse Execute(RemoveComponentRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "remove_component request payload is required.",
                    RemoveComponentRequestDto.ToolName);
            }

            var componentTypeName = SsotExecutorCommon.Normalize(request.component_type);
            if (string.IsNullOrEmpty(componentTypeName))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "remove_component requires component_type.",
                    RemoveComponentRequestDto.ToolName);
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
                    RemoveComponentRequestDto.ToolName);
            }

            var componentType = ResolveComponentType(componentTypeName);
            if (componentType == null || !typeof(Component).IsAssignableFrom(componentType))
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_TYPE_INVALID",
                    "remove_component cannot resolve component_type to a Unity Component.",
                    RemoveComponentRequestDto.ToolName);
            }

            var component = target.GetComponent(componentType);
            if (component == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_COMPONENT_NOT_FOUND",
                    "remove_component target does not contain requested component.",
                    RemoveComponentRequestDto.ToolName);
            }

            Undo.DestroyObjectImmediate(component);
            EditorUtility.SetDirty(target);

            return SsotRequestDispatcher.Success(
                RemoveComponentRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(target),
                    target_path = SsotExecutorCommon.BuildScenePath(target),
                    component_type = componentType.AssemblyQualifiedName,
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


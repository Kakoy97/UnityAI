using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Create;
using System;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class CreateObjectSsotExecutor
    {
        private static readonly NameCollisionPolicyService NameCollisionPolicy =
            new NameCollisionPolicyService();

        public SsotDispatchResponse Execute(CreateObjectRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "create_object request payload is required.",
                    CreateObjectRequestDto.ToolName);
            }

            var objectName = SsotExecutorCommon.Normalize(request.new_object_name);
            if (string.IsNullOrEmpty(objectName))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "create_object requires non-empty new_object_name.",
                    CreateObjectRequestDto.ToolName);
            }

            var objectKind = SsotExecutorCommon.Normalize(request.object_kind).ToLowerInvariant();
            if (string.IsNullOrEmpty(objectKind))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "create_object requires object_kind.",
                    CreateObjectRequestDto.ToolName);
            }

            GameObject parent;
            string errorCode;
            string errorMessage;
            if (!SsotExecutorCommon.TryResolveTargetFromAnchor(
                    request.parent_path,
                    request.parent_object_id,
                    out parent,
                    out errorCode,
                    out errorMessage))
            {
                return SsotRequestDispatcher.Failure(
                    errorCode,
                    errorMessage,
                    CreateObjectRequestDto.ToolName);
            }

            var preCheckEnabled = SsotCreateFamilyContract.PreCheckEnabled;
            var resolvedPolicy = ResolveNameCollisionPolicy(request);
            NameCollisionDecision collisionDecision = null;
            if (preCheckEnabled)
            {
                collisionDecision = NameCollisionPolicy.Evaluate(
                    parent.transform,
                    objectName,
                    resolvedPolicy);
                if (collisionDecision == null)
                {
                    return SsotRequestDispatcher.Failure(
                        "E_NAME_COLLISION_POLICY_INVALID",
                        "name collision policy decision is missing for create_object.",
                        CreateObjectRequestDto.ToolName);
                }
            }

            if (collisionDecision != null && !collisionDecision.CanProceed)
            {
                return SsotRequestDispatcher.Failure(
                    collisionDecision.ErrorCode,
                    collisionDecision.ErrorMessage,
                    CreateObjectRequestDto.ToolName,
                    new SsotDispatchResultData
                    {
                        scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                        target_object_name = objectName,
                        target_path = collisionDecision.ExistingCandidatePath,
                        existing_candidates_count = collisionDecision.ExistingCandidatesCount,
                        existing_candidate_path = collisionDecision.ExistingCandidatePath,
                        applied_policy = collisionDecision.AppliedPolicy,
                        pre_check_existing = preCheckEnabled
                    });
            }

            var effectiveName = string.IsNullOrEmpty(
                                    SsotExecutorCommon.Normalize(collisionDecision == null ? string.Empty : collisionDecision.ResolvedName))
                ? objectName
                : collisionDecision.ResolvedName;
            var reusedObject = collisionDecision == null ? null : collisionDecision.ReusedObject;
            var created = reusedObject ?? CreateByKind(objectKind, effectiveName);
            if (created == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "Unsupported object_kind for create_object.",
                    CreateObjectRequestDto.ToolName);
            }

            if (reusedObject == null)
            {
                Undo.RegisterCreatedObjectUndo(created, "SSOT create_object");
                created.transform.SetParent(parent.transform, false);
            }

            created.SetActive(request.set_active);
            EditorUtility.SetDirty(created);
            EditorUtility.SetDirty(parent);

            return SsotRequestDispatcher.Success(
                CreateObjectRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    target_object_id = SsotExecutorCommon.BuildObjectId(created),
                    target_path = SsotExecutorCommon.BuildScenePath(created),
                    target_object_name = created.name,
                    target_object_active = created.activeSelf,
                    existing_candidates_count = collisionDecision == null ? 0 : collisionDecision.ExistingCandidatesCount,
                    existing_candidate_path = collisionDecision == null ? string.Empty : collisionDecision.ExistingCandidatePath,
                    applied_policy = resolvedPolicy,
                    pre_check_existing = preCheckEnabled
                });
        }

        private static string ResolveNameCollisionPolicy(CreateObjectRequestDto request)
        {
            var requested = SsotExecutorCommon.Normalize(request == null ? string.Empty : request.name_collision_policy)
                .ToLowerInvariant();
            if (string.IsNullOrEmpty(requested))
            {
                return SsotExecutorCommon.Normalize(SsotCreateFamilyContract.DefaultOnConflict)
                    .ToLowerInvariant();
            }

            var allowed = SsotCreateFamilyContract.AllowedOnConflictPolicies;
            if (allowed != null)
            {
                for (var index = 0; index < allowed.Length; index += 1)
                {
                    var token = SsotExecutorCommon.Normalize(allowed[index]).ToLowerInvariant();
                    if (string.Equals(token, requested, StringComparison.Ordinal))
                    {
                        return requested;
                    }
                }
            }

            return SsotExecutorCommon.Normalize(SsotCreateFamilyContract.DefaultOnConflict)
                .ToLowerInvariant();
        }

        private static GameObject CreateByKind(string objectKind, string objectName)
        {
            switch (objectKind)
            {
                case "empty":
                    return new GameObject(objectName);
                case "camera":
                    return new GameObject(objectName, typeof(Camera));
                case "light":
                    return new GameObject(objectName, typeof(Light));
                case "ui_panel":
                    return new GameObject(
                        objectName,
                        typeof(RectTransform),
                        typeof(CanvasRenderer),
                        typeof(Image));
                case "ui_button":
                    return new GameObject(
                        objectName,
                        typeof(RectTransform),
                        typeof(CanvasRenderer),
                        typeof(Image),
                        typeof(Button));
                default:
                    return null;
            }
        }
    }
}

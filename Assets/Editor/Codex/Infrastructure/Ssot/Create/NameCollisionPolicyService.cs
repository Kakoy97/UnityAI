using System;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Create
{
    internal sealed class NameCollisionDecision
    {
        internal bool CanProceed;
        internal string ErrorCode;
        internal string ErrorMessage;
        internal string ResolvedName;
        internal GameObject ReusedObject;
        internal int ExistingCandidatesCount;
        internal string ExistingCandidatePath;
        internal string AppliedPolicy;
    }

    internal sealed class NameCollisionPolicyService
    {
        internal const string PolicyFail = "fail";
        internal const string PolicySuffix = "suffix";
        internal const string PolicyReuse = "reuse";

        internal NameCollisionDecision Evaluate(
            Transform parent,
            string desiredName,
            string policy)
        {
            var normalizedName = Normalize(desiredName);
            var normalizedPolicy = Normalize(policy).ToLowerInvariant();
            if (string.IsNullOrEmpty(normalizedPolicy))
            {
                normalizedPolicy = PolicyFail;
            }

            var decision = new NameCollisionDecision
            {
                CanProceed = false,
                ErrorCode = string.Empty,
                ErrorMessage = string.Empty,
                ResolvedName = normalizedName,
                ReusedObject = null,
                ExistingCandidatesCount = 0,
                ExistingCandidatePath = string.Empty,
                AppliedPolicy = normalizedPolicy
            };

            if (parent == null)
            {
                decision.ErrorCode = "E_TARGET_NOT_FOUND";
                decision.ErrorMessage = "Parent transform is required for create policy evaluation.";
                return decision;
            }

            if (string.IsNullOrEmpty(normalizedName))
            {
                decision.ErrorCode = "E_SSOT_SCHEMA_INVALID";
                decision.ErrorMessage = "new_object_name is required.";
                return decision;
            }

            var existing = FindFirstChildByName(parent, normalizedName, out var existingCount);
            decision.ExistingCandidatesCount = existingCount;
            decision.ExistingCandidatePath = existing == null ? string.Empty : BuildScenePath(existing);
            if (existingCount <= 0)
            {
                decision.CanProceed = true;
                return decision;
            }

            if (string.Equals(normalizedPolicy, PolicyFail, StringComparison.Ordinal))
            {
                decision.ErrorCode = "E_NAME_COLLISION_DETECTED";
                decision.ErrorMessage =
                    "Object name collision detected under parent: '" +
                    normalizedName +
                    "' (candidates=" +
                    existingCount.ToString() +
                    ").";
                return decision;
            }

            if (string.Equals(normalizedPolicy, PolicyReuse, StringComparison.Ordinal))
            {
                decision.CanProceed = true;
                decision.ReusedObject = existing;
                decision.ResolvedName = existing == null ? normalizedName : existing.name;
                return decision;
            }

            if (string.Equals(normalizedPolicy, PolicySuffix, StringComparison.Ordinal))
            {
                decision.CanProceed = true;
                decision.ResolvedName = BuildNextSuffixName(parent, normalizedName);
                return decision;
            }

            decision.ErrorCode = "E_NAME_COLLISION_POLICY_INVALID";
            decision.ErrorMessage = "Unsupported name collision policy: " + normalizedPolicy;
            return decision;
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static GameObject FindFirstChildByName(
            Transform parent,
            string desiredName,
            out int candidateCount)
        {
            candidateCount = 0;
            GameObject first = null;
            for (var index = 0; index < parent.childCount; index += 1)
            {
                var child = parent.GetChild(index);
                if (child == null || !string.Equals(child.name, desiredName, StringComparison.Ordinal))
                {
                    continue;
                }

                candidateCount += 1;
                if (first == null)
                {
                    first = child.gameObject;
                }
            }

            return first;
        }

        private static string BuildNextSuffixName(Transform parent, string baseName)
        {
            if (parent == null)
            {
                return baseName;
            }

            for (var suffix = 1; suffix <= 1024; suffix += 1)
            {
                var candidate = baseName + "_" + suffix.ToString();
                if (!HasChildName(parent, candidate))
                {
                    return candidate;
                }
            }

            return baseName + "_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString();
        }

        private static bool HasChildName(Transform parent, string candidateName)
        {
            for (var index = 0; index < parent.childCount; index += 1)
            {
                var child = parent.GetChild(index);
                if (child != null && string.Equals(child.name, candidateName, StringComparison.Ordinal))
                {
                    return true;
                }
            }

            return false;
        }

        private static string BuildScenePath(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            var transform = target.transform;
            var path = transform.name;
            while (transform.parent != null)
            {
                transform = transform.parent;
                path = transform.name + "/" + path;
            }

            return "Scene/" + path;
        }
    }
}

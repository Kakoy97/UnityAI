using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    public static class McpActionGovernance
    {
        public const string DomainGeneral = "general";
        public const string DomainGameObject = "gameobject";
        public const string DomainComponent = "component";
        public const string DomainTransform = "transform";
        public const string DomainRectTransform = "rect_transform";
        public const string DomainUi = "ui";
        public const string DomainPrefab = "prefab";
        public const string DomainScene = "scene";
        public const string DomainComposite = "composite";

        public const string TierCore = "core";
        public const string TierAdvanced = "advanced";
        public const string TierExperimental = "experimental";

        public const string LifecycleDraft = "draft";
        public const string LifecycleExperimental = "experimental";
        public const string LifecycleStable = "stable";
        public const string LifecycleDeprecated = "deprecated";
        public const string LifecycleRemoved = "removed";

        public const string UndoSafetyAtomicSafe = "atomic_safe";
        public const string UndoSafetyNonAtomic = "non_atomic";
    }

    public sealed class McpActionCapability
    {
        private static readonly Regex ActionTypeRegex =
            new Regex("^[a-z][a-z0-9_]{2,63}$", RegexOptions.Compiled);

        private static readonly HashSet<string> AllowedDomains =
            new HashSet<string>(StringComparer.Ordinal)
            {
                McpActionGovernance.DomainGeneral,
                McpActionGovernance.DomainGameObject,
                McpActionGovernance.DomainComponent,
                McpActionGovernance.DomainTransform,
                McpActionGovernance.DomainRectTransform,
                McpActionGovernance.DomainUi,
                McpActionGovernance.DomainPrefab,
                McpActionGovernance.DomainScene,
                McpActionGovernance.DomainComposite,
            };

        private static readonly HashSet<string> AllowedTiers =
            new HashSet<string>(StringComparer.Ordinal)
            {
                McpActionGovernance.TierCore,
                McpActionGovernance.TierAdvanced,
                McpActionGovernance.TierExperimental,
            };

        private static readonly HashSet<string> AllowedLifecycles =
            new HashSet<string>(StringComparer.Ordinal)
            {
                McpActionGovernance.LifecycleDraft,
                McpActionGovernance.LifecycleExperimental,
                McpActionGovernance.LifecycleStable,
                McpActionGovernance.LifecycleDeprecated,
                McpActionGovernance.LifecycleRemoved,
            };

        private static readonly HashSet<string> AllowedUndoSafety =
            new HashSet<string>(StringComparer.Ordinal)
            {
                McpActionGovernance.UndoSafetyAtomicSafe,
                McpActionGovernance.UndoSafetyNonAtomic,
            };

        public McpActionCapability(
            string actionType,
            string description,
            string anchorPolicy,
            string actionDataSchemaJson)
            : this(
                actionType,
                description,
                anchorPolicy,
                actionDataSchemaJson,
                McpActionGovernance.DomainGeneral,
                McpActionGovernance.TierCore,
                McpActionGovernance.LifecycleStable,
                McpActionGovernance.UndoSafetyAtomicSafe,
                string.Empty)
        {
        }

        public McpActionCapability(
            string actionType,
            string description,
            string anchorPolicy,
            string actionDataSchemaJson,
            string domain,
            string tier,
            string lifecycle,
            string undoSafety,
            string replacementActionType)
        {
            ActionType = NormalizeRequired(actionType, "actionType");
            Description = string.IsNullOrWhiteSpace(description) ? string.Empty : description.Trim();
            AnchorPolicy = string.IsNullOrWhiteSpace(anchorPolicy) ? string.Empty : anchorPolicy.Trim();
            ActionDataSchemaJson = string.IsNullOrWhiteSpace(actionDataSchemaJson)
                ? "{}"
                : actionDataSchemaJson.Trim();
            Domain = NormalizeAllowed(
                domain,
                "domain",
                AllowedDomains,
                McpActionGovernance.DomainGeneral);
            Tier = NormalizeAllowed(
                tier,
                "tier",
                AllowedTiers,
                McpActionGovernance.TierCore);
            Lifecycle = NormalizeAllowed(
                lifecycle,
                "lifecycle",
                AllowedLifecycles,
                McpActionGovernance.LifecycleStable);
            UndoSafety = NormalizeAllowed(
                undoSafety,
                "undoSafety",
                AllowedUndoSafety,
                McpActionGovernance.UndoSafetyAtomicSafe);
            ReplacementActionType = string.IsNullOrWhiteSpace(replacementActionType)
                ? string.Empty
                : replacementActionType.Trim();

            if (string.Equals(Lifecycle, McpActionGovernance.LifecycleDeprecated, StringComparison.Ordinal) &&
                string.IsNullOrEmpty(ReplacementActionType))
            {
                throw new ArgumentException(
                    "replacementActionType is required when lifecycle=deprecated.",
                    "replacementActionType");
            }

            if (!string.IsNullOrEmpty(ReplacementActionType))
            {
                ValidateActionTypeName(ReplacementActionType, "replacementActionType");
            }
        }

        public string ActionType { get; private set; }
        public string Description { get; private set; }
        public string AnchorPolicy { get; private set; }
        public string ActionDataSchemaJson { get; private set; }
        public string Domain { get; private set; }
        public string Tier { get; private set; }
        public string Lifecycle { get; private set; }
        public string UndoSafety { get; private set; }
        public string ReplacementActionType { get; private set; }

        public static McpActionCapability CreateDefault(string actionType)
        {
            return new McpActionCapability(actionType, string.Empty, string.Empty, "{}");
        }

        private static string NormalizeRequired(string value, string fieldName)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                throw new ArgumentException(fieldName + " is required.", fieldName);
            }

            var normalized = value.Trim();
            if (string.Equals(fieldName, "actionType", StringComparison.Ordinal))
            {
                ValidateActionTypeName(normalized, fieldName);
            }

            return normalized;
        }

        private static void ValidateActionTypeName(string value, string fieldName)
        {
            if (string.IsNullOrWhiteSpace(value) || !ActionTypeRegex.IsMatch(value.Trim()))
            {
                throw new ArgumentException(
                    fieldName +
                    " must match lower_snake_case pattern ^[a-z][a-z0-9_]{2,63}$.",
                    fieldName);
            }
        }

        private static string NormalizeAllowed(
            string value,
            string fieldName,
            HashSet<string> allowed,
            string fallback)
        {
            var normalized = string.IsNullOrWhiteSpace(value)
                ? fallback
                : value.Trim().ToLowerInvariant();
            if (!allowed.Contains(normalized))
            {
                throw new ArgumentException(
                    fieldName + " is invalid: " + normalized + ".",
                    fieldName);
            }

            return normalized;
        }
    }

    public sealed class McpActionRegistry
    {
        private const int MaxStableActions = 50;
        private const int MaxExperimentalActions = 30;
        private const int MaxStableActionsPerDomain = 12;

        private readonly Dictionary<string, IMcpVisualActionHandler> _handlers =
            new Dictionary<string, IMcpVisualActionHandler>(StringComparer.Ordinal);
        private readonly Dictionary<string, McpActionCapability> _capabilities =
            new Dictionary<string, McpActionCapability>(StringComparer.Ordinal);

        public int Count
        {
            get { return _handlers.Count; }
        }

        public void Register<THandler>(string actionType)
            where THandler : IMcpVisualActionHandler, new()
        {
            Register(actionType, new THandler(), McpActionCapability.CreateDefault(actionType));
        }

        public void Register<THandler>(string actionType, McpActionCapability capability)
            where THandler : IMcpVisualActionHandler, new()
        {
            Register(actionType, new THandler(), capability);
        }

        public void Register(
            string actionType,
            IMcpVisualActionHandler handler,
            McpActionCapability capability)
        {
            var normalizedActionType = NormalizeActionType(actionType, "actionType");
            if (handler == null)
            {
                throw new ArgumentNullException("handler");
            }

            if (_handlers.ContainsKey(normalizedActionType))
            {
                throw new InvalidOperationException(
                    "Visual action handler already registered for action_type '" +
                    normalizedActionType +
                    "'.");
            }

            var declaredActionType = NormalizeActionType(handler.ActionType, "handler.ActionType");
            if (!string.Equals(declaredActionType, normalizedActionType, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "Handler ActionType mismatch: register key='" +
                    normalizedActionType +
                    "', handler.ActionType='" +
                    declaredActionType +
                    "'.");
            }

            var normalizedCapability = capability ?? McpActionCapability.CreateDefault(normalizedActionType);
            if (!string.Equals(
                    normalizedCapability.ActionType,
                    normalizedActionType,
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    "Capability ActionType mismatch: register key='" +
                    normalizedActionType +
                    "', capability.ActionType='" +
                    normalizedCapability.ActionType +
                    "'.");
            }

            ValidateGovernanceBudget(normalizedActionType, normalizedCapability);
            _handlers[normalizedActionType] = handler;
            _capabilities[normalizedActionType] = normalizedCapability;
        }

        public bool TryGet(string actionType, out IMcpVisualActionHandler handler)
        {
            var normalized = string.IsNullOrWhiteSpace(actionType) ? string.Empty : actionType.Trim();
            if (string.IsNullOrEmpty(normalized))
            {
                handler = null;
                return false;
            }

            return _handlers.TryGetValue(normalized, out handler);
        }

        public bool TryGetCapability(string actionType, out McpActionCapability capability)
        {
            var normalized = string.IsNullOrWhiteSpace(actionType) ? string.Empty : actionType.Trim();
            if (string.IsNullOrEmpty(normalized))
            {
                capability = null;
                return false;
            }

            return _capabilities.TryGetValue(normalized, out capability);
        }

        public IReadOnlyList<McpActionCapability> GetCapabilities()
        {
            var items = new List<McpActionCapability>(_capabilities.Values);
            items.Sort(
                delegate(McpActionCapability left, McpActionCapability right)
                {
                    var leftType = left == null ? string.Empty : left.ActionType;
                    var rightType = right == null ? string.Empty : right.ActionType;
                    return string.CompareOrdinal(leftType, rightType);
                });
            return items;
        }

        private static string NormalizeActionType(string actionType, string paramName)
        {
            if (string.IsNullOrWhiteSpace(actionType))
            {
                throw new ArgumentException("actionType is required.", paramName);
            }

            var normalized = actionType.Trim();
            if (!Regex.IsMatch(normalized, "^[a-z][a-z0-9_]{2,63}$"))
            {
                throw new ArgumentException(
                    "actionType must match lower_snake_case pattern ^[a-z][a-z0-9_]{2,63}$.",
                    paramName);
            }

            return normalized;
        }

        private void ValidateGovernanceBudget(
            string actionType,
            McpActionCapability capability)
        {
            var stableCount = 0;
            var experimentalCount = 0;
            var stableByDomain = new Dictionary<string, int>(StringComparer.Ordinal);

            foreach (var pair in _capabilities)
            {
                var existingType = pair.Key;
                if (string.Equals(existingType, actionType, StringComparison.Ordinal))
                {
                    continue;
                }

                var existing = pair.Value;
                CountCapability(existing, ref stableCount, ref experimentalCount, stableByDomain);
            }

            CountCapability(capability, ref stableCount, ref experimentalCount, stableByDomain);

            if (stableCount > MaxStableActions)
            {
                throw new InvalidOperationException(
                    "Stable capability count exceeds governance limit " + MaxStableActions + ".");
            }

            if (experimentalCount > MaxExperimentalActions)
            {
                throw new InvalidOperationException(
                    "Experimental capability count exceeds governance limit " + MaxExperimentalActions + ".");
            }

            foreach (var pair in stableByDomain)
            {
                if (pair.Value > MaxStableActionsPerDomain)
                {
                    throw new InvalidOperationException(
                        "Stable capability count exceeds per-domain limit " +
                        MaxStableActionsPerDomain +
                        " for domain '" +
                        pair.Key +
                        "'.");
                }
            }
        }

        private static void CountCapability(
            McpActionCapability capability,
            ref int stableCount,
            ref int experimentalCount,
            Dictionary<string, int> stableByDomain)
        {
            if (capability == null)
            {
                return;
            }

            if (string.Equals(
                    capability.Lifecycle,
                    McpActionGovernance.LifecycleStable,
                    StringComparison.Ordinal))
            {
                stableCount += 1;
                var domain = string.IsNullOrWhiteSpace(capability.Domain)
                    ? McpActionGovernance.DomainGeneral
                    : capability.Domain.Trim();
                int current;
                if (!stableByDomain.TryGetValue(domain, out current))
                {
                    current = 0;
                }

                stableByDomain[domain] = current + 1;
            }

            if (string.Equals(
                    capability.Lifecycle,
                    McpActionGovernance.LifecycleExperimental,
                    StringComparison.Ordinal))
            {
                experimentalCount += 1;
            }
        }
    }
}

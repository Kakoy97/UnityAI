using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    public sealed class CompositeAliasTable
    {
        private static readonly Regex AliasPattern =
            new Regex("^[a-z][a-z0-9_]{2,31}$", RegexOptions.Compiled);
        private readonly Dictionary<string, UnityObjectAnchor> _anchors =
            new Dictionary<string, UnityObjectAnchor>(StringComparer.Ordinal);

        public int Count
        {
            get { return _anchors.Count; }
        }

        public bool TryResolve(
            string alias,
            out UnityObjectAnchor anchor,
            out string errorCode,
            out string errorMessage)
        {
            anchor = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var normalized = NormalizeAlias(alias);
            if (string.IsNullOrEmpty(normalized) || !AliasPattern.IsMatch(normalized))
            {
                errorCode = "E_COMPOSITE_ALIAS_INVALID";
                errorMessage = "Alias must match ^[a-z][a-z0-9_]{2,31}$.";
                return false;
            }

            UnityObjectAnchor existing;
            if (!_anchors.TryGetValue(normalized, out existing) || existing == null)
            {
                errorCode = "E_COMPOSITE_ALIAS_NOT_FOUND";
                errorMessage = "Alias not found: " + normalized;
                return false;
            }

            anchor = CloneAnchor(existing);
            return true;
        }

        public bool TryBind(
            string alias,
            UnityObjectAnchor anchor,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var normalized = NormalizeAlias(alias);
            if (string.IsNullOrEmpty(normalized) || !AliasPattern.IsMatch(normalized))
            {
                errorCode = "E_COMPOSITE_ALIAS_INVALID";
                errorMessage = "Alias must match ^[a-z][a-z0-9_]{2,31}$.";
                return false;
            }

            if (anchor == null ||
                string.IsNullOrWhiteSpace(anchor.path) ||
                string.IsNullOrWhiteSpace(anchor.object_id))
            {
                errorCode = "E_COMPOSITE_ALIAS_INVALID";
                errorMessage = "Alias binding requires anchor.object_id and anchor.path.";
                return false;
            }

            if (_anchors.ContainsKey(normalized))
            {
                errorCode = "E_COMPOSITE_ALIAS_DUPLICATED";
                errorMessage = "Alias already exists: " + normalized;
                return false;
            }

            _anchors[normalized] = CloneAnchor(anchor);
            return true;
        }

        private static string NormalizeAlias(string alias)
        {
            return string.IsNullOrWhiteSpace(alias) ? string.Empty : alias.Trim();
        }

        private static UnityObjectAnchor CloneAnchor(UnityObjectAnchor anchor)
        {
            if (anchor == null)
            {
                return null;
            }

            return new UnityObjectAnchor
            {
                object_id = string.IsNullOrWhiteSpace(anchor.object_id) ? string.Empty : anchor.object_id.Trim(),
                path = string.IsNullOrWhiteSpace(anchor.path) ? string.Empty : anchor.path.Trim(),
            };
        }
    }
}

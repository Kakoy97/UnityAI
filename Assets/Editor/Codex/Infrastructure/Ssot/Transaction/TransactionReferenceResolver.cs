using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction
{
    internal sealed class TransactionReferenceResolver
    {
        private static readonly Regex RefPattern =
            new Regex("^[A-Za-z_][A-Za-z0-9_]*\\.[A-Za-z_][A-Za-z0-9_]*$", RegexOptions.Compiled);

        internal bool TryResolvePayload(
            Dictionary<string, object> payload,
            TransactionAliasStore aliasStore,
            out Dictionary<string, object> resolvedPayload,
            out int resolvedRefCount,
            out string errorCode,
            out string errorMessage)
        {
            resolvedPayload = null;
            resolvedRefCount = 0;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (payload == null)
            {
                errorCode = "E_TRANSACTION_PLAN_INVALID";
                errorMessage = "transaction step payload is required.";
                return false;
            }

            if (aliasStore == null)
            {
                errorCode = "E_INTERNAL";
                errorMessage = "transaction alias store is unavailable.";
                return false;
            }

            if (!TryResolveNode(payload, aliasStore, out var resolvedNode, ref resolvedRefCount, out errorCode, out errorMessage))
            {
                return false;
            }

            resolvedPayload = resolvedNode as Dictionary<string, object>;
            if (resolvedPayload == null)
            {
                errorCode = "E_TRANSACTION_PLAN_INVALID";
                errorMessage = "transaction step payload must resolve to a JSON object.";
                return false;
            }

            return true;
        }

        private static bool TryResolveNode(
            object node,
            TransactionAliasStore aliasStore,
            out object resolvedNode,
            ref int resolvedRefCount,
            out string errorCode,
            out string errorMessage)
        {
            resolvedNode = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (node == null)
            {
                resolvedNode = null;
                return true;
            }

            if (node is Dictionary<string, object> dictionary)
            {
                if (TryGetRefExpression(dictionary, out var refExpression, out errorCode, out errorMessage))
                {
                    if (!TryResolveRefExpression(refExpression, aliasStore, out resolvedNode, out errorCode, out errorMessage))
                    {
                        return false;
                    }

                    resolvedRefCount += 1;
                    return true;
                }

                if (!string.IsNullOrEmpty(errorCode))
                {
                    return false;
                }

                var output = new Dictionary<string, object>(dictionary.Count);
                foreach (var pair in dictionary)
                {
                    if (!TryResolveNode(pair.Value, aliasStore, out var childResolved, ref resolvedRefCount, out errorCode, out errorMessage))
                    {
                        return false;
                    }

                    output[pair.Key] = childResolved;
                }

                resolvedNode = output;
                return true;
            }

            if (node is List<object> list)
            {
                var output = new List<object>(list.Count);
                for (var index = 0; index < list.Count; index += 1)
                {
                    if (!TryResolveNode(list[index], aliasStore, out var childResolved, ref resolvedRefCount, out errorCode, out errorMessage))
                    {
                        return false;
                    }

                    output.Add(childResolved);
                }

                resolvedNode = output;
                return true;
            }

            if (node is string textNode && textNode.Contains("$ref:"))
            {
                errorCode = "E_TRANSACTION_REF_PATH_INVALID";
                errorMessage = "transaction $ref string interpolation is not supported.";
                return false;
            }

            resolvedNode = node;
            return true;
        }

        private static bool TryGetRefExpression(
            Dictionary<string, object> dictionary,
            out string refExpression,
            out string errorCode,
            out string errorMessage)
        {
            refExpression = string.Empty;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (!dictionary.TryGetValue("$ref", out var refNode))
            {
                return false;
            }

            if (dictionary.Count != 1)
            {
                errorCode = "E_TRANSACTION_REF_PATH_INVALID";
                errorMessage = "transaction $ref object cannot contain extra fields.";
                return false;
            }

            refExpression = refNode as string;
            if (string.IsNullOrEmpty(refExpression) || !RefPattern.IsMatch(refExpression))
            {
                errorCode = "E_TRANSACTION_REF_PATH_INVALID";
                errorMessage = "transaction $ref expression is invalid.";
                return false;
            }

            return true;
        }

        private static bool TryResolveRefExpression(
            string refExpression,
            TransactionAliasStore aliasStore,
            out object resolvedValue,
            out string errorCode,
            out string errorMessage)
        {
            resolvedValue = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var splitIndex = refExpression.IndexOf('.');
            if (splitIndex <= 0 || splitIndex >= refExpression.Length - 1)
            {
                errorCode = "E_TRANSACTION_REF_PATH_INVALID";
                errorMessage = "transaction $ref expression is invalid: " + refExpression;
                return false;
            }

            var alias = refExpression.Substring(0, splitIndex);
            var fieldName = refExpression.Substring(splitIndex + 1);
            if (!aliasStore.TryResolve(alias, fieldName, out resolvedValue, out errorCode, out errorMessage))
            {
                return false;
            }

            return true;
        }
    }
}

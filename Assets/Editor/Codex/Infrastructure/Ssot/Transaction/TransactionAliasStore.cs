using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Infrastructure.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction
{
    internal sealed class TransactionAliasStore
    {
        private readonly Dictionary<string, Dictionary<string, object>> _valuesByAlias =
            new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);

        internal bool TryBind(
            string alias,
            SsotDispatchResultData resultData,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (string.IsNullOrEmpty(alias))
            {
                return true;
            }

            if (_valuesByAlias.ContainsKey(alias))
            {
                errorCode = "E_TRANSACTION_PLAN_INVALID";
                errorMessage = "duplicated save_as alias: " + alias;
                return false;
            }

            _valuesByAlias[alias] = BuildAliasFieldMap(resultData);
            return true;
        }

        internal bool TryResolve(
            string alias,
            string fieldName,
            out object value,
            out string errorCode,
            out string errorMessage)
        {
            value = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (!_valuesByAlias.TryGetValue(alias, out var fieldMap))
            {
                errorCode = "E_TRANSACTION_ALIAS_MISSING";
                errorMessage = "transaction alias not found: " + alias;
                return false;
            }

            if (!fieldMap.TryGetValue(fieldName, out value))
            {
                errorCode = "E_TRANSACTION_REF_PATH_INVALID";
                errorMessage = "transaction alias field is not allowed: " + alias + "." + fieldName;
                return false;
            }

            if (value is Dictionary<string, object> || value is List<object>)
            {
                errorCode = "E_TRANSACTION_REF_PATH_INVALID";
                errorMessage = "transaction alias field cannot resolve to object/array: " + alias + "." + fieldName;
                return false;
            }

            return true;
        }

        private static Dictionary<string, object> BuildAliasFieldMap(SsotDispatchResultData data)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            if (data == null)
            {
                return result;
            }

            result["scene_revision"] = data.scene_revision;
            result["target_object_id"] = data.target_object_id;
            result["target_path"] = data.target_path;
            result["target_object_name"] = data.target_object_name;
            result["value_kind"] = data.value_kind;
            result["value_string"] = data.value_string;
            result["value_number"] = data.value_number;
            result["value_boolean"] = data.value_boolean;
            return result;
        }
    }
}

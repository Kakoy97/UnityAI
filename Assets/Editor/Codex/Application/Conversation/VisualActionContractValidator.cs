using System;
using System.Collections.Generic;
using System.Reflection;
using System.Text;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using UnityEngine;

namespace UnityAI.Editor.Codex.Application
{
    internal static class VisualActionContractValidator
    {
        private static readonly Dictionary<string, FieldInfo> ActionFieldMap =
            BuildActionFieldMap();

        internal static bool TryValidateActionPayload(
            VisualLayerActionItem action,
            McpActionRegistry registry,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (action == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action is required.";
                return false;
            }

            var actionType = Normalize(action.type);
            if (string.IsNullOrEmpty(actionType))
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action.type is required.";
                return false;
            }

            McpActionCapability capability;
            if (registry == null || !registry.TryGetCapability(actionType, out capability) || capability == null)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action.type is unsupported.";
                return false;
            }

            var anchorPolicy = ResolveAnchorPolicy(capability.AnchorPolicy, actionType);
            if (!TryValidateAnchors(action, anchorPolicy, out errorCode, out errorMessage))
            {
                return false;
            }

            var schema = ParseActionDataSchema(capability.ActionDataSchemaJson);
            if (!TryValidateRequiredActionDataFields(action, schema, out errorCode, out errorMessage))
            {
                return false;
            }

            return true;
        }

        private static Dictionary<string, FieldInfo> BuildActionFieldMap()
        {
            var map = new Dictionary<string, FieldInfo>(StringComparer.Ordinal);
            var fields = typeof(VisualLayerActionItem).GetFields(BindingFlags.Public | BindingFlags.Instance);
            for (var i = 0; i < fields.Length; i++)
            {
                var field = fields[i];
                if (field == null || string.IsNullOrWhiteSpace(field.Name))
                {
                    continue;
                }

                map[field.Name] = field;
            }

            return map;
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        private static string ResolveAnchorPolicy(string rawPolicy, string actionType)
        {
            var normalized = Normalize(rawPolicy).ToLowerInvariant();
            if (normalized == "target_required" ||
                normalized == "parent_required" ||
                normalized == "target_or_parent_required" ||
                normalized == "target_and_parent_required")
            {
                return normalized;
            }

            if (normalized == "target_or_parent")
            {
                return "target_or_parent_required";
            }

            if (string.Equals(actionType, "create_gameobject", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(actionType, "create_object", StringComparison.OrdinalIgnoreCase))
            {
                return "parent_required";
            }

            return "target_or_parent_required";
        }

        private static bool TryValidateAnchors(
            VisualLayerActionItem action,
            string anchorPolicy,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            var hasTargetAnchor = HasCompleteAnchor(action.target_anchor);
            var hasParentAnchor = HasCompleteAnchor(action.parent_anchor);
            var hasInvalidTargetAnchor = action.target_anchor != null && !hasTargetAnchor;
            var hasInvalidParentAnchor = action.parent_anchor != null && !hasParentAnchor;

            if (hasInvalidTargetAnchor || hasInvalidParentAnchor)
            {
                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action target_anchor/parent_anchor must include object_id and path.";
                return false;
            }

            switch (anchorPolicy)
            {
                case "target_required":
                    if (!hasTargetAnchor)
                    {
                        errorCode = "E_ACTION_SCHEMA_INVALID";
                        errorMessage = "payload.action.target_anchor is required by anchor_policy(target_required).";
                        return false;
                    }

                    return true;

                case "parent_required":
                    if (!hasParentAnchor)
                    {
                        errorCode = "E_ACTION_SCHEMA_INVALID";
                        errorMessage = "payload.action.parent_anchor is required by anchor_policy(parent_required).";
                        return false;
                    }

                    return true;

                case "target_and_parent_required":
                    if (!hasTargetAnchor || !hasParentAnchor)
                    {
                        errorCode = "E_ACTION_SCHEMA_INVALID";
                        errorMessage =
                            "payload.action.target_anchor and payload.action.parent_anchor are required by anchor_policy(target_and_parent_required).";
                        return false;
                    }

                    return true;

                default:
                    if (!hasTargetAnchor && !hasParentAnchor)
                    {
                        errorCode = "E_ACTION_SCHEMA_INVALID";
                        errorMessage =
                            "payload.action.target_anchor or payload.action.parent_anchor is required by anchor_policy(target_or_parent_required).";
                        return false;
                    }

                    return true;
            }
        }

        private static bool HasCompleteAnchor(UnityObjectAnchor anchor)
        {
            return anchor != null &&
                   !string.IsNullOrWhiteSpace(anchor.object_id) &&
                   !string.IsNullOrWhiteSpace(anchor.path);
        }

        private static UnityActionDataSchema ParseActionDataSchema(string rawJson)
        {
            var json = string.IsNullOrWhiteSpace(rawJson) ? "{}" : rawJson.Trim();
            UnityActionDataSchema parsed = null;
            try
            {
                parsed = JsonUtility.FromJson<UnityActionDataSchema>(json);
            }
            catch
            {
                parsed = null;
            }

            if (parsed == null)
            {
                parsed = new UnityActionDataSchema();
            }

            if (parsed.required == null)
            {
                parsed.required = new string[0];
            }

            return parsed;
        }

        private static bool TryValidateRequiredActionDataFields(
            VisualLayerActionItem action,
            UnityActionDataSchema schema,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;
            if (schema == null || schema.required == null || schema.required.Length == 0)
            {
                return true;
            }

            var actionDataFields = ParseActionDataFields(action);
            for (var i = 0; i < schema.required.Length; i++)
            {
                var fieldName = Normalize(schema.required[i]);
                if (string.IsNullOrEmpty(fieldName))
                {
                    continue;
                }

                if (TryResolveFieldValue(action, actionDataFields, fieldName, out var value) &&
                    HasRequiredFieldValue(value))
                {
                    continue;
                }

                errorCode = "E_ACTION_SCHEMA_INVALID";
                errorMessage = "payload.action.action_data." + fieldName + " is required.";
                return false;
            }

            return true;
        }

        private static bool TryResolveFieldValue(
            VisualLayerActionItem action,
            Dictionary<string, object> actionDataFields,
            string fieldName,
            out object value)
        {
            value = null;
            if (action == null || string.IsNullOrEmpty(fieldName))
            {
                return false;
            }

            if (ActionFieldMap.TryGetValue(fieldName, out var field) && field != null)
            {
                var directValue = field.GetValue(action);
                if (directValue != null)
                {
                    value = directValue;
                    return true;
                }
            }

            if (actionDataFields != null &&
                actionDataFields.TryGetValue(fieldName, out var fromActionData))
            {
                value = fromActionData;
                return true;
            }

            return false;
        }

        private static bool HasRequiredFieldValue(object value)
        {
            if (value == null)
            {
                return false;
            }

            if (value is string text)
            {
                return !string.IsNullOrWhiteSpace(text);
            }

            return true;
        }

        private static Dictionary<string, object> ParseActionDataFields(VisualLayerActionItem action)
        {
            var map = new Dictionary<string, object>(StringComparer.Ordinal);
            var json = ResolveActionDataJson(action);
            if (string.IsNullOrWhiteSpace(json))
            {
                return map;
            }

            TryParseTopLevelJsonObject(json, map);
            return map;
        }

        private static string ResolveActionDataJson(VisualLayerActionItem action)
        {
            if (action == null)
            {
                return string.Empty;
            }

            var marshaled = DecodeBase64UrlUtf8(action.action_data_marshaled);
            if (!string.IsNullOrWhiteSpace(marshaled))
            {
                return marshaled;
            }

            return Normalize(action.action_data_json);
        }

        private static string DecodeBase64UrlUtf8(string raw)
        {
            var normalized = Normalize(raw);
            if (string.IsNullOrEmpty(normalized))
            {
                return string.Empty;
            }

            var base64 = normalized.Replace('-', '+').Replace('_', '/');
            var mod = base64.Length % 4;
            if (mod == 1)
            {
                return string.Empty;
            }

            if (mod > 1)
            {
                base64 += new string('=', 4 - mod);
            }

            try
            {
                var bytes = Convert.FromBase64String(base64);
                return bytes == null ? string.Empty : Encoding.UTF8.GetString(bytes);
            }
            catch
            {
                return string.Empty;
            }
        }

        private static bool TryParseTopLevelJsonObject(
            string json,
            Dictionary<string, object> output)
        {
            output.Clear();
            if (string.IsNullOrWhiteSpace(json))
            {
                return false;
            }

            var index = 0;
            if (!TryConsumeChar(json, ref index, '{'))
            {
                return false;
            }

            while (true)
            {
                SkipWhitespace(json, ref index);
                if (index >= json.Length)
                {
                    return false;
                }

                if (json[index] == '}')
                {
                    index++;
                    return true;
                }

                if (!TryParseJsonString(json, ref index, out var key))
                {
                    return false;
                }

                if (!TryConsumeChar(json, ref index, ':'))
                {
                    return false;
                }

                if (!TryParseJsonValue(json, ref index, out var value))
                {
                    return false;
                }

                if (!string.IsNullOrWhiteSpace(key) && !output.ContainsKey(key))
                {
                    output[key] = value;
                }

                SkipWhitespace(json, ref index);
                if (index >= json.Length)
                {
                    return false;
                }

                if (json[index] == ',')
                {
                    index++;
                    continue;
                }

                if (json[index] == '}')
                {
                    index++;
                    return true;
                }

                return false;
            }
        }

        private static bool TryParseJsonValue(string json, ref int index, out object value)
        {
            value = null;
            SkipWhitespace(json, ref index);
            if (index >= json.Length)
            {
                return false;
            }

            var ch = json[index];
            if (ch == '"')
            {
                if (!TryParseJsonString(json, ref index, out var text))
                {
                    return false;
                }

                value = text;
                return true;
            }

            if (ch == '{')
            {
                var start = index;
                if (!TrySkipJsonContainer(json, ref index, '{', '}'))
                {
                    return false;
                }

                value = json.Substring(start, index - start);
                return true;
            }

            if (ch == '[')
            {
                var start = index;
                if (!TrySkipJsonContainer(json, ref index, '[', ']'))
                {
                    return false;
                }

                value = json.Substring(start, index - start);
                return true;
            }

            if (StartsWith(json, index, "true"))
            {
                index += 4;
                value = true;
                return true;
            }

            if (StartsWith(json, index, "false"))
            {
                index += 5;
                value = false;
                return true;
            }

            if (StartsWith(json, index, "null"))
            {
                index += 4;
                value = null;
                return true;
            }

            if (TryParseJsonNumber(json, ref index, out var numberToken))
            {
                value = numberToken;
                return true;
            }

            return false;
        }

        private static bool TryParseJsonNumber(string json, ref int index, out string numberToken)
        {
            numberToken = string.Empty;
            var start = index;
            if (index < json.Length && (json[index] == '-' || json[index] == '+'))
            {
                index++;
            }

            var hasDigits = false;
            while (index < json.Length && char.IsDigit(json[index]))
            {
                hasDigits = true;
                index++;
            }

            if (index < json.Length && json[index] == '.')
            {
                index++;
                while (index < json.Length && char.IsDigit(json[index]))
                {
                    hasDigits = true;
                    index++;
                }
            }

            if (!hasDigits)
            {
                index = start;
                return false;
            }

            if (index < json.Length && (json[index] == 'e' || json[index] == 'E'))
            {
                index++;
                if (index < json.Length && (json[index] == '+' || json[index] == '-'))
                {
                    index++;
                }

                var expDigitsStart = index;
                while (index < json.Length && char.IsDigit(json[index]))
                {
                    index++;
                }

                if (expDigitsStart == index)
                {
                    index = start;
                    return false;
                }
            }

            numberToken = json.Substring(start, index - start);
            return true;
        }

        private static bool TrySkipJsonContainer(
            string json,
            ref int index,
            char openChar,
            char closeChar)
        {
            if (index >= json.Length || json[index] != openChar)
            {
                return false;
            }

            var depth = 0;
            while (index < json.Length)
            {
                var ch = json[index];
                if (ch == '"')
                {
                    if (!TryParseJsonString(json, ref index, out _))
                    {
                        return false;
                    }

                    continue;
                }

                if (ch == openChar)
                {
                    depth++;
                }
                else if (ch == closeChar)
                {
                    depth--;
                    index++;
                    if (depth == 0)
                    {
                        return true;
                    }

                    continue;
                }

                index++;
            }

            return false;
        }

        private static bool TryParseJsonString(string json, ref int index, out string value)
        {
            value = string.Empty;
            SkipWhitespace(json, ref index);
            if (index >= json.Length || json[index] != '"')
            {
                return false;
            }

            index++;
            var sb = new StringBuilder();
            while (index < json.Length)
            {
                var ch = json[index++];
                if (ch == '"')
                {
                    value = sb.ToString();
                    return true;
                }

                if (ch != '\\')
                {
                    sb.Append(ch);
                    continue;
                }

                if (index >= json.Length)
                {
                    return false;
                }

                var escaped = json[index++];
                switch (escaped)
                {
                    case '"':
                    case '\\':
                    case '/':
                        sb.Append(escaped);
                        break;
                    case 'b':
                        sb.Append('\b');
                        break;
                    case 'f':
                        sb.Append('\f');
                        break;
                    case 'n':
                        sb.Append('\n');
                        break;
                    case 'r':
                        sb.Append('\r');
                        break;
                    case 't':
                        sb.Append('\t');
                        break;
                    case 'u':
                        if (index + 3 >= json.Length)
                        {
                            return false;
                        }

                        if (!ushort.TryParse(
                                json.Substring(index, 4),
                                System.Globalization.NumberStyles.HexNumber,
                                System.Globalization.CultureInfo.InvariantCulture,
                                out var codePoint))
                        {
                            return false;
                        }

                        sb.Append((char)codePoint);
                        index += 4;
                        break;
                    default:
                        return false;
                }
            }

            return false;
        }

        private static bool StartsWith(string text, int index, string token)
        {
            if (index < 0 || string.IsNullOrEmpty(text) || string.IsNullOrEmpty(token))
            {
                return false;
            }

            if (index + token.Length > text.Length)
            {
                return false;
            }

            return string.CompareOrdinal(text, index, token, 0, token.Length) == 0;
        }

        private static bool TryConsumeChar(string text, ref int index, char expected)
        {
            SkipWhitespace(text, ref index);
            if (index >= text.Length || text[index] != expected)
            {
                return false;
            }

            index++;
            return true;
        }

        private static void SkipWhitespace(string text, ref int index)
        {
            while (index < text.Length && char.IsWhiteSpace(text[index]))
            {
                index++;
            }
        }
    }
}

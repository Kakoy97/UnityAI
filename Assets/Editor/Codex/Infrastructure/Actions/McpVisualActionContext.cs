using System;
using UnityAI.Editor.Codex.Domain;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    public interface IMcpVisualAnchorResolver
    {
        bool TryResolve(
            UnityObjectAnchor anchor,
            out GameObject resolved,
            out string errorCode,
            out string errorMessage);
    }

    public interface IMcpVisualActionExecutionUtilities
    {
        void MarkDirty(GameObject target);
        void MarkSceneDirty(GameObject target);
    }

    public sealed class McpVisualActionContext
    {
        private const int MaxDeserializeErrorLength = 240;

        public McpVisualActionContext(
            VisualLayerActionItem rawAction,
            GameObject selected,
            IMcpVisualAnchorResolver anchorResolver,
            IMcpVisualActionExecutionUtilities utilities)
        {
            RawAction = rawAction;
            ActionDataJson = rawAction == null ? string.Empty : SafeTrim(rawAction.action_data_json);
            Selected = selected;
            AnchorResolver = anchorResolver;
            Utilities = utilities;
        }

        public VisualLayerActionItem RawAction { get; private set; }
        public string ActionDataJson { get; private set; }
        public GameObject Selected { get; private set; }
        public IMcpVisualAnchorResolver AnchorResolver { get; private set; }
        public IMcpVisualActionExecutionUtilities Utilities { get; private set; }

        public bool TryDeserializeActionData<TActionData>(out TActionData data, out string error)
            where TActionData : class, new()
        {
            data = null;
            error = string.Empty;

            if (string.IsNullOrWhiteSpace(ActionDataJson))
            {
                error = "action_data_json is required.";
                return false;
            }

            try
            {
                data = JsonUtility.FromJson<TActionData>(ActionDataJson);
                if (data != null)
                {
                    return true;
                }

                error = "action_data_json deserialized to null.";
                return false;
            }
            catch (Exception ex)
            {
                error = NormalizeDeserializeError(ex == null ? string.Empty : ex.Message);
                return false;
            }
        }

        private static string NormalizeDeserializeError(string message)
        {
            var singleLine = NormalizeSingleLine(message);
            if (string.IsNullOrEmpty(singleLine))
            {
                return "action_data_json deserialization failed.";
            }

            if (singleLine.Length <= MaxDeserializeErrorLength)
            {
                return singleLine;
            }

            return singleLine.Substring(0, MaxDeserializeErrorLength).TrimEnd();
        }

        private static string NormalizeSingleLine(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            var lines = value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return lines.Length == 0 ? value.Trim() : lines[0].Trim();
        }

        private static string SafeTrim(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }
    }
}

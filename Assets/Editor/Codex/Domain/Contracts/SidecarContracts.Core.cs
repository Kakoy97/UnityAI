using System;

namespace UnityAI.Editor.Codex.Domain
{
    public enum TurnRuntimeState
    {
        Idle,
        CompilePending,
        ActionExecuting,
        Completed,
        Cancelled,
        Failed
    }


    public enum UiLogLevel
    {
        Info,
        Warning,
        Error
    }


    public enum UiLogSource
    {
        System,
        User,
        Codex
    }


    public sealed class UiLogEntry
    {
        public UiLogEntry(
            UiLogLevel level,
            string message,
            DateTime timestamp,
            UiLogSource source = UiLogSource.System)
        {
            Level = level;
            Message = message;
            Timestamp = timestamp;
            Source = source;
        }

        public UiLogLevel Level { get; private set; }
        public string Message { get; private set; }
        public DateTime Timestamp { get; private set; }
        public UiLogSource Source { get; private set; }

        public string ToRichText()
        {
            var color = "#D7D7D7";
            if (Level == UiLogLevel.Warning)
            {
                color = "#FFD166";
            }
            else if (Level == UiLogLevel.Error)
            {
                color = "#FF6B6B";
            }
            else if (Source == UiLogSource.User)
            {
                color = "#8ECAE6";
            }
            else if (Source == UiLogSource.Codex)
            {
                color = "#A7D88D";
            }

            var sourceTag = "SYSTEM";
            if (Source == UiLogSource.User)
            {
                sourceTag = "USER";
            }
            else if (Source == UiLogSource.Codex)
            {
                sourceTag = "CODEX";
            }

            return "<color=" + color + ">[" + Timestamp.ToString("HH:mm:ss") + "] [" + sourceTag + "] " + Message + "</color>";
        }
    }


    public sealed class GatewayResponse<T> where T : class
    {
        public bool TransportSuccess;
        public int StatusCode;
        public string RawBody;
        public string ErrorMessage;
        public T Data;
        public ErrorResponse Error;

        public bool IsHttpSuccess
        {
            get { return StatusCode >= 200 && StatusCode <= 299; }
        }
    }


    public sealed class SidecarStartResult
    {
        public bool Success;
        public bool AlreadyRunning;
        public string Message;
    }


    public sealed class SidecarStopResult
    {
        public bool Success;
        public bool WasRunning;
        public string Message;
    }


    [Serializable]
    public sealed class ErrorResponse
    {
        public string status;
        public string error_code;
        public string message;
        public string error_message;
        public string suggestion;
        public bool recoverable;
    }


    [Serializable]
    public sealed class HealthResponse
    {
        public bool ok;
        public string service;
        public string active_request_id;
        public string active_state;
        public string unity_connection_state;
    }


    [Serializable]
    public sealed class TurnContext
    {
        public string scene_revision;
        public SelectionInfo selection;
        public SelectionTreeInfo selection_tree;
    }


    [Serializable]
    public sealed class SelectionInfo
    {
        public string mode;
        public string object_id;
        public string target_object_path;
        public bool active;
        public string prefab_path;
    }


    [Serializable]
    public sealed class SelectionTreeInfo
    {
        public int max_depth;
        public SelectionTreeNode root;
        public int truncated_node_count;
        public string truncated_reason;
    }


    [Serializable]
    public sealed class SelectionTreeNode
    {
        public string name;
        public string object_id;
        public string path;
        public int depth;
        public bool active;
        public string prefab_path;
        public UnityComponentDescriptor[] components;
        public SelectionTreeNode[] children;
        public int children_truncated_count;
    }


    [Serializable]
    public sealed class UnityObjectAnchor
    {
        public string object_id;
        public string path;
    }


    [Serializable]
    public sealed class UnityComponentDescriptor
    {
        public string short_name;
        public string assembly_qualified_name;
    }

}

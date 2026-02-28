using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    [InitializeOnLoad]
    public static class UnityConsoleErrorTracker
    {
        private const int MaxEntries = 256;
        private const int MaxConditionLength = 320;
        private const int MaxStackTraceLength = 640;
        private static readonly object SyncRoot = new object();
        private static readonly List<UnityConsoleErrorSnapshot> Entries = new List<UnityConsoleErrorSnapshot>(64);

        static UnityConsoleErrorTracker()
        {
            UnityEngine.Application.logMessageReceived += OnLogMessageReceived;
        }

        public static UnityConsoleErrorSnapshot[] GetRecentErrors(int maxCount)
        {
            lock (SyncRoot)
            {
                if (Entries.Count == 0)
                {
                    return Array.Empty<UnityConsoleErrorSnapshot>();
                }

                var take = maxCount > 0 ? Math.Min(maxCount, Entries.Count) : Entries.Count;
                var result = new UnityConsoleErrorSnapshot[take];
                for (var i = 0; i < take; i++)
                {
                    var item = Entries[i];
                    result[i] = new UnityConsoleErrorSnapshot
                    {
                        timestamp = item.timestamp,
                        log_type = item.log_type,
                        condition = item.condition,
                        stack_trace = item.stack_trace,
                        file = item.file,
                        line = item.line,
                        error_code = item.error_code
                    };
                }

                return result;
            }
        }

        private static void OnLogMessageReceived(string condition, string stackTrace, LogType type)
        {
            if (!IsErrorType(type))
            {
                return;
            }

            var file = string.Empty;
            var line = 0;
            TryExtractFileAndLine(stackTrace, out file, out line);
            var normalizedCondition = SanitizeSingleLine(condition, MaxConditionLength);
            var normalizedStackTrace = SanitizeSingleLine(stackTrace, MaxStackTraceLength);

            var snapshot = new UnityConsoleErrorSnapshot
            {
                timestamp = DateTime.UtcNow.ToString("o"),
                log_type = type.ToString(),
                condition = normalizedCondition,
                stack_trace = normalizedStackTrace,
                file = string.IsNullOrWhiteSpace(file) ? string.Empty : file.Trim(),
                line = line,
                error_code = ExtractErrorCode(normalizedCondition, normalizedStackTrace)
            };

            lock (SyncRoot)
            {
                Entries.Insert(0, snapshot);
                if (Entries.Count > MaxEntries)
                {
                    Entries.RemoveRange(MaxEntries, Entries.Count - MaxEntries);
                }
            }
        }

        private static bool IsErrorType(LogType type)
        {
            return type == LogType.Error || type == LogType.Exception || type == LogType.Assert;
        }

        private static string ExtractErrorCode(string condition, string stackTrace)
        {
            var source = string.IsNullOrEmpty(condition) ? stackTrace : condition;
            if (string.IsNullOrEmpty(source))
            {
                return string.Empty;
            }

            var match = Regex.Match(source, "\\b[A-Z]{2}\\d{4}\\b");
            return match.Success ? match.Value : string.Empty;
        }

        private static void TryExtractFileAndLine(string stackTrace, out string file, out int line)
        {
            file = string.Empty;
            line = 0;

            if (string.IsNullOrEmpty(stackTrace))
            {
                return;
            }

            var match = Regex.Match(stackTrace, "\\(at\\s+(.+):(\\d+)\\)");
            if (!match.Success || match.Groups.Count < 3)
            {
                return;
            }

            file = match.Groups[1].Value ?? string.Empty;
            var rawLine = match.Groups[2].Value ?? string.Empty;
            int parsedLine;
            if (int.TryParse(rawLine, out parsedLine) && parsedLine > 0)
            {
                line = parsedLine;
            }
        }

        private static string SanitizeSingleLine(string raw, int maxLength)
        {
            var value = string.IsNullOrWhiteSpace(raw) ? string.Empty : raw.Trim();
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            var firstLine = value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var singleLine = firstLine.Length > 0 ? firstLine[0].Trim() : value;
            if (singleLine.Length <= maxLength)
            {
                return singleLine;
            }

            return singleLine.Substring(0, maxLength).TrimEnd();
        }
    }

    public sealed class UnityConsoleErrorSnapshot
    {
        public string timestamp;
        public string log_type;
        public string condition;
        public string stack_trace;
        public string file;
        public int line;
        public string error_code;
    }
}

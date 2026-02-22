using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.Compilation;

namespace UnityAI.Editor.Codex.Infrastructure
{
    [InitializeOnLoad]
    public static class UnityCompilationStateTracker
    {
        private static readonly object SyncRoot = new object();
        private static readonly List<CompilationErrorSnapshot> LastCompilationErrors = new List<CompilationErrorSnapshot>();

        private static long _lastCompilationStartedUtcTicks;
        private static long _lastCompilationFinishedUtcTicks;
        private static int _lastCompilationErrorCount;

        static UnityCompilationStateTracker()
        {
            CompilationPipeline.compilationStarted += OnCompilationStarted;
            CompilationPipeline.assemblyCompilationFinished += OnAssemblyCompilationFinished;
            CompilationPipeline.compilationFinished += OnCompilationFinished;
        }

        public static bool HasCompilationFinishedSince(long utcTicks)
        {
            lock (SyncRoot)
            {
                return _lastCompilationFinishedUtcTicks > utcTicks;
            }
        }

        public static bool LastCompilationHadErrorsSince(long utcTicks)
        {
            lock (SyncRoot)
            {
                return _lastCompilationFinishedUtcTicks > utcTicks && _lastCompilationErrorCount > 0;
            }
        }

        public static int GetLastCompilationErrorCountSince(long utcTicks)
        {
            lock (SyncRoot)
            {
                if (_lastCompilationFinishedUtcTicks <= utcTicks)
                {
                    return 0;
                }

                return _lastCompilationErrorCount;
            }
        }

        public static CompilationErrorSnapshot[] GetLastCompilationErrorsSince(long utcTicks, int maxCount)
        {
            lock (SyncRoot)
            {
                if (_lastCompilationFinishedUtcTicks <= utcTicks || LastCompilationErrors.Count == 0)
                {
                    return Array.Empty<CompilationErrorSnapshot>();
                }

                var take = maxCount > 0 ? Math.Min(maxCount, LastCompilationErrors.Count) : LastCompilationErrors.Count;
                var result = new CompilationErrorSnapshot[take];
                for (var i = 0; i < take; i++)
                {
                    result[i] = LastCompilationErrors[i];
                }

                return result;
            }
        }

        private static void OnCompilationStarted(object _)
        {
            lock (SyncRoot)
            {
                _lastCompilationStartedUtcTicks = DateTime.UtcNow.Ticks;
                _lastCompilationErrorCount = 0;
                LastCompilationErrors.Clear();
            }
        }

        private static void OnAssemblyCompilationFinished(string _, CompilerMessage[] messages)
        {
            if (messages == null || messages.Length == 0)
            {
                return;
            }

            var errorCount = 0;
            for (var i = 0; i < messages.Length; i++)
            {
                if (messages[i].type == CompilerMessageType.Error)
                {
                    errorCount += 1;
                }
            }

            if (errorCount <= 0)
            {
                return;
            }

            lock (SyncRoot)
            {
                for (var i = 0; i < messages.Length; i++)
                {
                    var msg = messages[i];
                    if (msg.type != CompilerMessageType.Error)
                    {
                        continue;
                    }

                    _lastCompilationErrorCount += 1;
                    LastCompilationErrors.Add(new CompilationErrorSnapshot
                    {
                        code = ExtractErrorCode(msg.message),
                        file = msg.file ?? string.Empty,
                        line = msg.line,
                        column = msg.column,
                        message = msg.message ?? string.Empty
                    });
                }
            }
        }

        private static void OnCompilationFinished(object _)
        {
            lock (SyncRoot)
            {
                if (_lastCompilationStartedUtcTicks <= 0)
                {
                    _lastCompilationStartedUtcTicks = DateTime.UtcNow.Ticks;
                }

                _lastCompilationFinishedUtcTicks = DateTime.UtcNow.Ticks;
            }
        }

        private static string ExtractErrorCode(string message)
        {
            if (string.IsNullOrEmpty(message))
            {
                return string.Empty;
            }

            var match = Regex.Match(message, "\\bCS\\d{4}\\b");
            if (!match.Success)
            {
                return string.Empty;
            }

            return match.Value;
        }
    }

    public sealed class CompilationErrorSnapshot
    {
        public string code;
        public string file;
        public int line;
        public int column;
        public string message;
    }
}

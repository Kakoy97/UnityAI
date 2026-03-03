using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    internal static class OperationHistoryStore
    {
        private const string RetentionDaysEditorPrefKey = "Codex.OperationHistory.RetentionDays";
        private const string MaxEntriesEditorPrefKey = "Codex.OperationHistory.MaxEntries";
        private const string SessionIdEditorPrefKey = "Codex.OperationHistory.SessionId";
        private const int DefaultRetentionDays = 7;
        private const int MinRetentionDays = 1;
        private const int MaxRetentionDays = 90;
        private const int DefaultMaxEntries = 1000;
        private const int MinMaxEntries = 10;
        private const int MaxMaxEntries = 20000;
        private const string FileNamePrefix = "operation-history-";
        private const string FileNameSuffix = ".jsonl";
        private static readonly Encoding Utf8NoBom = new UTF8Encoding(false);

        private static string _testRootPath = string.Empty;
        private static string _testSessionId = string.Empty;
        private static int _testRetentionDays = -1;
        private static int _testMaxEntries = -1;
        private static DateTime _testNowUtc = DateTime.MinValue;

        [Serializable]
        private sealed class OperationHistoryEntry
        {
            public string schema_version;
            public string recorded_at;
            public string session_id;
            public string thread_id;
            public string turn_id;
            public string request_id;
            public string action_type;
            public bool success;
            public string error_code;
            public string target_object_path;
            public string target_object_id;
            public string created_object_path;
            public string created_object_id;
            public string component_assembly_qualified_name;
            public int duration_ms;
            public UnityWriteReceipt write_receipt;
        }

        internal sealed class AppendResult
        {
            public bool Success;
            public string FilePath;
            public string ErrorMessage;
            public int TotalEntryCountAfter;
        }

        internal static AppendResult Append(UnityActionResultRequest request)
        {
            var result = new AppendResult
            {
                Success = false,
                FilePath = string.Empty,
                ErrorMessage = string.Empty,
                TotalEntryCountAfter = 0,
            };

            if (request == null || request.payload == null)
            {
                result.ErrorMessage = "unity.action.result payload is missing.";
                return result;
            }

            try
            {
                var nowUtc = ResolveNowUtc();
                var rootPath = ResolveRootPath();
                Directory.CreateDirectory(rootPath);

                PruneByAge(rootPath, nowUtc);

                var filePath = Path.Combine(
                    rootPath,
                    FileNamePrefix + nowUtc.ToString("yyyyMMdd") + FileNameSuffix);
                var entry = BuildEntry(request, nowUtc);
                var serialized = JsonUtility.ToJson(entry);
                File.AppendAllText(filePath, serialized + Environment.NewLine, Utf8NoBom);

                var maxEntries = ResolveMaxEntries();
                var totalAfter = EnforceMaxEntries(rootPath, maxEntries);
                result.Success = true;
                result.FilePath = filePath;
                result.TotalEntryCountAfter = totalAfter;
                return result;
            }
            catch (Exception ex)
            {
                result.ErrorMessage = ex.Message;
                return result;
            }
        }

        private static OperationHistoryEntry BuildEntry(
            UnityActionResultRequest request,
            DateTime nowUtc)
        {
            var payload = request.payload;
            return new OperationHistoryEntry
            {
                schema_version = "operation_history.v1",
                recorded_at = nowUtc.ToString("o"),
                session_id = ResolveSessionId(),
                thread_id = Safe(request.thread_id),
                turn_id = Safe(request.turn_id),
                request_id = Safe(request.request_id),
                action_type = Safe(payload.action_type),
                success = payload.success,
                error_code = Safe(payload.error_code),
                target_object_path = Safe(payload.target_object_path),
                target_object_id = Safe(payload.target_object_id),
                created_object_path = Safe(payload.created_object_path),
                created_object_id = Safe(payload.created_object_id),
                component_assembly_qualified_name =
                    Safe(payload.component_assembly_qualified_name),
                duration_ms = payload.duration_ms > 0 ? payload.duration_ms : 0,
                write_receipt = payload.write_receipt,
            };
        }

        private static void PruneByAge(string rootPath, DateTime nowUtc)
        {
            var retentionDays = ResolveRetentionDays();
            var threshold = nowUtc.AddDays(-retentionDays);
            var files = Directory.GetFiles(rootPath, FileNamePrefix + "*" + FileNameSuffix);
            for (var i = 0; i < files.Length; i++)
            {
                var filePath = files[i];
                DateTime lastWriteUtc;
                try
                {
                    lastWriteUtc = File.GetLastWriteTimeUtc(filePath);
                }
                catch
                {
                    continue;
                }

                if (lastWriteUtc < threshold)
                {
                    TryDeleteFile(filePath);
                }
            }
        }

        private static int EnforceMaxEntries(string rootPath, int maxEntries)
        {
            var files = Directory.GetFiles(rootPath, FileNamePrefix + "*" + FileNameSuffix)
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToArray();
            var lineCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var total = 0;
            for (var i = 0; i < files.Length; i++)
            {
                var filePath = files[i];
                var count = CountLines(filePath);
                lineCounts[filePath] = count;
                total += count;
            }

            var toTrim = total - maxEntries;
            if (toTrim <= 0)
            {
                return total;
            }

            for (var i = 0; i < files.Length && toTrim > 0; i++)
            {
                var filePath = files[i];
                var fileCount = lineCounts[filePath];
                if (fileCount <= 0)
                {
                    continue;
                }

                if (toTrim >= fileCount)
                {
                    toTrim -= fileCount;
                    total -= fileCount;
                    TryDeleteFile(filePath);
                    continue;
                }

                var keepFrom = toTrim;
                var lines = File.ReadAllLines(filePath);
                var kept = lines.Skip(keepFrom).ToArray();
                File.WriteAllLines(filePath, kept, Utf8NoBom);
                total -= toTrim;
                toTrim = 0;
            }

            return total < 0 ? 0 : total;
        }

        private static int CountLines(string filePath)
        {
            try
            {
                return File.ReadLines(filePath).Count();
            }
            catch
            {
                return 0;
            }
        }

        private static void TryDeleteFile(string filePath)
        {
            try
            {
                if (File.Exists(filePath))
                {
                    File.Delete(filePath);
                }
            }
            catch
            {
                // ignored
            }
        }

        private static string ResolveRootPath()
        {
            if (!string.IsNullOrWhiteSpace(_testRootPath))
            {
                return _testRootPath;
            }

            var projectRoot = Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, ".."));
            return Path.Combine(projectRoot, "Library", "Codex", "operation_history");
        }

        private static DateTime ResolveNowUtc()
        {
            if (_testNowUtc > DateTime.MinValue)
            {
                return _testNowUtc;
            }
            return DateTime.UtcNow;
        }

        private static int ResolveRetentionDays()
        {
            if (_testRetentionDays >= MinRetentionDays)
            {
                return _testRetentionDays;
            }
            var value = EditorPrefs.GetInt(RetentionDaysEditorPrefKey, DefaultRetentionDays);
            return Clamp(value, MinRetentionDays, MaxRetentionDays);
        }

        private static int ResolveMaxEntries()
        {
            if (_testMaxEntries > 0)
            {
                // Tests need small budgets (e.g. 2) to validate trimming behavior quickly.
                return Clamp(_testMaxEntries, 1, MaxMaxEntries);
            }
            var value = EditorPrefs.GetInt(MaxEntriesEditorPrefKey, DefaultMaxEntries);
            return Clamp(value, MinMaxEntries, MaxMaxEntries);
        }

        private static string ResolveSessionId()
        {
            if (!string.IsNullOrWhiteSpace(_testSessionId))
            {
                return _testSessionId;
            }

            var existing = EditorPrefs.GetString(SessionIdEditorPrefKey, string.Empty);
            if (!string.IsNullOrWhiteSpace(existing))
            {
                return existing.Trim();
            }

            var generated = "sess_" + DateTime.UtcNow.ToString("yyyyMMddTHHmmss") +
                            "_" + Guid.NewGuid().ToString("N");
            EditorPrefs.SetString(SessionIdEditorPrefKey, generated);
            return generated;
        }

        private static int Clamp(int value, int minValue, int maxValue)
        {
            if (value < minValue)
            {
                return minValue;
            }
            if (value > maxValue)
            {
                return maxValue;
            }
            return value;
        }

        private static string Safe(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }

        internal static void ConfigureForTests(
            string rootPath,
            int retentionDays,
            int maxEntries,
            string sessionId,
            DateTime nowUtc)
        {
            _testRootPath = string.IsNullOrWhiteSpace(rootPath) ? string.Empty : rootPath.Trim();
            _testRetentionDays = retentionDays;
            _testMaxEntries = maxEntries;
            _testSessionId = string.IsNullOrWhiteSpace(sessionId) ? string.Empty : sessionId.Trim();
            _testNowUtc = nowUtc;
        }

        internal static void ResetTestOverrides()
        {
            _testRootPath = string.Empty;
            _testRetentionDays = -1;
            _testMaxEntries = -1;
            _testSessionId = string.Empty;
            _testNowUtc = DateTime.MinValue;
        }
    }
}

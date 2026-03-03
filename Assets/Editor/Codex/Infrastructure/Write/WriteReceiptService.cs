using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure
{
    internal static class WriteReceiptService
    {
        private const string ConsoleWindowSecondsEditorPrefKey = "Codex.WriteReceipt.ConsoleWindowSeconds";
        private const string ConsoleMaxEntriesEditorPrefKey = "Codex.WriteReceipt.ConsoleMaxEntries";
        private const int DefaultConsoleWindowSeconds = 20;
        private const int MinConsoleWindowSeconds = 1;
        private const int MaxConsoleWindowSeconds = 300;
        private const int DefaultConsoleMaxEntries = 12;
        private const int MinConsoleMaxEntries = 1;
        private const int MaxConsoleMaxEntries = 100;

        internal sealed class Baseline
        {
            public string[] DirtyScenePathsBefore;
            public GameObject TargetObjectBefore;
            public UnityWriteTargetSnapshot TargetSnapshotBefore;
            public string TargetResolution;
            public DateTime OperationStartedAtUtc;
        }

        internal static Baseline CaptureBefore(VisualLayerActionItem action, GameObject selected)
        {
            string targetResolution;
            var targetObject = ResolvePrimaryTarget(action, selected, out targetResolution);
            return new Baseline
            {
                DirtyScenePathsBefore = CollectDirtyScenePaths(),
                TargetObjectBefore = targetObject,
                TargetSnapshotBefore = Snapshot(targetObject),
                TargetResolution = targetResolution,
                OperationStartedAtUtc = DateTime.UtcNow,
            };
        }

        internal static UnityWriteReceipt Build(
            Baseline baseline,
            VisualLayerActionItem action,
            UnityActionExecutionResult executionResult)
        {
            var safeBaseline = baseline ?? CaptureBefore(action, null);
            var nowUtc = DateTime.UtcNow;
            var dirtyAfter = CollectDirtyScenePaths();
            var sceneDiff = BuildSceneDiff(safeBaseline.DirtyScenePathsBefore, dirtyAfter);

            var targetAfter = ResolvePostTarget(action, executionResult, safeBaseline.TargetObjectBefore);
            var targetAfterSnapshot = Snapshot(targetAfter);
            var targetDelta = new UnityWriteTargetDelta
            {
                before = safeBaseline.TargetSnapshotBefore ?? Snapshot(null),
                after = targetAfterSnapshot,
                changed_fields = BuildChangedFields(
                    safeBaseline.TargetSnapshotBefore ?? Snapshot(null),
                    targetAfterSnapshot),
            };

            var createdBefore = Snapshot(null);
            var createdAfter = ResolveCreatedSnapshot(executionResult);
            var createdDelta = new UnityWriteTargetDelta
            {
                before = createdBefore,
                after = createdAfter,
                changed_fields = BuildChangedFields(createdBefore, createdAfter),
            };

            var propertyChanges = new List<string>();
            AppendPrefixed(propertyChanges, "target", targetDelta.changed_fields);
            AppendPrefixed(propertyChanges, "created", createdDelta.changed_fields);
            if (sceneDiff.dirty_scene_set_changed)
            {
                propertyChanges.Add("scene.dirty_scene_set");
            }

            var consoleSnapshot = BuildConsoleSnapshot(safeBaseline, nowUtc);

            return new UnityWriteReceipt
            {
                schema_version = "write_receipt.v1",
                captured_at = nowUtc.ToString("o"),
                success = executionResult != null && executionResult.success,
                error_code = executionResult == null || string.IsNullOrWhiteSpace(executionResult.errorCode)
                    ? string.Empty
                    : executionResult.errorCode.Trim(),
                target_resolution = string.IsNullOrWhiteSpace(safeBaseline.TargetResolution)
                    ? "none"
                    : safeBaseline.TargetResolution,
                scene_diff = sceneDiff,
                target_delta = targetDelta,
                created_object_delta = createdDelta,
                property_changes = propertyChanges.ToArray(),
                console_snapshot = consoleSnapshot,
            };
        }

        private static UnityWriteSceneDiff BuildSceneDiff(
            string[] beforePaths,
            string[] afterPaths)
        {
            var before = beforePaths ?? Array.Empty<string>();
            var after = afterPaths ?? Array.Empty<string>();
            var beforeSet = new HashSet<string>(before, StringComparer.Ordinal);
            var afterSet = new HashSet<string>(after, StringComparer.Ordinal);

            var added = new List<string>();
            var cleared = new List<string>();
            for (var i = 0; i < after.Length; i++)
            {
                var path = after[i];
                if (!beforeSet.Contains(path))
                {
                    added.Add(path);
                }
            }

            for (var i = 0; i < before.Length; i++)
            {
                var path = before[i];
                if (!afterSet.Contains(path))
                {
                    cleared.Add(path);
                }
            }

            return new UnityWriteSceneDiff
            {
                dirty_scene_count_before = before.Length,
                dirty_scene_count_after = after.Length,
                added_dirty_scene_paths = added.ToArray(),
                cleared_dirty_scene_paths = cleared.ToArray(),
                dirty_scene_set_changed = added.Count > 0 || cleared.Count > 0,
            };
        }

        private static UnityWriteConsoleSnapshot BuildConsoleSnapshot(
            Baseline baseline,
            DateTime nowUtc)
        {
            var windowSeconds = ReadConfiguredInt(
                ConsoleWindowSecondsEditorPrefKey,
                DefaultConsoleWindowSeconds,
                MinConsoleWindowSeconds,
                MaxConsoleWindowSeconds);
            var maxEntries = ReadConfiguredInt(
                ConsoleMaxEntriesEditorPrefKey,
                DefaultConsoleMaxEntries,
                MinConsoleMaxEntries,
                MaxConsoleMaxEntries);
            var startedAtUtc = baseline == null || baseline.OperationStartedAtUtc <= DateTime.MinValue
                ? nowUtc
                : baseline.OperationStartedAtUtc;
            var minimumStart = nowUtc.AddSeconds(-windowSeconds);
            if (startedAtUtc < minimumStart)
            {
                startedAtUtc = minimumStart;
            }
            if (startedAtUtc > nowUtc)
            {
                startedAtUtc = nowUtc;
            }

            var recent = UnityConsoleErrorTracker.GetRecentErrors(MaxConsoleMaxEntries);
            var filtered = new List<UnityWriteConsoleEntry>();
            for (var i = 0; i < recent.Length; i++)
            {
                var item = recent[i];
                if (item == null)
                {
                    continue;
                }

                var timestampUtc = ParseIsoUtc(item.timestamp, nowUtc);
                if (timestampUtc < startedAtUtc || timestampUtc > nowUtc)
                {
                    continue;
                }

                filtered.Add(new UnityWriteConsoleEntry
                {
                    timestamp = timestampUtc.ToString("o"),
                    log_type = string.IsNullOrWhiteSpace(item.log_type) ? "Error" : item.log_type.Trim(),
                    error_code = string.IsNullOrWhiteSpace(item.error_code) ? string.Empty : item.error_code.Trim(),
                    condition = string.IsNullOrWhiteSpace(item.condition) ? string.Empty : item.condition.Trim(),
                    file = string.IsNullOrWhiteSpace(item.file) ? string.Empty : item.file.Trim(),
                    line = item.line > 0 ? item.line : 0,
                });
            }

            var totalErrors = filtered.Count;
            if (filtered.Count > maxEntries)
            {
                filtered.RemoveRange(maxEntries, filtered.Count - maxEntries);
            }

            return new UnityWriteConsoleSnapshot
            {
                captured_at = nowUtc.ToString("o"),
                window_start_at = startedAtUtc.ToString("o"),
                window_end_at = nowUtc.ToString("o"),
                window_seconds = windowSeconds,
                max_entries = maxEntries,
                total_errors = totalErrors,
                truncated = totalErrors > maxEntries,
                errors = filtered.ToArray(),
            };
        }

        private static DateTime ParseIsoUtc(string value, DateTime fallbackUtc)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return fallbackUtc;
            }

            DateTime parsed;
            if (!DateTime.TryParse(
                value.Trim(),
                null,
                System.Globalization.DateTimeStyles.AdjustToUniversal |
                    System.Globalization.DateTimeStyles.AssumeUniversal,
                out parsed))
            {
                return fallbackUtc;
            }

            return parsed.Kind == DateTimeKind.Utc ? parsed : parsed.ToUniversalTime();
        }

        private static int ReadConfiguredInt(
            string key,
            int defaultValue,
            int minValue,
            int maxValue)
        {
            var value = EditorPrefs.GetInt(key, defaultValue);
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

        private static string[] CollectDirtyScenePaths()
        {
            var paths = new List<string>();
            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded || !scene.isDirty)
                {
                    continue;
                }

                paths.Add(NormalizeScenePath(scene));
            }

            paths.Sort(StringComparer.Ordinal);
            return paths.ToArray();
        }

        private static string NormalizeScenePath(Scene scene)
        {
            if (!string.IsNullOrWhiteSpace(scene.path))
            {
                return scene.path.Trim();
            }

            return "scene_" + scene.handle;
        }

        private static GameObject ResolvePrimaryTarget(
            VisualLayerActionItem action,
            GameObject selected,
            out string source)
        {
            source = "none";
            var targetPath = NormalizePath(action == null || action.target_anchor == null
                ? string.Empty
                : action.target_anchor.path);
            if (!string.IsNullOrEmpty(targetPath))
            {
                var go = FindGameObjectByScenePath(targetPath);
                if (go != null)
                {
                    source = "target_anchor";
                    return go;
                }
            }

            if (selected != null)
            {
                source = "selected";
                return selected;
            }

            var parentPath = NormalizePath(action == null || action.parent_anchor == null
                ? string.Empty
                : action.parent_anchor.path);
            if (!string.IsNullOrEmpty(parentPath))
            {
                var parent = FindGameObjectByScenePath(parentPath);
                if (parent != null)
                {
                    source = "parent_anchor";
                    return parent;
                }
            }

            return null;
        }

        private static GameObject ResolvePostTarget(
            VisualLayerActionItem action,
            UnityActionExecutionResult executionResult,
            GameObject targetBefore)
        {
            if (targetBefore != null)
            {
                return targetBefore;
            }

            var resultTargetPath = NormalizePath(executionResult == null
                ? string.Empty
                : executionResult.targetObjectPath);
            if (!string.IsNullOrEmpty(resultTargetPath))
            {
                var targetFromResult = FindGameObjectByScenePath(resultTargetPath);
                if (targetFromResult != null)
                {
                    return targetFromResult;
                }
            }

            var targetPath = NormalizePath(action == null || action.target_anchor == null
                ? string.Empty
                : action.target_anchor.path);
            if (!string.IsNullOrEmpty(targetPath))
            {
                return FindGameObjectByScenePath(targetPath);
            }

            return null;
        }

        private static UnityWriteTargetSnapshot ResolveCreatedSnapshot(UnityActionExecutionResult executionResult)
        {
            var createdPath = NormalizePath(executionResult == null
                ? string.Empty
                : executionResult.createdObjectPath);
            if (string.IsNullOrEmpty(createdPath))
            {
                return Snapshot(null);
            }

            var created = FindGameObjectByScenePath(createdPath);
            return Snapshot(created);
        }

        private static UnityWriteTargetSnapshot Snapshot(GameObject go)
        {
            if (go == null)
            {
                return new UnityWriteTargetSnapshot
                {
                    exists = false,
                    object_id = string.Empty,
                    path = string.Empty,
                    name = string.Empty,
                    active = false,
                    parent_path = string.Empty,
                    component_count = 0,
                    child_count = 0,
                };
            }

            var parentPath = string.Empty;
            if (go.transform != null && go.transform.parent != null)
            {
                parentPath = BuildScenePath(go.transform.parent);
            }

            return new UnityWriteTargetSnapshot
            {
                exists = true,
                object_id = BuildObjectId(go),
                path = go.transform == null ? string.Empty : BuildScenePath(go.transform),
                name = string.IsNullOrWhiteSpace(go.name) ? string.Empty : go.name.Trim(),
                active = go.activeSelf,
                parent_path = parentPath,
                component_count = SafeComponentCount(go),
                child_count = go.transform == null ? 0 : go.transform.childCount,
            };
        }

        private static string[] BuildChangedFields(
            UnityWriteTargetSnapshot before,
            UnityWriteTargetSnapshot after)
        {
            var b = before ?? Snapshot(null);
            var a = after ?? Snapshot(null);
            var changed = new List<string>();

            if (b.exists != a.exists)
            {
                changed.Add("exists");
            }
            if (!string.Equals(b.path, a.path, StringComparison.Ordinal))
            {
                changed.Add("path");
            }
            if (!string.Equals(b.name, a.name, StringComparison.Ordinal))
            {
                changed.Add("name");
            }
            if (b.active != a.active)
            {
                changed.Add("active");
            }
            if (!string.Equals(b.parent_path, a.parent_path, StringComparison.Ordinal))
            {
                changed.Add("parent_path");
            }
            if (b.component_count != a.component_count)
            {
                changed.Add("component_count");
            }
            if (b.child_count != a.child_count)
            {
                changed.Add("child_count");
            }

            return changed.ToArray();
        }

        private static void AppendPrefixed(List<string> target, string prefix, string[] values)
        {
            if (target == null || values == null || values.Length == 0)
            {
                return;
            }

            var safePrefix = string.IsNullOrWhiteSpace(prefix) ? "field" : prefix.Trim();
            for (var i = 0; i < values.Length; i++)
            {
                var item = values[i];
                if (string.IsNullOrWhiteSpace(item))
                {
                    continue;
                }

                target.Add(safePrefix + "." + item.Trim());
            }
        }

        private static int SafeComponentCount(GameObject go)
        {
            if (go == null)
            {
                return 0;
            }

            try
            {
                var components = go.GetComponents<Component>();
                return components == null ? 0 : components.Length;
            }
            catch
            {
                return 0;
            }
        }

        private static string BuildObjectId(GameObject go)
        {
            if (go == null)
            {
                return string.Empty;
            }

            try
            {
                var globalObjectId = GlobalObjectId.GetGlobalObjectIdSlow(go);
                var serialized = globalObjectId.ToString();
                if (!string.IsNullOrWhiteSpace(serialized))
                {
                    return serialized.Trim();
                }
            }
            catch
            {
                // ignored
            }

            return "instance_" + go.GetInstanceID();
        }

        private static GameObject FindGameObjectByScenePath(string targetPath)
        {
            if (string.IsNullOrEmpty(targetPath))
            {
                return null;
            }

            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex++)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var i = 0; i < roots.Length; i++)
                {
                    var root = roots[i];
                    if (root == null)
                    {
                        continue;
                    }

                    Transform found;
                    if (TryFindTransformByPath(root.transform, targetPath, out found) && found != null)
                    {
                        return found.gameObject;
                    }
                }
            }

            return null;
        }

        private static bool TryFindTransformByPath(Transform current, string targetPath, out Transform found)
        {
            found = null;
            if (current == null)
            {
                return false;
            }

            if (string.Equals(BuildScenePath(current), targetPath, StringComparison.Ordinal))
            {
                found = current;
                return true;
            }

            for (var i = 0; i < current.childCount; i++)
            {
                if (TryFindTransformByPath(current.GetChild(i), targetPath, out found))
                {
                    return true;
                }
            }

            return false;
        }

        private static string BuildScenePath(Transform transform)
        {
            if (transform == null)
            {
                return string.Empty;
            }

            var segments = new List<string>();
            var current = transform;
            while (current != null)
            {
                segments.Add(current.name);
                current = current.parent;
            }

            segments.Reverse();
            return "Scene/" + string.Join("/", segments.ToArray());
        }

        private static string NormalizePath(string path)
        {
            return string.IsNullOrWhiteSpace(path) ? string.Empty : path.Trim();
        }
    }
}

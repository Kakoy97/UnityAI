using System;
using System.Collections.Generic;
using System.IO;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityEditor;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class ListAssetsInFolderSsotExecutor
    {
        public SsotDispatchResponse Execute(ListAssetsInFolderRequestDto request)
        {
            if (request == null || string.IsNullOrWhiteSpace(request.folder_path))
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "folder_path is required.",
                    ListAssetsInFolderRequestDto.ToolName);
            }

            var folderPath = NormalizePath(request.folder_path);
            if (!AssetDatabase.IsValidFolder(folderPath))
            {
                return SsotRequestDispatcher.Failure(
                    "E_FOLDER_NOT_FOUND",
                    "folder_path is not a valid Unity folder: " + folderPath,
                    ListAssetsInFolderRequestDto.ToolName);
            }

            var recursive = request.recursive;
            var includeMeta = request.include_meta;
            var limit = request.limit > 0 ? request.limit : 5000;
            if (limit > 5000)
            {
                limit = 5000;
            }

            var entries = CollectAssetEntries(folderPath, recursive, includeMeta, limit);

            return SsotRequestDispatcher.Success(
                ListAssetsInFolderRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    folder_path = folderPath,
                    recursive = recursive,
                    include_meta = includeMeta,
                    total_count = entries.Length,
                    assets = entries,
                });
        }

        private static SsotAssetEntrySummary[] CollectAssetEntries(
            string folderPath,
            bool recursive,
            bool includeMeta,
            int limit)
        {
            var uniquePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var orderedPaths = new List<string>();
            var guids = AssetDatabase.FindAssets(string.Empty, new[] { folderPath });
            for (var i = 0; i < guids.Length; i += 1)
            {
                var path = NormalizePath(AssetDatabase.GUIDToAssetPath(guids[i]));
                if (string.IsNullOrEmpty(path))
                {
                    continue;
                }

                if (!includeMeta && path.EndsWith(".meta", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (!recursive && !IsDirectChild(folderPath, path))
                {
                    continue;
                }

                if (!uniquePaths.Add(path))
                {
                    continue;
                }

                orderedPaths.Add(path);
            }

            orderedPaths.Sort(StringComparer.OrdinalIgnoreCase);
            if (orderedPaths.Count > limit)
            {
                orderedPaths.RemoveRange(limit, orderedPaths.Count - limit);
            }

            var output = new SsotAssetEntrySummary[orderedPaths.Count];
            for (var i = 0; i < orderedPaths.Count; i += 1)
            {
                output[i] = new SsotAssetEntrySummary
                {
                    path = orderedPaths[i]
                };
            }

            return output;
        }

        private static bool IsDirectChild(string folderPath, string assetPath)
        {
            if (string.IsNullOrEmpty(folderPath) || string.IsNullOrEmpty(assetPath))
            {
                return false;
            }

            var normalizedFolderPath = NormalizePath(folderPath).TrimEnd('/');
            var normalizedAssetPath = NormalizePath(assetPath);
            var parentPath = NormalizePath(Path.GetDirectoryName(normalizedAssetPath));
            return string.Equals(normalizedFolderPath, parentPath, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizePath(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return string.Empty;
            }

            return value.Trim().Replace('\\', '/');
        }
    }
}

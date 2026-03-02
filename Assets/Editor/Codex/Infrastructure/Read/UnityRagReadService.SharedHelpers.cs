using System;
using System.IO;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        private static UnityReadToken BuildReadToken(string kind, string objectId, string path)
        {
            return new UnityReadToken
            {
                token = "rt_" + Guid.NewGuid().ToString("N"),
                issued_at = NowIso(),
                hard_max_age_ms = ReadTokenHardMaxAgeMs,
                revision_vector = new UnityReadTokenRevisionVector
                {
                    scene_revision = UnitySceneRevisionTracker.CurrentRevision,
                    asset_revision = "asset_rev_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(),
                    compile_epoch = 0
                },
                scope = new UnityReadTokenScope
                {
                    kind = string.IsNullOrWhiteSpace(kind) ? "scene" : kind.Trim(),
                    object_id = string.IsNullOrWhiteSpace(objectId) ? string.Empty : objectId.Trim(),
                    path = string.IsNullOrWhiteSpace(path) ? string.Empty : NormalizePath(path)
                }
            };
        }

        private static string ResolveAssetType(string assetPath)
        {
            if (AssetDatabase.IsValidFolder(assetPath))
            {
                return "Folder";
            }

            var type = AssetDatabase.GetMainAssetTypeAtPath(assetPath);
            if (type == null)
            {
                return "Unknown";
            }

            return string.IsNullOrEmpty(type.FullName) ? type.Name : type.FullName;
        }

        private static bool IsDirectChild(string candidatePath, string folderPath)
        {
            if (string.IsNullOrEmpty(candidatePath) || string.IsNullOrEmpty(folderPath))
            {
                return false;
            }

            var parent = Path.GetDirectoryName(candidatePath);
            if (string.IsNullOrEmpty(parent))
            {
                return false;
            }

            parent = NormalizePath(parent).TrimEnd('/');
            var root = NormalizePath(folderPath).TrimEnd('/');
            return string.Equals(parent, root, StringComparison.OrdinalIgnoreCase);
        }

        private static string NormalizePath(string raw)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                return string.Empty;
            }

            return raw.Replace('\\', '/').Trim();
        }

        private static string NormalizeRequestId(string requestId)
        {
            return string.IsNullOrWhiteSpace(requestId) ? string.Empty : requestId.Trim();
        }

        private static string BuildObjectPath(Transform transform, string prefix)
        {
            if (transform == null)
            {
                return string.Empty;
            }

            var path = transform.name;
            var current = transform;
            while (current.parent != null)
            {
                current = current.parent;
                path = current.name + "/" + path;
            }

            var normalizedPrefix = string.IsNullOrWhiteSpace(prefix) ? string.Empty : prefix.Trim().TrimEnd('/');
            return string.IsNullOrEmpty(normalizedPrefix) ? path : normalizedPrefix + "/" + path;
        }

        private static string BuildObjectId(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            try
            {
                var id = GlobalObjectId.GetGlobalObjectIdSlow(gameObject).ToString();
                if (!string.IsNullOrEmpty(id))
                {
                    return id;
                }
            }
            catch
            {
                // ignored
            }

            return "instance_" + gameObject.GetInstanceID().ToString();
        }

        private static string BuildAssemblyQualifiedName(Type type)
        {
            if (type == null)
            {
                return string.Empty;
            }

            if (!string.IsNullOrEmpty(type.AssemblyQualifiedName))
            {
                return type.AssemblyQualifiedName;
            }

            if (!string.IsNullOrEmpty(type.FullName))
            {
                return type.FullName;
            }

            return string.IsNullOrEmpty(type.Name) ? string.Empty : type.Name;
        }

        private static bool ContainsIgnoreCase(string source, string query)
        {
            if (string.IsNullOrEmpty(source) || string.IsNullOrEmpty(query))
            {
                return false;
            }

            return source.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static int ClampPositive(int value, int fallback)
        {
            return value > 0 ? value : fallback;
        }

        private static string NowIso()
        {
            return DateTime.UtcNow.ToString("o");
        }
    }
}

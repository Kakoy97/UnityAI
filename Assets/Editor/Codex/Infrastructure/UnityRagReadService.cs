using System;
using System.Collections.Generic;
using System.IO;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class UnityRagReadService
    {
        private const string MissingScriptShortName = "MissingScript";
        private const string MissingScriptAssemblyQualifiedName = "UnityEditor.MissingScript";
        private const int DefaultLimit = 200;
        private const int DefaultNodeBudget = 512;
        private const int DefaultCharBudget = 64000;
        private const int ReadTokenHardMaxAgeMs = 3 * 60 * 1000;
        private const int MaxReadErrorMessageLength = 320;

        public UnityListAssetsInFolderResponse ListAssetsInFolder(UnityListAssetsInFolderRequest request)
        {
            var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
            var payload = request == null ? null : request.payload;
            var folderPath = payload != null ? NormalizePath(payload.folder_path) : string.Empty;
            if (string.IsNullOrEmpty(folderPath) || !AssetDatabase.IsValidFolder(folderPath))
            {
                return BuildListAssetsFailure(requestId, "E_SCHEMA_INVALID", "payload.folder_path is required and must be a valid folder.");
            }

            var recursive = payload != null && payload.recursive;
            var includeMeta = payload != null && payload.include_meta;
            var limit = ClampPositive(payload == null ? 0 : payload.limit, DefaultLimit);
            var guids = AssetDatabase.FindAssets(string.Empty, new[] { folderPath });

            var assets = new List<UnityAssetInfo>(Math.Min(limit, guids.Length));
            var totalCount = 0;
            for (var i = 0; i < guids.Length; i++)
            {
                var assetPath = NormalizePath(AssetDatabase.GUIDToAssetPath(guids[i]));
                if (string.IsNullOrEmpty(assetPath))
                {
                    continue;
                }
                if (!recursive && !IsDirectChild(assetPath, folderPath))
                {
                    continue;
                }
                if (!includeMeta && assetPath.EndsWith(".meta", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                totalCount += 1;
                if (assets.Count < limit)
                {
                    assets.Add(
                        new UnityAssetInfo
                        {
                            guid = guids[i],
                            path = assetPath,
                            asset_type = ResolveAssetType(assetPath),
                            is_folder = AssetDatabase.IsValidFolder(assetPath)
                        });
                }
            }

            return new UnityListAssetsInFolderResponse
            {
                ok = true,
                request_id = requestId,
                captured_at = NowIso(),
                error_code = string.Empty,
                error_message = string.Empty,
                read_token = BuildReadToken("asset", string.Empty, folderPath),
                data = new UnityListAssetsInFolderData
                {
                    folder_path = folderPath,
                    recursive = recursive,
                    include_meta = includeMeta,
                    limit = limit,
                    returned_count = assets.Count,
                    total_count = totalCount,
                    assets = assets.ToArray()
                }
            };
        }

        public UnityGetSceneRootsResponse GetSceneRoots(UnityGetSceneRootsRequest request)
        {
            var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
            var payload = request == null ? null : request.payload;
            var scenePath = payload != null ? NormalizePath(payload.scene_path) : string.Empty;
            var includeInactive = payload == null || payload.include_inactive;

            var roots = new List<UnitySceneRootInfo>();
            if (!CollectSceneRoots(scenePath, includeInactive, roots))
            {
                return BuildGetSceneRootsFailure(requestId, "E_SCENE_NOT_LOADED", "Scene is not loaded: " + scenePath);
            }

            return new UnityGetSceneRootsResponse
            {
                ok = true,
                request_id = requestId,
                captured_at = NowIso(),
                error_code = string.Empty,
                error_message = string.Empty,
                read_token = BuildReadToken("scene", roots.Count > 0 ? roots[0].object_id : string.Empty, string.IsNullOrEmpty(scenePath) ? "Scene" : scenePath),
                data = new UnityGetSceneRootsData
                {
                    scene_path = scenePath,
                    include_inactive = includeInactive,
                    scene_revision = UnitySceneRevisionTracker.CurrentRevision,
                    returned_count = roots.Count,
                    roots = roots.ToArray()
                }
            };
        }

        public UnityFindObjectsByComponentResponse FindObjectsByComponent(UnityFindObjectsByComponentRequest request)
        {
            var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
            var payload = request == null ? null : request.payload;
            var query = payload != null ? (payload.component_query ?? string.Empty).Trim() : string.Empty;
            if (string.IsNullOrEmpty(query))
            {
                return BuildFindObjectsFailure(requestId, "E_SCHEMA_INVALID", "payload.component_query is required.");
            }

            var scenePath = payload != null ? NormalizePath(payload.scene_path) : string.Empty;
            var underPath = payload != null ? NormalizePath(payload.under_path) : string.Empty;
            var includeInactive = payload == null || payload.include_inactive;
            var limit = ClampPositive(payload == null ? 0 : payload.limit, DefaultLimit);

            List<UnityComponentMatchItem> matches;
            if (!FindComponentMatches(scenePath, underPath, includeInactive, query, limit, out matches))
            {
                return BuildFindObjectsFailure(requestId, "E_SCENE_NOT_LOADED", "Scene is not loaded: " + scenePath);
            }

            return new UnityFindObjectsByComponentResponse
            {
                ok = true,
                request_id = requestId,
                captured_at = NowIso(),
                error_code = string.Empty,
                error_message = string.Empty,
                read_token = BuildReadToken("scene", matches.Count > 0 ? matches[0].object_id : string.Empty, string.IsNullOrEmpty(underPath) ? "Scene" : underPath),
                data = new UnityFindObjectsByComponentData
                {
                    component_query = query,
                    scene_path = scenePath,
                    under_path = underPath,
                    include_inactive = includeInactive,
                    limit = limit,
                    returned_count = matches.Count,
                    matches = matches.ToArray()
                }
            };
        }

        public UnityQueryPrefabInfoResponse QueryPrefabInfo(UnityQueryPrefabInfoRequest request)
        {
            var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
            var payload = request == null ? null : request.payload;
            if (payload == null || string.IsNullOrWhiteSpace(payload.prefab_path) || payload.max_depth < 0)
            {
                return BuildQueryPrefabFailure(requestId, "E_SCHEMA_INVALID", "payload.prefab_path is required and payload.max_depth must be >= 0.");
            }

            var prefabPath = NormalizePath(payload.prefab_path);
            var nodeBudget = ClampPositive(payload.node_budget, DefaultNodeBudget);
            var charBudget = ClampPositive(payload.char_budget, DefaultCharBudget);
            var includeComponents = payload.include_components;
            var includeMissingScripts = payload.include_missing_scripts;
            var prefabRoot = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (prefabRoot == null)
            {
                return BuildQueryPrefabFailure(requestId, "E_PREFAB_NOT_FOUND", "Prefab not found: " + prefabPath);
            }

            try
            {
                using (var readScope = new PrefabReadScope(prefabPath))
                {
                    var loadedRoot = readScope.Root;
                    var rootNode = loadedRoot == null
                    ? null
                    : BuildPrefabTreeNode(loadedRoot.transform, prefabPath, 0, payload.max_depth, nodeBudget, includeComponents, includeMissingScripts);
                    var approxSize = rootNode == null ? 0 : JsonUtility.ToJson(rootNode).Length;
                    var truncated = approxSize > charBudget;
                    var truncatedReason = truncated ? "char_budget" : string.Empty;

                    return new UnityQueryPrefabInfoResponse
                    {
                        ok = true,
                        request_id = requestId,
                        captured_at = NowIso(),
                        error_code = string.Empty,
                        error_message = string.Empty,
                        read_token = BuildReadToken("prefab", rootNode == null ? string.Empty : rootNode.object_id, prefabPath),
                        data = new UnityQueryPrefabInfoData
                        {
                            prefab_path = prefabPath,
                            max_depth = payload.max_depth,
                            node_budget = nodeBudget,
                            char_budget = charBudget,
                            include_components = includeComponents,
                            include_missing_scripts = includeMissingScripts,
                            returned_node_count = CountNodes(rootNode),
                            truncated = truncated,
                            truncated_reason = truncatedReason,
                            root = rootNode
                        }
                    };
                }
            }
            catch (PrefabReadScopeDisposeException ex)
            {
                return BuildQueryPrefabFailure(requestId, "E_PREFAB_QUERY_DISPOSE_FAILED", ex.Message);
            }
            catch (MissingMethodException ex)
            {
                return BuildQueryPrefabFailure(requestId, "E_PREFAB_QUERY_API_UNAVAILABLE", ex.Message);
            }
            catch (Exception ex)
            {
                return BuildQueryPrefabFailure(requestId, "E_PREFAB_QUERY_FAILED", ex.Message);
            }
        }

        private static bool CollectSceneRoots(string scenePath, bool includeInactive, List<UnitySceneRootInfo> roots)
        {
            if (roots == null)
            {
                return false;
            }

            if (!string.IsNullOrEmpty(scenePath))
            {
                var scene = SceneManager.GetSceneByPath(scenePath);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    return false;
                }
                AppendSceneRoots(scene, includeInactive, roots);
                return true;
            }

            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }
                AppendSceneRoots(scene, includeInactive, roots);
            }
            return true;
        }

        private static void AppendSceneRoots(Scene scene, bool includeInactive, List<UnitySceneRootInfo> roots)
        {
            var rootObjects = scene.GetRootGameObjects();
            for (var i = 0; i < rootObjects.Length; i++)
            {
                var root = rootObjects[i];
                if (root == null)
                {
                    continue;
                }
                if (!includeInactive && !root.activeInHierarchy)
                {
                    continue;
                }
                roots.Add(
                    new UnitySceneRootInfo
                    {
                        object_id = BuildObjectId(root),
                        path = BuildObjectPath(root.transform, "Scene"),
                        name = root.name,
                        active = root.activeInHierarchy,
                        child_count = root.transform.childCount
                    });
            }
        }

        private static bool FindComponentMatches(
            string scenePath,
            string underPath,
            bool includeInactive,
            string query,
            int limit,
            out List<UnityComponentMatchItem> matches)
        {
            matches = new List<UnityComponentMatchItem>(Math.Min(limit, 128));
            if (!string.IsNullOrEmpty(scenePath))
            {
                var scene = SceneManager.GetSceneByPath(scenePath);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    return false;
                }
                SearchScene(scene, underPath, includeInactive, query, limit, matches);
                return true;
            }

            for (var i = 0; i < SceneManager.sceneCount; i++)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }
                SearchScene(scene, underPath, includeInactive, query, limit, matches);
                if (matches.Count >= limit)
                {
                    break;
                }
            }
            return true;
        }

        private static void SearchScene(
            Scene scene,
            string underPath,
            bool includeInactive,
            string query,
            int limit,
            List<UnityComponentMatchItem> matches)
        {
            var roots = scene.GetRootGameObjects();
            for (var i = 0; i < roots.Length; i++)
            {
                var root = roots[i];
                if (root == null)
                {
                    continue;
                }
                WalkForComponentMatches(root.transform, scene.path, underPath, includeInactive, query, limit, matches);
                if (matches.Count >= limit)
                {
                    break;
                }
            }
        }

        private static void WalkForComponentMatches(
            Transform transform,
            string scenePath,
            string underPath,
            bool includeInactive,
            string query,
            int limit,
            List<UnityComponentMatchItem> matches)
        {
            if (transform == null || matches == null || matches.Count >= limit)
            {
                return;
            }

            var path = BuildObjectPath(transform, "Scene");
            var inScope = string.IsNullOrEmpty(underPath) ||
                          string.Equals(path, underPath, StringComparison.Ordinal) ||
                          path.StartsWith(underPath + "/", StringComparison.Ordinal);
            var maybeContainsScope = string.IsNullOrEmpty(underPath) ||
                                     inScope ||
                                     underPath.StartsWith(path + "/", StringComparison.Ordinal);
            if (!maybeContainsScope)
            {
                return;
            }

            var gameObject = transform.gameObject;
            if (gameObject != null && (includeInactive || gameObject.activeInHierarchy) && inScope)
            {
                var matchedComponents = BuildMatchedComponents(gameObject, query);
                if (matchedComponents.Length > 0)
                {
                    matches.Add(
                        new UnityComponentMatchItem
                        {
                            object_id = BuildObjectId(gameObject),
                            path = path,
                            name = gameObject.name,
                            scene_path = scenePath,
                            active = gameObject.activeInHierarchy,
                            matched_components = matchedComponents
                        });
                }
            }

            for (var i = 0; i < transform.childCount; i++)
            {
                if (matches.Count >= limit)
                {
                    return;
                }
                WalkForComponentMatches(
                    transform.GetChild(i),
                    scenePath,
                    underPath,
                    includeInactive,
                    query,
                    limit,
                    matches);
            }
        }

        private static UnityComponentDescriptor[] BuildMatchedComponents(GameObject gameObject, string query)
        {
            if (gameObject == null || string.IsNullOrWhiteSpace(query))
            {
                return new UnityComponentDescriptor[0];
            }

            var normalizedQuery = query.Trim();
            var components = gameObject.GetComponents<Component>();
            var result = new List<UnityComponentDescriptor>(4);
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    if (ContainsIgnoreCase(MissingScriptShortName, normalizedQuery) ||
                        ContainsIgnoreCase(MissingScriptAssemblyQualifiedName, normalizedQuery))
                    {
                        result.Add(
                            new UnityComponentDescriptor
                            {
                                short_name = MissingScriptShortName,
                                assembly_qualified_name = MissingScriptAssemblyQualifiedName
                            });
                    }
                    continue;
                }

                var type = component.GetType();
                if (type == null)
                {
                    continue;
                }
                var shortName = string.IsNullOrEmpty(type.Name) ? string.Empty : type.Name;
                var fullName = string.IsNullOrEmpty(type.FullName) ? string.Empty : type.FullName;
                var assemblyName = BuildAssemblyQualifiedName(type);
                if (!ContainsIgnoreCase(shortName, normalizedQuery) &&
                    !ContainsIgnoreCase(fullName, normalizedQuery) &&
                    !ContainsIgnoreCase(assemblyName, normalizedQuery))
                {
                    continue;
                }

                result.Add(
                    new UnityComponentDescriptor
                    {
                        short_name = shortName,
                        assembly_qualified_name = assemblyName
                    });
            }

            return result.ToArray();
        }

        private static UnityPrefabTreeNode BuildPrefabTreeNode(
            Transform transform,
            string prefabPath,
            int depth,
            int maxDepth,
            int nodeBudget,
            bool includeComponents,
            bool includeMissingScripts)
        {
            if (transform == null || nodeBudget <= 0)
            {
                return null;
            }

            var root = new UnityPrefabTreeNode
            {
                name = transform.name,
                object_id = BuildObjectId(transform.gameObject),
                path = BuildObjectPath(transform, "Prefab"),
                depth = depth,
                active = transform.gameObject != null && transform.gameObject.activeSelf,
                prefab_path = prefabPath,
                components = includeComponents
                    ? BuildAllComponents(transform, includeMissingScripts)
                    : new UnityComponentDescriptor[0],
                children = new UnityPrefabTreeNode[0],
                children_truncated_count = 0
            };

            if (depth >= maxDepth)
            {
                root.children_truncated_count = transform.childCount;
                return root;
            }

            var children = new List<UnityPrefabTreeNode>();
            var remaining = nodeBudget - 1;
            for (var i = 0; i < transform.childCount; i++)
            {
                if (remaining <= 0)
                {
                    root.children_truncated_count += transform.childCount - i;
                    break;
                }

                var child = BuildPrefabTreeNode(
                    transform.GetChild(i),
                    prefabPath,
                    depth + 1,
                    maxDepth,
                    remaining,
                    includeComponents,
                    includeMissingScripts);
                if (child == null)
                {
                    root.children_truncated_count += transform.childCount - i;
                    break;
                }

                children.Add(child);
                remaining -= CountNodes(child);
            }

            root.children = children.ToArray();
            return root;
        }

        private static UnityComponentDescriptor[] BuildAllComponents(Transform transform, bool includeMissingScripts)
        {
            if (transform == null)
            {
                return new UnityComponentDescriptor[0];
            }

            var components = transform.GetComponents<Component>();
            var result = new List<UnityComponentDescriptor>(components.Length);
            for (var i = 0; i < components.Length; i++)
            {
                var component = components[i];
                if (component == null)
                {
                    if (!includeMissingScripts)
                    {
                        continue;
                    }
                    result.Add(
                        new UnityComponentDescriptor
                        {
                            short_name = MissingScriptShortName,
                            assembly_qualified_name = MissingScriptAssemblyQualifiedName
                        });
                    continue;
                }

                var type = component.GetType();
                if (type == null)
                {
                    continue;
                }
                result.Add(
                    new UnityComponentDescriptor
                    {
                        short_name = string.IsNullOrEmpty(type.Name) ? "-" : type.Name,
                        assembly_qualified_name = BuildAssemblyQualifiedName(type)
                    });
            }
            return result.ToArray();
        }

        private static int CountNodes(UnityPrefabTreeNode node)
        {
            if (node == null)
            {
                return 0;
            }

            var count = 1;
            if (node.children == null)
            {
                return count;
            }
            for (var i = 0; i < node.children.Length; i++)
            {
                count += CountNodes(node.children[i]);
            }
            return count;
        }

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

        private static UnityListAssetsInFolderResponse BuildListAssetsFailure(string requestId, string errorCode, string errorMessage)
        {
            var normalizedCode = NormalizeReadErrorCode(errorCode, "E_QUERY_HANDLER_FAILED");
            var normalizedMessage = NormalizeReadErrorMessage(errorMessage, "list_assets_in_folder failed.");
            return new UnityListAssetsInFolderResponse
            {
                ok = false,
                request_id = requestId,
                captured_at = NowIso(),
                error_code = normalizedCode,
                error_message = normalizedMessage,
                read_token = null,
                data = null
            };
        }

        private static UnityGetSceneRootsResponse BuildGetSceneRootsFailure(string requestId, string errorCode, string errorMessage)
        {
            var normalizedCode = NormalizeReadErrorCode(errorCode, "E_QUERY_HANDLER_FAILED");
            var normalizedMessage = NormalizeReadErrorMessage(errorMessage, "get_scene_roots failed.");
            return new UnityGetSceneRootsResponse
            {
                ok = false,
                request_id = requestId,
                captured_at = NowIso(),
                error_code = normalizedCode,
                error_message = normalizedMessage,
                read_token = null,
                data = null
            };
        }

        private static UnityFindObjectsByComponentResponse BuildFindObjectsFailure(string requestId, string errorCode, string errorMessage)
        {
            var normalizedCode = NormalizeReadErrorCode(errorCode, "E_QUERY_HANDLER_FAILED");
            var normalizedMessage = NormalizeReadErrorMessage(errorMessage, "find_objects_by_component failed.");
            return new UnityFindObjectsByComponentResponse
            {
                ok = false,
                request_id = requestId,
                captured_at = NowIso(),
                error_code = normalizedCode,
                error_message = normalizedMessage,
                read_token = null,
                data = null
            };
        }

        private static UnityQueryPrefabInfoResponse BuildQueryPrefabFailure(string requestId, string errorCode, string errorMessage)
        {
            var normalizedCode = NormalizeReadErrorCode(errorCode, "E_PREFAB_QUERY_FAILED");
            var normalizedMessage = NormalizeReadErrorMessage(errorMessage, "query_prefab_info failed.");
            return new UnityQueryPrefabInfoResponse
            {
                ok = false,
                request_id = requestId,
                captured_at = NowIso(),
                error_code = normalizedCode,
                error_message = normalizedMessage,
                read_token = null,
                data = null
            };
        }

        private static string NormalizeReadErrorCode(string errorCode, string fallback)
        {
            var normalized = string.IsNullOrWhiteSpace(errorCode)
                ? string.Empty
                : errorCode.Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(normalized))
            {
                return fallback;
            }

            if (string.Equals(normalized, "TARGET_NOT_FOUND", StringComparison.Ordinal) ||
                string.Equals(normalized, "E_ACTION_TARGET_NOT_FOUND", StringComparison.Ordinal))
            {
                return "E_TARGET_NOT_FOUND";
            }

            if (string.Equals(normalized, "UNITY_QUERY_FAILED", StringComparison.Ordinal))
            {
                return "E_QUERY_HANDLER_FAILED";
            }

            return normalized;
        }

        private static string NormalizeReadErrorMessage(string errorMessage, string fallback)
        {
            var value = string.IsNullOrWhiteSpace(errorMessage)
                ? string.Empty
                : errorMessage.Trim();
            if (string.IsNullOrEmpty(value))
            {
                return fallback;
            }

            var firstLine = value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var singleLine = firstLine.Length > 0 ? firstLine[0].Trim() : value;
            if (singleLine.Length <= MaxReadErrorMessageLength)
            {
                return singleLine;
            }

            return singleLine.Substring(0, MaxReadErrorMessageLength).TrimEnd();
        }
    }
}

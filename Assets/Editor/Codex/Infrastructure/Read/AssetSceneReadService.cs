using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        public UnityListAssetsInFolderResponse ListAssetsInFolder(UnityListAssetsInFolderRequest request)
        {
            return AssetSceneReadService.ExecuteListAssets(this, request);
        }

        public UnityGetSceneRootsResponse GetSceneRoots(UnityGetSceneRootsRequest request)
        {
            return AssetSceneReadService.ExecuteGetSceneRoots(this, request);
        }

        public UnityFindObjectsByComponentResponse FindObjectsByComponent(UnityFindObjectsByComponentRequest request)
        {
            return AssetSceneReadService.ExecuteFindObjects(this, request);
        }

        public UnityQueryPrefabInfoResponse QueryPrefabInfo(UnityQueryPrefabInfoRequest request)
        {
            return AssetSceneReadService.ExecuteQueryPrefab(this, request);
        }

        private static class AssetSceneReadService
        {
            internal static UnityListAssetsInFolderResponse ExecuteListAssets(
                UnityRagReadService owner,
                UnityListAssetsInFolderRequest request)
            {
                if (owner == null)
                {
                    return BuildListAssetsFailure(
                        string.Empty,
                        "E_INTERNAL_NULL",
                        "UnityRagReadService instance is null.");
                }

                return owner.ListAssetsInFolderCore(request);
            }

            internal static UnityGetSceneRootsResponse ExecuteGetSceneRoots(
                UnityRagReadService owner,
                UnityGetSceneRootsRequest request)
            {
                if (owner == null)
                {
                    return BuildGetSceneRootsFailure(
                        string.Empty,
                        "E_INTERNAL_NULL",
                        "UnityRagReadService instance is null.");
                }

                return owner.GetSceneRootsCore(request);
            }

            internal static UnityFindObjectsByComponentResponse ExecuteFindObjects(
                UnityRagReadService owner,
                UnityFindObjectsByComponentRequest request)
            {
                if (owner == null)
                {
                    return BuildFindObjectsFailure(
                        string.Empty,
                        "E_INTERNAL_NULL",
                        "UnityRagReadService instance is null.");
                }

                return owner.FindObjectsByComponentCore(request);
            }

            internal static UnityQueryPrefabInfoResponse ExecuteQueryPrefab(
                UnityRagReadService owner,
                UnityQueryPrefabInfoRequest request)
            {
                if (owner == null)
                {
                    return BuildQueryPrefabFailure(
                        string.Empty,
                        "E_INTERNAL_NULL",
                        "UnityRagReadService instance is null.");
                }

                return owner.QueryPrefabInfoCore(request);
            }
        }

        private UnityListAssetsInFolderResponse ListAssetsInFolderCore(UnityListAssetsInFolderRequest request)
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

        private UnityGetSceneRootsResponse GetSceneRootsCore(UnityGetSceneRootsRequest request)
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

        private UnityFindObjectsByComponentResponse FindObjectsByComponentCore(UnityFindObjectsByComponentRequest request)
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

        private UnityQueryPrefabInfoResponse QueryPrefabInfoCore(UnityQueryPrefabInfoRequest request)
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


    }
}
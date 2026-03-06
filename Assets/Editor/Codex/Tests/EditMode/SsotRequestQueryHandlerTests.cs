using System;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Queries;
using UnityAI.Editor.Codex.Infrastructure.Queries.Handlers;
using UnityAI.Editor.Codex.Infrastructure.Ssot;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class SsotRequestQueryHandlerTests
    {
        [Test]
        public void Dispatcher_ReturnsUnsupportedTool_WhenToolIsUnknown()
        {
            var dispatcher = new SsotRequestDispatcher();
            var response = dispatcher.Dispatch("unknown_ssot_tool", "{}");

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_SSOT_TOOL_UNSUPPORTED", response.error_code);
        }

        [Test]
        public void Handler_ModifyUiLayout_UpdatesRectTransform()
        {
            var rootName = "SsotRoot_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var childName = "SsotNode_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject root = null;

            try
            {
                root = new GameObject(rootName, typeof(RectTransform));
                var child = new GameObject(childName, typeof(RectTransform));
                child.transform.SetParent(root.transform, false);

                var childRect = child.GetComponent<RectTransform>();
                Assert.NotNull(childRect);
                childRect.anchoredPosition = Vector2.zero;
                childRect.sizeDelta = new Vector2(20f, 20f);

                var targetPath = "Scene/" + rootName + "/" + childName;
                var targetObjectId = GlobalObjectId.GetGlobalObjectIdSlow(child).ToString();
                var request = new ModifyUiLayoutRequestDto
                {
                    execution_mode = "execute",
                    thread_id = "t_ssot_test",
                    idempotency_key = "idem_ssot_test",
                    based_on_read_token = "token_ssot_test",
                    write_anchor_object_id = targetObjectId,
                    write_anchor_path = targetPath,
                    target_object_id = targetObjectId,
                    target_path = targetPath,
                    anchored_x = 120d,
                    anchored_y = 240d,
                    width = 220d,
                    height = 88d
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = ModifyUiLayoutRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_modify_ui_layout_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                Assert.NotNull(result.Payload);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.IsTrue(string.IsNullOrEmpty(payload.error_code));

                var resultData = payload.data;
                Assert.NotNull(resultData);
                Assert.AreEqual(120f, childRect.anchoredPosition.x, 0.001f);
                Assert.AreEqual(240f, childRect.anchoredPosition.y, 0.001f);
                Assert.AreEqual(220f, childRect.rect.width, 0.001f);
                Assert.AreEqual(88f, childRect.rect.height, 0.001f);
            }
            finally
            {
                if (root != null)
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
        }

        [Test]
        public void Handler_ReturnsSchemaError_WhenEnvelopeToolNameMissing()
        {
            var pulledQuery = new UnityPulledQuery
            {
                query_type = UnityQueryTypes.SsotRequest,
                query_payload_json = "{\"tool_name\":\"\",\"payload_json\":\"{}\"}"
            };
            var handler = new SsotRequestQueryHandler();

            var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                .GetAwaiter()
                .GetResult();

            Assert.NotNull(result);
            var payload = result.Payload as SsotDispatchResponse;
            Assert.NotNull(payload);
            Assert.IsFalse(payload.ok);
            Assert.AreEqual("E_SSOT_SCHEMA_INVALID", payload.error_code);
        }

        [Test]
        public void Handler_SetComponentProperties_UpdatesTransformLocalPositionX()
        {
            var rootName = "SsotCompRoot_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var childName = "SsotCompNode_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject root = null;

            try
            {
                root = new GameObject(rootName);
                var child = new GameObject(childName);
                child.transform.SetParent(root.transform, false);
                child.transform.localPosition = Vector3.zero;

                var targetPath = "Scene/" + rootName + "/" + childName;
                var targetObjectId = GlobalObjectId.GetGlobalObjectIdSlow(child).ToString();
                var request = new SetComponentPropertiesRequestDto
                {
                    execution_mode = "execute",
                    thread_id = "t_ssot_test",
                    idempotency_key = "idem_ssot_component_test",
                    based_on_read_token = "token_ssot_component_test",
                    write_anchor_object_id = targetObjectId,
                    write_anchor_path = targetPath,
                    target_object_id = targetObjectId,
                    target_path = targetPath,
                    component_type = typeof(Transform).AssemblyQualifiedName,
                    property_path = "m_LocalPosition.x",
                    value_kind = "number",
                    value_number = 42d
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = SetComponentPropertiesRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_set_component_properties_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.AreEqual(42f, child.transform.localPosition.x, 0.001f);
                Assert.NotNull(payload.data);
                Assert.AreEqual("set_component_properties", payload.tool_name);
                Assert.AreEqual("number", payload.data.value_kind);
                Assert.AreEqual(42d, payload.data.value_number, 0.001d);
            }
            finally
            {
                if (root != null)
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
        }

        [Test]
        public void Handler_GetSceneSnapshotForWrite_ReturnsScopedNodeSummary()
        {
            var rootName = "SsotSnapRoot_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject root = null;

            try
            {
                root = new GameObject(rootName);
                var request = new GetSceneSnapshotForWriteRequestDto
                {
                    thread_id = "t_ssot_snapshot_test",
                    scope_path = "Scene/" + rootName
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = GetSceneSnapshotForWriteRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_get_scene_snapshot_for_write_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.NotNull(payload.data);
                Assert.AreEqual("get_scene_snapshot_for_write", payload.tool_name);
                Assert.IsTrue(string.IsNullOrEmpty(payload.data.read_token_candidate));
                Assert.IsFalse(string.IsNullOrEmpty(payload.data.scene_revision));
                Assert.NotNull(payload.data.scene_roots);
                Assert.AreEqual(1, payload.data.scene_roots.Length);
                Assert.AreEqual("Scene/" + rootName, payload.data.scene_roots[0].path);
            }
            finally
            {
                if (root != null)
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
        }

        [Test]
        public void Handler_GetCurrentSelection_ReturnsActiveSelection()
        {
            var nodeName = "SsotSelNode_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject node = null;
            var previousSelection = Selection.activeGameObject;

            try
            {
                node = new GameObject(nodeName);
                Selection.activeGameObject = node;
                var request = new GetCurrentSelectionRequestDto
                {
                    thread_id = "t_ssot_selection_test"
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = GetCurrentSelectionRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_get_current_selection_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.NotNull(payload.data);
                Assert.AreEqual("get_current_selection", payload.tool_name);
                Assert.AreEqual("Scene/" + nodeName, payload.data.target_path);
                Assert.IsTrue(string.IsNullOrEmpty(payload.data.read_token_candidate));
                Assert.IsFalse(string.IsNullOrEmpty(payload.data.scene_revision));
            }
            finally
            {
                Selection.activeGameObject = previousSelection;
                if (node != null)
                {
                    UnityEngine.Object.DestroyImmediate(node);
                }
            }
        }

        [Test]
        public void Handler_GetGameobjectComponents_ReturnsExplicitTargetComponents()
        {
            var rootName = "SsotCompReadRoot_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var childName = "SsotCompReadNode_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject root = null;

            try
            {
                root = new GameObject(rootName);
                var child = new GameObject(childName);
                child.transform.SetParent(root.transform, false);
                var targetPath = "Scene/" + rootName + "/" + childName;
                var targetObjectId = GlobalObjectId.GetGlobalObjectIdSlow(child).ToString();
                var request = new GetGameobjectComponentsRequestDto
                {
                    thread_id = "t_ssot_components_test",
                    target_object_id = targetObjectId,
                    target_path = targetPath
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = GetGameobjectComponentsRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_get_gameobject_components_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.NotNull(payload.data);
                Assert.AreEqual("get_gameobject_components", payload.tool_name);
                Assert.AreEqual(targetPath, payload.data.target_path);
                Assert.GreaterOrEqual(payload.data.component_count, 1);
                Assert.NotNull(payload.data.components);
                Assert.GreaterOrEqual(payload.data.components.Length, 1);
            }
            finally
            {
                if (root != null)
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
        }

        [Test]
        public void Handler_GetHierarchySubtree_ReturnsRootAndChildren()
        {
            var rootName = "SsotTreeRoot_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var childName = "SsotTreeChild_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject root = null;

            try
            {
                root = new GameObject(rootName);
                var child = new GameObject(childName);
                child.transform.SetParent(root.transform, false);
                new GameObject("SsotTreeLeaf").transform.SetParent(child.transform, false);

                var targetPath = "Scene/" + rootName;
                var targetObjectId = GlobalObjectId.GetGlobalObjectIdSlow(root).ToString();
                var request = new GetHierarchySubtreeRequestDto
                {
                    thread_id = "t_ssot_tree_test",
                    target_object_id = targetObjectId,
                    target_path = targetPath,
                    depth = 2,
                    node_budget = 20,
                    char_budget = 12000
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = GetHierarchySubtreeRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_get_hierarchy_subtree_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.NotNull(payload.data);
                Assert.AreEqual("get_hierarchy_subtree", payload.tool_name);
                Assert.AreEqual(targetPath, payload.data.target_path);
                Assert.NotNull(payload.data.root);
                Assert.NotNull(payload.data.root.children);
                Assert.GreaterOrEqual(payload.data.returned_node_count, 2);
            }
            finally
            {
                if (root != null)
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
        }

        [Test]
        public void Handler_GetSceneRoots_ReturnsRootAnchors()
        {
            var rootName = "SsotSceneRoots_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject root = null;

            try
            {
                root = new GameObject(rootName);
                var request = new GetSceneRootsRequestDto
                {
                    thread_id = "t_ssot_scene_roots_test",
                    include_inactive = true
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = GetSceneRootsRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_get_scene_roots_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.NotNull(payload.data);
                Assert.AreEqual("get_scene_roots", payload.tool_name);
                Assert.NotNull(payload.data.scene_roots);
                Assert.GreaterOrEqual(payload.data.scene_roots.Length, 1);
            }
            finally
            {
                if (root != null)
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
        }

        [Test]
        public void Handler_ListAssetsInFolder_ReturnsAssetEntries()
        {
            var request = new ListAssetsInFolderRequestDto
            {
                thread_id = "t_ssot_list_assets_test",
                folder_path = "Assets",
                recursive = false,
                include_meta = false,
                limit = 20
            };
            var envelope = new SsotToolEnvelopeDto
            {
                tool_name = ListAssetsInFolderRequestDto.ToolName,
                payload_json = JsonUtility.ToJson(request)
            };
            var pulledQuery = new UnityPulledQuery
            {
                query_type = UnityQueryTypes.SsotRequest,
                request_id = "req_ssot_list_assets_test",
                query_payload_json = JsonUtility.ToJson(envelope)
            };

            var handler = new SsotRequestQueryHandler();
            var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                .GetAwaiter()
                .GetResult();

            Assert.NotNull(result);
            var payload = result.Payload as SsotDispatchResponse;
            Assert.NotNull(payload);
            Assert.IsTrue(payload.ok);
            Assert.NotNull(payload.data);
            Assert.AreEqual("list_assets_in_folder", payload.tool_name);
            Assert.NotNull(payload.data.assets);
            Assert.GreaterOrEqual(payload.data.total_count, 0);
        }

        [Test]
        public void Handler_FindObjectsByComponent_ReturnsMatchedAnchors()
        {
            var rootName = "SsotFindCompRoot_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var childName = "SsotFindCompNode_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject root = null;

            try
            {
                root = new GameObject(rootName, typeof(RectTransform));
                var child = new GameObject(childName, typeof(RectTransform));
                child.transform.SetParent(root.transform, false);

                var request = new FindObjectsByComponentRequestDto
                {
                    thread_id = "t_ssot_find_component_test",
                    component_query = "RectTransform",
                    under_path = "Scene/" + rootName,
                    include_inactive = true,
                    limit = 20
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = FindObjectsByComponentRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_find_objects_by_component_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.NotNull(payload.data);
                Assert.AreEqual("find_objects_by_component", payload.tool_name);
                Assert.NotNull(payload.data.found_objects);
                Assert.GreaterOrEqual(payload.data.total_count, 1);
            }
            finally
            {
                if (root != null)
                {
                    UnityEngine.Object.DestroyImmediate(root);
                }
            }
        }

        [Test]
        public void Handler_QueryPrefabInfo_ReturnsStructuredFailureForMissingPrefab()
        {
            var request = new QueryPrefabInfoRequestDto
            {
                thread_id = "t_ssot_query_prefab_test",
                prefab_path = "Assets/Prefabs/DefinitelyMissing.prefab",
                max_depth = 3,
                node_budget = 200,
                char_budget = 12000,
                include_components = true,
                include_missing_scripts = true
            };
            var envelope = new SsotToolEnvelopeDto
            {
                tool_name = QueryPrefabInfoRequestDto.ToolName,
                payload_json = JsonUtility.ToJson(request)
            };
            var pulledQuery = new UnityPulledQuery
            {
                query_type = UnityQueryTypes.SsotRequest,
                request_id = "req_ssot_query_prefab_info_test",
                query_payload_json = JsonUtility.ToJson(envelope)
            };

            var handler = new SsotRequestQueryHandler();
            var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                .GetAwaiter()
                .GetResult();

            Assert.NotNull(result);
            var payload = result.Payload as SsotDispatchResponse;
            Assert.NotNull(payload);
            Assert.AreEqual("query_prefab_info", payload.tool_name);
            Assert.IsFalse(payload.ok);
            Assert.IsFalse(string.IsNullOrEmpty(payload.error_code));
        }

        [Test]
        public void Handler_GetUiTree_ReturnsUiRootsForCanvas()
        {
            var canvasName = "SsotUiTreeCanvas_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var nodeName = "SsotUiTreeNode_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject canvas = null;

            try
            {
                canvas = new GameObject(canvasName, typeof(RectTransform), typeof(Canvas));
                var child = new GameObject(nodeName, typeof(RectTransform));
                child.transform.SetParent(canvas.transform, false);

                var request = new GetUiTreeRequestDto
                {
                    thread_id = "t_ssot_ui_tree_test",
                    ui_system = "ugui",
                    root_path = "Scene/" + canvasName,
                    include_inactive = true,
                    include_components = true,
                    include_layout = true,
                    include_interaction = true,
                    include_text_metrics = false,
                    max_depth = 3,
                    node_budget = 300,
                    char_budget = 20000
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = GetUiTreeRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_get_ui_tree_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.NotNull(payload.data);
                Assert.AreEqual("get_ui_tree", payload.tool_name);
                Assert.NotNull(payload.data.ui_roots);
                Assert.GreaterOrEqual(payload.data.ui_roots.Length, 1);
            }
            finally
            {
                if (canvas != null)
                {
                    UnityEngine.Object.DestroyImmediate(canvas);
                }
            }
        }

        [Test]
        public void Handler_GetUiOverlayReport_ReturnsOverlayCanvasSummary()
        {
            var canvasName = "SsotOverlayCanvas_" + Guid.NewGuid().ToString("N").Substring(0, 8);
            GameObject canvas = null;

            try
            {
                canvas = new GameObject(canvasName, typeof(RectTransform), typeof(Canvas));
                var canvasComponent = canvas.GetComponent<Canvas>();
                Assert.NotNull(canvasComponent);
                canvasComponent.renderMode = RenderMode.ScreenSpaceOverlay;

                var request = new GetUiOverlayReportRequestDto
                {
                    thread_id = "t_ssot_overlay_test",
                    root_path = "Scene/" + canvasName,
                    include_inactive = true,
                    include_children_summary = true,
                    max_nodes = 200,
                    max_children_per_canvas = 20,
                    timeout_ms = 3000
                };
                var envelope = new SsotToolEnvelopeDto
                {
                    tool_name = GetUiOverlayReportRequestDto.ToolName,
                    payload_json = JsonUtility.ToJson(request)
                };
                var pulledQuery = new UnityPulledQuery
                {
                    query_type = UnityQueryTypes.SsotRequest,
                    request_id = "req_ssot_get_ui_overlay_report_test",
                    query_payload_json = JsonUtility.ToJson(envelope)
                };

                var handler = new SsotRequestQueryHandler();
                var result = handler.ExecuteAsync(pulledQuery, BuildExecutionContext())
                    .GetAwaiter()
                    .GetResult();

                Assert.NotNull(result);
                var payload = result.Payload as SsotDispatchResponse;
                Assert.NotNull(payload);
                Assert.IsTrue(payload.ok);
                Assert.NotNull(payload.data);
                Assert.AreEqual("get_ui_overlay_report", payload.tool_name);
                Assert.GreaterOrEqual(payload.data.returned_canvas_count, 1);
                Assert.NotNull(payload.data.overlay_canvases);
                Assert.GreaterOrEqual(payload.data.overlay_canvases.Length, 1);
            }
            finally
            {
                if (canvas != null)
                {
                    UnityEngine.Object.DestroyImmediate(canvas);
                }
            }
        }

        private static UnityQueryExecutionContext BuildExecutionContext()
        {
            return new UnityQueryExecutionContext(
                new UnityRagReadService(),
                action => Task.FromResult(action == null ? null : action()));
        }
    }
}

using System;
using System.Collections.Generic;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class SerializedPropertyTreeReadServiceTests
    {
        private const string NamePrefix = "__R16_SP_TREE__";
        private UnityRagReadService _service;
        private readonly List<GameObject> _createdObjects = new List<GameObject>();

        [SetUp]
        public void SetUp()
        {
            _service = new UnityRagReadService();
        }

        [TearDown]
        public void TearDown()
        {
            for (var i = 0; i < _createdObjects.Count; i++)
            {
                var go = _createdObjects[i];
                if (go == null)
                {
                    continue;
                }

                UnityEngine.Object.DestroyImmediate(go);
            }

            _createdObjects.Clear();
        }

        [Test]
        public void GetSerializedPropertyTree_ReturnsReadOnlyScriptField_AndWritableUserField()
        {
            var target = CreateTestObject("Target_ReadOnly");
            target.AddComponent<SerializedPropertyTreeFixtureComponent>();
            var payload = BuildPayload(target);
            payload.page_size = 64;
            payload.node_budget = 128;
            payload.char_budget = 12000;
            payload.include_value_summary = true;

            var response = _service.GetSerializedPropertyTree(
                new UnityGetSerializedPropertyTreeRequest
                {
                    request_id = "req_sp_tree_readonly",
                    payload = payload,
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok, response == null ? string.Empty : response.error_message);
            Assert.NotNull(response.data);
            Assert.NotNull(response.data.nodes);
            Assert.Greater(response.data.nodes.Length, 0);

            var scriptNode = FindNode(response.data.nodes, "m_Script");
            Assert.NotNull(scriptNode, "m_Script should be present for MonoBehaviour.");
            Assert.IsFalse(scriptNode.writable);
            Assert.AreEqual("script_reference_read_only", scriptNode.read_only_reason);
            Assert.IsTrue(scriptNode.llm_hint.Contains("Read-only"));

            var intNode = FindNode(response.data.nodes, "intValue");
            Assert.NotNull(intNode);
            Assert.IsTrue(intNode.writable);
            Assert.AreEqual("42", intNode.value_summary);
            Assert.AreEqual("Use value_kind=integer with int_value.", intNode.llm_hint);
        }

        [Test]
        public void GetSerializedPropertyTree_PageSizePagination_UsesCursorAndSkipsReturnedNode()
        {
            var target = CreateTestObject("Target_Page");
            target.AddComponent<SerializedPropertyTreeFixtureComponent>();

            var firstPagePayload = BuildPayload(target);
            firstPagePayload.page_size = 1;
            firstPagePayload.node_budget = 64;
            firstPagePayload.char_budget = 12000;

            var first = _service.GetSerializedPropertyTree(
                new UnityGetSerializedPropertyTreeRequest
                {
                    request_id = "req_sp_tree_page_1",
                    payload = firstPagePayload,
                });

            Assert.NotNull(first);
            Assert.IsTrue(first.ok, first == null ? string.Empty : first.error_message);
            Assert.NotNull(first.data);
            Assert.NotNull(first.data.nodes);
            Assert.AreEqual(1, first.data.nodes.Length);
            Assert.IsTrue(first.data.truncated);
            Assert.AreEqual("PAGE_SIZE_EXCEEDED", first.data.truncated_reason);
            Assert.IsFalse(string.IsNullOrEmpty(first.data.next_cursor));

            var firstPath = first.data.nodes[0].property_path;
            Assert.AreEqual(firstPath, first.data.next_cursor);

            var secondPagePayload = BuildPayload(target);
            secondPagePayload.page_size = 1;
            secondPagePayload.node_budget = 64;
            secondPagePayload.char_budget = 12000;
            secondPagePayload.after_property_path = first.data.next_cursor;

            var second = _service.GetSerializedPropertyTree(
                new UnityGetSerializedPropertyTreeRequest
                {
                    request_id = "req_sp_tree_page_2",
                    payload = secondPagePayload,
                });

            Assert.NotNull(second);
            Assert.IsTrue(second.ok, second == null ? string.Empty : second.error_message);
            Assert.NotNull(second.data);
            Assert.NotNull(second.data.nodes);
            Assert.AreEqual(1, second.data.nodes.Length);
            Assert.AreNotEqual(firstPath, second.data.nodes[0].property_path);
        }

        [Test]
        public void GetSerializedPropertyTree_NodeBudgetExceeded_ReturnsTruncatedWithCursor()
        {
            var target = CreateTestObject("Target_NodeBudget");
            target.AddComponent<SerializedPropertyTreeFixtureComponent>();
            var payload = BuildPayload(target);
            payload.page_size = 64;
            payload.node_budget = 1;
            payload.char_budget = 12000;

            var response = _service.GetSerializedPropertyTree(
                new UnityGetSerializedPropertyTreeRequest
                {
                    request_id = "req_sp_tree_node_budget",
                    payload = payload,
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok, response == null ? string.Empty : response.error_message);
            Assert.NotNull(response.data);
            Assert.NotNull(response.data.nodes);
            Assert.AreEqual(1, response.data.nodes.Length);
            Assert.IsTrue(response.data.truncated);
            Assert.AreEqual("NODE_BUDGET_EXCEEDED", response.data.truncated_reason);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.next_cursor));
            Assert.AreEqual(response.data.nodes[0].property_path, response.data.next_cursor);
        }

        [Test]
        public void GetSerializedPropertyTree_CharBudgetExceeded_ReturnsTruncatedWithCursor()
        {
            var target = CreateTestObject("Target_CharBudget");
            target.AddComponent<SerializedPropertyTreeFixtureComponent>();
            var payload = BuildPayload(target);
            payload.page_size = 64;
            payload.node_budget = 128;
            payload.char_budget = 256;
            payload.include_value_summary = true;

            var response = _service.GetSerializedPropertyTree(
                new UnityGetSerializedPropertyTreeRequest
                {
                    request_id = "req_sp_tree_char_budget",
                    payload = payload,
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok, response == null ? string.Empty : response.error_message);
            Assert.NotNull(response.data);
            Assert.NotNull(response.data.nodes);
            Assert.Greater(response.data.nodes.Length, 0);
            Assert.IsTrue(response.data.truncated);
            Assert.AreEqual("CHAR_BUDGET_EXCEEDED", response.data.truncated_reason);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.next_cursor));
        }

        [Test]
        public void GetSerializedPropertyTree_AfterPropertyPathMissing_ReturnsCursorNotFoundError()
        {
            var target = CreateTestObject("Target_CursorNotFound");
            target.AddComponent<SerializedPropertyTreeFixtureComponent>();
            var payload = BuildPayload(target);
            payload.after_property_path = "__missing_cursor__";

            var response = _service.GetSerializedPropertyTree(
                new UnityGetSerializedPropertyTreeRequest
                {
                    request_id = "req_sp_tree_cursor_missing",
                    payload = payload,
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_CURSOR_NOT_FOUND", response.error_code);
        }

        [Test]
        public void GetSerializedPropertyTree_ComponentSelectors_ReturnsGroupedComponentResults()
        {
            var target = CreateTestObject("Target_Multi");
            target.AddComponent<SerializedPropertyTreeFixtureComponent>();
            target.AddComponent<SerializedPropertyTreeSecondaryFixtureComponent>();

            var payload = BuildPayload(target);
            payload.component_selector = null;
            payload.component_selectors = new[]
            {
                new SerializedPropertyComponentSelector
                {
                    component_assembly_qualified_name =
                        typeof(SerializedPropertyTreeFixtureComponent).AssemblyQualifiedName,
                    component_index = 0,
                },
                new SerializedPropertyComponentSelector
                {
                    component_assembly_qualified_name =
                        typeof(SerializedPropertyTreeSecondaryFixtureComponent).AssemblyQualifiedName,
                    component_index = 0,
                },
            };
            payload.page_size = 8;
            payload.node_budget = 16;
            payload.char_budget = 6000;

            var response = _service.GetSerializedPropertyTree(
                new UnityGetSerializedPropertyTreeRequest
                {
                    request_id = "req_sp_tree_multi",
                    payload = payload,
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok, response == null ? string.Empty : response.error_message);
            Assert.NotNull(response.data);
            Assert.NotNull(response.data.components);
            Assert.AreEqual(2, response.data.components.Length);
            Assert.Greater(response.data.components[0].returned_count, 0);
            Assert.Greater(response.data.components[1].returned_count, 0);
            Assert.IsNotEmpty(response.data.components[0].nodes[0].llm_hint);
            Assert.AreEqual(response.data.components[0].component.type, response.data.component.type);
        }

        private GameObject CreateTestObject(string suffix)
        {
            var safeSuffix = string.IsNullOrEmpty(suffix) ? "Target" : suffix;
            var go = new GameObject(NamePrefix + safeSuffix);
            _createdObjects.Add(go);
            return go;
        }

        private static UnityGetSerializedPropertyTreePayload BuildPayload(GameObject target)
        {
            return new UnityGetSerializedPropertyTreePayload
            {
                target_anchor = BuildAnchor(target),
                component_selector = new SerializedPropertyComponentSelector
                {
                    component_assembly_qualified_name =
                        typeof(SerializedPropertyTreeFixtureComponent).AssemblyQualifiedName,
                    component_index = 0,
                },
                root_property_path = string.Empty,
                depth = 2,
                page_size = 64,
                node_budget = 128,
                char_budget = 12000,
                include_value_summary = true,
                include_non_visible = false,
            };
        }

        private static UnityObjectAnchor BuildAnchor(GameObject target)
        {
            return new UnityObjectAnchor
            {
                object_id = BuildObjectId(target),
                path = "Scene/" + target.name,
            };
        }

        private static string BuildObjectId(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            return GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();
        }

        private static UnitySerializedPropertyTreeNode FindNode(
            UnitySerializedPropertyTreeNode[] nodes,
            string propertyPath)
        {
            if (nodes == null || string.IsNullOrEmpty(propertyPath))
            {
                return null;
            }

            for (var i = 0; i < nodes.Length; i++)
            {
                var node = nodes[i];
                if (node == null)
                {
                    continue;
                }

                if (string.Equals(node.property_path, propertyPath, StringComparison.Ordinal))
                {
                    return node;
                }
            }

            return null;
        }

        private sealed class SerializedPropertyTreeFixtureComponent : MonoBehaviour
        {
            public int intValue = 42;
            public float floatValue = 3.5f;
            public string shortText = "seed";
            public string longText =
                "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
            public Vector3 vectorValue = new Vector3(1f, 2f, 3f);
            public int[] intArray = new[] { 1, 2, 3, 4, 5 };
            [SerializeField] private string hiddenValue = "hidden";
        }

        private sealed class SerializedPropertyTreeSecondaryFixtureComponent : MonoBehaviour
        {
            public bool enabledFlag = true;
            public Color tint = new Color(0.2f, 0.4f, 0.6f, 1f);
        }
    }
}

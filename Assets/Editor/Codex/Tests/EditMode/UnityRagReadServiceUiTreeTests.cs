using System;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityRagReadServiceUiTreeTests
    {
        private const string NamePrefix = "__R11_UI_TREE__";
        private UnityRagReadService _service;

        [SetUp]
        public void SetUp()
        {
            _service = new UnityRagReadService();
        }

        [TearDown]
        public void TearDown()
        {
            var allObjects = UnityEngine.Object.FindObjectsOfType<GameObject>();
            for (var i = 0; i < allObjects.Length; i++)
            {
                var go = allObjects[i];
                if (go == null)
                {
                    continue;
                }

                if (!go.name.StartsWith(NamePrefix, StringComparison.Ordinal))
                {
                    continue;
                }

                UnityEngine.Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void GetUiTree_ReturnsCanvasNodes_WithEnhancedUiFields()
        {
            var canvasGo = new GameObject(NamePrefix + "CanvasRoot");
            canvasGo.AddComponent<Canvas>();
            var imageGo = new GameObject(NamePrefix + "ImageNode", typeof(RectTransform));
            imageGo.transform.SetParent(canvasGo.transform, false);
            imageGo.AddComponent<Image>();
            var textGo = new GameObject(NamePrefix + "TextNode", typeof(RectTransform));
            textGo.transform.SetParent(canvasGo.transform, false);
            textGo.AddComponent<Text>().text = "Codex UI Tree";

            var response = _service.GetUiTree(
                new UnityGetUiTreeRequest
                {
                    request_id = "req_ui_tree_ok",
                    payload = new UnityGetUiTreePayload
                    {
                        ui_system = "ugui",
                        root_path = "Scene/" + canvasGo.name,
                        include_inactive = true,
                        include_components = true,
                        include_layout = true,
                        include_interaction = true,
                        include_text_metrics = true,
                        max_depth = 4,
                        node_budget = 128,
                        char_budget = 12000,
                        resolution = new UnityQueryResolution
                        {
                            width = 1920,
                            height = 1080
                        },
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.NotNull(response.data.canvases);
            Assert.Greater(response.data.canvases.Length, 0);
            Assert.NotNull(response.data.roots);
            Assert.Greater(response.data.roots.Length, 0);
            Assert.AreEqual("ugui", response.data.ui_system);
            Assert.IsTrue(response.data.include_interaction);
            Assert.IsTrue(response.data.include_text_metrics);
            Assert.NotNull(response.data.runtime_resolution);
            Assert.Greater(response.data.runtime_resolution.width, 0);
            Assert.Greater(response.data.runtime_resolution.height, 0);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.runtime_source));
            Assert.NotNull(response.read_token);
            Assert.IsFalse(string.IsNullOrEmpty(response.read_token.token));

            var root = response.data.roots[0];
            Assert.NotNull(root);
            Assert.IsFalse(string.IsNullOrEmpty(root.path));
            Assert.NotNull(root.anchor);
            Assert.NotNull(root.rect_transform);
            Assert.NotNull(root.rect_screen_px);
            Assert.NotNull(root.components);
            Assert.NotNull(root.components_summary);
            Assert.AreEqual(root.components.Length, root.components_summary.Length);

            var flat = FlattenNodes(response.data.roots);
            Assert.IsTrue(flat.Exists((n) => n != null && n.interaction != null));
            Assert.IsTrue(flat.Exists((n) => n != null && n.text_metrics != null));
        }

        [Test]
        public void GetUiTree_ReturnsSourceNotFound_WhenRootPathMissing()
        {
            var response = _service.GetUiTree(
                new UnityGetUiTreeRequest
                {
                    request_id = "req_ui_tree_missing",
                    payload = new UnityGetUiTreePayload
                    {
                        ui_system = "ugui",
                        root_path = "Scene/This/Path/DoesNotExist",
                        include_inactive = true,
                        include_components = false,
                        include_layout = false,
                    },
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_UI_TREE_SOURCE_NOT_FOUND", response.error_code);
        }

        [Test]
        public void GetUiTree_ReturnsSourceNotFound_ForUnsupportedUitkInCurrentPhase()
        {
            var response = _service.GetUiTree(
                new UnityGetUiTreeRequest
                {
                    request_id = "req_ui_tree_uitk",
                    payload = new UnityGetUiTreePayload
                    {
                        ui_system = "uitk",
                    },
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_UI_TREE_SOURCE_NOT_FOUND", response.error_code);
        }

        private static System.Collections.Generic.List<UnityUiTreeNode> FlattenNodes(UnityUiTreeNode[] roots)
        {
            var result = new System.Collections.Generic.List<UnityUiTreeNode>();
            if (roots == null || roots.Length == 0)
            {
                return result;
            }

            var stack = new System.Collections.Generic.Stack<UnityUiTreeNode>();
            for (var i = 0; i < roots.Length; i++)
            {
                if (roots[i] != null)
                {
                    stack.Push(roots[i]);
                }
            }

            while (stack.Count > 0)
            {
                var current = stack.Pop();
                if (current == null)
                {
                    continue;
                }

                result.Add(current);
                if (current.children == null)
                {
                    continue;
                }

                for (var i = current.children.Length - 1; i >= 0; i--)
                {
                    if (current.children[i] != null)
                    {
                        stack.Push(current.children[i]);
                    }
                }
            }

            return result;
        }
    }
}

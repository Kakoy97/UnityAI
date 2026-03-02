using System;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityVisualReadChainTests
    {
        private const string NamePrefix = "__R11_CHAIN__";
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
        public void GetUiTree_ThenCaptureScreenshot_Succeeds_WithStablePayloadShape()
        {
            var cameraGo = new GameObject(NamePrefix + "MainCamera");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var canvasGo = new GameObject(NamePrefix + "Canvas", typeof(RectTransform), typeof(Canvas));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var panelGo = new GameObject(NamePrefix + "Panel", typeof(RectTransform));
            panelGo.transform.SetParent(canvasGo.transform, false);

            var treeResponse = _service.GetUiTree(
                new UnityGetUiTreeRequest
                {
                    request_id = "req_chain_tree_001",
                    payload = new UnityGetUiTreePayload
                    {
                        ui_system = "ugui",
                        include_inactive = true,
                        include_components = true,
                        include_layout = true,
                        max_depth = 4,
                        node_budget = 128,
                        char_budget = 12000,
                    },
                });

            Assert.NotNull(treeResponse);
            Assert.IsTrue(treeResponse.ok);
            Assert.NotNull(treeResponse.data);
            Assert.NotNull(treeResponse.data.roots);
            Assert.Greater(treeResponse.data.roots.Length, 0);
            Assert.NotNull(treeResponse.read_token);

            var discoveredRootPath = treeResponse.data.roots[0].path;
            Assert.IsFalse(string.IsNullOrEmpty(discoveredRootPath));
            Assert.IsTrue(discoveredRootPath.StartsWith("Scene/", StringComparison.Ordinal));

            var screenshotResponse = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_chain_capture_001",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "render_output",
                        output_mode = "inline_base64",
                        image_format = "png",
                        width = 160,
                        height = 120,
                        include_ui = true,
                    },
                });

            Assert.NotNull(screenshotResponse);
            Assert.IsTrue(screenshotResponse.ok);
            Assert.NotNull(screenshotResponse.data);
            Assert.IsFalse(string.IsNullOrEmpty(screenshotResponse.data.image_base64));
            Assert.AreEqual("render_output", screenshotResponse.data.requested_mode);
            Assert.AreEqual("render_output", screenshotResponse.data.capture_mode_effective);
            Assert.IsTrue(string.IsNullOrEmpty(screenshotResponse.data.fallback_reason));
        }
    }
}

using System;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityRagReadServiceHitTestViewportTests
    {
        private const string NamePrefix = "__V1_HIT_TEST__";
        private UnityRagReadService _service;

        [SetUp]
        public void SetUp()
        {
            _service = new UnityRagReadService();
        }

        [TearDown]
        public void TearDown()
        {
            var all = UnityEngine.Object.FindObjectsOfType<GameObject>();
            for (var i = 0; i < all.Length; i++)
            {
                var go = all[i];
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
        public void HitTestViewport_ReturnsRuntimeContext_AndMappedPointWithinBounds()
        {
            var canvasGo = new GameObject(NamePrefix + "Canvas", typeof(RectTransform), typeof(Canvas));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var imageGo = new GameObject(NamePrefix + "Image", typeof(RectTransform), typeof(Image));
            imageGo.transform.SetParent(canvasGo.transform, false);

            var response = _service.HitTestUiAtViewportPoint(
                new UnityHitTestUiAtViewportPointRequest
                {
                    request_id = "req_v1_hit_test_runtime",
                    payload = new UnityHitTestUiAtViewportPointPayload
                    {
                        view = "game",
                        coord_space = "viewport_px",
                        coord_origin = "top_left",
                        x = 1920f,
                        y = 1080f,
                        resolution = new UnityQueryResolution
                        {
                            width = 1920,
                            height = 1080
                        },
                        max_results = 8,
                        include_non_interactable = true
                    }
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.NotNull(response.data.runtime_resolution);
            Assert.IsFalse(string.IsNullOrWhiteSpace(response.data.runtime_source));
            Assert.AreEqual("top_left", response.data.coord_origin);
            Assert.NotNull(response.data.mapped_point);
            Assert.GreaterOrEqual(response.data.mapped_point.x, 0f);
            Assert.GreaterOrEqual(response.data.mapped_point.y, 0f);
            Assert.LessOrEqual(
                response.data.mapped_point.x,
                response.data.runtime_resolution.width - 1);
            Assert.LessOrEqual(
                response.data.mapped_point.y,
                response.data.runtime_resolution.height - 1);
        }

        [Test]
        public void HitTestViewport_WithoutRaycastSource_ReturnsApproximateMarkers()
        {
            var canvasGo = new GameObject(NamePrefix + "CanvasNoRaycast", typeof(RectTransform), typeof(Canvas));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var response = _service.HitTestUiAtViewportPoint(
                new UnityHitTestUiAtViewportPointRequest
                {
                    request_id = "req_v1_hit_test_approx",
                    payload = new UnityHitTestUiAtViewportPointPayload
                    {
                        view = "game",
                        coord_space = "viewport_px",
                        coord_origin = "bottom_left",
                        x = 100f,
                        y = 100f,
                        resolution = new UnityQueryResolution
                        {
                            width = 1920,
                            height = 1080
                        },
                        include_non_interactable = true
                    }
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.IsTrue(response.data.approximate);
            Assert.AreEqual("NO_RAYCAST_SOURCE", response.data.approx_reason);
            Assert.AreEqual("low", response.data.confidence);
        }
    }
}

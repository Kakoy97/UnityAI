using System;
using NUnit.Framework;
using UnityEditor.SceneManagement;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityRagReadServiceUiOverlayReportTests
    {
        private const string NamePrefix = "__R18_UI_OVERLAY__";
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
        public void GetUiOverlayReport_ReturnsOverlaySummary_WithRecommendation()
        {
            var overlayCanvasGo = new GameObject(
                NamePrefix + "OverlayCanvas",
                typeof(RectTransform),
                typeof(Canvas),
                typeof(CanvasScaler),
                typeof(GraphicRaycaster));
            var overlayCanvas = overlayCanvasGo.GetComponent<Canvas>();
            overlayCanvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var panelGo = new GameObject(
                NamePrefix + "Panel",
                typeof(RectTransform),
                typeof(Image));
            panelGo.transform.SetParent(overlayCanvasGo.transform, false);

            var buttonGo = new GameObject(
                NamePrefix + "Button",
                typeof(RectTransform),
                typeof(Image),
                typeof(Button));
            buttonGo.transform.SetParent(panelGo.transform, false);

            var worldCanvasGo = new GameObject(
                NamePrefix + "WorldCanvas",
                typeof(RectTransform),
                typeof(Canvas));
            var worldCanvas = worldCanvasGo.GetComponent<Canvas>();
            worldCanvas.renderMode = RenderMode.ScreenSpaceCamera;

            var activeScene = EditorSceneManager.GetActiveScene();
            var dirtyBefore = activeScene.isDirty;

            var response = _service.GetUiOverlayReport(
                new UnityGetUiOverlayReportRequest
                {
                    request_id = "req_overlay_report_ok",
                    payload = new UnityGetUiOverlayReportPayload
                    {
                        scope = new UnityQueryScope
                        {
                            root_path = "Scene/" + overlayCanvasGo.name
                        },
                        include_inactive = true,
                        include_children_summary = true,
                        max_nodes = 128,
                        max_children_per_canvas = 8,
                        timeout_ms = 4000
                    }
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.NotNull(response.read_token);
            Assert.NotNull(response.data.overlay_canvases);
            Assert.GreaterOrEqual(response.data.overlay_canvases.Length, 1);
            Assert.AreEqual(0, response.data.non_overlay_canvases_count);
            Assert.NotNull(response.data.diagnosis_codes);
            Assert.IsTrue(response.data.diagnosis_codes.Length >= 1);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.recommended_capture_mode));
            Assert.Contains(
                response.data.recommended_capture_mode,
                new[] { "render_output", "composite", "structural_only" });
            Assert.IsFalse(string.IsNullOrEmpty(response.data.overlay_canvases[0].path));
            Assert.NotNull(response.data.overlay_canvases[0].children_summary);
            Assert.GreaterOrEqual(response.data.overlay_canvases[0].children_summary.Length, 1);
            Assert.AreEqual(dirtyBefore, EditorSceneManager.GetActiveScene().isDirty);
        }

        [Test]
        public void GetUiOverlayReport_ReturnsSourceNotFound_WhenScopeMissing()
        {
            var response = _service.GetUiOverlayReport(
                new UnityGetUiOverlayReportRequest
                {
                    request_id = "req_overlay_report_missing",
                    payload = new UnityGetUiOverlayReportPayload
                    {
                        scope = new UnityQueryScope
                        {
                            root_path = "Scene/Path/Not/Exists"
                        }
                    }
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_UI_OVERLAY_REPORT_SOURCE_NOT_FOUND", response.error_code);
        }
    }
}

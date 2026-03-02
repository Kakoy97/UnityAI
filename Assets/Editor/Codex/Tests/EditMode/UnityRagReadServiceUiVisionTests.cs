using System;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityRagReadServiceUiVisionTests
    {
        private const string NamePrefix = "__V1_L3_UI__";
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
        public void HitTestUiAtViewportPoint_UsesClamp_AndApproximateFallback_WhenNoRaycastSource()
        {
            var canvasGo = new GameObject(NamePrefix + "Canvas", typeof(RectTransform), typeof(Canvas));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var panelGo = new GameObject(NamePrefix + "Panel", typeof(RectTransform), typeof(Image));
            var panelRect = panelGo.GetComponent<RectTransform>();
            panelRect.SetParent(canvasGo.transform, false);
            panelRect.sizeDelta = new Vector2(300f, 160f);
            panelRect.anchoredPosition = Vector2.zero;

            var response = _service.HitTestUiAtViewportPoint(
                new UnityHitTestUiAtViewportPointRequest
                {
                    request_id = "req_hit_viewport_clamp",
                    payload = new UnityHitTestUiAtViewportPointPayload
                    {
                        view = "game",
                        coord_space = "viewport_px",
                        coord_origin = "bottom_left",
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
            Assert.IsTrue(response.data.runtime_resolution.width >= 1);
            Assert.IsTrue(response.data.runtime_resolution.height >= 1);
            Assert.NotNull(response.data.mapped_point);
            Assert.IsTrue(response.data.mapped_point.x >= 0);
            Assert.IsTrue(response.data.mapped_point.y >= 0);
            Assert.IsTrue(response.data.mapped_point.x <= response.data.runtime_resolution.width - 1);
            Assert.IsTrue(response.data.mapped_point.y <= response.data.runtime_resolution.height - 1);
            Assert.IsTrue(response.data.approximate);
            Assert.AreEqual("NO_RAYCAST_SOURCE", response.data.approx_reason);
        }

        [Test]
        public void HitTestUiAtViewportPoint_ReturnsTargetNotFound_WhenScopeMissing()
        {
            var response = _service.HitTestUiAtViewportPoint(
                new UnityHitTestUiAtViewportPointRequest
                {
                    request_id = "req_hit_scope_missing",
                    payload = new UnityHitTestUiAtViewportPointPayload
                    {
                        view = "game",
                        coord_space = "viewport_px",
                        coord_origin = "bottom_left",
                        x = 10,
                        y = 20,
                        resolution = new UnityQueryResolution
                        {
                            width = 100,
                            height = 100
                        },
                        scope = new UnityQueryScope
                        {
                            root_path = "Scene/Path/Not/Exists"
                        }
                    }
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_TARGET_NOT_FOUND", response.error_code);
        }

        [Test]
        public void ValidateUiLayout_ReturnsNotClickableStaticOnly_WhenNoRaycastSource()
        {
            var canvasGo = new GameObject(NamePrefix + "CanvasValidate", typeof(RectTransform), typeof(Canvas));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var buttonGo = new GameObject(NamePrefix + "Button", typeof(RectTransform), typeof(Image), typeof(Button));
            buttonGo.transform.SetParent(canvasGo.transform, false);
            var button = buttonGo.GetComponent<Button>();
            button.interactable = false;

            var scopePath = "Scene/" + canvasGo.name;
            var response = _service.ValidateUiLayout(
                new UnityValidateUiLayoutRequest
                {
                    request_id = "req_validate_not_clickable",
                    payload = new UnityValidateUiLayoutPayload
                    {
                        scope = new UnityQueryScope
                        {
                            root_path = scopePath
                        },
                        resolutions = new[]
                        {
                            new UnityQueryResolutionItem
                            {
                                name = "runtime_like",
                                width = 1920,
                                height = 1080
                            }
                        },
                        checks = new[] { "NOT_CLICKABLE" },
                        max_issues = 20,
                        time_budget_ms = 500
                    }
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.NotNull(response.data.issues);
            Assert.Greater(response.data.issues.Length, 0);

            var found = false;
            for (var i = 0; i < response.data.issues.Length; i++)
            {
                var issue = response.data.issues[i];
                if (issue == null || !string.Equals(issue.issue_type, "NOT_CLICKABLE", StringComparison.Ordinal))
                {
                    continue;
                }

                found = true;
                Assert.AreEqual("static_only", issue.mode);
                Assert.AreEqual("warning", issue.severity);
                Assert.AreEqual("NO_RAYCAST_SOURCE", issue.approx_reason);
                break;
            }

            Assert.IsTrue(found, "Expected at least one NOT_CLICKABLE issue.");
        }
    }
}

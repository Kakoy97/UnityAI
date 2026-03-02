using System;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityUiLayoutValidatorTests
    {
        private const string NamePrefix = "__V1_VALIDATE__";
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
        public void ValidateUiLayout_RespectsIssueBudget_AndReturnsPartial()
        {
            var canvasGo = new GameObject(NamePrefix + "Canvas", typeof(RectTransform), typeof(Canvas));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            CreateOverlappingImage(canvasGo.transform, NamePrefix + "A", 0f);
            CreateOverlappingImage(canvasGo.transform, NamePrefix + "B", 10f);
            CreateOverlappingImage(canvasGo.transform, NamePrefix + "C", 20f);

            var response = _service.ValidateUiLayout(
                new UnityValidateUiLayoutRequest
                {
                    request_id = "req_v1_validate_budget",
                    payload = new UnityValidateUiLayoutPayload
                    {
                        checks = new[] { "OVERLAP" },
                        max_issues = 1,
                        time_budget_ms = 1000,
                        layout_refresh_mode = "scoped_roots_only"
                    }
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.IsTrue(response.data.partial);
            Assert.AreEqual("ISSUE_BUDGET_EXCEEDED", response.data.truncated_reason);
            Assert.NotNull(response.data.issues);
            Assert.AreEqual(1, response.data.issues.Length);
        }

        [Test]
        public void ValidateUiLayout_TextOverflowAcrossResolutions_ContainsDerivedOnlyIssue()
        {
            var canvasGo = new GameObject(NamePrefix + "CanvasText", typeof(RectTransform), typeof(Canvas));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var textGo = new GameObject(NamePrefix + "Text", typeof(RectTransform), typeof(Text));
            textGo.transform.SetParent(canvasGo.transform, false);
            var textRect = textGo.GetComponent<RectTransform>();
            textRect.sizeDelta = new Vector2(32f, 16f);
            var text = textGo.GetComponent<Text>();
            text.text = "THIS_IS_A_LONG_TEXT_FOR_OVERFLOW_VALIDATION";
            text.fontSize = 32;
            text.horizontalOverflow = HorizontalWrapMode.Overflow;
            text.verticalOverflow = VerticalWrapMode.Overflow;

            var response = _service.ValidateUiLayout(
                new UnityValidateUiLayoutRequest
                {
                    request_id = "req_v1_validate_text",
                    payload = new UnityValidateUiLayoutPayload
                    {
                        checks = new[] { "TEXT_OVERFLOW" },
                        resolutions = new[]
                        {
                            new UnityQueryResolutionItem
                            {
                                name = "landscape_small",
                                width = 1280,
                                height = 720
                            },
                            new UnityQueryResolutionItem
                            {
                                name = "portrait_small",
                                width = 720,
                                height = 1280
                            }
                        },
                        max_issues = 20,
                        time_budget_ms = 1000,
                        layout_refresh_mode = "scoped_roots_only"
                    }
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.NotNull(response.data.issues);
            Assert.Greater(response.data.issues.Length, 0);

            var hasDerivedOnly = false;
            for (var i = 0; i < response.data.issues.Length; i++)
            {
                var issue = response.data.issues[i];
                if (issue == null ||
                    !string.Equals(issue.issue_type, "TEXT_OVERFLOW", StringComparison.Ordinal))
                {
                    continue;
                }

                if (string.Equals(issue.mode, "derived_only", StringComparison.Ordinal))
                {
                    hasDerivedOnly = true;
                    Assert.AreEqual("warning", issue.severity);
                    Assert.IsTrue(issue.approximate);
                    Assert.AreEqual("DERIVED_ONLY_MODEL", issue.approx_reason);
                    break;
                }
            }

            Assert.IsTrue(hasDerivedOnly, "Expected at least one derived_only TEXT_OVERFLOW issue.");
        }

        private static void CreateOverlappingImage(Transform parent, string name, float x)
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(Image));
            go.transform.SetParent(parent, false);
            var rect = go.GetComponent<RectTransform>();
            rect.sizeDelta = new Vector2(200f, 120f);
            rect.anchoredPosition = new Vector2(x, 0f);
        }
    }
}

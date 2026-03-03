using System;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityRagReadServiceScreenshotTests
    {
        private const string NamePrefix = "__R11_SS__";
        private UnityRagReadService _service;
        private readonly List<string> _artifactFiles = new List<string>();

        [SetUp]
        public void SetUp()
        {
            _service = new UnityRagReadService();
            _artifactFiles.Clear();
            UnityRagReadService.CompositeCaptureEnabledOverrideForTests = null;
            UnityRagReadService.CompositeCaptureIsPlayingOverrideForTests = null;
            UnityRagReadService.CompositeCaptureBusyOverrideForTests = null;
            UnityRagReadService.CompositeCaptureTextureProviderForTests = null;
            CompositeCaptureExecuteAlwaysProbe.ResetCounters();
        }

        [TearDown]
        public void TearDown()
        {
            for (var i = 0; i < _artifactFiles.Count; i++)
            {
                var file = _artifactFiles[i];
                if (string.IsNullOrEmpty(file))
                {
                    continue;
                }

                try
                {
                    if (File.Exists(file))
                    {
                        File.Delete(file);
                    }
                }
                catch
                {
                    // best effort
                }
            }

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

            UnityRagReadService.CompositeCaptureEnabledOverrideForTests = null;
            UnityRagReadService.CompositeCaptureIsPlayingOverrideForTests = null;
            UnityRagReadService.CompositeCaptureBusyOverrideForTests = null;
            UnityRagReadService.CompositeCaptureTextureProviderForTests = null;
            CompositeCaptureExecuteAlwaysProbe.ResetCounters();
        }

        [Test]
        public void CaptureSceneScreenshot_ReturnsInlineBase64_WhenGameCameraExists()
        {
            var cameraGo = new GameObject(NamePrefix + "CameraInline");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_inline",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "render_output",
                        output_mode = "inline_base64",
                        image_format = "png",
                        width = 128,
                        height = 96,
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.IsNotNull(response.data);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.image_base64));
            Assert.IsTrue(string.IsNullOrEmpty(response.data.artifact_uri));
            Assert.AreEqual("inline_base64", response.data.output_mode);
            Assert.AreEqual("image/png", response.data.mime_type);
            Assert.AreEqual("render_output", response.data.requested_mode);
            Assert.AreEqual("render_output", response.data.effective_mode);
            Assert.AreEqual("render_output", response.data.capture_mode_effective);
            Assert.IsTrue(string.IsNullOrEmpty(response.data.fallback_reason));
            Assert.Greater(response.data.byte_size, 0);
            Assert.NotNull(response.data.visual_evidence);
            Assert.IsTrue(string.IsNullOrEmpty(response.data.visual_evidence.artifact_uri));
            Assert.IsFalse(string.IsNullOrEmpty(response.data.visual_evidence.pixel_hash));
            Assert.NotNull(response.data.unity_state);
            Assert.NotNull(response.data.pixel_sanity);
            Assert.NotNull(response.data.camera_used);
            Assert.NotNull(response.data.diagnosis_tags);
            Assert.NotNull(response.read_token);
            Assert.IsFalse(string.IsNullOrEmpty(response.read_token.token));
        }

        [Test]
        public void CaptureSceneScreenshot_InlineBase64_DefaultsToJpeg_WhenImageFormatMissing()
        {
            var cameraGo = new GameObject(NamePrefix + "CameraInlineDefaultJpg");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_inline_default_jpg",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "render_output",
                        output_mode = "inline_base64",
                        width = 128,
                        height = 96,
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.AreEqual("inline_base64", response.data.output_mode);
            Assert.AreEqual("jpg", response.data.image_format);
            Assert.AreEqual("image/jpeg", response.data.mime_type);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.image_base64));
            Assert.IsTrue(string.IsNullOrEmpty(response.data.artifact_uri));
        }

        [Test]
        public void CaptureSceneScreenshot_InlineBase64_FallsBackToArtifact_WhenMaxBase64BytesExceeded()
        {
            var cameraGo = new GameObject(NamePrefix + "CameraInlineFallbackArtifact");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_inline_limit",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "render_output",
                        output_mode = "inline_base64",
                        image_format = "png",
                        width = 128,
                        height = 96,
                        max_base64_bytes = 16,
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.AreEqual("artifact_uri", response.data.output_mode);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.artifact_uri));
            Assert.IsTrue(string.IsNullOrEmpty(response.data.image_base64));
            Assert.AreEqual("max_base64_bytes_exceeded", response.data.fallback_reason);
            Assert.NotNull(response.data.diagnosis_tags);
            CollectionAssert.Contains(response.data.diagnosis_tags, "FALLBACK");
            CollectionAssert.Contains(response.data.diagnosis_tags, "BASE64_SIZE_EXCEEDED");

            var artifactPath = new Uri(response.data.artifact_uri).LocalPath;
            _artifactFiles.Add(artifactPath);
            Assert.IsTrue(File.Exists(artifactPath));
        }

        [Test]
        public void CaptureSceneScreenshot_ReturnsArtifactUri_AndCleansExpiredArtifacts()
        {
            var cameraGo = new GameObject(NamePrefix + "CameraArtifact");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var artifactDir = Path.GetFullPath(Path.Combine("Library", "Codex", "McpArtifacts"));
            Directory.CreateDirectory(artifactDir);
            var staleFile = Path.Combine(artifactDir, "scene_capture_stale_test.png");
            File.WriteAllBytes(staleFile, new byte[] { 1, 2, 3 });
            File.SetLastWriteTimeUtc(staleFile, DateTime.UtcNow.AddHours(-48));

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_artifact",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "render_output",
                        output_mode = "artifact_uri",
                        image_format = "png",
                        width = 96,
                        height = 96,
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.IsNotNull(response.data);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.artifact_uri));
            Assert.IsTrue(string.IsNullOrEmpty(response.data.image_base64));
            Assert.AreEqual("render_output", response.data.requested_mode);
            Assert.AreEqual("render_output", response.data.effective_mode);
            Assert.AreEqual("render_output", response.data.capture_mode_effective);
            Assert.IsTrue(string.IsNullOrEmpty(response.data.fallback_reason));
            Assert.NotNull(response.data.visual_evidence);
            Assert.NotNull(response.data.unity_state);
            Assert.NotNull(response.data.pixel_sanity);
            Assert.NotNull(response.data.camera_used);
            Assert.NotNull(response.data.diagnosis_tags);

            var artifactPath = new Uri(response.data.artifact_uri).LocalPath;
            _artifactFiles.Add(artifactPath);
            Assert.IsTrue(File.Exists(artifactPath));
            Assert.IsFalse(File.Exists(staleFile));
            Assert.AreEqual(response.data.artifact_uri, response.data.visual_evidence.artifact_uri);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.visual_evidence.pixel_hash));
        }

        [Test]
        public void CaptureSceneScreenshot_ReturnsViewNotFound_WhenNoActiveGameCamera()
        {
            var disabled = new List<CameraToggleState>();
            try
            {
                var cameras = UnityEngine.Object.FindObjectsOfType<Camera>();
                for (var i = 0; i < cameras.Length; i++)
                {
                    var camera = cameras[i];
                    if (camera == null)
                    {
                        continue;
                    }

                    if (camera.cameraType == CameraType.SceneView)
                    {
                        continue;
                    }

                    disabled.Add(new CameraToggleState
                    {
                        Camera = camera,
                        Enabled = camera.enabled,
                    });
                    camera.enabled = false;
                }

                var response = _service.CaptureSceneScreenshot(
                    new UnityCaptureSceneScreenshotRequest
                    {
                        request_id = "req_ss_missing_view",
                        payload = new UnityCaptureSceneScreenshotPayload
                        {
                            view_mode = "game",
                            output_mode = "inline_base64",
                            image_format = "png",
                        },
                    });

                Assert.NotNull(response);
                Assert.IsFalse(response.ok);
                Assert.AreEqual("E_SCREENSHOT_VIEW_NOT_FOUND", response.error_code);
            }
            finally
            {
                for (var i = 0; i < disabled.Count; i++)
                {
                    var state = disabled[i];
                    if (state.Camera == null)
                    {
                        continue;
                    }
                    state.Camera.enabled = state.Enabled;
                }
            }
        }

        [Test]
        public void CaptureSceneScreenshot_FinalPixels_ModeIsDisabled()
        {
            var cameraGo = new GameObject(NamePrefix + "CameraFinalPixels");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_final_pixels",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "final_pixels",
                        output_mode = "inline_base64",
                        image_format = "png",
                        width = 160,
                        height = 120,
                        include_ui = true,
                    },
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_CAPTURE_MODE_DISABLED", response.error_code);
            Assert.IsNull(response.data);
        }

        [Test]
        public void CaptureSceneScreenshot_CompositeMode_IsDisabled_WhenFeatureFlagOff()
        {
            UnityRagReadService.CompositeCaptureEnabledOverrideForTests = false;

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_composite_disabled",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "composite",
                        output_mode = "inline_base64",
                        image_format = "png",
                    },
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_CAPTURE_MODE_DISABLED", response.error_code);
            Assert.IsNull(response.data);
        }

        [Test]
        public void CaptureSceneScreenshot_CompositeMode_UsesEditModeTempScenePath_WhenNotPlaying()
        {
            UnityRagReadService.CompositeCaptureEnabledOverrideForTests = true;
            UnityRagReadService.CompositeCaptureIsPlayingOverrideForTests = false;

            var cameraGo = new GameObject(NamePrefix + "CameraCompositeEditMode");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var canvasGo = new GameObject(NamePrefix + "OverlayCanvas", typeof(RectTransform), typeof(Canvas));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var imageGo = new GameObject(NamePrefix + "OverlayImage", typeof(RectTransform), typeof(UnityEngine.UI.Image));
            imageGo.transform.SetParent(canvasGo.transform, false);

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_composite_editmode",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "composite",
                        output_mode = "inline_base64",
                        image_format = "png",
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.AreEqual("composite", response.data.capture_mode_effective);
            Assert.AreEqual("editmode_temp_scene_composite", response.data.read_timing);
            Assert.NotNull(response.data.diagnosis_tags);
            CollectionAssert.Contains(response.data.diagnosis_tags, "COMPOSITE_RENDER");
            CollectionAssert.Contains(response.data.diagnosis_tags, "EDITMODE_TEMP_SCENE");
            CollectionAssert.Contains(response.data.diagnosis_tags, "OVERLAY_CLONED");
            Assert.AreEqual(0, CountCompositeTempSceneMarkers());
        }

        [Test]
        public void CaptureSceneScreenshot_CompositeMode_FallsBackToRenderOutput_WhenNoOverlayCanvasInEditMode()
        {
            UnityRagReadService.CompositeCaptureEnabledOverrideForTests = true;
            UnityRagReadService.CompositeCaptureIsPlayingOverrideForTests = false;

            var cameraGo = new GameObject(NamePrefix + "CameraCompositeNoOverlay");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_composite_editmode_no_overlay",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "composite",
                        output_mode = "inline_base64",
                        image_format = "png",
                        width = 96,
                        height = 64,
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.AreEqual("render_output", response.data.capture_mode_effective);
            Assert.AreEqual("composite_overlay_absent", response.data.fallback_reason);
            Assert.NotNull(response.data.diagnosis_tags);
            CollectionAssert.Contains(response.data.diagnosis_tags, "FALLBACK");
            CollectionAssert.Contains(response.data.diagnosis_tags, "EDITMODE_TEMP_SCENE");
            CollectionAssert.Contains(response.data.diagnosis_tags, "COMPOSITE_FALLBACK_RENDER_OUTPUT");
        }

        [Test]
        public void CaptureSceneScreenshot_CompositeMode_ReturnsBusy_WhenCompositeAlreadyInFlight()
        {
            UnityRagReadService.CompositeCaptureEnabledOverrideForTests = true;
            UnityRagReadService.CompositeCaptureBusyOverrideForTests = true;

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_composite_busy",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "composite",
                        output_mode = "inline_base64",
                        image_format = "png",
                    },
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_COMPOSITE_BUSY", response.error_code);
            Assert.IsNull(response.data);
        }

        [Test]
        public void CaptureSceneScreenshot_CompositeMode_UsesPlayModeCapturePath_WhenEnabled()
        {
            UnityRagReadService.CompositeCaptureEnabledOverrideForTests = true;
            UnityRagReadService.CompositeCaptureIsPlayingOverrideForTests = true;
            UnityRagReadService.CompositeCaptureTextureProviderForTests = CreateCompositeCaptureTexture;

            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_composite_playmode",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "composite",
                        output_mode = "inline_base64",
                        image_format = "png",
                        width = 96,
                        height = 64,
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.AreEqual("composite", response.data.requested_mode);
            Assert.AreEqual("composite", response.data.effective_mode);
            Assert.AreEqual("composite", response.data.capture_mode_effective);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.image_base64));
            Assert.AreEqual("playmode_screen_capture", response.data.read_timing);
            Assert.NotNull(response.data.diagnosis_tags);
            CollectionAssert.Contains(response.data.diagnosis_tags, "COMPOSITE_RENDER");
            CollectionAssert.Contains(response.data.diagnosis_tags, "PLAYMODE_CAPTURE");
            Assert.NotNull(response.data.camera_used);
            Assert.AreEqual("PlayMode/ScreenCapture", response.data.camera_used.path);
        }

        [Test]
        public void CaptureSceneScreenshot_CompositeMode_EditModeClone_DoesNotExecuteCustomExecuteAlwaysScript()
        {
            UnityRagReadService.CompositeCaptureEnabledOverrideForTests = true;
            UnityRagReadService.CompositeCaptureIsPlayingOverrideForTests = false;

            var cameraGo = new GameObject(NamePrefix + "CameraCompositeGuard");
            var camera = cameraGo.AddComponent<Camera>();
            camera.enabled = true;

            var canvasGo = new GameObject(
                NamePrefix + "OverlayCanvasGuard",
                typeof(RectTransform),
                typeof(Canvas),
                typeof(CompositeCaptureExecuteAlwaysProbe));
            var canvas = canvasGo.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;

            var imageGo = new GameObject(NamePrefix + "OverlayImageGuard", typeof(RectTransform), typeof(UnityEngine.UI.Image));
            imageGo.transform.SetParent(canvasGo.transform, false);

            var baselineEnableCount = CompositeCaptureExecuteAlwaysProbe.EnableCount;
            var response = _service.CaptureSceneScreenshot(
                new UnityCaptureSceneScreenshotRequest
                {
                    request_id = "req_ss_composite_editmode_guard",
                    payload = new UnityCaptureSceneScreenshotPayload
                    {
                        view_mode = "game",
                        capture_mode = "composite",
                        output_mode = "inline_base64",
                        image_format = "png",
                        width = 96,
                        height = 64,
                    },
                });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.AreEqual("composite", response.data.capture_mode_effective);
            Assert.AreEqual(baselineEnableCount, CompositeCaptureExecuteAlwaysProbe.EnableCount);
            Assert.NotNull(response.data.diagnosis_tags);
            CollectionAssert.Contains(response.data.diagnosis_tags, "COMPOSITE_SANITIZED");
        }

        [Test]
        public void HitTestUiAtScreenPoint_IsDisabled()
        {
            var response = _service.HitTestUiAtScreenPoint(
                new UnityHitTestUiAtScreenPointRequest
                {
                    request_id = "req_hit_scene_mode",
                    payload = new UnityHitTestUiAtScreenPointPayload
                    {
                        view_mode = "scene",
                        x = 10,
                        y = 20,
                        reference_width = 1280,
                        reference_height = 720,
                    },
                });

            Assert.NotNull(response);
            Assert.IsFalse(response.ok);
            Assert.AreEqual("E_COMMAND_DISABLED", response.error_code);
        }

        private struct CameraToggleState
        {
            public Camera Camera;
            public bool Enabled;
        }

        private static Texture2D CreateCompositeCaptureTexture()
        {
            var texture = new Texture2D(48, 32, TextureFormat.RGB24, false);
            var pixels = new Color[48 * 32];
            for (var i = 0; i < pixels.Length; i++)
            {
                pixels[i] = new Color(0.2f, 0.6f, 0.8f, 1f);
            }

            texture.SetPixels(pixels);
            texture.Apply(false, false);
            return texture;
        }

        private static int CountCompositeTempSceneMarkers()
        {
            var count = 0;
#if UNITY_2020_1_OR_NEWER
            var allObjects = UnityEngine.Object.FindObjectsOfType<GameObject>(true);
#else
            var allObjects = UnityEngine.Object.FindObjectsOfType<GameObject>();
#endif
            for (var i = 0; i < allObjects.Length; i++)
            {
                var go = allObjects[i];
                if (go == null)
                {
                    continue;
                }

                if (string.Equals(go.name, "__CODEX_COMPOSITE_CAPTURE_TEMP_SCENE_MARKER__", StringComparison.Ordinal))
                {
                    count += 1;
                }
            }

            return count;
        }

        [ExecuteAlways]
        private sealed class CompositeCaptureExecuteAlwaysProbe : MonoBehaviour
        {
            internal static int EnableCount;

            internal static void ResetCounters()
            {
                EnableCount = 0;
            }

            private void OnEnable()
            {
                EnableCount += 1;
            }
        }
    }
}

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
            Assert.NotNull(response.data.unity_state);
            Assert.NotNull(response.data.pixel_sanity);
            Assert.NotNull(response.data.camera_used);
            Assert.NotNull(response.data.diagnosis_tags);
            Assert.NotNull(response.read_token);
            Assert.IsFalse(string.IsNullOrEmpty(response.read_token.token));
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
            Assert.NotNull(response.data.unity_state);
            Assert.NotNull(response.data.pixel_sanity);
            Assert.NotNull(response.data.camera_used);
            Assert.NotNull(response.data.diagnosis_tags);

            var artifactPath = new Uri(response.data.artifact_uri).LocalPath;
            _artifactFiles.Add(artifactPath);
            Assert.IsTrue(File.Exists(artifactPath));
            Assert.IsFalse(File.Exists(staleFile));
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
    }
}

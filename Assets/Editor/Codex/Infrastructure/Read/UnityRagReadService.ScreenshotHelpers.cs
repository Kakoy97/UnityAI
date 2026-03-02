using System;
using System.IO;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        private static bool TryResolveCaptureCamera(
            string requestedViewMode,
            out Camera captureCamera,
            out string resolvedViewMode,
            out string cameraPathHint)
        {
            captureCamera = null;
            resolvedViewMode = string.Empty;
            cameraPathHint = "Scene/Screenshot";

            if (string.Equals(requestedViewMode, "scene", StringComparison.Ordinal))
            {
                return TryGetSceneViewCamera(out captureCamera, out resolvedViewMode, out cameraPathHint);
            }

            if (string.Equals(requestedViewMode, "game", StringComparison.Ordinal))
            {
                return TryGetGameCamera(out captureCamera, out resolvedViewMode, out cameraPathHint);
            }

            if (TryGetSceneViewCamera(out captureCamera, out resolvedViewMode, out cameraPathHint))
            {
                return true;
            }

            return TryGetGameCamera(out captureCamera, out resolvedViewMode, out cameraPathHint);
        }

        private static bool TryGetSceneViewCamera(out Camera camera, out string resolvedViewMode, out string pathHint)
        {
            SceneView sceneView;
            return TryGetSceneViewCamera(out camera, out resolvedViewMode, out pathHint, out sceneView);
        }

        private static bool TryGetSceneViewCamera(
            out Camera camera,
            out string resolvedViewMode,
            out string pathHint,
            out SceneView sceneView)
        {
            camera = null;
            resolvedViewMode = string.Empty;
            pathHint = "SceneView";
            sceneView = null;

            sceneView = SceneView.lastActiveSceneView;
            if (sceneView != null && sceneView.camera != null)
            {
                camera = sceneView.camera;
                resolvedViewMode = "scene";
                return true;
            }

            foreach (var item in SceneView.sceneViews)
            {
                var candidate = item as SceneView;
                if (candidate == null || candidate.camera == null)
                {
                    continue;
                }

                sceneView = candidate;
                camera = candidate.camera;
                resolvedViewMode = "scene";
                return true;
            }

            return false;
        }

        private static bool TryGetGameCamera(out Camera camera, out string resolvedViewMode, out string pathHint)
        {
            camera = null;
            resolvedViewMode = string.Empty;
            pathHint = "GameView";

            if (Camera.main != null && Camera.main.isActiveAndEnabled)
            {
                camera = Camera.main;
                resolvedViewMode = "game";
                pathHint = BuildObjectPath(Camera.main.gameObject.transform, "Scene");
                return true;
            }

            var cameras = UnityEngine.Object.FindObjectsOfType<Camera>();
            for (var i = 0; i < cameras.Length; i++)
            {
                var candidate = cameras[i];
                if (candidate == null || !candidate.isActiveAndEnabled)
                {
                    continue;
                }
                if (candidate.cameraType == CameraType.SceneView)
                {
                    continue;
                }

                camera = candidate;
                resolvedViewMode = "game";
                pathHint = candidate.gameObject != null
                    ? BuildObjectPath(candidate.gameObject.transform, "Scene")
                    : "GameView";
                return true;
            }

            return false;
        }

        private static byte[] CaptureCameraToBytes(
            Camera sourceCamera,
            int width,
            int height,
            string imageFormat,
            int jpegQuality)
        {
            if (sourceCamera == null)
            {
                return null;
            }

            var normalizedWidth = ClampInRange(width, DefaultScreenshotWidth, MinScreenshotDimension, MaxScreenshotDimension);
            var normalizedHeight = ClampInRange(height, DefaultScreenshotHeight, MinScreenshotDimension, MaxScreenshotDimension);
            var normalizedJpegQuality = ClampInRange(jpegQuality, DefaultScreenshotJpegQuality, 1, 100);
            var normalizedFormat = NormalizeCaptureImageFormat(imageFormat);

            var previousTarget = sourceCamera.targetTexture;
            var previousActive = RenderTexture.active;
            var captureRt = new RenderTexture(normalizedWidth, normalizedHeight, 24, RenderTextureFormat.ARGB32);
            var captureTexture = new Texture2D(normalizedWidth, normalizedHeight, TextureFormat.RGB24, false);

            try
            {
                sourceCamera.targetTexture = captureRt;
                sourceCamera.Render();
                RenderTexture.active = captureRt;
                captureTexture.ReadPixels(new Rect(0, 0, normalizedWidth, normalizedHeight), 0, 0);
                captureTexture.Apply(false, false);

                return string.Equals(normalizedFormat, "jpg", StringComparison.Ordinal)
                    ? captureTexture.EncodeToJPG(normalizedJpegQuality)
                    : captureTexture.EncodeToPNG();
            }
            finally
            {
                sourceCamera.targetTexture = previousTarget;
                RenderTexture.active = previousActive;
                UnityEngine.Object.DestroyImmediate(captureTexture);
                UnityEngine.Object.DestroyImmediate(captureRt);
            }
        }

        private static string TryWriteScreenshotArtifact(byte[] bytes, string imageFormat, out string error)
        {
            error = string.Empty;
            if (bytes == null || bytes.Length == 0)
            {
                error = "Screenshot bytes are empty.";
                return string.Empty;
            }

            try
            {
                var extension = string.Equals(imageFormat, "jpg", StringComparison.Ordinal) ? "jpg" : "png";
                var relativeDir = Path.Combine("Library", "Codex", "McpArtifacts");
                var absoluteDir = Path.GetFullPath(relativeDir);
                Directory.CreateDirectory(absoluteDir);
                var fileName = "scene_capture_" + DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff") + "." + extension;
                var absolutePath = Path.Combine(absoluteDir, fileName);
                File.WriteAllBytes(absolutePath, bytes);
                CleanupScreenshotArtifacts(absoluteDir);
                return new Uri(absolutePath).AbsoluteUri;
            }
            catch (Exception ex)
            {
                error = ex.Message;
                return string.Empty;
            }
        }

        private static void CleanupScreenshotArtifacts(string absoluteDir)
        {
            if (string.IsNullOrWhiteSpace(absoluteDir) || !Directory.Exists(absoluteDir))
            {
                return;
            }

            try
            {
                var files = Directory.GetFiles(absoluteDir, "scene_capture_*.*", SearchOption.TopDirectoryOnly);
                if (files == null || files.Length == 0)
                {
                    return;
                }

                var nowUtc = DateTime.UtcNow;
                for (var i = 0; i < files.Length; i++)
                {
                    var file = files[i];
                    if (string.IsNullOrEmpty(file))
                    {
                        continue;
                    }

                    DateTime lastWriteUtc;
                    try
                    {
                        lastWriteUtc = File.GetLastWriteTimeUtc(file);
                    }
                    catch
                    {
                        continue;
                    }

                    if (lastWriteUtc <= DateTime.MinValue)
                    {
                        continue;
                    }

                    if ((nowUtc - lastWriteUtc).TotalHours <= ScreenshotArtifactMaxAgeHours)
                    {
                        continue;
                    }

                    TryDeleteFile(file);
                }

                files = Directory.GetFiles(absoluteDir, "scene_capture_*.*", SearchOption.TopDirectoryOnly);
                if (files == null || files.Length <= ScreenshotArtifactMaxFiles)
                {
                    return;
                }

                var records = new ScreenshotFileRecord[files.Length];
                for (var i = 0; i < files.Length; i++)
                {
                    var fullPath = files[i];
                    var timestamp = DateTime.MaxValue;
                    try
                    {
                        timestamp = File.GetLastWriteTimeUtc(fullPath);
                    }
                    catch
                    {
                        // keep max value so unreadable files are deleted last
                    }

                    records[i] = new ScreenshotFileRecord
                    {
                        FullPath = fullPath,
                        LastWriteUtc = timestamp
                    };
                }

                Array.Sort(records, (a, b) => DateTime.Compare(a.LastWriteUtc, b.LastWriteUtc));
                var deleteCount = records.Length - ScreenshotArtifactMaxFiles;
                for (var i = 0; i < deleteCount; i++)
                {
                    TryDeleteFile(records[i].FullPath);
                }
            }
            catch
            {
                // cleanup is best effort; never fail screenshot result due to janitor errors
            }
        }

        private static void TryDeleteFile(string filePath)
        {
            if (string.IsNullOrWhiteSpace(filePath))
            {
                return;
            }

            try
            {
                if (File.Exists(filePath))
                {
                    File.Delete(filePath);
                }
            }
            catch
            {
                // ignore best-effort cleanup failures
            }
        }

        private struct ScreenshotFileRecord
        {
            public string FullPath;
            public DateTime LastWriteUtc;
        }

        private static string NormalizeCaptureViewMode(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
            if (string.Equals(normalized, "scene", StringComparison.Ordinal) ||
                string.Equals(normalized, "game", StringComparison.Ordinal))
            {
                return normalized;
            }
            return "auto";
        }

        private static string NormalizeCaptureOutputMode(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
            if (string.Equals(normalized, "inline_base64", StringComparison.Ordinal))
            {
                return "inline_base64";
            }
            return "artifact_uri";
        }

        private static string NormalizeCaptureMode(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
            if (string.Equals(normalized, CaptureModeFinalPixels, StringComparison.Ordinal))
            {
                return CaptureModeFinalPixels;
            }
            if (string.Equals(normalized, CaptureModeEditorView, StringComparison.Ordinal))
            {
                return CaptureModeEditorView;
            }
            return CaptureModeRenderOutput;
        }

        private static string NormalizeCaptureImageFormat(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim().ToLowerInvariant();
            if (string.Equals(normalized, "jpg", StringComparison.Ordinal) ||
                string.Equals(normalized, "jpeg", StringComparison.Ordinal))
            {
                return "jpg";
            }
            return "png";
        }

        private static string ResolveCaptureMimeType(string imageFormat)
        {
            return string.Equals(imageFormat, "jpg", StringComparison.Ordinal)
                ? "image/jpeg"
                : "image/png";
        }

        private static int ClampInRange(int value, int fallback, int min, int max)
        {
            var normalized = value <= 0 ? fallback : value;
            if (normalized < min)
            {
                return min;
            }
            if (normalized > max)
            {
                return max;
            }
            return normalized;
        }
    }
}

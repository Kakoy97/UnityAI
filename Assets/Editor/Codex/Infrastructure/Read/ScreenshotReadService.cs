using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        public UnityCaptureSceneScreenshotResponse CaptureSceneScreenshot(UnityCaptureSceneScreenshotRequest request)
        {
            return ScreenshotReadService.ExecuteCapture(this, request);
        }

        private static class ScreenshotReadService
        {
            internal static UnityCaptureSceneScreenshotResponse ExecuteCapture(
                UnityRagReadService owner,
                UnityCaptureSceneScreenshotRequest request)
            {
                if (owner == null)
                {
                    return BuildCaptureSceneScreenshotFailure(
                        string.Empty,
                        "E_INTERNAL_NULL",
                        "UnityRagReadService instance is null.");
                }

                return owner.CaptureSceneScreenshotCore(request);
            }
        }

        private UnityCaptureSceneScreenshotResponse CaptureSceneScreenshotCore(UnityCaptureSceneScreenshotRequest request)
        {
            var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
            var payload = request == null ? null : request.payload;

            var requestedViewMode = NormalizeCaptureViewMode(payload == null ? string.Empty : payload.view_mode);
            var requestedCaptureMode = NormalizeCaptureMode(payload == null ? string.Empty : payload.capture_mode);
            var outputMode = NormalizeCaptureOutputMode(payload == null ? string.Empty : payload.output_mode);
            var imageFormat = NormalizeCaptureImageFormat(payload == null ? string.Empty : payload.image_format);
            var width = ClampInRange(payload == null ? 0 : payload.width, DefaultScreenshotWidth, MinScreenshotDimension, MaxScreenshotDimension);
            var height = ClampInRange(payload == null ? 0 : payload.height, DefaultScreenshotHeight, MinScreenshotDimension, MaxScreenshotDimension);
            var jpegQuality = ClampInRange(payload == null ? 0 : payload.jpeg_quality, DefaultScreenshotJpegQuality, 1, 100);

            if (string.Equals(requestedCaptureMode, CaptureModeFinalPixels, StringComparison.Ordinal) ||
                string.Equals(requestedCaptureMode, CaptureModeEditorView, StringComparison.Ordinal))
            {
                return BuildCaptureSceneScreenshotFailure(
                    requestId,
                    "E_CAPTURE_MODE_DISABLED",
                    "capture_scene_screenshot currently supports capture_mode=render_output only.");
            }

            var effectiveCaptureMode = CaptureModeRenderOutput;
            var fallbackReason = string.Empty;
            var resolvedViewMode = requestedViewMode;
            var cameraPathHint = "Scene/Screenshot";
            var diagnostics = ScreenshotCaptureDiagnostics.Empty;
            byte[] bytes;
            string captureError;
            if (!TryCaptureViaCamera(
                requestedViewMode,
                width,
                height,
                imageFormat,
                jpegQuality,
                out bytes,
                out resolvedViewMode,
                out cameraPathHint,
                out diagnostics,
                out captureError))
            {
                return BuildCaptureSceneScreenshotFailure(
                    requestId,
                    ResolveScreenshotFailureCode(captureError),
                    captureError);
            }

            if (bytes == null || bytes.Length == 0)
            {
                return BuildCaptureSceneScreenshotFailure(
                    requestId,
                    "E_SCREENSHOT_CAPTURE_FAILED",
                    "Screenshot capture produced empty bytes.");
            }

            var capturedWidth = diagnostics.read_rect_screen_px != null &&
                                diagnostics.read_rect_screen_px.width > 0
                ? diagnostics.read_rect_screen_px.width
                : width;
            var capturedHeight = diagnostics.read_rect_screen_px != null &&
                                 diagnostics.read_rect_screen_px.height > 0
                ? diagnostics.read_rect_screen_px.height
                : height;
            var pixelSanity = diagnostics.pixel_sanity ?? ComputePixelSanityFromEncodedBytes(bytes);
            var data = new UnityCaptureSceneScreenshotData
            {
                requested_mode = requestedCaptureMode,
                view_mode = resolvedViewMode,
                effective_mode = effectiveCaptureMode,
                capture_mode_effective = effectiveCaptureMode,
                fallback_reason = fallbackReason,
                output_mode = outputMode,
                image_format = imageFormat,
                mime_type = ResolveCaptureMimeType(imageFormat),
                width = capturedWidth,
                height = capturedHeight,
                byte_size = bytes.Length,
                artifact_uri = string.Empty,
                image_base64 = string.Empty,
                unity_state = BuildScreenshotUnityState(),
                pixel_sanity = pixelSanity,
                camera_used = diagnostics.camera_used,
                game_view_rect_screen_px = diagnostics.game_view_rect_screen_px,
                read_rect_screen_px = diagnostics.read_rect_screen_px,
                pixels_per_point = diagnostics.pixels_per_point,
                display_index = diagnostics.display_index,
                read_timing = diagnostics.read_timing,
                editor_window_rect_screen_px = diagnostics.editor_window_rect_screen_px,
                include_gizmos_effective = diagnostics.include_gizmos_effective
            };
            data.diagnosis_tags = BuildScreenshotDiagnosisTags(
                data.pixel_sanity,
                data.game_view_rect_screen_px,
                data.read_rect_screen_px,
                fallbackReason);

            if (string.Equals(outputMode, "inline_base64", StringComparison.Ordinal))
            {
                data.image_base64 = Convert.ToBase64String(bytes);
            }
            else
            {
                string artifactError;
                var artifactUri = TryWriteScreenshotArtifact(bytes, imageFormat, out artifactError);
                if (string.IsNullOrEmpty(artifactUri))
                {
                    return BuildCaptureSceneScreenshotFailure(
                        requestId,
                        "E_SCREENSHOT_CAPTURE_FAILED",
                        string.IsNullOrEmpty(artifactError) ? "Failed to persist screenshot artifact." : artifactError);
                }
                data.artifact_uri = artifactUri;
            }

            return new UnityCaptureSceneScreenshotResponse
            {
                ok = true,
                request_id = requestId,
                captured_at = NowIso(),
                error_code = string.Empty,
                error_message = string.Empty,
                read_token = BuildReadToken("scene", string.Empty, string.IsNullOrEmpty(cameraPathHint) ? "Scene/Screenshot" : cameraPathHint),
                data = data
            };
        }



        private static bool TryCaptureViaCamera(
            string requestedViewMode,
            int width,
            int height,
            string imageFormat,
            int jpegQuality,
            out byte[] bytes,
            out string resolvedViewMode,
            out string cameraPathHint,
            out ScreenshotCaptureDiagnostics diagnostics,
            out string errorMessage)
        {
            bytes = null;
            resolvedViewMode = string.Empty;
            cameraPathHint = "Scene/Screenshot";
            diagnostics = ScreenshotCaptureDiagnostics.Empty;
            errorMessage = string.Empty;

            Camera captureCamera;
            if (!TryResolveCaptureCamera(requestedViewMode, out captureCamera, out resolvedViewMode, out cameraPathHint))
            {
                errorMessage = "No available camera/view for screenshot capture.";
                return false;
            }

            try
            {
                bytes = CaptureCameraToBytes(captureCamera, width, height, imageFormat, jpegQuality);
            }
            catch (Exception ex)
            {
                bytes = null;
                errorMessage = ex.Message;
                return false;
            }

            if (bytes == null || bytes.Length == 0)
            {
                errorMessage = "Screenshot capture produced empty bytes.";
                return false;
            }

            diagnostics.camera_used = BuildScreenshotCameraUsed(captureCamera);
            diagnostics.pixel_sanity = ComputePixelSanityFromEncodedBytes(bytes);
            diagnostics.read_timing = "immediate";
            return true;
        }

        private static UnityScreenshotCameraUsed BuildScreenshotCameraUsed(Camera camera)
        {
            if (camera == null)
            {
                return null;
            }

            return new UnityScreenshotCameraUsed
            {
                path = camera.gameObject == null ? "GameView" : BuildObjectPath(camera.gameObject.transform, "Scene"),
                instance_id = camera.GetInstanceID(),
                target_display = camera.targetDisplay,
                culling_mask = camera.cullingMask,
                clear_flags = camera.clearFlags.ToString(),
                background_color = "#" + ColorUtility.ToHtmlStringRGBA(camera.backgroundColor),
            };
        }

        private static UnityScreenshotUnityState BuildScreenshotUnityState()
        {
            return new UnityScreenshotUnityState
            {
                is_playing = EditorApplication.isPlaying,
                is_paused = EditorApplication.isPaused,
                focused_view = ResolveFocusedViewName(),
            };
        }

        private static string ResolveFocusedViewName()
        {
            var focused = EditorWindow.focusedWindow;
            if (focused == null)
            {
                return "Unknown";
            }

            var typeName = focused.GetType().Name;
            if (ContainsIgnoreCase(typeName, "GameView"))
            {
                return "Game";
            }
            if (ContainsIgnoreCase(typeName, "SceneView"))
            {
                return "Scene";
            }
            return "Other";
        }


        private static UnityScreenshotPixelSanity ComputePixelSanityFromEncodedBytes(byte[] encodedBytes)
        {
            if (encodedBytes == null || encodedBytes.Length == 0)
            {
                return new UnityScreenshotPixelSanity
                {
                    is_all_black = true,
                    avg_luma = 0f,
                    std_luma = 0f,
                    unique_color_estimate = 0,
                };
            }

            var texture = new Texture2D(2, 2, TextureFormat.RGB24, false);
            try
            {
                if (!texture.LoadImage(encodedBytes, false))
                {
                    return new UnityScreenshotPixelSanity
                    {
                        is_all_black = true,
                        avg_luma = 0f,
                        std_luma = 0f,
                        unique_color_estimate = 0,
                    };
                }

                return ComputePixelSanity(texture.GetPixels());
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }

        private static UnityScreenshotPixelSanity ComputePixelSanity(Color[] colors)
        {
            if (colors == null || colors.Length == 0)
            {
                return new UnityScreenshotPixelSanity
                {
                    is_all_black = true,
                    avg_luma = 0f,
                    std_luma = 0f,
                    unique_color_estimate = 0,
                };
            }

            double sum = 0d;
            double sumSquared = 0d;
            var unique = new HashSet<int>();
            var maxUnique = 4096;
            for (var i = 0; i < colors.Length; i++)
            {
                var color = colors[i];
                var luma = 0.2126f * color.r + 0.7152f * color.g + 0.0722f * color.b;
                sum += luma;
                sumSquared += luma * luma;

                if (unique.Count < maxUnique)
                {
                    var color32 = (Color32)color;
                    var packed = (color32.r << 16) | (color32.g << 8) | color32.b;
                    unique.Add(packed);
                }
            }

            var sampleCount = colors.Length;
            var avg = sampleCount <= 0 ? 0d : sum / sampleCount;
            var variance = sampleCount <= 0 ? 0d : Math.Max(0d, (sumSquared / sampleCount) - (avg * avg));
            var std = Math.Sqrt(variance);
            return new UnityScreenshotPixelSanity
            {
                is_all_black = avg < 0.005d && std < 0.002d,
                avg_luma = (float)avg,
                std_luma = (float)std,
                unique_color_estimate = unique.Count,
            };
        }

        private static string[] BuildScreenshotDiagnosisTags(
            UnityScreenshotPixelSanity pixelSanity,
            UnityScreenshotRect gameViewRect,
            UnityScreenshotRect readRect,
            string fallbackReason)
        {
            var tags = new List<string>(3);
            if (!string.IsNullOrEmpty(fallbackReason))
            {
                tags.Add("FALLBACK");
            }
            if (pixelSanity != null && pixelSanity.is_all_black)
            {
                tags.Add("ALL_BLACK");
            }
            if (IsRectOutside(readRect, gameViewRect))
            {
                tags.Add("RECT_OUTSIDE");
            }
            return tags.Count == 0 ? new string[0] : tags.ToArray();
        }

        private static bool IsRectOutside(UnityScreenshotRect readRect, UnityScreenshotRect containerRect)
        {
            if (readRect == null || containerRect == null)
            {
                return false;
            }

            if (readRect.width <= 0 || readRect.height <= 0 || containerRect.width <= 0 || containerRect.height <= 0)
            {
                return false;
            }

            var readRight = readRect.x + readRect.width;
            var readTop = readRect.y + readRect.height;
            var containerRight = containerRect.x + containerRect.width;
            var containerTop = containerRect.y + containerRect.height;
            return readRect.x < containerRect.x ||
                   readRect.y < containerRect.y ||
                   readRight > containerRight ||
                   readTop > containerTop;
        }

        private static string ResolveScreenshotFailureCode(string errorMessage)
        {
            if (!string.IsNullOrWhiteSpace(errorMessage) &&
                errorMessage.IndexOf("No available camera/view", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "E_SCREENSHOT_VIEW_NOT_FOUND";
            }

            return "E_SCREENSHOT_CAPTURE_FAILED";
        }

        private struct ScreenshotCaptureDiagnostics
        {
            public UnityScreenshotPixelSanity pixel_sanity;
            public UnityScreenshotCameraUsed camera_used;
            public UnityScreenshotRect game_view_rect_screen_px;
            public UnityScreenshotRect read_rect_screen_px;
            public float pixels_per_point;
            public int display_index;
            public string read_timing;
            public UnityScreenshotRect editor_window_rect_screen_px;
            public bool include_gizmos_effective;

            public static ScreenshotCaptureDiagnostics Empty
            {
                get
                {
                    return new ScreenshotCaptureDiagnostics
                    {
                        pixel_sanity = null,
                        camera_used = null,
                        game_view_rect_screen_px = null,
                        read_rect_screen_px = null,
                        pixels_per_point = 0f,
                        display_index = 0,
                        read_timing = string.Empty,
                        editor_window_rect_screen_px = null,
                        include_gizmos_effective = false,
                    };
                }
            }
        }


    }
}
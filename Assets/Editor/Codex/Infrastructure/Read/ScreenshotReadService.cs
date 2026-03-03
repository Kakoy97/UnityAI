using System;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
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
            var requestedImageFormatRaw = payload == null ? string.Empty : payload.image_format;
            var imageFormat = ResolveEffectiveImageFormat(requestedImageFormatRaw, outputMode);
            var width = ClampInRange(payload == null ? 0 : payload.width, DefaultScreenshotWidth, MinScreenshotDimension, MaxScreenshotDimension);
            var height = ClampInRange(payload == null ? 0 : payload.height, DefaultScreenshotHeight, MinScreenshotDimension, MaxScreenshotDimension);
            var jpegQuality = ResolveEffectiveJpegQuality(payload == null ? 0 : payload.jpeg_quality, outputMode, imageFormat);
            var maxBase64Bytes = ResolveEffectiveMaxBase64Bytes(payload == null ? 0 : payload.max_base64_bytes);
            var isCompositeRequested = string.Equals(requestedCaptureMode, CaptureModeComposite, StringComparison.Ordinal);

            if (string.Equals(requestedCaptureMode, CaptureModeFinalPixels, StringComparison.Ordinal) ||
                string.Equals(requestedCaptureMode, CaptureModeEditorView, StringComparison.Ordinal))
            {
                return BuildCaptureSceneScreenshotFailure(
                    requestId,
                    "E_CAPTURE_MODE_DISABLED",
                    "capture_scene_screenshot currently supports capture_mode=render_output only.");
            }
            if (isCompositeRequested && !IsCompositeCaptureEnabled())
            {
                return BuildCaptureSceneScreenshotFailure(
                    requestId,
                    "E_CAPTURE_MODE_DISABLED",
                    "capture_mode=composite is disabled. Enable UNITY_CAPTURE_COMPOSITE_ENABLED and retry.");
            }

            var compositeLockHeld = false;
            if (isCompositeRequested)
            {
                if (!TryEnterCompositeCaptureLock())
                {
                    return BuildCaptureSceneScreenshotFailure(
                        requestId,
                        "E_COMPOSITE_BUSY",
                        "Another composite capture is already in progress.");
                }

                compositeLockHeld = true;
            }

            try
            {
                var effectiveCaptureMode = isCompositeRequested ? CaptureModeComposite : CaptureModeRenderOutput;
                var fallbackReason = string.Empty;
                var resolvedViewMode = requestedViewMode;
                var cameraPathHint = "Scene/Screenshot";
                var diagnostics = ScreenshotCaptureDiagnostics.Empty;
                var compositeDetails = CompositeCaptureDetails.Empty;
                byte[] bytes;
                string captureErrorCode;
                string captureError;
                var captureSucceeded = isCompositeRequested
                    ? TryCaptureComposite(
                        requestedViewMode,
                        width,
                        height,
                        imageFormat,
                        jpegQuality,
                        out bytes,
                        out resolvedViewMode,
                        out cameraPathHint,
                        out diagnostics,
                        out compositeDetails,
                        out captureErrorCode,
                        out captureError)
                    : TryCaptureViaCamera(
                        requestedViewMode,
                        width,
                        height,
                        imageFormat,
                        jpegQuality,
                        out bytes,
                        out resolvedViewMode,
                        out cameraPathHint,
                        out diagnostics,
                        out captureErrorCode,
                        out captureError);
                if (!captureSucceeded)
                {
                    return BuildCaptureSceneScreenshotFailure(
                        requestId,
                        isCompositeRequested
                            ? ResolveCompositeFailureCode(captureErrorCode, captureError)
                            : ResolveScreenshotFailureCode(captureError),
                        captureError);
                }

                if (isCompositeRequested)
                {
                    if (!string.IsNullOrWhiteSpace(compositeDetails.effective_capture_mode))
                    {
                        effectiveCaptureMode = compositeDetails.effective_capture_mode;
                    }
                    fallbackReason = AppendFallbackReason(fallbackReason, compositeDetails.fallback_reason);
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
                var effectiveOutputMode = outputMode;
                var imageBase64 = string.Empty;
                var artifactUri = string.Empty;
                var base64SizeExceeded = false;

                if (string.Equals(outputMode, "inline_base64", StringComparison.Ordinal))
                {
                    var encodedBase64 = Convert.ToBase64String(bytes);
                    var base64ByteCount = Encoding.UTF8.GetByteCount(encodedBase64);
                    if (maxBase64Bytes > 0 && base64ByteCount > maxBase64Bytes)
                    {
                        string artifactError;
                        artifactUri = TryWriteScreenshotArtifact(bytes, imageFormat, out artifactError);
                        if (string.IsNullOrEmpty(artifactUri))
                        {
                            return BuildCaptureSceneScreenshotFailure(
                                requestId,
                                "E_SCREENSHOT_CAPTURE_FAILED",
                                string.IsNullOrEmpty(artifactError) ? "Failed to persist screenshot artifact." : artifactError);
                        }

                        effectiveOutputMode = "artifact_uri";
                        fallbackReason = AppendFallbackReason(fallbackReason, "max_base64_bytes_exceeded");
                        base64SizeExceeded = true;
                    }
                    else
                    {
                        imageBase64 = encodedBase64;
                    }
                }
                else
                {
                    string artifactError;
                    artifactUri = TryWriteScreenshotArtifact(bytes, imageFormat, out artifactError);
                    if (string.IsNullOrEmpty(artifactUri))
                    {
                        return BuildCaptureSceneScreenshotFailure(
                            requestId,
                            "E_SCREENSHOT_CAPTURE_FAILED",
                            string.IsNullOrEmpty(artifactError) ? "Failed to persist screenshot artifact." : artifactError);
                    }
                }

                var visualEvidence = BuildVisualEvidence(
                    artifactUri,
                    bytes,
                    pixelSanity,
                    fallbackReason,
                    effectiveCaptureMode);
                var data = new UnityCaptureSceneScreenshotData
                {
                    requested_mode = requestedCaptureMode,
                    view_mode = resolvedViewMode,
                    effective_mode = effectiveCaptureMode,
                    capture_mode_effective = effectiveCaptureMode,
                    fallback_reason = fallbackReason,
                    output_mode = effectiveOutputMode,
                    image_format = imageFormat,
                    mime_type = ResolveCaptureMimeType(imageFormat),
                    width = capturedWidth,
                    height = capturedHeight,
                    byte_size = bytes.Length,
                    artifact_uri = artifactUri,
                    image_base64 = imageBase64,
                    visual_evidence = visualEvidence,
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
                    fallbackReason,
                    base64SizeExceeded,
                    isCompositeRequested &&
                    string.Equals(effectiveCaptureMode, CaptureModeComposite, StringComparison.Ordinal),
                    compositeDetails.play_mode_capture,
                    compositeDetails.editmode_temp_scene_capture,
                    compositeDetails.overlay_cloned,
                    compositeDetails.safety_stripped_component_count > 0,
                    isCompositeRequested &&
                    string.Equals(effectiveCaptureMode, CaptureModeRenderOutput, StringComparison.Ordinal));

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
            finally
            {
                if (compositeLockHeld)
                {
                    ExitCompositeCaptureLock();
                }
            }
        }

        private static int CompositeCaptureLockFlag;

        private static string ResolveEffectiveImageFormat(string rawImageFormat, string outputMode)
        {
            if (string.IsNullOrWhiteSpace(rawImageFormat) &&
                string.Equals(outputMode, "inline_base64", StringComparison.Ordinal))
            {
                return "jpg";
            }

            return NormalizeCaptureImageFormat(rawImageFormat);
        }

        private static int ResolveEffectiveJpegQuality(
            int requestedJpegQuality,
            string outputMode,
            string imageFormat)
        {
            if (requestedJpegQuality > 0)
            {
                return ClampInRange(requestedJpegQuality, DefaultScreenshotJpegQuality, 1, 100);
            }

            if (string.Equals(outputMode, "inline_base64", StringComparison.Ordinal) &&
                string.Equals(imageFormat, "jpg", StringComparison.Ordinal))
            {
                return DefaultInlineBase64JpegQuality;
            }

            return DefaultScreenshotJpegQuality;
        }

        private static int ResolveEffectiveMaxBase64Bytes(int requestedMaxBase64Bytes)
        {
            return ClampInRange(
                requestedMaxBase64Bytes,
                DefaultScreenshotMaxBase64Bytes,
                MinScreenshotMaxBase64Bytes,
                MaxScreenshotMaxBase64Bytes);
        }

        private static string AppendFallbackReason(string existing, string nextReason)
        {
            var current = string.IsNullOrWhiteSpace(existing) ? string.Empty : existing.Trim();
            var next = string.IsNullOrWhiteSpace(nextReason) ? string.Empty : nextReason.Trim();
            if (string.IsNullOrEmpty(next))
            {
                return current;
            }
            if (string.IsNullOrEmpty(current))
            {
                return next;
            }
            return current + ";" + next;
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
            out string errorCode,
            out string errorMessage)
        {
            bytes = null;
            resolvedViewMode = string.Empty;
            cameraPathHint = "Scene/Screenshot";
            diagnostics = ScreenshotCaptureDiagnostics.Empty;
            errorCode = string.Empty;
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

        private static bool TryCaptureComposite(
            string requestedViewMode,
            int width,
            int height,
            string imageFormat,
            int jpegQuality,
            out byte[] bytes,
            out string resolvedViewMode,
            out string cameraPathHint,
            out ScreenshotCaptureDiagnostics diagnostics,
            out CompositeCaptureDetails details,
            out string errorCode,
            out string errorMessage)
        {
            details = CompositeCaptureDetails.Empty;
            if (IsPlayingForCompositeCapture())
            {
                var playModeResult = TryCaptureCompositeViaPlayMode(
                    width,
                    height,
                    imageFormat,
                    jpegQuality,
                    out bytes,
                    out resolvedViewMode,
                    out cameraPathHint,
                    out diagnostics,
                    out errorCode,
                    out errorMessage);
                if (playModeResult)
                {
                    details = new CompositeCaptureDetails
                    {
                        effective_capture_mode = CaptureModeComposite,
                        fallback_reason = string.Empty,
                        play_mode_capture = true,
                        editmode_temp_scene_capture = false,
                        overlay_cloned = true,
                        safety_stripped_component_count = 0,
                    };
                }

                return playModeResult;
            }

            return TryCaptureCompositeViaEditMode(
                requestedViewMode,
                width,
                height,
                imageFormat,
                jpegQuality,
                out bytes,
                out resolvedViewMode,
                out cameraPathHint,
                out diagnostics,
                out details,
                out errorCode,
                out errorMessage);
        }

        private static bool TryCaptureCompositeViaPlayMode(
            int width,
            int height,
            string imageFormat,
            int jpegQuality,
            out byte[] bytes,
            out string resolvedViewMode,
            out string cameraPathHint,
            out ScreenshotCaptureDiagnostics diagnostics,
            out string errorCode,
            out string errorMessage)
        {
            bytes = null;
            resolvedViewMode = "game";
            cameraPathHint = "PlayMode/ScreenCapture";
            diagnostics = ScreenshotCaptureDiagnostics.Empty;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (!IsPlayingForCompositeCapture())
            {
                errorCode = "E_COMPOSITE_PLAYMODE_REQUIRED";
                errorMessage = "composite capture currently requires Play Mode.";
                return false;
            }

            Texture2D capturedTexture = null;
            Texture2D resizedTexture = null;
            RenderTexture resizeTarget = null;
            var previousActive = RenderTexture.active;
            try
            {
                capturedTexture = CaptureCompositeScreenshotTexture();
                if (capturedTexture == null)
                {
                    errorCode = "E_SCREENSHOT_CAPTURE_FAILED";
                    errorMessage = "Play Mode composite capture returned null texture.";
                    return false;
                }

                var normalizedWidth = ClampInRange(width, DefaultScreenshotWidth, MinScreenshotDimension, MaxScreenshotDimension);
                var normalizedHeight = ClampInRange(height, DefaultScreenshotHeight, MinScreenshotDimension, MaxScreenshotDimension);
                var normalizedJpegQuality = ClampInRange(jpegQuality, DefaultScreenshotJpegQuality, 1, 100);
                var normalizedFormat = NormalizeCaptureImageFormat(imageFormat);
                var encodeTexture = capturedTexture;
                if (capturedTexture.width != normalizedWidth || capturedTexture.height != normalizedHeight)
                {
                    resizeTarget = new RenderTexture(normalizedWidth, normalizedHeight, 0, RenderTextureFormat.ARGB32);
                    Graphics.Blit(capturedTexture, resizeTarget);
                    RenderTexture.active = resizeTarget;
                    resizedTexture = new Texture2D(normalizedWidth, normalizedHeight, TextureFormat.RGB24, false);
                    resizedTexture.ReadPixels(new Rect(0, 0, normalizedWidth, normalizedHeight), 0, 0);
                    resizedTexture.Apply(false, false);
                    encodeTexture = resizedTexture;
                }

                bytes = string.Equals(normalizedFormat, "jpg", StringComparison.Ordinal)
                    ? encodeTexture.EncodeToJPG(normalizedJpegQuality)
                    : encodeTexture.EncodeToPNG();
                if (bytes == null || bytes.Length == 0)
                {
                    errorCode = "E_SCREENSHOT_CAPTURE_FAILED";
                    errorMessage = "Composite screenshot capture produced empty bytes.";
                    return false;
                }

                diagnostics.read_rect_screen_px = new UnityScreenshotRect
                {
                    x = 0,
                    y = 0,
                    width = encodeTexture.width,
                    height = encodeTexture.height,
                };
                diagnostics.game_view_rect_screen_px = new UnityScreenshotRect
                {
                    x = 0,
                    y = 0,
                    width = encodeTexture.width,
                    height = encodeTexture.height,
                };
                diagnostics.pixel_sanity = ComputePixelSanity(encodeTexture.GetPixels());
                diagnostics.read_timing = "playmode_screen_capture";
                diagnostics.pixels_per_point = 1f;
                diagnostics.display_index = 0;
                diagnostics.include_gizmos_effective = false;
                diagnostics.camera_used = new UnityScreenshotCameraUsed
                {
                    path = "PlayMode/ScreenCapture",
                    instance_id = 0,
                    target_display = 0,
                    culling_mask = 0,
                    clear_flags = "ScreenCapture",
                    background_color = "#00000000",
                };
                return true;
            }
            catch (Exception ex)
            {
                errorCode = "E_SCREENSHOT_CAPTURE_FAILED";
                errorMessage = ex.Message;
                return false;
            }
            finally
            {
                RenderTexture.active = previousActive;
                if (resizedTexture != null)
                {
                    UnityEngine.Object.DestroyImmediate(resizedTexture);
                }
                if (resizeTarget != null)
                {
                    UnityEngine.Object.DestroyImmediate(resizeTarget);
                }
                if (capturedTexture != null)
                {
                    UnityEngine.Object.DestroyImmediate(capturedTexture);
                }
            }
        }

        private static bool TryCaptureCompositeViaEditMode(
            string requestedViewMode,
            int width,
            int height,
            string imageFormat,
            int jpegQuality,
            out byte[] bytes,
            out string resolvedViewMode,
            out string cameraPathHint,
            out ScreenshotCaptureDiagnostics diagnostics,
            out CompositeCaptureDetails details,
            out string errorCode,
            out string errorMessage)
        {
            bytes = null;
            resolvedViewMode = requestedViewMode;
            cameraPathHint = "Scene/Screenshot";
            diagnostics = ScreenshotCaptureDiagnostics.Empty;
            details = CompositeCaptureDetails.Empty;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            byte[] baseBytes;
            string baseErrorCode;
            string baseErrorMessage;
            ScreenshotCaptureDiagnostics baseDiagnostics;
            string baseResolvedViewMode;
            string baseCameraPathHint;
            var baseCaptured = TryCaptureViaCamera(
                requestedViewMode,
                width,
                height,
                imageFormat,
                jpegQuality,
                out baseBytes,
                out baseResolvedViewMode,
                out baseCameraPathHint,
                out baseDiagnostics,
                out baseErrorCode,
                out baseErrorMessage);
            if (!baseCaptured)
            {
                errorCode = string.IsNullOrWhiteSpace(baseErrorCode)
                    ? ResolveScreenshotFailureCode(baseErrorMessage)
                    : baseErrorCode;
                errorMessage = baseErrorMessage;
                return false;
            }

            resolvedViewMode = baseResolvedViewMode;
            cameraPathHint = string.IsNullOrWhiteSpace(baseCameraPathHint)
                ? "Scene/Screenshot|TempSceneOverlay"
                : baseCameraPathHint + "|TempSceneOverlay";
            diagnostics = baseDiagnostics;

            OverlayCompositeLayer layer;
            string overlayErrorCode;
            string overlayErrorMessage;
            var overlayCaptured = OverlayCompositeCaptureService.TryCaptureOverlayLayer(
                width,
                height,
                out layer,
                out overlayErrorCode,
                out overlayErrorMessage);
            if (!overlayCaptured)
            {
                if (!string.IsNullOrWhiteSpace(overlayErrorCode) || !string.IsNullOrWhiteSpace(overlayErrorMessage))
                {
                    Debug.LogWarning(
                        "[Codex][CompositeCapture][EditMode] overlay layer capture failed. " +
                        "code=" + overlayErrorCode + " message=" + overlayErrorMessage);
                }

                var overlayFallbackReason = "composite_overlay_capture_failed";
                if (string.Equals(overlayErrorCode, "E_COMPOSITE_CAPTURE_RESTRICTED", StringComparison.Ordinal))
                {
                    overlayFallbackReason = "composite_capture_restricted";
                }

                bytes = baseBytes;
                diagnostics.read_timing = "editmode_temp_scene_fallback";
                details = new CompositeCaptureDetails
                {
                    effective_capture_mode = CaptureModeRenderOutput,
                    fallback_reason = overlayFallbackReason,
                    play_mode_capture = false,
                    editmode_temp_scene_capture = true,
                    overlay_cloned = false,
                    safety_stripped_component_count = 0,
                };
                return true;
            }

            if (!layer.has_overlay_canvas || layer.pixels == null || layer.pixels.Length == 0)
            {
                bytes = baseBytes;
                diagnostics.read_timing = "editmode_temp_scene_fallback";
                details = new CompositeCaptureDetails
                {
                    effective_capture_mode = CaptureModeRenderOutput,
                    fallback_reason = "composite_overlay_absent",
                    play_mode_capture = false,
                    editmode_temp_scene_capture = true,
                    overlay_cloned = false,
                    safety_stripped_component_count = layer.sanitized_component_count,
                };
                return true;
            }

            byte[] compositedBytes;
            UnityScreenshotPixelSanity compositedPixelSanity;
            string composeErrorMessage;
            var composed = TryComposeOverlayWithBase(
                baseBytes,
                layer,
                imageFormat,
                jpegQuality,
                out compositedBytes,
                out compositedPixelSanity,
                out composeErrorMessage);
            if (!composed)
            {
                bytes = baseBytes;
                diagnostics.read_timing = "editmode_temp_scene_fallback";
                details = new CompositeCaptureDetails
                {
                    effective_capture_mode = CaptureModeRenderOutput,
                    fallback_reason = "composite_overlay_compose_failed",
                    play_mode_capture = false,
                    editmode_temp_scene_capture = true,
                    overlay_cloned = layer.overlay_canvas_count > 0,
                    safety_stripped_component_count = layer.sanitized_component_count,
                };
                return true;
            }

            bytes = compositedBytes;
            diagnostics.read_rect_screen_px = new UnityScreenshotRect
            {
                x = 0,
                y = 0,
                width = layer.width,
                height = layer.height,
            };
            diagnostics.game_view_rect_screen_px = new UnityScreenshotRect
            {
                x = 0,
                y = 0,
                width = layer.width,
                height = layer.height,
            };
            diagnostics.pixel_sanity = compositedPixelSanity;
            diagnostics.read_timing = "editmode_temp_scene_composite";

            details = new CompositeCaptureDetails
            {
                effective_capture_mode = CaptureModeComposite,
                fallback_reason = string.Empty,
                play_mode_capture = false,
                editmode_temp_scene_capture = true,
                overlay_cloned = layer.overlay_canvas_count > 0,
                safety_stripped_component_count = layer.sanitized_component_count,
            };
            return true;
        }

        private static bool TryComposeOverlayWithBase(
            byte[] baseBytes,
            OverlayCompositeLayer overlayLayer,
            string imageFormat,
            int jpegQuality,
            out byte[] compositedBytes,
            out UnityScreenshotPixelSanity pixelSanity,
            out string errorMessage)
        {
            compositedBytes = null;
            pixelSanity = null;
            errorMessage = string.Empty;
            if (baseBytes == null || baseBytes.Length == 0)
            {
                errorMessage = "Base render output bytes are empty.";
                return false;
            }

            if (overlayLayer.pixels == null || overlayLayer.pixels.Length == 0)
            {
                errorMessage = "Overlay layer pixels are empty.";
                return false;
            }

            Texture2D baseTexture = null;
            Texture2D compositedTexture = null;
            try
            {
                baseTexture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
                if (!baseTexture.LoadImage(baseBytes, false))
                {
                    errorMessage = "Failed to decode base render output for overlay composition.";
                    return false;
                }

                if (baseTexture.width != overlayLayer.width || baseTexture.height != overlayLayer.height)
                {
                    errorMessage = "Overlay and base capture resolutions differ.";
                    return false;
                }

                var basePixels = baseTexture.GetPixels32();
                if (basePixels == null || basePixels.Length != overlayLayer.pixels.Length)
                {
                    errorMessage = "Base and overlay pixel buffer size mismatch.";
                    return false;
                }

                var mergedPixels = new Color32[basePixels.Length];
                for (var i = 0; i < basePixels.Length; i++)
                {
                    var basePixel = basePixels[i];
                    var overlayPixel = overlayLayer.pixels[i];
                    var alpha = overlayPixel.a / 255f;
                    if (alpha <= 0f)
                    {
                        mergedPixels[i] = basePixel;
                        continue;
                    }

                    mergedPixels[i] = new Color32
                    {
                        r = (byte)(basePixel.r + ((overlayPixel.r - basePixel.r) * alpha)),
                        g = (byte)(basePixel.g + ((overlayPixel.g - basePixel.g) * alpha)),
                        b = (byte)(basePixel.b + ((overlayPixel.b - basePixel.b) * alpha)),
                        a = 255,
                    };
                }

                compositedTexture = new Texture2D(
                    overlayLayer.width,
                    overlayLayer.height,
                    TextureFormat.RGB24,
                    false);
                compositedTexture.SetPixels32(mergedPixels);
                compositedTexture.Apply(false, false);

                var normalizedJpegQuality = ClampInRange(jpegQuality, DefaultScreenshotJpegQuality, 1, 100);
                var normalizedFormat = NormalizeCaptureImageFormat(imageFormat);
                compositedBytes = string.Equals(normalizedFormat, "jpg", StringComparison.Ordinal)
                    ? compositedTexture.EncodeToJPG(normalizedJpegQuality)
                    : compositedTexture.EncodeToPNG();
                pixelSanity = ComputePixelSanity(compositedTexture.GetPixels());
                return compositedBytes != null && compositedBytes.Length > 0;
            }
            catch (Exception ex)
            {
                errorMessage = ex.Message;
                return false;
            }
            finally
            {
                if (compositedTexture != null)
                {
                    UnityEngine.Object.DestroyImmediate(compositedTexture);
                }
                if (baseTexture != null)
                {
                    UnityEngine.Object.DestroyImmediate(baseTexture);
                }
            }
        }

        private static Texture2D CaptureCompositeScreenshotTexture()
        {
            if (CompositeCaptureTextureProviderForTests != null)
            {
                return CompositeCaptureTextureProviderForTests();
            }

            return ScreenCapture.CaptureScreenshotAsTexture();
        }

        private static bool IsCompositeCaptureEnabled()
        {
            if (CompositeCaptureEnabledOverrideForTests.HasValue)
            {
                return CompositeCaptureEnabledOverrideForTests.Value;
            }

            var raw = Environment.GetEnvironmentVariable(CompositeCaptureEnabledEnvName);
            if (string.IsNullOrWhiteSpace(raw))
            {
                return false;
            }

            var normalized = raw.Trim().ToLowerInvariant();
            return string.Equals(normalized, "1", StringComparison.Ordinal) ||
                   string.Equals(normalized, "true", StringComparison.Ordinal) ||
                   string.Equals(normalized, "yes", StringComparison.Ordinal) ||
                   string.Equals(normalized, "on", StringComparison.Ordinal);
        }

        private static bool TryEnterCompositeCaptureLock()
        {
            if (CompositeCaptureBusyOverrideForTests.HasValue)
            {
                return !CompositeCaptureBusyOverrideForTests.Value;
            }

            return Interlocked.CompareExchange(ref CompositeCaptureLockFlag, 1, 0) == 0;
        }

        private static void ExitCompositeCaptureLock()
        {
            if (CompositeCaptureBusyOverrideForTests.HasValue)
            {
                return;
            }

            Interlocked.Exchange(ref CompositeCaptureLockFlag, 0);
        }

        private static bool IsPlayingForCompositeCapture()
        {
            if (CompositeCaptureIsPlayingOverrideForTests.HasValue)
            {
                return CompositeCaptureIsPlayingOverrideForTests.Value;
            }

            return EditorApplication.isPlaying;
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
            string fallbackReason,
            bool base64SizeExceeded,
            bool compositeRender,
            bool playModeCapture,
            bool editModeTempSceneCapture,
            bool overlayCloned,
            bool safetyStripped,
            bool compositeFallbackToRenderOutput)
        {
            var tags = new List<string>(12);
            if (!string.IsNullOrEmpty(fallbackReason))
            {
                tags.Add("FALLBACK");
            }
            if (base64SizeExceeded)
            {
                tags.Add("BASE64_SIZE_EXCEEDED");
            }
            if (pixelSanity != null && pixelSanity.is_all_black)
            {
                tags.Add("ALL_BLACK");
            }
            if (IsRectOutside(readRect, gameViewRect))
            {
                tags.Add("RECT_OUTSIDE");
            }
            if (compositeRender)
            {
                tags.Add("COMPOSITE_RENDER");
            }
            if (playModeCapture)
            {
                tags.Add("PLAYMODE_CAPTURE");
            }
            if (editModeTempSceneCapture)
            {
                tags.Add("EDITMODE_TEMP_SCENE");
            }
            if (overlayCloned)
            {
                tags.Add("OVERLAY_CLONED");
            }
            if (safetyStripped)
            {
                tags.Add("COMPOSITE_SANITIZED");
            }
            if (compositeFallbackToRenderOutput)
            {
                tags.Add("COMPOSITE_FALLBACK_RENDER_OUTPUT");
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

        private static string ResolveCompositeFailureCode(string errorCode, string errorMessage)
        {
            if (!string.IsNullOrWhiteSpace(errorCode))
            {
                return errorCode.Trim().ToUpperInvariant();
            }

            if (!string.IsNullOrWhiteSpace(errorMessage) &&
                errorMessage.IndexOf("requires Play Mode", StringComparison.OrdinalIgnoreCase) >= 0)
            {
                return "E_COMPOSITE_PLAYMODE_REQUIRED";
            }

            return "E_SCREENSHOT_CAPTURE_FAILED";
        }

        private static UnityScreenshotVisualEvidence BuildVisualEvidence(
            string artifactUri,
            byte[] bytes,
            UnityScreenshotPixelSanity pixelSanity,
            string fallbackReason,
            string effectiveMode)
        {
            return new UnityScreenshotVisualEvidence
            {
                artifact_uri = string.IsNullOrWhiteSpace(artifactUri) ? string.Empty : artifactUri.Trim(),
                pixel_hash = ComputeSha256Hex(bytes),
                diff_summary = BuildVisualEvidenceDiffSummary(pixelSanity, fallbackReason, effectiveMode),
            };
        }

        private static string BuildVisualEvidenceDiffSummary(
            UnityScreenshotPixelSanity pixelSanity,
            string fallbackReason,
            string effectiveMode)
        {
            var tags = new List<string>(4);
            tags.Add(string.IsNullOrWhiteSpace(effectiveMode) ? "mode:render_output" : "mode:" + effectiveMode.Trim());
            if (!string.IsNullOrWhiteSpace(fallbackReason))
            {
                tags.Add("fallback:" + fallbackReason.Trim());
            }
            if (pixelSanity != null && pixelSanity.is_all_black)
            {
                tags.Add("pixel_sanity:all_black");
            }
            else if (pixelSanity != null)
            {
                tags.Add("pixel_sanity:ok");
            }

            return string.Join("; ", tags.ToArray());
        }

        private static string ComputeSha256Hex(byte[] bytes)
        {
            if (bytes == null || bytes.Length <= 0)
            {
                return string.Empty;
            }

            try
            {
                using (var sha256 = SHA256.Create())
                {
                    var hash = sha256.ComputeHash(bytes);
                    var builder = new StringBuilder(hash.Length * 2);
                    for (var i = 0; i < hash.Length; i++)
                    {
                        builder.Append(hash[i].ToString("x2"));
                    }
                    return builder.ToString();
                }
            }
            catch
            {
                return string.Empty;
            }
        }

        private struct OverlayCompositeLayer
        {
            public bool has_overlay_canvas;
            public int width;
            public int height;
            public Color32[] pixels;
            public int overlay_canvas_count;
            public int sanitized_component_count;
            public int blocked_component_count;

            public static OverlayCompositeLayer Empty
            {
                get
                {
                    return new OverlayCompositeLayer
                    {
                        has_overlay_canvas = false,
                        width = 0,
                        height = 0,
                        pixels = null,
                        overlay_canvas_count = 0,
                        sanitized_component_count = 0,
                        blocked_component_count = 0,
                    };
                }
            }
        }

        private struct CompositeCaptureDetails
        {
            public string effective_capture_mode;
            public string fallback_reason;
            public bool play_mode_capture;
            public bool editmode_temp_scene_capture;
            public bool overlay_cloned;
            public int safety_stripped_component_count;

            public static CompositeCaptureDetails Empty
            {
                get
                {
                    return new CompositeCaptureDetails
                    {
                        effective_capture_mode = CaptureModeComposite,
                        fallback_reason = string.Empty,
                        play_mode_capture = false,
                        editmode_temp_scene_capture = false,
                        overlay_cloned = false,
                        safety_stripped_component_count = 0,
                    };
                }
            }
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

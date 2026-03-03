using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Reflection;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.UiValidation;
using UnityEditor;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.SceneManagement;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        private const string MissingScriptShortName = "MissingScript";
        private const string MissingScriptAssemblyQualifiedName = "UnityEditor.MissingScript";
        private const int DefaultLimit = 200;
        private const int DefaultNodeBudget = 512;
        private const int DefaultCharBudget = 64000;
        private const int DefaultScreenshotWidth = 1280;
        private const int DefaultScreenshotHeight = 720;
        private const int DefaultScreenshotJpegQuality = 85;
        private const int DefaultInlineBase64JpegQuality = 75;
        private const int DefaultScreenshotMaxBase64Bytes = 2 * 1024 * 1024;
        private const int MinScreenshotMaxBase64Bytes = 1;
        private const int MaxScreenshotMaxBase64Bytes = 10 * 1024 * 1024;
        private const int MinScreenshotDimension = 64;
        private const int MaxScreenshotDimension = 4096;
        private const int ScreenshotArtifactMaxAgeHours = 24;
        private const int ScreenshotArtifactMaxFiles = 120;
        private const int ReadTokenHardMaxAgeMs = 3 * 60 * 1000;
        private const int DefaultUiTreeMaxDepth = 6;
        private const int MaxUiTreeDepth = 16;
        private const int DefaultHitTestMaxResults = 5;
        private const int MaxHitTestResults = 32;
        private const int DefaultValidateTimeBudgetMs = 1200;
        private const int DefaultValidateMaxIssues = 200;
        private const string CaptureModeRenderOutput = "render_output";
        private const string CaptureModeComposite = "composite";
        private const string CaptureModeFinalPixels = "final_pixels";
        private const string CaptureModeEditorView = "editor_view";
        private const string CompositeCaptureEnabledEnvName = "UNITY_CAPTURE_COMPOSITE_ENABLED";

        internal static bool? CompositeCaptureEnabledOverrideForTests;
        internal static bool? CompositeCaptureIsPlayingOverrideForTests;
        internal static bool? CompositeCaptureBusyOverrideForTests;
        internal static Func<Texture2D> CompositeCaptureTextureProviderForTests;

        private static readonly HashSet<string> UiComponentTypeAllowList =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "Canvas",
                "CanvasScaler",
                "GraphicRaycaster",
                "CanvasGroup",
                "Image",
                "RawImage",
                "Text",
                "TextMeshProUGUI",
                "TMP_Text",
                "Button",
                "Toggle",
                "Slider",
                "Scrollbar",
                "Dropdown",
                "TMP_Dropdown",
                "InputField",
                "TMP_InputField",
                "ScrollRect",
                "Mask",
                "RectMask2D",
                "HorizontalLayoutGroup",
                "VerticalLayoutGroup",
                "GridLayoutGroup",
                "ContentSizeFitter",
                "LayoutElement",
            };

        private static UnityListAssetsInFolderResponse BuildListAssetsFailure(string requestId, string errorCode, string errorMessage)
        {
            return Read.ReadErrorMapper.BuildListAssetsFailure(requestId, errorCode, errorMessage);
        }

        private static UnityGetSceneRootsResponse BuildGetSceneRootsFailure(string requestId, string errorCode, string errorMessage)
        {
            return Read.ReadErrorMapper.BuildGetSceneRootsFailure(requestId, errorCode, errorMessage);
        }

        private static UnityFindObjectsByComponentResponse BuildFindObjectsFailure(string requestId, string errorCode, string errorMessage)
        {
            return Read.ReadErrorMapper.BuildFindObjectsFailure(requestId, errorCode, errorMessage);
        }

        private static UnityQueryPrefabInfoResponse BuildQueryPrefabFailure(string requestId, string errorCode, string errorMessage)
        {
            return Read.ReadErrorMapper.BuildQueryPrefabFailure(requestId, errorCode, errorMessage);
        }

        private static UnityGetUiTreeResponse BuildGetUiTreeFailure(string requestId, string errorCode, string errorMessage)
        {
            return Read.ReadErrorMapper.BuildGetUiTreeFailure(requestId, errorCode, errorMessage);
        }

        private static UnityGetUiOverlayReportResponse BuildGetUiOverlayReportFailure(string requestId, string errorCode, string errorMessage)
        {
            return Read.ReadErrorMapper.BuildGetUiOverlayReportFailure(requestId, errorCode, errorMessage);
        }

        private static UnityGetSerializedPropertyTreeResponse BuildGetSerializedPropertyTreeFailure(
            string requestId,
            string errorCode,
            string errorMessage)
        {
            return Read.ReadErrorMapper.BuildGetSerializedPropertyTreeFailure(
                requestId,
                errorCode,
                errorMessage);
        }

        private static UnityCaptureSceneScreenshotResponse BuildCaptureSceneScreenshotFailure(string requestId, string errorCode, string errorMessage)
        {
            return Read.ReadErrorMapper.BuildCaptureSceneScreenshotFailure(requestId, errorCode, errorMessage);
        }

        private static UnityHitTestUiAtScreenPointResponse BuildHitTestFailure(string requestId, string errorCode, string errorMessage)
        {
            return Read.ReadErrorMapper.BuildHitTestFailure(requestId, errorCode, errorMessage);
        }

        private static UnityHitTestUiAtViewportPointResponse BuildHitTestViewportFailure(
            string requestId,
            string errorCode,
            string errorMessage)
        {
            return Read.ReadErrorMapper.BuildHitTestViewportFailure(requestId, errorCode, errorMessage);
        }

        private static UnityValidateUiLayoutResponse BuildValidateUiLayoutFailure(
            string requestId,
            string errorCode,
            string errorMessage)
        {
            return Read.ReadErrorMapper.BuildValidateUiLayoutFailure(requestId, errorCode, errorMessage);
        }
    }
}


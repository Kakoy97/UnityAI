using System;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Read
{
    internal static class ReadErrorMapper
    {
        private const int MaxReadErrorMessageLength = 320;

        internal static UnityListAssetsInFolderResponse BuildListAssetsFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityListAssetsInFolderResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityGetSceneRootsResponse BuildGetSceneRootsFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityGetSceneRootsResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityFindObjectsByComponentResponse BuildFindObjectsFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityFindObjectsByComponentResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityQueryPrefabInfoResponse BuildQueryPrefabFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityQueryPrefabInfoResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityGetUiTreeResponse BuildGetUiTreeFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityGetUiTreeResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityGetSerializedPropertyTreeResponse BuildGetSerializedPropertyTreeFailure(
            string requestId,
            string errorCode,
            string errorMessage)
        {
            return new UnityGetSerializedPropertyTreeResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityCaptureSceneScreenshotResponse BuildCaptureSceneScreenshotFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityCaptureSceneScreenshotResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityHitTestUiAtScreenPointResponse BuildHitTestFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityHitTestUiAtScreenPointResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityHitTestUiAtViewportPointResponse BuildHitTestViewportFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityHitTestUiAtViewportPointResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        internal static UnityValidateUiLayoutResponse BuildValidateUiLayoutFailure(string requestId, string errorCode, string errorMessage)
        {
            return new UnityValidateUiLayoutResponse
            {
                ok = false,
                request_id = NormalizeRequestId(requestId),
                captured_at = NowIso(),
                error_code = NormalizeReadErrorCode(errorCode),
                error_message = NormalizeReadErrorMessage(errorMessage),
                read_token = null,
                data = null,
            };
        }

        private static string NormalizeRequestId(string requestId)
        {
            return string.IsNullOrWhiteSpace(requestId) ? string.Empty : requestId.Trim();
        }

        private static string NormalizeReadErrorCode(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value)
                ? string.Empty
                : value.Trim().ToUpperInvariant();

            return string.IsNullOrEmpty(normalized)
                ? "E_QUERY_HANDLER_FAILED"
                : normalized;
        }

        private static string NormalizeReadErrorMessage(string value)
        {
            var normalized = string.IsNullOrWhiteSpace(value)
                ? string.Empty
                : value.Trim();
            if (string.IsNullOrEmpty(normalized))
            {
                return "Read query failed.";
            }

            var lines = normalized.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var singleLine = lines.Length > 0 ? lines[0].Trim() : normalized;
            if (singleLine.Length <= MaxReadErrorMessageLength)
            {
                return singleLine;
            }

            return singleLine.Substring(0, MaxReadErrorMessageLength).TrimEnd();
        }

        private static string NowIso()
        {
            return DateTime.UtcNow.ToString("o");
        }
    }
}

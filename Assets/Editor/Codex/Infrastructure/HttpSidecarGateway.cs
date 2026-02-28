using System;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Ports;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class HttpSidecarGateway : ISidecarGateway
    {
        private const int MaxTransportErrorMessageLength = 320;
        private static readonly HttpClient HttpClient = CreateHttpClient();

        public Task<GatewayResponse<HealthResponse>> GetHealthAsync(string baseUrl)
        {
            return SendAsync<HealthResponse>(HttpMethod.Get, baseUrl, "/health", null);
        }

        public Task<GatewayResponse<SidecarStateSnapshotResponse>> GetStateSnapshotAsync(string baseUrl)
        {
            return SendAsync<SidecarStateSnapshotResponse>(HttpMethod.Get, baseUrl, "/state/snapshot", null);
        }

        public Task<GatewayResponse<FilesChangedEnvelopeResponse>> ApplyFileActionsAsync(string baseUrl, FileActionsApplyRequest request)
        {
            return SendAsync<FilesChangedEnvelopeResponse>(HttpMethod.Post, baseUrl, "/file-actions/apply", request);
        }

        public Task<GatewayResponse<UnitySelectionSnapshotResponse>> ReportSelectionSnapshotAsync(string baseUrl, UnitySelectionSnapshotRequest request)
        {
            return SendAsync<UnitySelectionSnapshotResponse>(HttpMethod.Post, baseUrl, "/unity/selection/snapshot", request);
        }

        public Task<GatewayResponse<UnityConsoleSnapshotResponse>> ReportConsoleSnapshotAsync(string baseUrl, UnityConsoleSnapshotRequest request)
        {
            return SendAsync<UnityConsoleSnapshotResponse>(HttpMethod.Post, baseUrl, "/unity/console/snapshot", request);
        }

        public Task<GatewayResponse<UnityRuntimePingResponse>> ReportRuntimePingAsync(string baseUrl, UnityRuntimePingRequest request)
        {
            return SendAsync<UnityRuntimePingResponse>(HttpMethod.Post, baseUrl, "/unity/runtime/ping", request);
        }

        public Task<GatewayResponse<UnityCompileReportResponse>> ReportCompileResultAsync(string baseUrl, UnityCompileResultRequest request)
        {
            var normalized = NormalizeUnityCompileResultRequest(request);
            return SendAsync<UnityCompileReportResponse>(HttpMethod.Post, baseUrl, "/unity/compile/result", normalized);
        }

        public Task<GatewayResponse<UnityActionReportResponse>> ReportUnityActionResultAsync(string baseUrl, UnityActionResultRequest request)
        {
            var normalized = NormalizeUnityActionResultRequest(request);
            return SendAsync<UnityActionReportResponse>(HttpMethod.Post, baseUrl, "/unity/action/result", normalized);
        }

        public Task<GatewayResponse<UnityQueryComponentsReportResponse>> ReportUnityComponentsQueryResultAsync(string baseUrl, UnityQueryComponentsResultRequest request)
        {
            var normalized = NormalizeUnityQueryComponentsResultRequest(request);
            return SendAsync<UnityQueryComponentsReportResponse>(HttpMethod.Post, baseUrl, "/unity/query/components/result", normalized);
        }

        public Task<GatewayResponse<UnityQueryPullResponse>> PullQueriesAsync(string baseUrl)
        {
            return SendAsync<UnityQueryPullResponse>(
                HttpMethod.Post,
                baseUrl,
                "/unity/query/pull",
                new UnityQueryPullRequest());
        }

        public Task<GatewayResponse<UnityQueryReportResponse>> ReportQueryResultAsync(string baseUrl, string queryId, object payload)
        {
            var normalizedQueryId = string.IsNullOrEmpty(queryId) ? string.Empty : queryId.Trim();
            var payloadJson = "{}";
            if (payload is string)
            {
                payloadJson = string.IsNullOrEmpty((string)payload) ? "{}" : (string)payload;
            }
            else if (payload != null)
            {
                payloadJson = JsonUtility.ToJson(payload);
                if (string.IsNullOrEmpty(payloadJson))
                {
                    payloadJson = "{}";
                }
            }

            var requestJson = "{\"query_id\":\"" + EscapeJson(normalizedQueryId) + "\",\"result\":" + payloadJson + "}";
            return SendRawAsync<UnityQueryReportResponse>(
                HttpMethod.Post,
                baseUrl,
                "/unity/query/report",
                requestJson);
        }

        private static async Task<GatewayResponse<T>> SendAsync<T>(HttpMethod method, string baseUrl, string path, object payload)
            where T : class
        {
            var response = new GatewayResponse<T>();
            var requestUrl = BuildUrl(baseUrl, path);

            try
            {
                using (var request = new HttpRequestMessage(method, requestUrl))
                {
                    if (payload != null)
                    {
                        var json = JsonUtility.ToJson(payload);
                        request.Content = new StringContent(json, Encoding.UTF8, "application/json");
                    }

                    using (var httpResponse = await HttpClient.SendAsync(request))
                    {
                        response.TransportSuccess = true;
                        response.StatusCode = (int)httpResponse.StatusCode;
                        response.RawBody = await httpResponse.Content.ReadAsStringAsync();
                        response.ErrorMessage = string.Empty;
                        response.Data = TryParseJson<T>(response.RawBody);
                        response.Error = TryParseJson<ErrorResponse>(response.RawBody);
                        return response;
                    }
                }
            }
            catch (Exception ex)
            {
                response.TransportSuccess = false;
                response.StatusCode = 0;
                response.RawBody = string.Empty;
                response.ErrorMessage = NormalizeTransportErrorMessage(ex == null ? string.Empty : ex.Message);
                response.Data = null;
                response.Error = null;
                return response;
            }
        }

        private static async Task<GatewayResponse<T>> SendRawAsync<T>(HttpMethod method, string baseUrl, string path, string rawJson)
            where T : class
        {
            var response = new GatewayResponse<T>();
            var requestUrl = BuildUrl(baseUrl, path);

            try
            {
                using (var request = new HttpRequestMessage(method, requestUrl))
                {
                    var json = string.IsNullOrEmpty(rawJson) ? "{}" : rawJson;
                    request.Content = new StringContent(json, Encoding.UTF8, "application/json");

                    using (var httpResponse = await HttpClient.SendAsync(request))
                    {
                        response.TransportSuccess = true;
                        response.StatusCode = (int)httpResponse.StatusCode;
                        response.RawBody = await httpResponse.Content.ReadAsStringAsync();
                        response.ErrorMessage = string.Empty;
                        response.Data = TryParseJson<T>(response.RawBody);
                        response.Error = TryParseJson<ErrorResponse>(response.RawBody);
                        return response;
                    }
                }
            }
            catch (Exception ex)
            {
                response.TransportSuccess = false;
                response.StatusCode = 0;
                response.RawBody = string.Empty;
                response.ErrorMessage = NormalizeTransportErrorMessage(ex == null ? string.Empty : ex.Message);
                response.Data = null;
                response.Error = null;
                return response;
            }
        }

        private static string BuildUrl(string baseUrl, string path)
        {
            var normalizedBase = string.IsNullOrEmpty(baseUrl) ? string.Empty : baseUrl.TrimEnd('/');
            var normalizedPath = path.StartsWith("/") ? path : "/" + path;
            return normalizedBase + normalizedPath;
        }

        private static UnityCompileResultRequest NormalizeUnityCompileResultRequest(UnityCompileResultRequest request)
        {
            if (request == null)
            {
                request = new UnityCompileResultRequest();
            }

            if (request.payload == null)
            {
                request.payload = new UnityCompileResultPayload();
            }

            if (request.payload.errors == null)
            {
                request.payload.errors = Array.Empty<UnityCompileErrorItem>();
            }

            for (var i = 0; i < request.payload.errors.Length; i++)
            {
                var item = request.payload.errors[i];
                if (item == null)
                {
                    request.payload.errors[i] = new UnityCompileErrorItem
                    {
                        code = "UNKNOWN",
                        file = string.Empty,
                        line = 1,
                        column = 1,
                        message = "Compilation failed."
                    };
                    continue;
                }

                item.code = NormalizeErrorCode(item.code, "UNKNOWN");
                item.message = NormalizeErrorMessage(item.message, "Compilation failed.");
                item.file = string.IsNullOrWhiteSpace(item.file) ? string.Empty : item.file.Trim();
                item.line = item.line > 0 ? item.line : 1;
                item.column = item.column > 0 ? item.column : 1;
            }

            return request;
        }

        private static UnityQueryComponentsResultRequest NormalizeUnityQueryComponentsResultRequest(UnityQueryComponentsResultRequest request)
        {
            if (request == null)
            {
                request = new UnityQueryComponentsResultRequest();
            }

            if (request.payload == null)
            {
                request.payload = new UnityQueryComponentsResultPayload();
            }

            request.payload.query_id = string.IsNullOrWhiteSpace(request.payload.query_id)
                ? string.Empty
                : request.payload.query_id.Trim();
            request.payload.target_path = string.IsNullOrWhiteSpace(request.payload.target_path)
                ? string.Empty
                : request.payload.target_path.Trim();

            var hasErrorCode = !string.IsNullOrWhiteSpace(request.payload.error_code);
            if (hasErrorCode)
            {
                request.payload.error_code = NormalizeErrorCode(request.payload.error_code, "E_QUERY_HANDLER_FAILED");
                request.payload.error_message = NormalizeErrorMessage(
                    request.payload.error_message,
                    "Unity query execution failed.");
            }
            else
            {
                request.payload.error_code = string.Empty;
                request.payload.error_message = string.Empty;
            }

            if (request.payload.components == null)
            {
                request.payload.components = Array.Empty<UnityComponentDescriptor>();
            }

            return request;
        }

        private static UnityActionResultRequest NormalizeUnityActionResultRequest(UnityActionResultRequest request)
        {
            if (request == null)
            {
                request = new UnityActionResultRequest();
            }

            if (request.payload == null)
            {
                request.payload = new UnityActionResultPayload();
            }

            request.payload.action_type = string.IsNullOrWhiteSpace(request.payload.action_type)
                ? string.Empty
                : request.payload.action_type.Trim();
            request.payload.target_object_path = string.IsNullOrWhiteSpace(request.payload.target_object_path)
                ? string.Empty
                : request.payload.target_object_path.Trim();
            request.payload.target_object_id = string.IsNullOrWhiteSpace(request.payload.target_object_id)
                ? string.Empty
                : request.payload.target_object_id.Trim();
            request.payload.object_id = request.payload.target_object_id;
            request.payload.target = !string.IsNullOrWhiteSpace(request.payload.target_object_path)
                ? request.payload.target_object_path
                : request.payload.target_object_id;
            request.payload.parent_object_path = string.IsNullOrWhiteSpace(request.payload.parent_object_path)
                ? string.Empty
                : request.payload.parent_object_path.Trim();
            request.payload.parent_object_id = string.IsNullOrWhiteSpace(request.payload.parent_object_id)
                ? string.Empty
                : request.payload.parent_object_id.Trim();
            request.payload.created_object_path = string.IsNullOrWhiteSpace(request.payload.created_object_path)
                ? string.Empty
                : request.payload.created_object_path.Trim();
            request.payload.created_object_id = string.IsNullOrWhiteSpace(request.payload.created_object_id)
                ? string.Empty
                : request.payload.created_object_id.Trim();

            if (request.payload.success)
            {
                request.payload.error_code = string.Empty;
                request.payload.error_message = string.Empty;
                return request;
            }

            var normalizedCode = NormalizeActionErrorCode(request.payload.error_code);
            request.payload.error_code = normalizedCode;
            request.payload.error_message =
                NormalizeActionErrorMessage(normalizedCode, request.payload.error_message);
            return request;
        }

        private static string NormalizeActionErrorCode(string errorCode)
        {
            var normalized = NormalizeErrorCode(errorCode, string.Empty);
            if (string.IsNullOrEmpty(normalized))
            {
                return "E_ACTION_EXECUTION_FAILED";
            }

            if (string.Equals(normalized, "E_SCHEMA_INVALID", StringComparison.Ordinal))
            {
                return "E_ACTION_SCHEMA_INVALID";
            }

            if (string.Equals(normalized, "E_ACTION_SCHEMA_INVALID", StringComparison.Ordinal))
            {
                return normalized;
            }

            if (string.Equals(normalized, "E_TARGET_ANCHOR_CONFLICT", StringComparison.Ordinal))
            {
                return normalized;
            }

            return normalized;
        }

        private static string NormalizeActionErrorMessage(string errorCode, string errorMessage)
        {
            var normalizedInput = NormalizeErrorMessage(errorMessage, string.Empty);

            if (!string.IsNullOrEmpty(normalizedInput))
            {
                return normalizedInput;
            }

            if (string.Equals(errorCode, "E_ACTION_SCHEMA_INVALID", StringComparison.Ordinal))
            {
                return "Visual action payload schema validation failed.";
            }

            if (string.Equals(errorCode, "E_TARGET_ANCHOR_CONFLICT", StringComparison.Ordinal))
            {
                return "Target anchor conflict: object_id and path resolve to different objects.";
            }

            return "Visual action execution failed.";
        }

        private static string NormalizeTransportErrorMessage(string message)
        {
            return NormalizeErrorMessage(message, "Transport error");
        }

        private static string NormalizeErrorCode(string code, string fallback)
        {
            var normalized = string.IsNullOrWhiteSpace(code) ? string.Empty : code.Trim().ToUpperInvariant();
            return string.IsNullOrEmpty(normalized) ? fallback : normalized;
        }

        private static string NormalizeErrorMessage(string message, string fallback)
        {
            var trimmed = string.IsNullOrWhiteSpace(message) ? string.Empty : message.Trim();
            if (string.IsNullOrEmpty(trimmed))
            {
                return fallback;
            }

            var firstLine = trimmed.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var singleLine = firstLine.Length > 0 ? firstLine[0].Trim() : trimmed;
            if (singleLine.Length > MaxTransportErrorMessageLength)
            {
                return singleLine.Substring(0, MaxTransportErrorMessageLength).TrimEnd();
            }
            return singleLine;
        }

        private static T TryParseJson<T>(string json) where T : class
        {
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }

            try
            {
                return JsonUtility.FromJson<T>(json);
            }
            catch
            {
                return null;
            }
        }

        private static string EscapeJson(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static HttpClient CreateHttpClient()
        {
            var client = new HttpClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            return client;
        }
    }
}

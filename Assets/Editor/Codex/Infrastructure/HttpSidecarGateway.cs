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
        private static readonly HttpClient HttpClient = CreateHttpClient();

        public Task<GatewayResponse<SessionStartResponse>> StartSessionAsync(string baseUrl, SessionStartRequest request)
        {
            return SendAsync<SessionStartResponse>(HttpMethod.Post, baseUrl, "/session/start", request);
        }

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

        public Task<GatewayResponse<UnityRuntimePingResponse>> ReportRuntimePingAsync(string baseUrl, UnityRuntimePingRequest request)
        {
            return SendAsync<UnityRuntimePingResponse>(HttpMethod.Post, baseUrl, "/unity/runtime/ping", request);
        }

        public Task<GatewayResponse<UnityCompileReportResponse>> ReportCompileResultAsync(string baseUrl, UnityCompileResultRequest request)
        {
            return SendAsync<UnityCompileReportResponse>(HttpMethod.Post, baseUrl, "/unity/compile/result", request);
        }

        public Task<GatewayResponse<UnityActionReportResponse>> ReportUnityActionResultAsync(string baseUrl, UnityActionResultRequest request)
        {
            return SendAsync<UnityActionReportResponse>(HttpMethod.Post, baseUrl, "/unity/action/result", request);
        }

        public Task<GatewayResponse<UnityQueryComponentsReportResponse>> ReportUnityComponentsQueryResultAsync(string baseUrl, UnityQueryComponentsResultRequest request)
        {
            return SendAsync<UnityQueryComponentsReportResponse>(HttpMethod.Post, baseUrl, "/unity/query/components/result", request);
        }

        public Task<GatewayResponse<TurnStatusResponse>> SendTurnAsync(string baseUrl, TurnSendRequest request)
        {
            return SendAsync<TurnStatusResponse>(HttpMethod.Post, baseUrl, "/turn/send", request);
        }

        public Task<GatewayResponse<TurnStatusResponse>> GetTurnStatusAsync(string baseUrl, string requestId, int eventCursor)
        {
            var path =
                "/turn/status?request_id=" + Uri.EscapeDataString(requestId) +
                "&cursor=" + Uri.EscapeDataString(eventCursor.ToString());
            return SendAsync<TurnStatusResponse>(HttpMethod.Get, baseUrl, path, null);
        }

        public Task<GatewayResponse<TurnStatusResponse>> CancelTurnAsync(string baseUrl, TurnCancelRequest request)
        {
            return SendAsync<TurnStatusResponse>(HttpMethod.Post, baseUrl, "/turn/cancel", request);
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
                response.ErrorMessage = ex.Message;
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

        private static HttpClient CreateHttpClient()
        {
            var client = new HttpClient();
            client.Timeout = TimeSpan.FromSeconds(10);
            return client;
        }
    }
}

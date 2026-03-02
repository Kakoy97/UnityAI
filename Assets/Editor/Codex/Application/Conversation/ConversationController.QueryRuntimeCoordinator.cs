using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.Queries;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Application
{
    public sealed partial class ConversationController
    {
        private async Task SendRuntimePingCoreAsync()
        {
            await SendRuntimePingInternalAsync("just_recompiled", true);
        }

        private async Task PollRagQueriesCoreAsync(double now)
        {
            if (_ragQueryPollInFlight)
            {
                return;
            }

            if (_lastRagQueryPollAt > 0d && now - _lastRagQueryPollAt < PollIntervalSeconds)
            {
                return;
            }

            _ragQueryPollInFlight = true;
            _lastRagQueryPollAt = now;
            try
            {
                await TryHandlePulledReadQueryAsync();
                await TryBackgroundRuntimePingAsync(now);
                await TryAutoReportCompileResultAsync();
                TryTripTimeout(now);
            }
            catch (Exception ex)
            {
                AddLog(
                    UiLogLevel.Error,
                    "poll loop failed: " + NormalizeErrorMessageForTransport(
                        ex == null ? string.Empty : ex.Message,
                        "poll loop failed."));
                Debug.LogError("[Codex] PollRagQueriesAsync failed: " + ex);
            }
            finally
            {
                _ragQueryPollInFlight = false;
            }
        }

        private async Task TryBackgroundRuntimePingAsync(double now)
        {
            if (_runtimePingProbeInFlight)
            {
                return;
            }

            if (_lastRuntimePingProbeAt > 0d &&
                now - _lastRuntimePingProbeAt < RuntimePingProbeIntervalSeconds)
            {
                return;
            }

            _runtimePingProbeInFlight = true;
            _lastRuntimePingProbeAt = now;
            try
            {
                await SendRuntimePingInternalAsync("heartbeat", false);
            }
            finally
            {
                _runtimePingProbeInFlight = false;
            }
        }

        private async Task SendRuntimePingInternalAsync(string status, bool logWhenNoRecovery)
        {
            if (string.IsNullOrWhiteSpace(ThreadId))
            {
                ThreadId = "t_default";
            }

            var request = new UnityRuntimePingRequest
            {
                @event = "unity.runtime.ping",
                request_id = "req_ping_" + Guid.NewGuid().ToString("N"),
                thread_id = ThreadId,
                turn_id = string.IsNullOrEmpty(_turnId)
                    ? "u_ping_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    : _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityRuntimePingPayload
                {
                    status = string.IsNullOrEmpty(status) ? "just_recompiled" : status
                }
            };

            var result = await _sidecarGateway.ReportRuntimePingAsync(SidecarUrl, request);
            if (!result.TransportSuccess)
            {
                MaybeLogTransportFailure(
                    EditorApplicationTimeFallback(),
                    "unity.runtime.ping failed: " + result.ErrorMessage);
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping failed: " + result.ErrorMessage);
                }

                return;
            }

            if (!result.IsHttpSuccess)
            {
                MaybeLogTransportFailure(
                    EditorApplicationTimeFallback(),
                    "unity.runtime.ping rejected: " + ReadErrorCode(result));
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping rejected: " + ReadErrorCode(result));
                }

                return;
            }

            var pong = result.Data;
            if (pong == null)
            {
                MaybeLogTransportFailure(
                    EditorApplicationTimeFallback(),
                    "unity.runtime.ping response parse failed.");
                if (logWhenNoRecovery)
                {
                    AddLog(UiLogLevel.Warning, "unity.runtime.ping response parse failed.");
                }

                return;
            }

            var statusFromPing = ToTurnStatus(pong);
            if (EnableDiagnosticLogs)
            {
                AddLog(
                    UiLogLevel.Info,
                    "diag.runtime.ping.response: request_id=" + SafeString(pong.request_id) +
                    ", state=" + SafeString(statusFromPing == null ? string.Empty : statusFromPing.state) +
                    ", stage=" + SafeString(pong.stage) +
                    ", recovered=" + pong.recovered +
                    ", has_unity_action_request=" +
                    (pong.unity_action_request != null &&
                     pong.unity_action_request.payload != null &&
                     pong.unity_action_request.payload.action != null) + ".");
            }

            if (IsTerminalStatus(statusFromPing))
            {
                HandleTerminalStatus(statusFromPing);
                return;
            }

            var now = EditorApplicationTimeFallback();
            if (statusFromPing != null &&
                !string.IsNullOrEmpty(statusFromPing.request_id) &&
                string.Equals(statusFromPing.state, "running", StringComparison.Ordinal))
            {
                _activeRequestId = statusFromPing.request_id;
                if (string.IsNullOrEmpty(_turnId))
                {
                    _turnId = request.turn_id;
                }

                IsBusy = true;
                ApplyStage(statusFromPing.stage, now);
                if (TryCapturePendingUnityActionRequest(
                        statusFromPing.unity_action_request,
                        "unity.runtime.ping",
                        statusFromPing.request_id))
                {
                    await HandleCapturedPendingActionAsync(
                        "unity.runtime.ping",
                        "Received unity.action.request from runtime ping. Waiting for confirmation.");
                    return;
                }

                BusyReason = BuildBusyReasonForRuntimeState();
                SaveState();
                EmitChanged();
            }
            else if (IsBusy &&
                     statusFromPing != null &&
                     string.Equals(statusFromPing.state, "idle", StringComparison.Ordinal))
            {
                AddLog(UiLogLevel.Warning, "unity.runtime.ping: sidecar has no active job; clearing local busy state.");
                UnlockTurn();
                SaveState();
                return;
            }

            if (pong.recovered)
            {
                AddLog(UiLogLevel.Warning, "unity.runtime.ping recovered pending action from sidecar.");
                return;
            }

            if (logWhenNoRecovery)
            {
                var pingMessage =
                    statusFromPing != null && !string.IsNullOrEmpty(statusFromPing.message)
                        ? statusFromPing.message
                        : pong.message;
                AddLog(UiLogLevel.Info, "unity.runtime.ping: " + SafeString(pingMessage));
            }
        }

        private async Task TryHandlePulledReadQueryAsync()
        {
            var pull = await _sidecarGateway.PullQueriesAsync(SidecarUrl);
            if (!IsUsableQueryPull(pull))
            {
                return;
            }

            var pulledQuery = pull.Data.query;
            if (pulledQuery == null || string.IsNullOrEmpty(pulledQuery.query_id))
            {
                AddLog(UiLogLevel.Warning, "unity.query.pull returned pending query without query_id.");
                return;
            }

            var dispatchResult = await ExecutePulledReadQueryAsync(pulledQuery);
            var report = await _sidecarGateway.ReportQueryResultAsync(
                SidecarUrl,
                pulledQuery.query_id,
                dispatchResult.payload);
            HandleQueryReportOutcome(
                report,
                string.IsNullOrEmpty(pulledQuery.query_type) ? "unknown_query" : pulledQuery.query_type,
                pulledQuery.query_id,
                dispatchResult.error_code);
        }

        private async Task<UnityRagQueryDispatchResult> ExecutePulledReadQueryAsync(UnityPulledQuery pulledQuery)
        {
            var queryType = NormalizeQueryType(pulledQuery == null ? string.Empty : pulledQuery.query_type);
            if (string.IsNullOrEmpty(queryType))
            {
                return BuildQueryDispatchFailure(
                    pulledQuery,
                    "E_SCHEMA_INVALID",
                    "Pulled query is missing query_type.");
            }

            var registryDispatch = await DispatchPulledReadQueryViaRegistryAsync(
                queryType,
                pulledQuery);
            if (registryDispatch == null)
            {
                return BuildQueryDispatchFailure(
                    pulledQuery,
                    "E_QUERY_HANDLER_FAILED",
                    "Unity query registry returned null dispatch result.");
            }

            if (!registryDispatch.handled)
            {
                return BuildQueryDispatchFailure(
                    pulledQuery,
                    "E_UNSUPPORTED_QUERY_TYPE",
                    "Unsupported Unity query_type: " + queryType);
            }

            if (!string.IsNullOrEmpty(registryDispatch.error_message))
            {
                return BuildQueryDispatchFailure(
                    pulledQuery,
                    registryDispatch.error_code,
                    registryDispatch.error_message);
            }

            return new UnityRagQueryDispatchResult
            {
                payload = registryDispatch.payload,
                error_code = string.IsNullOrEmpty(registryDispatch.error_code)
                    ? string.Empty
                    : registryDispatch.error_code
            };
        }

        private static string NormalizeQueryType(string value)
        {
            return string.IsNullOrEmpty(value) ? string.Empty : value.Trim();
        }

        private UnityRagQueryDispatchResult BuildQueryDispatchFailure(
            UnityPulledQuery pulledQuery,
            string errorCode,
            string errorMessage)
        {
            var requestId = pulledQuery == null || string.IsNullOrEmpty(pulledQuery.request_id)
                ? string.Empty
                : pulledQuery.request_id.Trim();
            var payload = new UnityGenericQueryFailureResult
            {
                ok = false,
                request_id = requestId,
                captured_at = DateTime.UtcNow.ToString("o"),
                error_code = NormalizeErrorCodeForTransport(errorCode, "E_QUERY_HANDLER_FAILED"),
                error_message = NormalizeErrorMessageForTransport(
                    errorMessage,
                    "Unity query handler failed.")
            };
            return new UnityRagQueryDispatchResult
            {
                payload = payload,
                error_code = payload.error_code
            };
        }

        private bool IsUsableQueryPull(GatewayResponse<UnityQueryPullResponse> pull)
        {
            if (pull == null)
            {
                return false;
            }
            if (!pull.TransportSuccess)
            {
                return false;
            }

            if (pull.StatusCode == 404 || pull.StatusCode == 204)
            {
                return false;
            }

            if (!pull.IsHttpSuccess)
            {
                AddLog(UiLogLevel.Warning, "unity.query.pull rejected: " + ReadErrorCode(pull));
                return false;
            }

            if (pull.Data == null || !pull.Data.ok || !pull.Data.pending)
            {
                return false;
            }

            return pull.Data.query != null;
        }

        private void HandleQueryReportOutcome(
            GatewayResponse<UnityQueryReportResponse> report,
            string queryName,
            string queryId,
            string localErrorCode)
        {
            if (report == null || !report.TransportSuccess)
            {
                AddLog(
                    UiLogLevel.Warning,
                    queryName + " result report failed: " +
                    (report == null ? "null response" : report.ErrorMessage));
                return;
            }

            if (!report.IsHttpSuccess)
            {
                AddLog(
                    UiLogLevel.Warning,
                    queryName + " result report rejected: " + ReadErrorCode(report));
                return;
            }

            if (!string.IsNullOrEmpty(localErrorCode))
            {
                AddLog(
                    UiLogLevel.Warning,
                    queryName + " result reported with error_code=" + localErrorCode +
                    " query_id=" + SafeString(queryId));
                return;
            }

            AddLog(
                UiLogLevel.Info,
                queryName + " result reported. query_id=" + SafeString(queryId));
        }

        private Task<T> RunOnEditorMainThreadAsync<T>(Func<T> action)
        {
            var context = _unitySynchronizationContext;
            if (context == null)
            {
                var fallback = new TaskCompletionSource<T>();
                EditorApplication.delayCall += () =>
                {
                    try
                    {
                        fallback.TrySetResult(action != null ? action() : default(T));
                    }
                    catch (Exception ex)
                    {
                        fallback.TrySetException(ex);
                    }
                };
                return fallback.Task;
            }

            var tcs = new TaskCompletionSource<T>();
            context.Post(_ =>
            {
                try
                {
                    tcs.TrySetResult(action != null ? action() : default(T));
                }
                catch (Exception ex)
                {
                    tcs.TrySetException(ex);
                }
            }, null);
            return tcs.Task;
        }

        private UnityQueryExecutionContext BuildUnityQueryExecutionContext()
        {
            return new UnityQueryExecutionContext(
                _ragReadService,
                action => RunOnEditorMainThreadAsync(() => action == null ? null : action()));
        }

        [Serializable]
        private sealed class UnityRagQueryDispatchResult
        {
            public object payload;
            public string error_code;
        }

        [Serializable]
        private sealed class UnityGenericQueryFailureResult
        {
            public bool ok;
            public string request_id;
            public string captured_at;
            public string error_code;
            public string error_message;
        }
    }
}

using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Application
{
    public sealed partial class ConversationController
    {
        public Task<bool> ReportCapabilitiesAsync(string reason, bool force)
        {
            return ReportCapabilitiesCoreAsync(reason, force);
        }

        private async Task<bool> ReportCapabilitiesCoreAsync(string reason, bool force)
        {
            if (_capabilityReportInFlight && !force)
            {
                return false;
            }

            if (string.IsNullOrWhiteSpace(ThreadId))
            {
                ThreadId = "t_default";
            }

            var capabilities = BuildCapabilityActionItems();
            var capabilityVersion = BuildCapabilityVersion(capabilities);
            if (!force &&
                !string.IsNullOrEmpty(_lastReportedCapabilityVersion) &&
                string.Equals(
                    _lastReportedCapabilityVersion,
                    capabilityVersion,
                    StringComparison.Ordinal))
            {
                return true;
            }

            var request = new UnityCapabilitiesReportRequest
            {
                @event = "unity.capabilities.report",
                request_id = "req_cap_" + Guid.NewGuid().ToString("N"),
                thread_id = ThreadId,
                turn_id = string.IsNullOrEmpty(_turnId)
                    ? "u_cap_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    : _turnId,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityCapabilitiesReportPayload
                {
                    capability_version = capabilityVersion,
                    actions = capabilities,
                },
            };

            _capabilityReportInFlight = true;
            try
            {
                var result = await _sidecarGateway.ReportUnityCapabilitiesAsync(SidecarUrl, request);
                if (!result.TransportSuccess)
                {
                    if (force)
                    {
                        AddLog(UiLogLevel.Warning, "unity.capabilities.report failed: " + result.ErrorMessage);
                    }
                    return false;
                }

                if (!result.IsHttpSuccess || result.Data == null || !result.Data.ok)
                {
                    if (force)
                    {
                        AddLog(
                            UiLogLevel.Warning,
                            "unity.capabilities.report rejected: " + ReadErrorCode(result));
                    }
                    return false;
                }

                _lastReportedCapabilityVersion = capabilityVersion;
                if (EnableDiagnosticLogs)
                {
                    AddLog(
                        UiLogLevel.Info,
                        "unity.capabilities.report accepted: version=" +
                        capabilityVersion +
                        ", actions=" +
                        request.payload.actions.Length +
                        ", reason=" +
                        SafeString(reason));
                }
                return true;
            }
            finally
            {
                _capabilityReportInFlight = false;
            }
        }

    }
}

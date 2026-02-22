using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Ports
{
    public interface ISidecarGateway
    {
        Task<GatewayResponse<SessionStartResponse>> StartSessionAsync(string baseUrl, SessionStartRequest request);
        Task<GatewayResponse<HealthResponse>> GetHealthAsync(string baseUrl);
        Task<GatewayResponse<SidecarStateSnapshotResponse>> GetStateSnapshotAsync(string baseUrl);
        Task<GatewayResponse<FilesChangedEnvelopeResponse>> ApplyFileActionsAsync(string baseUrl, FileActionsApplyRequest request);
        Task<GatewayResponse<UnityRuntimePingResponse>> ReportRuntimePingAsync(string baseUrl, UnityRuntimePingRequest request);
        Task<GatewayResponse<UnityCompileReportResponse>> ReportCompileResultAsync(string baseUrl, UnityCompileResultRequest request);
        Task<GatewayResponse<UnityActionReportResponse>> ReportUnityActionResultAsync(string baseUrl, UnityActionResultRequest request);
        Task<GatewayResponse<UnityQueryComponentsReportResponse>> ReportUnityComponentsQueryResultAsync(string baseUrl, UnityQueryComponentsResultRequest request);
        Task<GatewayResponse<TurnStatusResponse>> SendTurnAsync(string baseUrl, TurnSendRequest request);
        Task<GatewayResponse<TurnStatusResponse>> GetTurnStatusAsync(string baseUrl, string requestId, int eventCursor);
        Task<GatewayResponse<TurnStatusResponse>> CancelTurnAsync(string baseUrl, TurnCancelRequest request);
    }
}

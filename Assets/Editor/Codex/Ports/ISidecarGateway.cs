using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Ports
{
    public interface ISidecarGateway
    {
        Task<GatewayResponse<HealthResponse>> GetHealthAsync(string baseUrl);
        Task<GatewayResponse<SidecarStateSnapshotResponse>> GetStateSnapshotAsync(string baseUrl);
        Task<GatewayResponse<FilesChangedEnvelopeResponse>> ApplyFileActionsAsync(string baseUrl, FileActionsApplyRequest request);
        Task<GatewayResponse<UnitySelectionSnapshotResponse>> ReportSelectionSnapshotAsync(string baseUrl, UnitySelectionSnapshotRequest request);
        Task<GatewayResponse<UnityConsoleSnapshotResponse>> ReportConsoleSnapshotAsync(string baseUrl, UnityConsoleSnapshotRequest request);
        Task<GatewayResponse<UnityRuntimePingResponse>> ReportRuntimePingAsync(string baseUrl, UnityRuntimePingRequest request);
        // Compile/action callbacks must preserve stable error_code/error_message semantics.
        Task<GatewayResponse<UnityCompileReportResponse>> ReportCompileResultAsync(string baseUrl, UnityCompileResultRequest request);
        Task<GatewayResponse<UnityActionReportResponse>> ReportUnityActionResultAsync(string baseUrl, UnityActionResultRequest request);
        Task<GatewayResponse<UnityQueryComponentsReportResponse>> ReportUnityComponentsQueryResultAsync(string baseUrl, UnityQueryComponentsResultRequest request);
        Task<GatewayResponse<UnityQueryPullResponse>> PullQueriesAsync(string baseUrl);
        Task<GatewayResponse<UnityQueryReportResponse>> ReportQueryResultAsync(string baseUrl, string queryId, object payload);
    }
}

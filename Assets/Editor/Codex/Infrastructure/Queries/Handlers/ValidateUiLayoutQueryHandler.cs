using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class ValidateUiLayoutQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.ValidateUiLayout; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "validate_ui_layout execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityValidateUiLayoutPayload>(pulledQuery);
            var request = new UnityValidateUiLayoutRequest
            {
                @event = "unity.query.validate_ui_layout.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityValidateUiLayoutPayload
                {
                    scope = payload.scope,
                    resolutions = payload.resolutions,
                    checks = payload.checks,
                    max_issues = payload.max_issues,
                    time_budget_ms = payload.time_budget_ms,
                    layout_refresh_mode = context.NormalizeQueryField(payload.layout_refresh_mode),
                    timeout_ms = payload.timeout_ms
                }
            };

            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.ValidateUiLayout(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "validate_ui_layout handler returned null.");
            }

            if (string.IsNullOrEmpty(response.request_id))
            {
                response.request_id = request.request_id;
            }

            return UnityQueryHandlerResult.Success(
                response,
                string.IsNullOrEmpty(response.error_code) ? string.Empty : response.error_code);
        }
    }
}

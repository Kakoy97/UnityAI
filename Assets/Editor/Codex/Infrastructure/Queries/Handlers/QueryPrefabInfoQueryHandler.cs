using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class QueryPrefabInfoQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.QueryPrefabInfo; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "query_prefab_info execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityQueryPrefabInfoPayload>(pulledQuery);
            var request = new UnityQueryPrefabInfoRequest
            {
                @event = "unity.query.query_prefab_info.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityQueryPrefabInfoPayload
                {
                    prefab_path = context.NormalizeQueryField(payload.prefab_path),
                    max_depth = payload.max_depth,
                    node_budget = payload.node_budget,
                    char_budget = payload.char_budget,
                    include_components = payload.include_components,
                    include_missing_scripts = payload.include_missing_scripts
                }
            };
            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.QueryPrefabInfo(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "query_prefab_info handler returned null.");
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

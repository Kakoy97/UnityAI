using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class ListAssetsInFolderQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.ListAssetsInFolder; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "list_assets_in_folder execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<UnityListAssetsInFolderPayload>(pulledQuery);
            var request = new UnityListAssetsInFolderRequest
            {
                @event = "unity.query.list_assets_in_folder.request",
                request_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.request_id),
                thread_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.thread_id),
                turn_id = context.NormalizeQueryField(pulledQuery == null ? string.Empty : pulledQuery.turn_id),
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityListAssetsInFolderPayload
                {
                    folder_path = context.NormalizeQueryField(payload.folder_path),
                    recursive = payload.recursive,
                    include_meta = payload.include_meta,
                    limit = payload.limit
                }
            };
            var response = await context.RunOnEditorMainThreadAsync(
                () => context.RagReadService.ListAssetsInFolder(request));
            if (response == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "list_assets_in_folder handler returned null.");
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

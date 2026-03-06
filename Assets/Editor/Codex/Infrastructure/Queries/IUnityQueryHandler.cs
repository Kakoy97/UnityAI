using System;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Queries
{
    public interface IUnityQueryHandler
    {
        string QueryType { get; }

        Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityAI.Editor.Codex.Domain.UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context);
    }

    public static class UnityQueryTypes
    {
        public const string SsotRequest = "ssot.request";
    }

    public sealed class UnityQueryHandlerResult
    {
        public object Payload { get; private set; }
        public string ErrorCode { get; private set; }
        public string ErrorMessage { get; private set; }

        public static UnityQueryHandlerResult Success(object payload, string errorCode)
        {
            return new UnityQueryHandlerResult
            {
                Payload = payload,
                ErrorCode = string.IsNullOrEmpty(errorCode) ? string.Empty : errorCode.Trim(),
                ErrorMessage = string.Empty
            };
        }

        public static UnityQueryHandlerResult Failure(string errorCode, string errorMessage)
        {
            return new UnityQueryHandlerResult
            {
                Payload = null,
                ErrorCode = string.IsNullOrEmpty(errorCode)
                    ? "E_QUERY_HANDLER_FAILED"
                    : errorCode.Trim(),
                ErrorMessage = string.IsNullOrEmpty(errorMessage)
                    ? "Unity query handler failed."
                    : errorMessage.Trim()
            };
        }
    }

    public sealed class UnityQueryExecutionContext
    {
        public UnityQueryExecutionContext(
            UnityRagReadService ragReadService,
            Func<Func<object>, Task<object>> runOnEditorMainThreadAsync)
        {
            if (ragReadService == null)
            {
                throw new ArgumentNullException("ragReadService");
            }
            if (runOnEditorMainThreadAsync == null)
            {
                throw new ArgumentNullException("runOnEditorMainThreadAsync");
            }

            RagReadService = ragReadService;
            RunOnEditorMainThreadAsyncObject = runOnEditorMainThreadAsync;
        }

        public UnityRagReadService RagReadService { get; private set; }
        public Func<Func<object>, Task<object>> RunOnEditorMainThreadAsyncObject { get; private set; }

        public async Task<TResponse> RunOnEditorMainThreadAsync<TResponse>(Func<TResponse> action)
        {
            if (action == null)
            {
                return default(TResponse);
            }

            var boxed = await RunOnEditorMainThreadAsyncObject(() =>
            {
                return (object)action();
            });

            if (boxed == null)
            {
                return default(TResponse);
            }

            if (boxed is TResponse)
            {
                return (TResponse)boxed;
            }

            return (TResponse)boxed;
        }

        public string NormalizeQueryField(string value)
        {
            return string.IsNullOrEmpty(value) ? string.Empty : value.Trim();
        }

        public TPayload GetQueryPayloadOrDefault<TPayload>(UnityAI.Editor.Codex.Domain.UnityPulledQuery pulledQuery)
            where TPayload : class, new()
        {
            if (pulledQuery == null)
            {
                return new TPayload();
            }

            TPayload parsed;
            if (TryDeserializeQueryPayload(pulledQuery.query_payload_json, out parsed))
            {
                return parsed;
            }

            return new TPayload();
        }

        private static bool TryDeserializeQueryPayload<TPayload>(string json, out TPayload payload)
            where TPayload : class, new()
        {
            payload = null;
            if (string.IsNullOrEmpty(json))
            {
                return false;
            }

            try
            {
                payload = JsonUtility.FromJson<TPayload>(json);
                return payload != null;
            }
            catch
            {
                payload = null;
                return false;
            }
        }
    }
}

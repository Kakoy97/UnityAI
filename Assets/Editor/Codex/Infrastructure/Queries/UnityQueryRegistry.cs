using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.Queries
{
    public sealed class UnityQueryRegistry
    {
        private readonly Dictionary<string, IUnityQueryHandler> _handlers =
            new Dictionary<string, IUnityQueryHandler>(StringComparer.Ordinal);

        public int Count
        {
            get { return _handlers.Count; }
        }

        public void Register(IUnityQueryHandler handler)
        {
            if (handler == null)
            {
                throw new ArgumentNullException("handler");
            }

            var queryType = NormalizeQueryType(handler.QueryType);
            if (string.IsNullOrEmpty(queryType))
            {
                throw new ArgumentException("handler.QueryType is required.", "handler");
            }

            if (_handlers.ContainsKey(queryType))
            {
                throw new InvalidOperationException(
                    "Unity query handler already registered for query_type '" +
                    queryType +
                    "'.");
            }

            _handlers[queryType] = handler;
        }

        public bool Contains(string queryType)
        {
            return _handlers.ContainsKey(NormalizeQueryType(queryType));
        }

        public async Task<UnityQueryRegistryDispatchResult> DispatchAsync(
            string queryType,
            UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            var normalizedType = NormalizeQueryType(queryType);
            if (string.IsNullOrEmpty(normalizedType))
            {
                normalizedType = NormalizeQueryType(pulledQuery == null ? string.Empty : pulledQuery.query_type);
            }

            if (string.IsNullOrEmpty(normalizedType))
            {
                return UnityQueryRegistryDispatchResult.NotHandled();
            }

            IUnityQueryHandler handler;
            if (!_handlers.TryGetValue(normalizedType, out handler))
            {
                return UnityQueryRegistryDispatchResult.NotHandled();
            }

            if (context == null)
            {
                return UnityQueryRegistryDispatchResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "Unity query execution context is null.");
            }

            try
            {
                var result = await handler.ExecuteAsync(pulledQuery, context);
                if (result == null)
                {
                    return UnityQueryRegistryDispatchResult.Failure(
                        "E_QUERY_HANDLER_FAILED",
                        normalizedType + " handler returned null result.");
                }

                if (!string.IsNullOrEmpty(result.ErrorMessage))
                {
                    return UnityQueryRegistryDispatchResult.Failure(
                        string.IsNullOrEmpty(result.ErrorCode)
                            ? "E_QUERY_HANDLER_FAILED"
                            : result.ErrorCode,
                        result.ErrorMessage);
                }

                if (result.Payload == null)
                {
                    return UnityQueryRegistryDispatchResult.Failure(
                        "E_QUERY_HANDLER_FAILED",
                        normalizedType + " handler returned null payload.");
                }

                return UnityQueryRegistryDispatchResult.Handled(
                    result.Payload,
                    string.IsNullOrEmpty(result.ErrorCode) ? string.Empty : result.ErrorCode);
            }
            catch (Exception ex)
            {
                return UnityQueryRegistryDispatchResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    ex == null ? "Unity query handler threw." : ex.Message);
            }
        }

        private static string NormalizeQueryType(string value)
        {
            return string.IsNullOrEmpty(value) ? string.Empty : value.Trim();
        }
    }

    public sealed class UnityQueryRegistryDispatchResult
    {
        public bool handled;
        public object payload;
        public string error_code;
        public string error_message;

        public static UnityQueryRegistryDispatchResult NotHandled()
        {
            return new UnityQueryRegistryDispatchResult
            {
                handled = false,
                payload = null,
                error_code = string.Empty,
                error_message = string.Empty
            };
        }

        public static UnityQueryRegistryDispatchResult Handled(object payload, string errorCode)
        {
            return new UnityQueryRegistryDispatchResult
            {
                handled = true,
                payload = payload,
                error_code = string.IsNullOrEmpty(errorCode) ? string.Empty : errorCode.Trim(),
                error_message = string.Empty
            };
        }

        public static UnityQueryRegistryDispatchResult Failure(string errorCode, string errorMessage)
        {
            return new UnityQueryRegistryDispatchResult
            {
                handled = true,
                payload = null,
                error_code = string.IsNullOrEmpty(errorCode)
                    ? "E_QUERY_HANDLER_FAILED"
                    : errorCode.Trim(),
                error_message = string.IsNullOrEmpty(errorMessage)
                    ? "Unity query handler failed."
                    : errorMessage.Trim()
            };
        }
    }
}

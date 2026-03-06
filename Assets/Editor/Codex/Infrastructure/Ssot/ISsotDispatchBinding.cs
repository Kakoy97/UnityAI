using System;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot
{
    public interface ISsotDispatchBinding
    {
        string ToolName { get; }

        SsotDispatchResponse Dispatch(object requestDto, string normalizedToolName);
    }

    public static class SsotDispatchBindingFactory
    {
        public static ISsotDispatchBinding CreateExecutorBinding<TRequest, TExecutor>(
            string toolName,
            ISsotExecutorFactory executorFactory,
            Func<TExecutor> executorCreator,
            Func<TExecutor, TRequest, SsotDispatchResponse> execute,
            string typeMismatchMessage)
            where TRequest : class
            where TExecutor : class
        {
            return new ExecutorDispatchBinding<TRequest, TExecutor>(
                toolName,
                executorFactory,
                executorCreator,
                execute,
                typeMismatchMessage);
        }

        public static ISsotDispatchBinding CreateDeprecatedBinding<TRequest>(
            string toolName,
            string typeMismatchMessage,
            string deprecatedMessage)
            where TRequest : class
        {
            return new DeprecatedDispatchBinding<TRequest>(
                toolName,
                typeMismatchMessage,
                deprecatedMessage);
        }

        public static ISsotDispatchBinding CreateUnsupportedBinding(string toolName)
        {
            return new UnsupportedDispatchBinding(toolName);
        }

        private sealed class ExecutorDispatchBinding<TRequest, TExecutor> : ISsotDispatchBinding
            where TRequest : class
            where TExecutor : class
        {
            private readonly string _toolName;
            private readonly ISsotExecutorFactory _executorFactory;
            private readonly Func<TExecutor> _executorCreator;
            private readonly Func<TExecutor, TRequest, SsotDispatchResponse> _execute;
            private readonly string _typeMismatchMessage;
            private readonly string _executorCacheKey;

            public ExecutorDispatchBinding(
                string toolName,
                ISsotExecutorFactory executorFactory,
                Func<TExecutor> executorCreator,
                Func<TExecutor, TRequest, SsotDispatchResponse> execute,
                string typeMismatchMessage)
            {
                _toolName = Normalize(toolName);
                _executorFactory = executorFactory ?? throw new ArgumentNullException("executorFactory");
                _executorCreator = executorCreator ?? throw new ArgumentNullException("executorCreator");
                _execute = execute ?? throw new ArgumentNullException("execute");
                _typeMismatchMessage = Normalize(typeMismatchMessage);
                _executorCacheKey = typeof(TExecutor).FullName ?? typeof(TExecutor).Name;
            }

            public string ToolName
            {
                get { return _toolName; }
            }

            public SsotDispatchResponse Dispatch(object requestDto, string normalizedToolName)
            {
                var typedRequest = requestDto as TRequest;
                if (typedRequest == null)
                {
                    return SsotRequestDispatcher.Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        string.IsNullOrEmpty(_typeMismatchMessage)
                            ? "SSOT request type mismatch for " + ResolveToolName(normalizedToolName) + "."
                            : _typeMismatchMessage,
                        ResolveToolName(normalizedToolName));
                }

                var executor = _executorFactory.GetOrCreate(_executorCacheKey, _executorCreator);
                return _execute(executor, typedRequest);
            }

            private string ResolveToolName(string normalizedToolName)
            {
                var candidate = Normalize(normalizedToolName);
                return string.IsNullOrEmpty(candidate) ? _toolName : candidate;
            }
        }

        private sealed class DeprecatedDispatchBinding<TRequest> : ISsotDispatchBinding
            where TRequest : class
        {
            private readonly string _toolName;
            private readonly string _typeMismatchMessage;
            private readonly string _deprecatedMessage;

            public DeprecatedDispatchBinding(
                string toolName,
                string typeMismatchMessage,
                string deprecatedMessage)
            {
                _toolName = Normalize(toolName);
                _typeMismatchMessage = Normalize(typeMismatchMessage);
                _deprecatedMessage = Normalize(deprecatedMessage);
            }

            public string ToolName
            {
                get { return _toolName; }
            }

            public SsotDispatchResponse Dispatch(object requestDto, string normalizedToolName)
            {
                if (!(requestDto is TRequest))
                {
                    return SsotRequestDispatcher.Failure(
                        "E_SSOT_DESERIALIZE_FAILED",
                        string.IsNullOrEmpty(_typeMismatchMessage)
                            ? "SSOT request type mismatch for " + ResolveToolName(normalizedToolName) + "."
                            : _typeMismatchMessage,
                        ResolveToolName(normalizedToolName));
                }

                return SsotRequestDispatcher.Failure(
                    "E_SSOT_TOOL_DEPRECATED",
                    string.IsNullOrEmpty(_deprecatedMessage)
                        ? ResolveToolName(normalizedToolName) + " is deprecated in SSOT-only mode."
                        : _deprecatedMessage,
                    ResolveToolName(normalizedToolName));
            }

            private string ResolveToolName(string normalizedToolName)
            {
                var candidate = Normalize(normalizedToolName);
                return string.IsNullOrEmpty(candidate) ? _toolName : candidate;
            }
        }

        private sealed class UnsupportedDispatchBinding : ISsotDispatchBinding
        {
            private readonly string _toolName;

            public UnsupportedDispatchBinding(string toolName)
            {
                _toolName = Normalize(toolName);
            }

            public string ToolName
            {
                get { return _toolName; }
            }

            public SsotDispatchResponse Dispatch(object requestDto, string normalizedToolName)
            {
                var tool = ResolveToolName(normalizedToolName);
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_TOOL_UNSUPPORTED",
                    "Unsupported SSOT tool: " + tool,
                    tool);
            }

            private string ResolveToolName(string normalizedToolName)
            {
                var candidate = Normalize(normalizedToolName);
                return string.IsNullOrEmpty(candidate) ? _toolName : candidate;
            }
        }

        private static string Normalize(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }
    }
}

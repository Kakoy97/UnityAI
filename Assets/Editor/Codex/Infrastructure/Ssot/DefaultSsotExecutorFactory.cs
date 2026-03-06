using System;
using System.Collections.Generic;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot
{
    public sealed class DefaultSsotExecutorFactory : ISsotExecutorFactory
    {
        private readonly object _gate = new object();
        private readonly Dictionary<string, object> _cache =
            new Dictionary<string, object>(StringComparer.Ordinal);

        public TExecutor GetOrCreate<TExecutor>(string key, Func<TExecutor> creator)
            where TExecutor : class
        {
            if (creator == null)
            {
                throw new ArgumentNullException("creator");
            }

            var cacheKey = NormalizeCacheKey<TExecutor>(key);
            lock (_gate)
            {
                object existing;
                if (_cache.TryGetValue(cacheKey, out existing))
                {
                    var typedExisting = existing as TExecutor;
                    if (typedExisting == null)
                    {
                        throw new InvalidOperationException(
                            "SSOT executor cache key type mismatch for '" + cacheKey + "'.");
                    }

                    return typedExisting;
                }

                var created = creator();
                if (created == null)
                {
                    throw new InvalidOperationException(
                        "SSOT executor factory creator returned null for '" + cacheKey + "'.");
                }

                _cache[cacheKey] = created;
                return created;
            }
        }

        private static string NormalizeCacheKey<TExecutor>(string key)
            where TExecutor : class
        {
            var normalized = string.IsNullOrWhiteSpace(key) ? string.Empty : key.Trim();
            if (!string.IsNullOrEmpty(normalized))
            {
                return normalized;
            }

            return typeof(TExecutor).FullName ?? typeof(TExecutor).Name;
        }
    }
}

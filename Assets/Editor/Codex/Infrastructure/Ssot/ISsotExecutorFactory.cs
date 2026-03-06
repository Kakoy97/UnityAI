using System;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot
{
    public interface ISsotExecutorFactory
    {
        TExecutor GetOrCreate<TExecutor>(string key, Func<TExecutor> creator)
            where TExecutor : class;
    }
}

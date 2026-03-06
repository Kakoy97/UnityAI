using UnityAI.Editor.Codex.Infrastructure.Queries.Handlers;
using UnityEditor;

namespace UnityAI.Editor.Codex.Infrastructure.Queries
{
    [InitializeOnLoad]
    public static class UnityQueryRegistryBootstrap
    {
        private static UnityQueryRegistry _registry;

        static UnityQueryRegistryBootstrap()
        {
            _registry = BuildDefaultRegistry();
        }

        public static UnityQueryRegistry Registry
        {
            get { return _registry; }
        }

        public static void Rebuild()
        {
            _registry = BuildDefaultRegistry();
        }

        public static UnityQueryRegistry BuildDefaultRegistry()
        {
            var registry = new UnityQueryRegistry();
            registry.Register(new SsotRequestQueryHandler());
            return registry;
        }
    }
}

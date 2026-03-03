using System;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Queries;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityQueryRegistryTests
    {
        [Test]
        public void Register_Throws_WhenDuplicateQueryType()
        {
            var registry = new UnityQueryRegistry();
            registry.Register(new StubHandler(UnityQueryTypes.CaptureSceneScreenshot, (q, c) =>
                Task.FromResult(UnityQueryHandlerResult.Success(new UnityCaptureSceneScreenshotResponse(), string.Empty))));

            Assert.Throws<InvalidOperationException>(() =>
                registry.Register(new StubHandler(UnityQueryTypes.CaptureSceneScreenshot, (q, c) =>
                    Task.FromResult(UnityQueryHandlerResult.Success(new UnityCaptureSceneScreenshotResponse(), string.Empty)))));
        }

        [Test]
        public void Dispatch_ReturnsNotHandled_WhenQueryTypeMissing()
        {
            var registry = new UnityQueryRegistry();
            var result = registry.DispatchAsync(
                    "not_registered",
                    new UnityPulledQuery { query_type = "not_registered" },
                    null)
                .GetAwaiter()
                .GetResult();

            Assert.NotNull(result);
            Assert.IsFalse(result.handled);
            Assert.IsTrue(string.IsNullOrEmpty(result.error_code));
        }

        [Test]
        public void Dispatch_MapsHandlerException_ToStandardFailure()
        {
            var registry = new UnityQueryRegistry();
            registry.Register(new StubHandler("query_throw", (q, c) =>
            {
                throw new InvalidOperationException("boom");
            }));

            var result = registry.DispatchAsync(
                    "query_throw",
                    new UnityPulledQuery { query_type = "query_throw" },
                    BuildExecutionContext())
                .GetAwaiter()
                .GetResult();

            Assert.NotNull(result);
            Assert.IsTrue(result.handled);
            Assert.AreEqual("E_QUERY_HANDLER_FAILED", result.error_code);
            Assert.IsFalse(string.IsNullOrEmpty(result.error_message));
        }

        [Test]
        public void BuildDefaultRegistry_ContainsPhaseDQueryHandlers()
        {
            var registry = UnityQueryRegistryBootstrap.BuildDefaultRegistry();
            Assert.NotNull(registry);
            Assert.IsTrue(registry.Contains(UnityQueryTypes.ListAssetsInFolder));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.GetSceneRoots));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.FindObjectsByComponent));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.QueryPrefabInfo));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.CaptureSceneScreenshot));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.GetUiOverlayReport));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.GetUiTree));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.GetSerializedPropertyTree));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.HitTestUiAtScreenPoint));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.HitTestUiAtViewportPoint));
            Assert.IsTrue(registry.Contains(UnityQueryTypes.ValidateUiLayout));
        }

        private static UnityQueryExecutionContext BuildExecutionContext()
        {
            return new UnityQueryExecutionContext(
                new UnityRagReadService(),
                action => Task.FromResult(action == null ? null : action()));
        }

        private sealed class StubHandler : IUnityQueryHandler
        {
            private readonly Func<UnityPulledQuery, UnityQueryExecutionContext, Task<UnityQueryHandlerResult>> _executor;

            public StubHandler(
                string queryType,
                Func<UnityPulledQuery, UnityQueryExecutionContext, Task<UnityQueryHandlerResult>> executor)
            {
                QueryType = queryType;
                _executor = executor;
            }

            public string QueryType { get; private set; }

            public Task<UnityQueryHandlerResult> ExecuteAsync(
                UnityPulledQuery pulledQuery,
                UnityQueryExecutionContext context)
            {
                return _executor(pulledQuery, context);
            }
        }
    }
}

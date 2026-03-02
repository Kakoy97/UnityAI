using System.Threading.Tasks;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Queries;
using UnityAI.Editor.Codex.Infrastructure.Queries.Handlers;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityQueryRegistryDispatchTests
    {
        [Test]
        public void Dispatch_ListAssetsInFolder_UsesMainThreadGate_AndReturnsPayload()
        {
            var registry = new UnityQueryRegistry();
            registry.Register(new ListAssetsInFolderQueryHandler());

            var gateCalled = false;
            var expectedResponse = new UnityListAssetsInFolderResponse
            {
                ok = true,
                request_id = string.Empty,
                error_code = string.Empty
            };

            var context = new UnityQueryExecutionContext(
                new UnityRagReadService(),
                action =>
                {
                    gateCalled = true;
                    return Task.FromResult((object)expectedResponse);
                });

            var result = registry.DispatchAsync(
                    UnityQueryTypes.ListAssetsInFolder,
                    new UnityPulledQuery
                    {
                        query_type = UnityQueryTypes.ListAssetsInFolder,
                        request_id = "req_registry_list_assets"
                    },
                    context)
                .GetAwaiter()
                .GetResult();

            Assert.NotNull(result);
            Assert.IsTrue(result.handled);
            Assert.IsTrue(gateCalled);
            Assert.IsTrue(string.IsNullOrEmpty(result.error_code));
            Assert.IsTrue(string.IsNullOrEmpty(result.error_message));
            Assert.NotNull(result.payload);
            var payload = result.payload as UnityListAssetsInFolderResponse;
            Assert.NotNull(payload);
            Assert.AreEqual("req_registry_list_assets", payload.request_id);
        }

        [Test]
        public void ExecutionContext_PrefersQueryPayloadJson_OverLegacyPayload()
        {
            var context = BuildExecutionContext();
            var pulledQuery = new UnityPulledQuery
            {
                query_type = UnityQueryTypes.ListAssetsInFolder,
                query_payload_json = "{\"folder_path\":\"Assets/New\",\"recursive\":true,\"include_meta\":true,\"limit\":11}",
                payload = new UnityPulledQueryPayload
                {
                    folder_path = "Assets/Old",
                    recursive = false,
                    include_meta = false,
                    limit = 3
                }
            };

            var payload = context.GetQueryPayloadOrDefault<UnityListAssetsInFolderPayload>(pulledQuery);

            Assert.NotNull(payload);
            Assert.AreEqual("Assets/New", payload.folder_path);
            Assert.IsTrue(payload.recursive);
            Assert.IsTrue(payload.include_meta);
            Assert.AreEqual(11, payload.limit);
        }

        [Test]
        public void ExecutionContext_FallsBackToLegacyPayload_WhenQueryPayloadJsonInvalid()
        {
            var context = BuildExecutionContext();
            var pulledQuery = new UnityPulledQuery
            {
                query_type = UnityQueryTypes.ListAssetsInFolder,
                query_payload_json = "{invalid_json}",
                payload = new UnityPulledQueryPayload
                {
                    folder_path = "Assets/Legacy",
                    recursive = true,
                    include_meta = false,
                    limit = 9
                }
            };

            var payload = context.GetQueryPayloadOrDefault<UnityListAssetsInFolderPayload>(pulledQuery);

            Assert.NotNull(payload);
            Assert.AreEqual("Assets/Legacy", payload.folder_path);
            Assert.IsTrue(payload.recursive);
            Assert.IsFalse(payload.include_meta);
            Assert.AreEqual(9, payload.limit);
        }

        [Test]
        public void Dispatch_HandlerFailure_PropagatesErrorEnvelope()
        {
            var registry = new UnityQueryRegistry();
            registry.Register(new FailureStubHandler(UnityQueryTypes.GetUiTree));

            var result = registry.DispatchAsync(
                    UnityQueryTypes.GetUiTree,
                    new UnityPulledQuery
                    {
                        query_type = UnityQueryTypes.GetUiTree
                    },
                    BuildExecutionContext())
                .GetAwaiter()
                .GetResult();

            Assert.NotNull(result);
            Assert.IsTrue(result.handled);
            Assert.AreEqual("E_UI_TREE_SOURCE_NOT_FOUND", result.error_code);
            Assert.AreEqual("ui tree source missing.", result.error_message);
            Assert.IsNull(result.payload);
        }

        private static UnityQueryExecutionContext BuildExecutionContext()
        {
            return new UnityQueryExecutionContext(
                new UnityRagReadService(),
                action => Task.FromResult(action == null ? null : action()));
        }

        private sealed class FailureStubHandler : IUnityQueryHandler
        {
            public FailureStubHandler(string queryType)
            {
                QueryType = queryType;
            }

            public string QueryType { get; private set; }

            public Task<UnityQueryHandlerResult> ExecuteAsync(
                UnityPulledQuery pulledQuery,
                UnityQueryExecutionContext context)
            {
                return Task.FromResult(
                    UnityQueryHandlerResult.Failure(
                        "E_UI_TREE_SOURCE_NOT_FOUND",
                        "ui tree source missing."));
            }
        }
    }
}

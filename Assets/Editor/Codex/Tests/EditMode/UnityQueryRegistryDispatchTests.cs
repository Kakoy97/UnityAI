using System.Threading.Tasks;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityAI.Editor.Codex.Infrastructure.Queries;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityQueryRegistryDispatchTests
    {
        [Test]
        public void Dispatch_SsotRequest_UsesMainThreadGate_AndReturnsPayload()
        {
            var registry = new UnityQueryRegistry();
            registry.Register(new GateStubHandler(UnityQueryTypes.SsotRequest));

            var gateCalled = false;
            var expectedResponse = new UnityGetSceneRootsResponse
            {
                ok = true,
                request_id = "req_registry_ssot",
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
                    UnityQueryTypes.SsotRequest,
                    new UnityPulledQuery
                    {
                        query_type = UnityQueryTypes.SsotRequest,
                        request_id = "req_registry_ssot"
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
            var payload = result.payload as UnityGetSceneRootsResponse;
            Assert.NotNull(payload);
            Assert.AreEqual("req_registry_ssot", payload.request_id);
        }

        [Test]
        public void ExecutionContext_ParsesQueryPayloadJson_WhenValid()
        {
            var context = BuildExecutionContext();
            var pulledQuery = new UnityPulledQuery
            {
                query_type = UnityQueryTypes.SsotRequest,
                query_payload_json = "{\"folder_path\":\"Assets/New\",\"recursive\":true,\"include_meta\":true,\"limit\":11}"
            };

            var payload = context.GetQueryPayloadOrDefault<UnityListAssetsInFolderPayload>(pulledQuery);

            Assert.NotNull(payload);
            Assert.AreEqual("Assets/New", payload.folder_path);
            Assert.IsTrue(payload.recursive);
            Assert.IsTrue(payload.include_meta);
            Assert.AreEqual(11, payload.limit);
        }

        [Test]
        public void ExecutionContext_ReturnsDefaultPayload_WhenQueryPayloadJsonInvalid()
        {
            var context = BuildExecutionContext();
            var pulledQuery = new UnityPulledQuery
            {
                query_type = UnityQueryTypes.SsotRequest,
                query_payload_json = "{invalid_json}"
            };

            var payload = context.GetQueryPayloadOrDefault<UnityListAssetsInFolderPayload>(pulledQuery);

            Assert.NotNull(payload);
            Assert.IsTrue(string.IsNullOrEmpty(payload.folder_path));
            Assert.IsFalse(payload.recursive);
            Assert.IsFalse(payload.include_meta);
            Assert.AreEqual(0, payload.limit);
        }

        [Test]
        public void Dispatch_HandlerFailure_PropagatesErrorEnvelope()
        {
            var registry = new UnityQueryRegistry();
            registry.Register(new FailureStubHandler(UnityQueryTypes.SsotRequest));

            var result = registry.DispatchAsync(
                    UnityQueryTypes.SsotRequest,
                    new UnityPulledQuery
                    {
                        query_type = UnityQueryTypes.SsotRequest
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

        private sealed class GateStubHandler : IUnityQueryHandler
        {
            public GateStubHandler(string queryType)
            {
                QueryType = queryType;
            }

            public string QueryType { get; private set; }

            public async Task<UnityQueryHandlerResult> ExecuteAsync(
                UnityPulledQuery pulledQuery,
                UnityQueryExecutionContext context)
            {
                var response = await context.RunOnEditorMainThreadAsync(
                    () =>
                        new UnityGetSceneRootsResponse
                        {
                            ok = true,
                            request_id = pulledQuery == null ? string.Empty : pulledQuery.request_id,
                            error_code = string.Empty
                        });
                return UnityQueryHandlerResult.Success(response, string.Empty);
            }
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

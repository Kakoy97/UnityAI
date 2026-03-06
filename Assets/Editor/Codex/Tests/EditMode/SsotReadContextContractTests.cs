using NUnit.Framework;
using UnityAI.Editor.Codex.Generated.Ssot;
using UnityAI.Editor.Codex.Infrastructure.Ssot.Executors;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class SsotReadContextContractTests
    {
        [Test]
        public void GetSceneSnapshotForWrite_EmitsSceneRevision_AndNoReadTokenCandidate()
        {
            var executor = new GetSceneSnapshotForWriteSsotExecutor();
            var response = executor.Execute(new GetSceneSnapshotForWriteRequestDto
            {
                thread_id = "t_ssot_context_contract"
            });

            Assert.NotNull(response);
            Assert.IsTrue(response.ok);
            Assert.NotNull(response.data);
            Assert.IsFalse(string.IsNullOrEmpty(response.data.scene_revision));
            Assert.IsTrue(string.IsNullOrEmpty(response.data.read_token_candidate));
        }
    }
}

using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.Actions;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class CompositeAliasTableTests
    {
        [Test]
        public void TryBind_And_TryResolve_Succeeds_ForValidAlias()
        {
            var table = new CompositeAliasTable();
            var ok = table.TryBind(
                "hp_root",
                new UnityObjectAnchor
                {
                    object_id = "go_1",
                    path = "Scene/Canvas/HpRoot",
                },
                out var errorCode,
                out var errorMessage);

            Assert.IsTrue(ok);
            Assert.AreEqual(string.Empty, errorCode);
            Assert.AreEqual(string.Empty, errorMessage);

            UnityObjectAnchor resolved;
            ok = table.TryResolve("hp_root", out resolved, out errorCode, out errorMessage);

            Assert.IsTrue(ok);
            Assert.NotNull(resolved);
            Assert.AreEqual("go_1", resolved.object_id);
            Assert.AreEqual("Scene/Canvas/HpRoot", resolved.path);
        }

        [Test]
        public void TryResolve_ReturnsAliasNotFound_ForUnknownAlias()
        {
            var table = new CompositeAliasTable();
            UnityObjectAnchor resolved;
            var ok = table.TryResolve("unknown", out resolved, out var errorCode, out var errorMessage);

            Assert.IsFalse(ok);
            Assert.IsNull(resolved);
            Assert.AreEqual("E_COMPOSITE_ALIAS_NOT_FOUND", errorCode);
            Assert.IsNotEmpty(errorMessage);
        }

        [Test]
        public void TryBind_ReturnsDuplicated_WhenAliasAlreadyBound()
        {
            var table = new CompositeAliasTable();
            var first = table.TryBind(
                "hp_root",
                new UnityObjectAnchor
                {
                    object_id = "go_1",
                    path = "Scene/Canvas/HpRoot",
                },
                out _,
                out _);
            Assert.IsTrue(first);

            var second = table.TryBind(
                "hp_root",
                new UnityObjectAnchor
                {
                    object_id = "go_2",
                    path = "Scene/Canvas/HpRoot2",
                },
                out var errorCode,
                out var errorMessage);

            Assert.IsFalse(second);
            Assert.AreEqual("E_COMPOSITE_ALIAS_DUPLICATED", errorCode);
            Assert.IsNotEmpty(errorMessage);
        }
    }
}

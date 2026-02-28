using System;
using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class UnityAnchorExecutionTests
    {
        private const string NamePrefix = "__P3_QA__";
        private UnityVisualActionExecutor _executor;

        [SetUp]
        public void SetUp()
        {
            _executor = new UnityVisualActionExecutor();
        }

        [TearDown]
        public void TearDown()
        {
            var allObjects = UnityEngine.Object.FindObjectsOfType<GameObject>();
            for (var i = 0; i < allObjects.Length; i++)
            {
                var go = allObjects[i];
                if (go == null)
                {
                    continue;
                }

                if (!go.name.StartsWith(NamePrefix, StringComparison.Ordinal))
                {
                    continue;
                }

                UnityEngine.Object.DestroyImmediate(go);
            }
        }

        [Test]
        public void UnityActionRequestPayload_Deserializes_WriteAndActionAnchors()
        {
            const string json =
                "{" +
                "\"based_on_read_token\":\"tok_anchor_123456789012345678901234\"," +
                "\"requires_confirmation\":false," +
                "\"write_anchor\":{\"object_id\":\"go_root\",\"path\":\"Scene/Root\"}," +
                "\"action\":{" +
                "\"type\":\"create_gameobject\"," +
                "\"name\":\"Child\"," +
                "\"parent_anchor\":{\"object_id\":\"go_root\",\"path\":\"Scene/Root\"}" +
                "}" +
                "}";

            var payload = JsonUtility.FromJson<UnityActionRequestPayload>(json);

            Assert.NotNull(payload);
            Assert.NotNull(payload.write_anchor);
            Assert.AreEqual("go_root", payload.write_anchor.object_id);
            Assert.AreEqual("Scene/Root", payload.write_anchor.path);
            Assert.NotNull(payload.action);
            Assert.NotNull(payload.action.parent_anchor);
            Assert.AreEqual("go_root", payload.action.parent_anchor.object_id);
            Assert.AreEqual("Scene/Root", payload.action.parent_anchor.path);
        }

        [Test]
        public void Execute_Rejects_WhenTargetAnchorConflicts()
        {
            var goA = new GameObject(NamePrefix + "TargetA");
            var goB = new GameObject(NamePrefix + "TargetB");
            var action = new VisualLayerActionItem
            {
                type = "add_component",
                component_assembly_qualified_name =
                    "UnityEngine.Transform, UnityEngine.CoreModule",
                target_anchor = new UnityObjectAnchor
                {
                    object_id = BuildObjectId(goA),
                    path = BuildScenePath(goB.transform),
                },
            };

            var result = _executor.Execute(action, goA);

            Assert.NotNull(result);
            Assert.IsFalse(result.success);
            Assert.AreEqual("E_TARGET_ANCHOR_CONFLICT", result.errorCode);
        }

        [Test]
        public void Execute_CreateGameObject_Succeeds_WithValidParentAnchor()
        {
            var parent = new GameObject(NamePrefix + "Parent");
            var parentPath = BuildScenePath(parent.transform);
            var parentObjectId = BuildObjectId(parent);
            var childName = NamePrefix + "Child";
            var action = new VisualLayerActionItem
            {
                type = "create_gameobject",
                name = childName,
                parent_anchor = new UnityObjectAnchor
                {
                    object_id = parentObjectId,
                    path = parentPath,
                },
            };

            var result = _executor.Execute(action, parent);

            Assert.NotNull(result);
            Assert.IsTrue(result.success);
            Assert.AreEqual(parentPath, result.parentObjectPath);
            Assert.AreEqual(parentObjectId, result.parentObjectId);
            Assert.IsTrue(
                result.createdObjectPath.EndsWith("/" + childName, StringComparison.Ordinal));
            Assert.IsNotEmpty(result.createdObjectId);
        }

        private static string BuildObjectId(GameObject go)
        {
            var globalId = GlobalObjectId.GetGlobalObjectIdSlow(go);
            return globalId.ToString();
        }

        private static string BuildScenePath(Transform transform)
        {
            var current = transform;
            var path = current.name;
            while (current.parent != null)
            {
                current = current.parent;
                path = current.name + "/" + path;
            }

            return "Scene/" + path;
        }
    }
}


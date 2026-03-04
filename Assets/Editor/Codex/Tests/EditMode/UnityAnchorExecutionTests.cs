using System;
using System.Reflection;
using NUnit.Framework;
using UnityAI.Editor.Codex.Application;
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
                "\"type\":\"create_object\"," +
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
                target_anchor = new UnityObjectAnchor
                {
                    object_id = BuildObjectId(goA),
                    path = BuildScenePath(goB.transform),
                },
                action_data_json =
                    "{\"component_assembly_qualified_name\":\"UnityEngine.Transform, UnityEngine.CoreModule\"}",
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
                type = "create_object",
                parent_anchor = new UnityObjectAnchor
                {
                    object_id = parentObjectId,
                    path = parentPath,
                },
                action_data_json = "{\"name\":\"" + childName + "\"}",
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

        [Test]
        public void ConversationController_ValidateActionRequestPayload_CreateObjectAlias_AcceptsParentAnchorOnly()
        {
            var payload = new UnityActionRequestPayload
            {
                based_on_read_token = "tok_anchor_123456789012345678901234",
                write_anchor = new UnityObjectAnchor
                {
                    object_id = "go_canvas",
                    path = "Scene/Canvas",
                },
                action = new VisualLayerActionItem
                {
                    type = "create_object",
                    parent_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_canvas",
                        path = "Scene/Canvas",
                    },
                    action_data_json = "{\"name\":\"Button\",\"ui_type\":\"Button\"}",
                },
            };

            var args = new object[] { payload, null, null };
            var method = typeof(ConversationController).GetMethod(
                "TryValidateActionRequestPayload",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);
            var ok = (bool)method.Invoke(null, args);

            Assert.IsTrue(ok);
            Assert.IsTrue(string.IsNullOrEmpty(args[1] as string));
            Assert.IsTrue(string.IsNullOrEmpty(args[2] as string));
        }

        [Test]
        public void ConversationController_ValidateActionRequestPayload_CreateObjectAlias_RequiresParentAnchor()
        {
            var payload = new UnityActionRequestPayload
            {
                based_on_read_token = "tok_anchor_123456789012345678901234",
                write_anchor = new UnityObjectAnchor
                {
                    object_id = "go_canvas",
                    path = "Scene/Canvas",
                },
                action = new VisualLayerActionItem
                {
                    type = "create_object",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_canvas",
                        path = "Scene/Canvas",
                    },
                    action_data_json = "{\"name\":\"Button\",\"ui_type\":\"Button\"}",
                },
            };

            var args = new object[] { payload, null, null };
            var method = typeof(ConversationController).GetMethod(
                "TryValidateActionRequestPayload",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);
            var ok = (bool)method.Invoke(null, args);

            Assert.IsFalse(ok);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", args[1] as string);
            StringAssert.Contains("parent_anchor", args[2] as string);
        }

        [Test]
        public void ConversationController_ValidateActionRequestPayload_Fails_WhenWriteAnchorConflicts()
        {
            var payload = new UnityActionRequestPayload
            {
                based_on_read_token = "tok_anchor_123456789012345678901234",
                write_anchor = new UnityObjectAnchor
                {
                    object_id = "go_conflict",
                    path = "Scene/RootA",
                },
                action = new VisualLayerActionItem
                {
                    type = "add_component",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_conflict",
                        path = "Scene/RootB",
                    },
                    action_data_json =
                        "{\"component_assembly_qualified_name\":\"UnityEngine.Transform, UnityEngine.CoreModule\"}",
                },
            };

            var args = new object[] { payload, null, null };
            var method = typeof(ConversationController).GetMethod(
                "TryValidateActionRequestPayload",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);
            var ok = (bool)method.Invoke(null, args);
            Assert.IsFalse(ok);
            Assert.AreEqual("E_TARGET_ANCHOR_CONFLICT", args[1] as string);
        }

        [Test]
        public void ConversationController_ValidateActionRequestPayload_Fails_WhenWriteAnchorMissing()
        {
            var payload = new UnityActionRequestPayload
            {
                based_on_read_token = "tok_anchor_123456789012345678901234",
                write_anchor = null,
                action = new VisualLayerActionItem
                {
                    type = "create_object",
                    parent_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_root",
                        path = "Scene/Root",
                    },
                    action_data_json = "{\"name\":\"Child\"}",
                },
            };

            var args = new object[] { payload, null, null };
            var method = typeof(ConversationController).GetMethod(
                "TryValidateActionRequestPayload",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);
            var ok = (bool)method.Invoke(null, args);
            Assert.IsFalse(ok);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", args[1] as string);
        }

        [Test]
        public void ConversationController_ValidateActionRequestPayload_RejectsMalformedOptionalParentAnchor_ForMutationAction()
        {
            var payload = new UnityActionRequestPayload
            {
                based_on_read_token = "tok_anchor_123456789012345678901234",
                write_anchor = new UnityObjectAnchor
                {
                    object_id = "go_target",
                    path = "Scene/Canvas/Image",
                },
                action = new VisualLayerActionItem
                {
                    type = "rename_object",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_target",
                        path = "Scene/Canvas/Image",
                    },
                    parent_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_parent",
                        path = string.Empty,
                    },
                    action_data_json = "{\"name\":\"A\"}",
                },
            };

            var args = new object[] { payload, null, null };
            var method = typeof(ConversationController).GetMethod(
                "TryValidateActionRequestPayload",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);
            var ok = (bool)method.Invoke(null, args);

            Assert.IsFalse(ok);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", args[1] as string);
            StringAssert.Contains("target_anchor/parent_anchor", args[2] as string);
        }

        [Test]
        public void ConversationController_ValidateActionRequestPayload_RenameObject_RequiresActionDataName_ByContract()
        {
            var payload = new UnityActionRequestPayload
            {
                based_on_read_token = "tok_anchor_123456789012345678901234",
                write_anchor = new UnityObjectAnchor
                {
                    object_id = "go_target",
                    path = "Scene/Canvas/Image",
                },
                action = new VisualLayerActionItem
                {
                    type = "rename_object",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_target",
                        path = "Scene/Canvas/Image",
                    },
                    action_data_json = "{}",
                },
            };

            var args = new object[] { payload, null, null };
            var method = typeof(ConversationController).GetMethod(
                "TryValidateActionRequestPayload",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);
            var ok = (bool)method.Invoke(null, args);

            Assert.IsFalse(ok);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", args[1] as string);
            StringAssert.Contains("action_data.name", args[2] as string);
        }

        [Test]
        public void ConversationController_ValidateActionRequestPayload_SetActive_AcceptsFalseBooleanFromActionData()
        {
            var payload = new UnityActionRequestPayload
            {
                based_on_read_token = "tok_anchor_123456789012345678901234",
                write_anchor = new UnityObjectAnchor
                {
                    object_id = "go_target",
                    path = "Scene/Canvas/Image",
                },
                action = new VisualLayerActionItem
                {
                    type = "set_active",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_target",
                        path = "Scene/Canvas/Image",
                    },
                    action_data_json = "{\"active\":false}",
                },
            };

            var args = new object[] { payload, null, null };
            var method = typeof(ConversationController).GetMethod(
                "TryValidateActionRequestPayload",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);
            var ok = (bool)method.Invoke(null, args);

            Assert.IsTrue(ok);
            Assert.IsTrue(string.IsNullOrEmpty(args[1] as string));
            Assert.IsTrue(string.IsNullOrEmpty(args[2] as string));
        }

        [Test]
        public void ConversationController_ValidateActionRequestPayload_SetParent_RequiresTargetAndParentAnchors_ByContractPolicy()
        {
            var payload = new UnityActionRequestPayload
            {
                based_on_read_token = "tok_anchor_123456789012345678901234",
                write_anchor = new UnityObjectAnchor
                {
                    object_id = "go_target",
                    path = "Scene/Canvas/Image",
                },
                action = new VisualLayerActionItem
                {
                    type = "set_parent",
                    target_anchor = new UnityObjectAnchor
                    {
                        object_id = "go_target",
                        path = "Scene/Canvas/Image",
                    },
                    action_data_json = "{}",
                },
            };

            var args = new object[] { payload, null, null };
            var method = typeof(ConversationController).GetMethod(
                "TryValidateActionRequestPayload",
                BindingFlags.NonPublic | BindingFlags.Static);
            Assert.NotNull(method);
            var ok = (bool)method.Invoke(null, args);

            Assert.IsFalse(ok);
            Assert.AreEqual("E_ACTION_SCHEMA_INVALID", args[1] as string);
            StringAssert.Contains("target_and_parent_required", args[2] as string);
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

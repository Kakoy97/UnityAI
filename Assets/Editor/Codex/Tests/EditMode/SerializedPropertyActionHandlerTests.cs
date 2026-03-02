using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class SerializedPropertyActionHandlerTests
    {
        [Test]
        public void Execute_SetSerializedProperty_UpdatesSupportedValueKinds()
        {
            var root = new GameObject("R16_SET_SERIALIZED_PROPERTY_ROOT");
            var component = root.AddComponent<SerializedPropertyFixtureComponent>();
            try
            {
                var payload = new SerializedPropertyActionData
                {
                    component_selector = new SerializedPropertyComponentSelector
                    {
                        component_assembly_qualified_name =
                            typeof(SerializedPropertyFixtureComponent).AssemblyQualifiedName,
                        component_index = 0,
                    },
                    patches = new[]
                    {
                        new SerializedPropertyPatchItem
                        {
                            property_path = "intValue",
                            value_kind = "integer",
                            int_value = 7,
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "floatValue",
                            value_kind = "float",
                            float_value = 3.5f,
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "stringValue",
                            value_kind = "string",
                            string_value = "updated",
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "enumValue",
                            value_kind = "enum",
                            enum_name = "Third",
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "vector2Value",
                            value_kind = "vector2",
                            vector2_value = new SerializedPropertyVector2Dto
                            {
                                x = 11f,
                                y = 12f,
                            },
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "vector3Value",
                            value_kind = "vector3",
                            vector3_value = new SerializedPropertyVector3Dto
                            {
                                x = 21f,
                                y = 22f,
                                z = 23f,
                            },
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "colorValue",
                            value_kind = "color",
                            color_value = new SerializedPropertyColorDto
                            {
                                r = 0.3f,
                                g = 0.4f,
                                b = 0.5f,
                                a = 1f,
                            },
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "intArray",
                            value_kind = "array",
                            array_size = 5,
                        },
                    },
                };

                var action = new VisualLayerActionItem
                {
                    type = "set_serialized_property",
                    target_anchor = BuildAnchor(root),
                    action_data_json = JsonUtility.ToJson(payload),
                };

                var executor = new UnityVisualActionExecutor();
                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success, result.errorCode + " " + result.errorMessage);
                Assert.AreEqual(string.Empty, result.errorCode);

                Assert.AreEqual(7, component.intValue);
                Assert.AreEqual(3.5f, component.floatValue, 0.0001f);
                Assert.AreEqual("updated", component.stringValue);
                Assert.AreEqual(SerializedPropertyFixtureEnum.Third, component.enumValue);
                Assert.AreEqual(new Vector2(11f, 12f), component.vector2Value);
                Assert.AreEqual(new Vector3(21f, 22f, 23f), component.vector3Value);
                Assert.AreEqual(new Color(0.3f, 0.4f, 0.5f, 1f), component.colorValue);
                Assert.NotNull(component.intArray);
                Assert.AreEqual(5, component.intArray.Length);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_ObjectReferenceFromScene_Succeeds()
        {
            var root = new GameObject("R16_SET_SERIALIZED_PROPERTY_OBJECT_REF");
            var reference = new GameObject("R16_SET_SERIALIZED_PROPERTY_OBJECT_REF_TARGET", typeof(CanvasGroup));
            var fixture = root.AddComponent<SerializedPropertyFixtureComponent>();
            try
            {
                var payload = new SerializedPropertyActionData
                {
                    component_selector = new SerializedPropertyComponentSelector
                    {
                        component_assembly_qualified_name =
                            typeof(SerializedPropertyFixtureComponent).AssemblyQualifiedName,
                        component_index = 0,
                    },
                    patches = new[]
                    {
                        new SerializedPropertyPatchItem
                        {
                            property_path = "objectRef",
                            value_kind = "object_reference",
                            object_ref = new SerializedPropertyObjectReferenceDto
                            {
                                scene_anchor = BuildAnchor(reference),
                            },
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "canvasGroupRef",
                            value_kind = "object_reference",
                            object_ref = new SerializedPropertyObjectReferenceDto
                            {
                                scene_anchor = BuildAnchor(reference),
                            },
                        },
                    },
                };

                var action = new VisualLayerActionItem
                {
                    type = "set_serialized_property",
                    target_anchor = BuildAnchor(root),
                    action_data_json = JsonUtility.ToJson(payload),
                };

                var executor = new UnityVisualActionExecutor();
                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success, result.errorCode + " " + result.errorMessage);
                Assert.AreEqual(reference, fixture.objectRef);
                Assert.AreEqual(reference.GetComponent<CanvasGroup>(), fixture.canvasGroupRef);
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(reference);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_ObjectReference_ReturnsNotFoundError()
        {
            var root = new GameObject("R16_SET_SERIALIZED_PROPERTY_OBJECT_REF_NOT_FOUND");
            root.AddComponent<SerializedPropertyFixtureComponent>();
            try
            {
                var payload = new SerializedPropertyActionData
                {
                    component_selector = new SerializedPropertyComponentSelector
                    {
                        component_assembly_qualified_name =
                            typeof(SerializedPropertyFixtureComponent).AssemblyQualifiedName,
                        component_index = 0,
                    },
                    patches = new[]
                    {
                        new SerializedPropertyPatchItem
                        {
                            property_path = "objectRef",
                            value_kind = "object_reference",
                            object_ref = new SerializedPropertyObjectReferenceDto
                            {
                                asset_guid = "00000000000000000000000000000000",
                            },
                        },
                    },
                };

                var action = new VisualLayerActionItem
                {
                    type = "set_serialized_property",
                    target_anchor = BuildAnchor(root),
                    action_data_json = JsonUtility.ToJson(payload),
                };

                var executor = new UnityVisualActionExecutor();
                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_OBJECT_REF_NOT_FOUND", result.errorCode);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_ObjectReference_ReturnsTypeMismatchError()
        {
            var root = new GameObject("R16_SET_SERIALIZED_PROPERTY_OBJECT_REF_TYPE_MISMATCH");
            root.AddComponent<SerializedPropertyFixtureComponent>();
            var assetPath = AssetDatabase.GenerateUniqueAssetPath(
                "Assets/__R16_SET_SERIALIZED_PROPERTY_FIXTURE_TEXTURE.asset");
            AssetDatabase.DeleteAsset(assetPath);
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            texture.SetPixel(0, 0, Color.white);
            texture.SetPixel(1, 1, Color.black);
            texture.Apply();
            AssetDatabase.CreateAsset(texture, assetPath);
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport);
            AssetDatabase.SaveAssets();

            var assetGuid = AssetDatabase.AssetPathToGUID(assetPath);
            Assert.IsFalse(string.IsNullOrWhiteSpace(assetGuid), "Test fixture asset GUID must be resolvable.");
            Assert.NotNull(
                AssetDatabase.LoadMainAssetAtPath(assetPath),
                "Test fixture asset must be loadable before executing action.");

            try
            {
                var payload = new SerializedPropertyActionData
                {
                    component_selector = new SerializedPropertyComponentSelector
                    {
                        component_assembly_qualified_name =
                            typeof(SerializedPropertyFixtureComponent).AssemblyQualifiedName,
                        component_index = 0,
                    },
                    patches = new[]
                    {
                        new SerializedPropertyPatchItem
                        {
                            property_path = "objectRef",
                            value_kind = "object_reference",
                            object_ref = new SerializedPropertyObjectReferenceDto
                            {
                                asset_guid = assetGuid,
                                asset_path = assetPath,
                            },
                        },
                    },
                };

                var action = new VisualLayerActionItem
                {
                    type = "set_serialized_property",
                    target_anchor = BuildAnchor(root),
                    action_data_json = JsonUtility.ToJson(payload),
                };

                var executor = new UnityVisualActionExecutor();
                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_OBJECT_REF_TYPE_MISMATCH", result.errorCode);
            }
            finally
            {
                AssetDatabase.DeleteAsset(assetPath);
                AssetDatabase.SaveAssets();
                Object.DestroyImmediate(texture);
                Object.DestroyImmediate(root);
            }
        }

        private static UnityObjectAnchor BuildAnchor(GameObject target)
        {
            return new UnityObjectAnchor
            {
                object_id = BuildObjectId(target),
                path = "Scene/" + target.name,
            };
        }

        private static string BuildObjectId(GameObject target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            return GlobalObjectId.GetGlobalObjectIdSlow(target).ToString();
        }

        private enum SerializedPropertyFixtureEnum
        {
            First = 0,
            Second = 1,
            Third = 2,
        }

        private sealed class SerializedPropertyFixtureComponent : MonoBehaviour
        {
            public int intValue = 1;
            public float floatValue = 1f;
            public string stringValue = "seed";
            public SerializedPropertyFixtureEnum enumValue = SerializedPropertyFixtureEnum.Second;
            public Vector2 vector2Value = new Vector2(1f, 2f);
            public Vector3 vector3Value = new Vector3(1f, 2f, 3f);
            public Color colorValue = new Color(0.1f, 0.2f, 0.3f, 1f);
            public int[] intArray = new[] { 1, 2, 3 };
            public GameObject objectRef;
            public CanvasGroup canvasGroupRef;
        }

    }
}

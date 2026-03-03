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
                            property_path = "boolValue",
                            value_kind = "bool",
                            bool_value = false,
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
                Assert.IsFalse(component.boolValue);
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
        public void Execute_SetSerializedProperty_RejectsPatchCountOverLimit()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_PATCH_LIMIT");
            var component = root.AddComponent<SerializedPropertyFixtureComponent>();
            try
            {
                var patches = new SerializedPropertyPatchItem[65];
                for (var i = 0; i < patches.Length; i++)
                {
                    patches[i] = new SerializedPropertyPatchItem
                    {
                        property_path = "intValue",
                        value_kind = "integer",
                        int_value = i,
                    };
                }

                var payload = new SerializedPropertyActionData
                {
                    component_selector = new SerializedPropertyComponentSelector
                    {
                        component_assembly_qualified_name =
                            typeof(SerializedPropertyFixtureComponent).AssemblyQualifiedName,
                        component_index = 0,
                    },
                    patches = patches,
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
                Assert.AreEqual("E_ACTION_SCHEMA_INVALID", result.errorCode);
                StringAssert.Contains("max allowed 64", result.errorMessage);
                Assert.AreEqual(1, component.intValue);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_ArrayRemove_UsesDescendingIndexOrder()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_ARRAY_REMOVE_ORDER");
            var component = root.AddComponent<SerializedPropertyFixtureComponent>();
            component.intArray = new[] { 1, 2, 3, 4 };
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
                            property_path = "intArray",
                            value_kind = "array",
                            op = "remove",
                            indices = new[] { 1, 2 },
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
                CollectionAssert.AreEqual(new[] { 1, 4 }, component.intArray);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_ArrayRemove_ObjectReferenceShrinksArray()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_ARRAY_REMOVE_OBJECT_REF");
            var refA = new GameObject("R17_SET_SERIALIZED_PROPERTY_ARRAY_REMOVE_OBJECT_REF_A");
            var refB = new GameObject("R17_SET_SERIALIZED_PROPERTY_ARRAY_REMOVE_OBJECT_REF_B");
            var component = root.AddComponent<SerializedPropertyFixtureComponent>();
            component.objectArray = new[] { refA, refB };
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
                            property_path = "objectArray",
                            value_kind = "array",
                            op = "remove",
                            index = 0,
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
                Assert.NotNull(component.objectArray);
                Assert.AreEqual(1, component.objectArray.Length);
                Assert.AreEqual(refB, component.objectArray[0]);
            }
            finally
            {
                Object.DestroyImmediate(root);
                Object.DestroyImmediate(refA);
                Object.DestroyImmediate(refB);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_DryRun_DoesNotMutateAndReturnsPatchSummary()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_DRY_RUN_OK");
            var component = root.AddComponent<SerializedPropertyFixtureComponent>();
            try
            {
                var payload = new SerializedPropertyActionData
                {
                    dry_run = true,
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
                            int_value = 9,
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "boolValue",
                            value_kind = "bool",
                            bool_value = false,
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
                Assert.AreEqual(1, component.intValue);
                Assert.IsTrue(component.boolValue);

                Assert.NotNull(result.resultData);
                Assert.IsTrue(result.resultData.dry_run);
                Assert.IsTrue(result.resultData.validation_passed);
                Assert.AreEqual(2, result.resultData.patch_count);
                Assert.NotNull(result.resultData.patch_results);
                Assert.AreEqual(2, result.resultData.patch_results.Length);
                Assert.AreEqual("ok", result.resultData.patch_results[0].status);
                Assert.AreEqual("ok", result.resultData.patch_results[1].status);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_DryRun_FailureReturnsPatchSummaryAndNoMutation()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_DRY_RUN_FAIL");
            var component = root.AddComponent<SerializedPropertyFixtureComponent>();
            try
            {
                var payload = new SerializedPropertyActionData
                {
                    dry_run = true,
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
                            int_value = 9,
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "missingField",
                            value_kind = "integer",
                            int_value = 1,
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
                Assert.AreEqual("E_ACTION_PROPERTY_NOT_FOUND", result.errorCode);
                Assert.AreEqual(1, component.intValue);

                Assert.NotNull(result.resultData);
                Assert.IsTrue(result.resultData.dry_run);
                Assert.IsFalse(result.resultData.validation_passed);
                Assert.AreEqual(2, result.resultData.patch_count);
                Assert.NotNull(result.resultData.patch_results);
                Assert.AreEqual(2, result.resultData.patch_results.Length);
                Assert.AreEqual("ok", result.resultData.patch_results[0].status);
                Assert.AreEqual("error", result.resultData.patch_results[1].status);
                Assert.AreEqual(
                    "E_ACTION_PROPERTY_NOT_FOUND",
                    result.resultData.patch_results[1].error_code);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_UpdatesQuaternionVector4RectKinds()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_COMPLEX_STRUCTS");
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
                            property_path = "quaternionValue",
                            value_kind = "quaternion",
                            quaternion_value = new SerializedPropertyQuaternionDto
                            {
                                x = 0f,
                                y = 0.5f,
                                z = 0f,
                                w = 0.8660254f,
                            },
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "vector4Value",
                            value_kind = "vector4",
                            vector4_value = new SerializedPropertyVector4Dto
                            {
                                x = 10f,
                                y = 11f,
                                z = 12f,
                                w = 13f,
                            },
                        },
                        new SerializedPropertyPatchItem
                        {
                            property_path = "rectValue",
                            value_kind = "rect",
                            rect_value = new SerializedPropertyRectDto
                            {
                                x = 5f,
                                y = 6f,
                                width = 70f,
                                height = 80f,
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
                Assert.AreEqual(new Quaternion(0f, 0.5f, 0f, 0.8660254f), component.quaternionValue);
                Assert.AreEqual(new Vector4(10f, 11f, 12f, 13f), component.vector4Value);
                Assert.AreEqual(new Rect(5f, 6f, 70f, 80f), component.rectValue);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_AnimationCurve_IsWriteRestricted()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_ANIMATION_CURVE_RESTRICTED");
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
                            property_path = "animationCurveValue",
                            value_kind = "animation_curve",
                            animation_curve_value = new SerializedPropertyAnimationCurveDto
                            {
                                keys = new[]
                                {
                                    new SerializedPropertyAnimationCurveKeyDto
                                    {
                                        time = 0f,
                                        value = 0f,
                                        in_tangent = 0f,
                                        out_tangent = 0f,
                                    },
                                },
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
                Assert.AreEqual("E_ACTION_PROPERTY_WRITE_RESTRICTED", result.errorCode);
                StringAssert.Contains("AnimationCurve", result.errorMessage);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_ManagedReferenceRoot_IsWriteRestricted()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_MANAGED_REFERENCE_ROOT_RESTRICTED");
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
                            property_path = "managedReferenceValue",
                            value_kind = "string",
                            string_value = "blocked",
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
                Assert.AreEqual("E_ACTION_PROPERTY_WRITE_RESTRICTED", result.errorCode);
                StringAssert.Contains("ManagedReference", result.errorMessage);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetSerializedProperty_ManagedReferenceChild_IsWriteRestricted()
        {
            var root = new GameObject("R17_SET_SERIALIZED_PROPERTY_MANAGED_REFERENCE_CHILD_RESTRICTED");
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
                            property_path = "managedReferenceValue.intValue",
                            value_kind = "integer",
                            int_value = 99,
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
                Assert.AreEqual("E_ACTION_PROPERTY_WRITE_RESTRICTED", result.errorCode);
                StringAssert.Contains("ManagedReference", result.errorMessage);
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

        [System.Serializable]
        private abstract class SerializedPropertyManagedReferenceBase
        {
            public int intValue;
        }

        [System.Serializable]
        private sealed class SerializedPropertyManagedReferenceDerived
            : SerializedPropertyManagedReferenceBase
        {
            public string label = "seed";
        }

        private sealed class SerializedPropertyFixtureComponent : MonoBehaviour
        {
            public int intValue = 1;
            public float floatValue = 1f;
            public string stringValue = "seed";
            public bool boolValue = true;
            public SerializedPropertyFixtureEnum enumValue = SerializedPropertyFixtureEnum.Second;
            public Quaternion quaternionValue = Quaternion.identity;
            public Vector4 vector4Value = new Vector4(1f, 2f, 3f, 4f);
            public Vector2 vector2Value = new Vector2(1f, 2f);
            public Vector3 vector3Value = new Vector3(1f, 2f, 3f);
            public Rect rectValue = new Rect(1f, 2f, 3f, 4f);
            public Color colorValue = new Color(0.1f, 0.2f, 0.3f, 1f);
            public AnimationCurve animationCurveValue = AnimationCurve.Linear(0f, 0f, 1f, 1f);
            public int[] intArray = new[] { 1, 2, 3 };
            public GameObject objectRef;
            public CanvasGroup canvasGroupRef;
            public GameObject[] objectArray = new GameObject[0];
            [SerializeReference]
            public SerializedPropertyManagedReferenceBase managedReferenceValue =
                new SerializedPropertyManagedReferenceDerived
                {
                    intValue = 7,
                };
        }

    }
}

using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    internal static class AtomicActionAssert
    {
        private const float Tolerance = 0.001f;

        public static void AreVector2Equal(Vector2 expected, Vector2 actual)
        {
            Assert.AreEqual(expected.x, actual.x, Tolerance);
            Assert.AreEqual(expected.y, actual.y, Tolerance);
        }

        public static void AreVector3Equal(Vector3 expected, Vector3 actual)
        {
            Assert.AreEqual(expected.x, actual.x, Tolerance);
            Assert.AreEqual(expected.y, actual.y, Tolerance);
            Assert.AreEqual(expected.z, actual.z, Tolerance);
        }

        public static void AreColorEqual(Color expected, Color actual)
        {
            Assert.AreEqual(expected.r, actual.r, Tolerance);
            Assert.AreEqual(expected.g, actual.g, Tolerance);
            Assert.AreEqual(expected.b, actual.b, Tolerance);
            Assert.AreEqual(expected.a, actual.a, Tolerance);
        }
    }

    internal static class AtomicActionFixture
    {
        public const string CanvasRendererAqn = "UnityEngine.CanvasRenderer, UnityEngine.UIModule";
        public const string AudioSourceAqn = "UnityEngine.AudioSource, UnityEngine.AudioModule";
    }

    public sealed class AddComponentAtomicActionTests : AtomicActionTestBase
    {
        protected override string ActionType { get { return "add_component"; } }

        protected override GameObject CreateTarget()
        {
            return CreateTaggedGameObject();
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json =
                    "{\"component_assembly_qualified_name\":\"" +
                    AtomicActionFixture.CanvasRendererAqn +
                    "\"}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.NotNull(target.GetComponent<CanvasRenderer>());
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.IsNull(target.GetComponent<CanvasRenderer>());
        }
    }

    public sealed class RemoveComponentAtomicActionTests : AtomicActionTestBase
    {
        protected override string ActionType { get { return "remove_component"; } }

        protected override GameObject CreateTarget()
        {
            return CreateTaggedGameObject(typeof(CanvasRenderer));
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json =
                    "{\"component_assembly_qualified_name\":\"" +
                    AtomicActionFixture.CanvasRendererAqn +
                    "\"}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.IsNull(target.GetComponent<CanvasRenderer>());
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.NotNull(target.GetComponent<CanvasRenderer>());
        }
    }

    public sealed class ReplaceComponentAtomicActionTests : AtomicActionTestBase
    {
        protected override string ActionType { get { return "replace_component"; } }

        protected override GameObject CreateTarget()
        {
            return CreateTaggedGameObject(typeof(CanvasRenderer));
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json =
                    "{\"source_component_assembly_qualified_name\":\"" +
                    AtomicActionFixture.CanvasRendererAqn +
                    "\",\"component_assembly_qualified_name\":\"" +
                    AtomicActionFixture.AudioSourceAqn +
                    "\"}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.IsNull(target.GetComponent<CanvasRenderer>());
            Assert.NotNull(target.GetComponent<AudioSource>());
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.NotNull(target.GetComponent<CanvasRenderer>());
            Assert.IsNull(target.GetComponent<AudioSource>());
        }
    }

    public sealed class CreateGameObjectAtomicActionTests : AtomicActionTestBase
    {
        private string _createdName;

        protected override string ActionType { get { return "create_gameobject"; } }

        protected override GameObject CreateTarget()
        {
            _createdName = ObjectPrefix + "created_child";
            return CreateTaggedGameObject();
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                parent_anchor = BuildAnchor(target),
                action_data_json = "{\"name\":\"" + _createdName + "\"}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.NotNull(target.transform.Find(_createdName));
            Assert.NotNull(executionResult);
            Assert.IsFalse(string.IsNullOrWhiteSpace(executionResult.createdObjectId));
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.IsNull(target.transform.Find(_createdName));
        }
    }

    public sealed class RenameGameObjectAtomicActionTests : AtomicActionTestBase
    {
        private string _originalName;
        private string _renamedName;

        protected override string ActionType { get { return "rename_gameobject"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject();
            _originalName = target.name;
            _renamedName = ObjectPrefix + "renamed_target";
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"name\":\"" + _renamedName + "\"}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.AreEqual(_renamedName, target.name);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.AreEqual(_originalName, target.name);
        }
    }

    public sealed class SetTransformLocalPositionAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector3 _appliedValue = new Vector3(3f, 5f, 7f);
        private Vector3 _originalValue;

        protected override string ActionType { get { return "set_transform_local_position"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject();
            _originalValue = target.transform.localPosition;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"x\":3,\"y\":5,\"z\":7}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            AtomicActionAssert.AreVector3Equal(_appliedValue, target.transform.localPosition);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            AtomicActionAssert.AreVector3Equal(_originalValue, target.transform.localPosition);
        }
    }

    public sealed class DestroyGameObjectAtomicActionTests : AtomicActionTestBase
    {
        private string _targetName;

        protected override string ActionType { get { return "destroy_gameobject"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject();
            _targetName = target.name;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.IsNull(GameObject.Find(_targetName));
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.NotNull(GameObject.Find(_targetName));
        }
    }

    public sealed class SetTransformLocalRotationAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector3 _appliedEuler = new Vector3(10f, 25f, 40f);
        private Quaternion _originalValue;

        protected override string ActionType { get { return "set_transform_local_rotation"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject();
            _originalValue = target.transform.localRotation;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"x\":10,\"y\":25,\"z\":40}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.Less(
                Quaternion.Angle(Quaternion.Euler(_appliedEuler), target.transform.localRotation),
                0.1f);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.Less(Quaternion.Angle(_originalValue, target.transform.localRotation), 0.1f);
        }
    }

    public sealed class SetTransformLocalScaleAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector3 _appliedValue = new Vector3(1.5f, 2f, 0.75f);
        private Vector3 _originalValue;

        protected override string ActionType { get { return "set_transform_local_scale"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject();
            _originalValue = target.transform.localScale;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"x\":1.5,\"y\":2.0,\"z\":0.75}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            AtomicActionAssert.AreVector3Equal(_appliedValue, target.transform.localScale);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            AtomicActionAssert.AreVector3Equal(_originalValue, target.transform.localScale);
        }
    }

    public sealed class SetTransformWorldPositionAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector3 _appliedValue = new Vector3(8f, 6f, 4f);
        private Vector3 _originalValue;

        protected override string ActionType { get { return "set_transform_world_position"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject();
            _originalValue = target.transform.position;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"x\":8,\"y\":6,\"z\":4}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            AtomicActionAssert.AreVector3Equal(_appliedValue, target.transform.position);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            AtomicActionAssert.AreVector3Equal(_originalValue, target.transform.position);
        }
    }

    public sealed class SetTransformWorldRotationAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector3 _appliedEuler = new Vector3(15f, 45f, 75f);
        private Quaternion _originalValue;

        protected override string ActionType { get { return "set_transform_world_rotation"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject();
            _originalValue = target.transform.rotation;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"x\":15,\"y\":45,\"z\":75}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.Less(Quaternion.Angle(Quaternion.Euler(_appliedEuler), target.transform.rotation), 0.1f);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.Less(Quaternion.Angle(_originalValue, target.transform.rotation), 0.1f);
        }
    }

    public sealed class SetRectTransformAnchoredPositionAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector2 _appliedValue = new Vector2(30f, -40f);
        private Vector2 _originalValue;

        protected override string ActionType { get { return "set_rect_transform_anchored_position"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform));
            _originalValue = target.GetComponent<RectTransform>().anchoredPosition;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"x\":30,\"y\":-40}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            AtomicActionAssert.AreVector2Equal(
                _appliedValue,
                target.GetComponent<RectTransform>().anchoredPosition);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            AtomicActionAssert.AreVector2Equal(
                _originalValue,
                target.GetComponent<RectTransform>().anchoredPosition);
        }
    }

    public sealed class SetRectTransformSizeDeltaAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector2 _appliedValue = new Vector2(240f, 96f);
        private Vector2 _originalValue;

        protected override string ActionType { get { return "set_rect_transform_size_delta"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform));
            _originalValue = target.GetComponent<RectTransform>().sizeDelta;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"x\":240,\"y\":96}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            AtomicActionAssert.AreVector2Equal(
                _appliedValue,
                target.GetComponent<RectTransform>().sizeDelta);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            AtomicActionAssert.AreVector2Equal(
                _originalValue,
                target.GetComponent<RectTransform>().sizeDelta);
        }
    }

    public sealed class SetRectTransformPivotAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector2 _appliedValue = new Vector2(0.2f, 0.8f);
        private Vector2 _originalValue;

        protected override string ActionType { get { return "set_rect_transform_pivot"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform));
            _originalValue = target.GetComponent<RectTransform>().pivot;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"x\":0.2,\"y\":0.8}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            AtomicActionAssert.AreVector2Equal(
                _appliedValue,
                target.GetComponent<RectTransform>().pivot);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            AtomicActionAssert.AreVector2Equal(
                _originalValue,
                target.GetComponent<RectTransform>().pivot);
        }
    }

    public sealed class SetRectTransformAnchorsAtomicActionTests : AtomicActionTestBase
    {
        private readonly Vector2 _appliedMin = new Vector2(0.1f, 0.2f);
        private readonly Vector2 _appliedMax = new Vector2(0.9f, 0.95f);
        private Vector2 _originalMin;
        private Vector2 _originalMax;

        protected override string ActionType { get { return "set_rect_transform_anchors"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform));
            var rect = target.GetComponent<RectTransform>();
            _originalMin = rect.anchorMin;
            _originalMax = rect.anchorMax;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"min_x\":0.1,\"min_y\":0.2,\"max_x\":0.9,\"max_y\":0.95}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            var rect = target.GetComponent<RectTransform>();
            AtomicActionAssert.AreVector2Equal(_appliedMin, rect.anchorMin);
            AtomicActionAssert.AreVector2Equal(_appliedMax, rect.anchorMax);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            var rect = target.GetComponent<RectTransform>();
            AtomicActionAssert.AreVector2Equal(_originalMin, rect.anchorMin);
            AtomicActionAssert.AreVector2Equal(_originalMax, rect.anchorMax);
        }
    }

    public sealed class SetUiImageColorAtomicActionTests : AtomicActionTestBase
    {
        private readonly Color _appliedValue = new Color(0.8f, 0.2f, 0.4f, 1f);
        private Color _originalValue;

        protected override string ActionType { get { return "set_ui_image_color"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform), typeof(Image));
            _originalValue = target.GetComponent<Image>().color;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"r\":0.8,\"g\":0.2,\"b\":0.4,\"a\":1}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            AtomicActionAssert.AreColorEqual(_appliedValue, target.GetComponent<Image>().color);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            AtomicActionAssert.AreColorEqual(_originalValue, target.GetComponent<Image>().color);
        }
    }

    public sealed class SetUiImageRaycastTargetAtomicActionTests : AtomicActionTestBase
    {
        private bool _originalValue;

        protected override string ActionType { get { return "set_ui_image_raycast_target"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform), typeof(Image));
            _originalValue = target.GetComponent<Image>().raycastTarget;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"raycast_target\":false}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.IsFalse(target.GetComponent<Image>().raycastTarget);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.AreEqual(_originalValue, target.GetComponent<Image>().raycastTarget);
        }
    }

    public sealed class SetUiTextContentAtomicActionTests : AtomicActionTestBase
    {
        private string _originalValue;
        private string _appliedValue;

        protected override string ActionType { get { return "set_ui_text_content"; } }

        protected override GameObject CreateTarget()
        {
            _appliedValue = ObjectPrefix + "updated_text";
            var target = CreateTaggedGameObject(typeof(RectTransform), typeof(Text));
            var text = target.GetComponent<Text>();
            text.text = ObjectPrefix + "initial_text";
            _originalValue = text.text;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"text\":\"" + _appliedValue + "\"}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.AreEqual(_appliedValue, target.GetComponent<Text>().text);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.AreEqual(_originalValue, target.GetComponent<Text>().text);
        }
    }

    public sealed class SetUiTextColorAtomicActionTests : AtomicActionTestBase
    {
        private readonly Color _appliedValue = new Color(0.1f, 0.9f, 0.2f, 1f);
        private Color _originalValue;

        protected override string ActionType { get { return "set_ui_text_color"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform), typeof(Text));
            _originalValue = target.GetComponent<Text>().color;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"r\":0.1,\"g\":0.9,\"b\":0.2,\"a\":1}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            AtomicActionAssert.AreColorEqual(_appliedValue, target.GetComponent<Text>().color);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            AtomicActionAssert.AreColorEqual(_originalValue, target.GetComponent<Text>().color);
        }
    }

    public sealed class SetUiTextFontSizeAtomicActionTests : AtomicActionTestBase
    {
        private int _originalValue;
        private const int AppliedValue = 42;

        protected override string ActionType { get { return "set_ui_text_font_size"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform), typeof(Text));
            _originalValue = target.GetComponent<Text>().fontSize;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"font_size\":42}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.AreEqual(AppliedValue, target.GetComponent<Text>().fontSize);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.AreEqual(_originalValue, target.GetComponent<Text>().fontSize);
        }
    }

    public sealed class SetCanvasGroupAlphaAtomicActionTests : AtomicActionTestBase
    {
        private const float AppliedAlpha = 0.3f;
        private float _originalAlpha;

        protected override string ActionType { get { return "set_canvas_group_alpha"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(CanvasGroup));
            _originalAlpha = target.GetComponent<CanvasGroup>().alpha;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = "{\"alpha\":0.3}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.AreEqual(AppliedAlpha, target.GetComponent<CanvasGroup>().alpha, 0.001f);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.AreEqual(_originalAlpha, target.GetComponent<CanvasGroup>().alpha, 0.001f);
        }
    }

    public sealed class SetLayoutElementAtomicActionTests : AtomicActionTestBase
    {
        private struct LayoutSnapshot
        {
            public float MinWidth;
            public float MinHeight;
            public float PreferredWidth;
            public float PreferredHeight;
            public float FlexibleWidth;
            public float FlexibleHeight;
            public bool IgnoreLayout;
        }

        private LayoutSnapshot _original;

        protected override string ActionType { get { return "set_layout_element"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(RectTransform), typeof(LayoutElement));
            _original = Capture(target.GetComponent<LayoutElement>());
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json =
                    "{\"min_width\":100,\"min_height\":24,\"preferred_width\":180,\"preferred_height\":40,\"flexible_width\":1,\"flexible_height\":2,\"ignore_layout\":true}",
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            var element = target.GetComponent<LayoutElement>();
            Assert.AreEqual(100f, element.minWidth, 0.001f);
            Assert.AreEqual(24f, element.minHeight, 0.001f);
            Assert.AreEqual(180f, element.preferredWidth, 0.001f);
            Assert.AreEqual(40f, element.preferredHeight, 0.001f);
            Assert.AreEqual(1f, element.flexibleWidth, 0.001f);
            Assert.AreEqual(2f, element.flexibleHeight, 0.001f);
            Assert.IsTrue(element.ignoreLayout);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            var element = target.GetComponent<LayoutElement>();
            Assert.AreEqual(_original.MinWidth, element.minWidth, 0.001f);
            Assert.AreEqual(_original.MinHeight, element.minHeight, 0.001f);
            Assert.AreEqual(_original.PreferredWidth, element.preferredWidth, 0.001f);
            Assert.AreEqual(_original.PreferredHeight, element.preferredHeight, 0.001f);
            Assert.AreEqual(_original.FlexibleWidth, element.flexibleWidth, 0.001f);
            Assert.AreEqual(_original.FlexibleHeight, element.flexibleHeight, 0.001f);
            Assert.AreEqual(_original.IgnoreLayout, element.ignoreLayout);
        }

        private static LayoutSnapshot Capture(LayoutElement element)
        {
            return new LayoutSnapshot
            {
                MinWidth = element.minWidth,
                MinHeight = element.minHeight,
                PreferredWidth = element.preferredWidth,
                PreferredHeight = element.preferredHeight,
                FlexibleWidth = element.flexibleWidth,
                FlexibleHeight = element.flexibleHeight,
                IgnoreLayout = element.ignoreLayout,
            };
        }
    }

    public sealed class SetSerializedPropertyAtomicActionTests : AtomicActionTestBase
    {
        private const int AppliedIntValue = 123;
        private int _originalIntValue;

        protected override string ActionType { get { return "set_serialized_property"; } }

        protected override GameObject CreateTarget()
        {
            var target = CreateTaggedGameObject(typeof(AtomicSerializedPropertyFixtureComponent));
            _originalIntValue = target.GetComponent<AtomicSerializedPropertyFixtureComponent>().intValue;
            return target;
        }

        protected override VisualLayerActionItem BuildValidAction(GameObject target)
        {
            var payload = new SerializedPropertyActionData
            {
                component_selector = new SerializedPropertyComponentSelector
                {
                    component_assembly_qualified_name =
                        typeof(AtomicSerializedPropertyFixtureComponent).AssemblyQualifiedName,
                    component_index = 0,
                },
                patches = new[]
                {
                    new SerializedPropertyPatchItem
                    {
                        property_path = "intValue",
                        value_kind = "integer",
                        int_value = AppliedIntValue,
                    },
                },
            };

            return new VisualLayerActionItem
            {
                type = ActionType,
                target_anchor = BuildAnchor(target),
                action_data_json = JsonUtility.ToJson(payload),
            };
        }

        protected override void AssertApplied(GameObject target, UnityActionExecutionResult executionResult)
        {
            Assert.AreEqual(AppliedIntValue, target.GetComponent<AtomicSerializedPropertyFixtureComponent>().intValue);
        }

        protected override void AssertRolledBack(GameObject target)
        {
            Assert.AreEqual(_originalIntValue, target.GetComponent<AtomicSerializedPropertyFixtureComponent>().intValue);
        }
    }

    public sealed class AtomicSerializedPropertyFixtureComponent : MonoBehaviour
    {
        public int intValue = 5;
    }
}

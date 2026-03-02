using NUnit.Framework;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class ValuePackVisualActionHandlerTests
    {
        [Test]
        public void Execute_SetGameObjectActive_Succeeds()
        {
            var root = new GameObject("R10_SET_ACTIVE_ROOT");
            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = new VisualLayerActionItem
                {
                    type = "set_gameobject_active",
                    target_anchor = BuildAnchor(root),
                    action_data_json = "{\"active\":false}",
                };

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success);
                Assert.AreEqual(string.Empty, result.errorCode);
                Assert.IsFalse(root.activeSelf);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetUiImageColor_Succeeds()
        {
            var root = new GameObject(
                "R10_SET_IMAGE_COLOR_ROOT",
                typeof(RectTransform),
                typeof(Image));
            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = new VisualLayerActionItem
                {
                    type = "set_ui_image_color",
                    target_anchor = BuildAnchor(root),
                    action_data_json = "{\"r\":1,\"g\":0.25,\"b\":0.25,\"a\":1}",
                };

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsTrue(result.success);
                Assert.AreEqual(string.Empty, result.errorCode);
                var image = root.GetComponent<Image>();
                Assert.NotNull(image);
                Assert.AreEqual(1f, image.color.r, 0.0001f);
                Assert.AreEqual(0.25f, image.color.g, 0.0001f);
                Assert.AreEqual(0.25f, image.color.b, 0.0001f);
                Assert.AreEqual(1f, image.color.a, 0.0001f);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        [Test]
        public void Execute_SetRectTransformAnchors_Fails_WhenMinGreaterThanMax()
        {
            var root = new GameObject("R10_SET_ANCHORS_ROOT", typeof(RectTransform));
            try
            {
                var executor = new UnityVisualActionExecutor();
                var action = new VisualLayerActionItem
                {
                    type = "set_rect_transform_anchors",
                    target_anchor = BuildAnchor(root),
                    action_data_json = "{\"min_x\":0.8,\"min_y\":0.8,\"max_x\":0.2,\"max_y\":0.2}",
                };

                var result = executor.Execute(action, root);

                Assert.NotNull(result);
                Assert.IsFalse(result.success);
                Assert.AreEqual("E_ACTION_SCHEMA_INVALID", result.errorCode);
            }
            finally
            {
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
    }
}

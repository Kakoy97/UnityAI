using System.Collections.Generic;
using UnityEditor;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    public sealed class RollbackVerifier
    {
        public RollbackBaseline CaptureBaseline()
        {
            return new RollbackBaseline(CaptureDirtySceneKeys());
        }

        public RollbackVerificationResult VerifyAfterRollback(
            RollbackBaseline baseline,
            IEnumerable<int> expectedDestroyedInstanceIds)
        {
            if (baseline == null)
            {
                return RollbackVerificationResult.Fail("Rollback baseline is missing.");
            }

            if (expectedDestroyedInstanceIds != null)
            {
                foreach (var instanceId in expectedDestroyedInstanceIds)
                {
                    if (instanceId == 0)
                    {
                        continue;
                    }

                    if (EditorUtility.InstanceIDToObject(instanceId) != null)
                    {
                        return RollbackVerificationResult.Fail(
                            "Rollback leaked object instance id: " + instanceId);
                    }
                }
            }

            var currentDirty = CaptureDirtySceneKeys();
            foreach (var dirtyKey in currentDirty)
            {
                if (!baseline.DirtySceneKeys.Contains(dirtyKey))
                {
                    return RollbackVerificationResult.Fail(
                        "Rollback introduced new dirty scene: " + dirtyKey);
                }
            }

            return RollbackVerificationResult.Success();
        }

        private static HashSet<string> CaptureDirtySceneKeys()
        {
            var set = new HashSet<string>();
            for (var i = 0; i < SceneManager.sceneCount; i += 1)
            {
                var scene = SceneManager.GetSceneAt(i);
                if (!scene.IsValid() || !scene.isLoaded || !scene.isDirty)
                {
                    continue;
                }

                set.Add(NormalizeSceneKey(scene));
            }

            return set;
        }

        private static string NormalizeSceneKey(Scene scene)
        {
            if (!string.IsNullOrWhiteSpace(scene.path))
            {
                return scene.path.Trim();
            }

            if (!string.IsNullOrWhiteSpace(scene.name))
            {
                return scene.name.Trim();
            }

            return "scene_" + scene.handle;
        }
    }

    public sealed class RollbackBaseline
    {
        public RollbackBaseline(HashSet<string> dirtySceneKeys)
        {
            DirtySceneKeys = dirtySceneKeys ?? new HashSet<string>();
        }

        public HashSet<string> DirtySceneKeys { get; private set; }
    }

    public sealed class RollbackVerificationResult
    {
        private RollbackVerificationResult(bool ok, string message)
        {
            Ok = ok;
            Message = string.IsNullOrWhiteSpace(message) ? string.Empty : message.Trim();
        }

        public bool Ok { get; private set; }
        public string Message { get; private set; }

        public static RollbackVerificationResult Success()
        {
            return new RollbackVerificationResult(true, string.Empty);
        }

        public static RollbackVerificationResult Fail(string message)
        {
            return new RollbackVerificationResult(false, message);
        }
    }
}

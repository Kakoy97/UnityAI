using System;
using System.Threading;
using UnityEditor;
using UnityEditor.Compilation;

namespace UnityAI.Editor.Codex.Infrastructure
{
    [InitializeOnLoad]
    public static class UnitySceneRevisionTracker
    {
        private static long _revision;

        static UnitySceneRevisionTracker()
        {
            _revision = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            EditorApplication.hierarchyChanged += OnHierarchyChanged;
            Undo.undoRedoPerformed += OnUndoRedoPerformed;
            CompilationPipeline.compilationStarted += OnCompilationStarted;
            AssemblyReloadEvents.beforeAssemblyReload += OnBeforeAssemblyReload;
        }

        public static string CurrentRevision
        {
            get { return "rev_" + Interlocked.Read(ref _revision).ToString(); }
        }

        private static void OnHierarchyChanged()
        {
            Bump();
        }

        private static void OnUndoRedoPerformed()
        {
            Bump();
        }

        private static void OnCompilationStarted(object context)
        {
            Bump();
        }

        private static void OnBeforeAssemblyReload()
        {
            Bump();
        }

        private static void Bump()
        {
            Interlocked.Increment(ref _revision);
        }
    }
}

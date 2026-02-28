using System;
using System.Reflection;
using System.Threading;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class PrefabReadScope : IDisposable
    {
        private static readonly MethodInfo LoadPrefabContentsIntoOnlyInstancesMethod =
            typeof(PrefabUtility).GetMethod(
                "LoadPrefabContentsIntoOnlyInstances",
                BindingFlags.Public | BindingFlags.Static,
                null,
                new[] { typeof(string) },
                null);

        private static int _openCount;
        private static int _disposeCount;

        private int _disposeState;
        private GameObject _loadedRoot;

        public PrefabReadScope(string prefabPath)
        {
            PrefabPath = string.IsNullOrWhiteSpace(prefabPath) ? string.Empty : prefabPath.Trim();
            if (string.IsNullOrEmpty(PrefabPath))
            {
                throw new ArgumentException("prefabPath is required.", nameof(prefabPath));
            }

            Interlocked.Increment(ref _openCount);
            try
            {
                _loadedRoot = LoadPrefabContentsIntoOnlyInstances(PrefabPath);
                if (_loadedRoot == null)
                {
                    throw new InvalidOperationException(
                        "E_PREFAB_QUERY_FAILED: LoadPrefabContentsIntoOnlyInstances returned null for " +
                        PrefabPath);
                }
            }
            catch (MissingMethodException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    "E_PREFAB_QUERY_FAILED: LoadPrefabContentsIntoOnlyInstances failed for " +
                    PrefabPath +
                    ". " +
                    ex.Message,
                    ex);
            }
        }

        private static GameObject LoadPrefabContentsIntoOnlyInstances(string prefabPath)
        {
            var method = LoadPrefabContentsIntoOnlyInstancesMethod;
            if (method == null)
            {
                throw new MissingMethodException(
                    "UnityEditor.PrefabUtility",
                    "LoadPrefabContentsIntoOnlyInstances(string)");
            }

            try
            {
                return method.Invoke(null, new object[] { prefabPath }) as GameObject;
            }
            catch (TargetInvocationException ex)
            {
                if (ex.InnerException != null)
                {
                    throw ex.InnerException;
                }

                throw;
            }
        }

        public static int OpenCount
        {
            get { return Interlocked.CompareExchange(ref _openCount, 0, 0); }
        }

        public static int DisposeCount
        {
            get { return Interlocked.CompareExchange(ref _disposeCount, 0, 0); }
        }

        public string PrefabPath { get; private set; }

        public GameObject Root
        {
            get { return _loadedRoot; }
        }

        public bool IsDisposed
        {
            get { return Interlocked.CompareExchange(ref _disposeState, 0, 0) == 1; }
        }

        public void Dispose()
        {
            if (Interlocked.Exchange(ref _disposeState, 1) == 1)
            {
                return;
            }

            Interlocked.Increment(ref _disposeCount);

            if (_loadedRoot == null)
            {
                return;
            }

            try
            {
                PrefabUtility.UnloadPrefabContents(_loadedRoot);
                _loadedRoot = null;
            }
            catch (Exception ex)
            {
                throw new PrefabReadScopeDisposeException(
                    "E_PREFAB_QUERY_DISPOSE_FAILED: Failed to unload prefab contents for " +
                    PrefabPath +
                    ". " +
                    ex.Message,
                    ex);
            }
        }
    }

    public sealed class PrefabReadScopeDisposeException : Exception
    {
        public PrefabReadScopeDisposeException(string message, Exception innerException)
            : base(message, innerException)
        {
        }
    }
}

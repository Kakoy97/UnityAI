using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Ports;
using UnityEditor;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class EditorPrefsConversationStateStore : IConversationStateStore
    {
        private const string StateKey = "CodexUnity.ConversationState.v1";

        public PersistedConversationState Load()
        {
            var json = EditorPrefs.GetString(StateKey, string.Empty);
            if (string.IsNullOrEmpty(json))
            {
                return null;
            }

            try
            {
                return JsonUtility.FromJson<PersistedConversationState>(json);
            }
            catch
            {
                return null;
            }
        }

        public void Save(PersistedConversationState state)
        {
            if (state == null)
            {
                return;
            }

            var json = JsonUtility.ToJson(state);
            EditorPrefs.SetString(StateKey, json);
        }

        public void Clear()
        {
            if (EditorPrefs.HasKey(StateKey))
            {
                EditorPrefs.DeleteKey(StateKey);
            }
        }
    }
}


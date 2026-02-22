using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Ports
{
    public interface IConversationStateStore
    {
        PersistedConversationState Load();
        void Save(PersistedConversationState state);
        void Clear();
    }
}


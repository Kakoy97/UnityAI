using UnityAI.Editor.Codex.Domain;
using UnityEngine;

namespace UnityAI.Editor.Codex.Ports
{
    public interface ISelectionContextBuilder
    {
        TurnContext BuildContext(GameObject selected, int maxDepth);
    }
}


using UnityAI.Editor.Codex.Domain;
using UnityEngine;

namespace UnityAI.Editor.Codex.Ports
{
    public interface IUnityVisualActionExecutor
    {
        UnityActionExecutionResult Execute(VisualLayerActionItem action, GameObject selected);
    }
}

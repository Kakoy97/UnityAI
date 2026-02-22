using System.Threading.Tasks;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Ports
{
    public interface ISidecarProcessManager
    {
        bool IsRunning { get; }
        Task<SidecarStartResult> StartAsync(string sidecarUrl);
        SidecarStopResult Stop();
    }
}


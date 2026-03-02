using System.Threading.Tasks;

namespace UnityAI.Editor.Codex.Application
{
    public sealed partial class ConversationController
    {
        public Task SendRuntimePingAsync()
        {
            return QueryPollingCoordinatorFacade.SendRuntimePingAsync(this);
        }

        public Task PollRagQueriesAsync(double now)
        {
            return QueryPollingCoordinatorFacade.PollRagQueriesAsync(this, now);
        }

        private static class QueryPollingCoordinatorFacade
        {
            internal static Task SendRuntimePingAsync(ConversationController owner)
            {
                if (owner == null)
                {
                    return Task.CompletedTask;
                }

                return owner.SendRuntimePingCoreAsync();
            }

            internal static Task PollRagQueriesAsync(ConversationController owner, double now)
            {
                if (owner == null)
                {
                    return Task.CompletedTask;
                }

                return owner.PollRagQueriesCoreAsync(now);
            }
        }
    }
}

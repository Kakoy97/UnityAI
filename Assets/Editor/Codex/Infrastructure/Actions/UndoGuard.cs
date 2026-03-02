using UnityEditor;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    public sealed class UndoGuard
    {
        public int BeginGroup(string groupName)
        {
            Undo.IncrementCurrentGroup();
            var groupId = Undo.GetCurrentGroup();
            if (!string.IsNullOrWhiteSpace(groupName))
            {
                Undo.SetCurrentGroupName(groupName.Trim());
            }

            return groupId;
        }

        public void Commit(int groupId)
        {
            if (groupId < 0)
            {
                return;
            }

            Undo.CollapseUndoOperations(groupId);
        }

        public void Rollback(int groupId)
        {
            if (groupId < 0)
            {
                return;
            }

            Undo.RevertAllDownToGroup(groupId);
        }
    }
}


using System;
using UnityAI.Editor.Codex.Domain;

namespace UnityAI.Editor.Codex.Infrastructure.UiValidation
{
    public sealed class UiLayoutValidationRunResult
    {
        public bool ok;
        public string error_code;
        public string error_message;
        public string scope_object_id;
        public string scope_path;
        public UnityValidateUiLayoutData data;
    }

    public sealed class UiLayoutValidator
    {
        private readonly Func<UnityValidateUiLayoutRequest, UiLayoutValidationRunResult> _executor;

        public UiLayoutValidator(Func<UnityValidateUiLayoutRequest, UiLayoutValidationRunResult> executor)
        {
            if (executor == null)
            {
                throw new ArgumentNullException("executor");
            }

            _executor = executor;
        }

        public UiLayoutValidationRunResult Execute(UnityValidateUiLayoutRequest request)
        {
            return _executor(request);
        }
    }
}

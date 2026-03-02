using System;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.UiValidation;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed partial class UnityRagReadService
    {
        public UnityValidateUiLayoutResponse ValidateUiLayout(UnityValidateUiLayoutRequest request)
        {
            return UiLayoutReadService.Execute(request);
        }

        private static class UiLayoutReadService
        {
            internal static UnityValidateUiLayoutResponse Execute(UnityValidateUiLayoutRequest request)
            {
                var requestId = NormalizeRequestId(request == null ? string.Empty : request.request_id);
                var validator = new UiLayoutValidator(ExecuteValidateUiLayout);
                UiLayoutValidationRunResult runResult;
                try
                {
                    runResult = validator.Execute(request);
                }
                catch (Exception ex)
                {
                    return BuildValidateUiLayoutFailure(
                        requestId,
                        "E_UI_LAYOUT_VALIDATION_FAILED",
                        ex == null ? "validate_ui_layout failed." : ex.Message);
                }

                if (runResult == null)
                {
                    return BuildValidateUiLayoutFailure(
                        requestId,
                        "E_UI_LAYOUT_VALIDATION_FAILED",
                        "validate_ui_layout returned null result.");
                }

                if (!runResult.ok)
                {
                    return BuildValidateUiLayoutFailure(
                        requestId,
                        string.IsNullOrEmpty(runResult.error_code) ? "E_UI_LAYOUT_VALIDATION_FAILED" : runResult.error_code,
                        runResult.error_message);
                }

                var tokenPath = string.IsNullOrEmpty(runResult.scope_path) ? "Scene/UI" : runResult.scope_path;
                return new UnityValidateUiLayoutResponse
                {
                    ok = true,
                    request_id = requestId,
                    captured_at = NowIso(),
                    error_code = string.Empty,
                    error_message = string.Empty,
                    read_token = BuildReadToken("scene", runResult.scope_object_id ?? string.Empty, tokenPath),
                    data = runResult.data
                };
            }
        }
    }
}
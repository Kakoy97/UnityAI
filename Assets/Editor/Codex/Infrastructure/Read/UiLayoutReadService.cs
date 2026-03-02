using System;
using System.Collections.Generic;
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

                var specializedData = BuildSpecializedValidateData(request, runResult.data);
                var tokenPath = string.IsNullOrEmpty(runResult.scope_path) ? "Scene/UI" : runResult.scope_path;
                return new UnityValidateUiLayoutResponse
                {
                    ok = true,
                    request_id = requestId,
                    captured_at = NowIso(),
                    error_code = string.Empty,
                    error_message = string.Empty,
                    read_token = BuildReadToken("scene", runResult.scope_object_id ?? string.Empty, tokenPath),
                    data = specializedData
                };
            }

            private static UnityValidateUiLayoutData BuildSpecializedValidateData(
                UnityValidateUiLayoutRequest request,
                UnityValidateUiLayoutData data)
            {
                var payload = request == null ? null : request.payload;
                var normalizedData = data ?? new UnityValidateUiLayoutData();
                var issues = normalizedData.issues ?? new UnityUiLayoutIssue[0];
                var summary = BuildSpecialistSummary(issues);

                normalizedData.specialist_summary = summary;
                normalizedData.repair_plan_generated_by = string.Empty;
                normalizedData.repair_plan = null;

                if (payload != null && payload.include_repair_plan)
                {
                    var style = NormalizeRepairStyle(payload.repair_style);
                    var maxSuggestions = NormalizeRepairSuggestionLimit(payload.max_repair_suggestions);
                    var repairPlan = BuildRepairPlan(issues, maxSuggestions, style);
                    normalizedData.repair_plan = repairPlan;
                    normalizedData.repair_plan_generated_by = "unity";
                    summary.has_repair_plan = repairPlan != null && repairPlan.Length > 0;
                    summary.repair_style = style;
                }

                return normalizedData;
            }

            private static int NormalizeRepairSuggestionLimit(int requested)
            {
                if (requested <= 0)
                {
                    return 6;
                }

                return requested > 20 ? 20 : requested;
            }

            private static string NormalizeRepairStyle(string style)
            {
                var normalized = string.IsNullOrWhiteSpace(style) ? string.Empty : style.Trim().ToLowerInvariant();
                if (string.Equals(normalized, "conservative", StringComparison.Ordinal))
                {
                    return "conservative";
                }

                if (string.Equals(normalized, "aggressive", StringComparison.Ordinal))
                {
                    return "aggressive";
                }

                return "balanced";
            }

            private static UnityUiLayoutSpecialistSummary BuildSpecialistSummary(UnityUiLayoutIssue[] issues)
            {
                var summary = new UnityUiLayoutSpecialistSummary
                {
                    out_of_bounds_count = 0,
                    overlap_count = 0,
                    not_clickable_count = 0,
                    text_overflow_count = 0,
                    high_severity_count = 0,
                    low_confidence_count = 0,
                    has_repair_plan = false,
                    repair_style = string.Empty
                };

                if (issues == null || issues.Length == 0)
                {
                    return summary;
                }

                for (var i = 0; i < issues.Length; i++)
                {
                    var issue = issues[i];
                    if (issue == null)
                    {
                        continue;
                    }

                    var type = string.IsNullOrWhiteSpace(issue.issue_type) ? string.Empty : issue.issue_type.Trim();
                    if (string.Equals(type, "OUT_OF_BOUNDS", StringComparison.Ordinal))
                    {
                        summary.out_of_bounds_count += 1;
                    }
                    else if (string.Equals(type, "OVERLAP", StringComparison.Ordinal))
                    {
                        summary.overlap_count += 1;
                    }
                    else if (string.Equals(type, "NOT_CLICKABLE", StringComparison.Ordinal))
                    {
                        summary.not_clickable_count += 1;
                    }
                    else if (string.Equals(type, "TEXT_OVERFLOW", StringComparison.Ordinal))
                    {
                        summary.text_overflow_count += 1;
                    }

                    var severity = string.IsNullOrWhiteSpace(issue.severity) ? string.Empty : issue.severity.Trim().ToLowerInvariant();
                    if (string.Equals(severity, "error", StringComparison.Ordinal))
                    {
                        summary.high_severity_count += 1;
                    }

                    var confidence = string.IsNullOrWhiteSpace(issue.confidence)
                        ? string.Empty
                        : issue.confidence.Trim().ToLowerInvariant();
                    if (string.Equals(confidence, "low", StringComparison.Ordinal))
                    {
                        summary.low_confidence_count += 1;
                    }
                }

                return summary;
            }

            private static UnityUiLayoutRepairAction[] BuildRepairPlan(
                UnityUiLayoutIssue[] issues,
                int maxSuggestions,
                string repairStyle)
            {
                if (issues == null || issues.Length == 0 || maxSuggestions <= 0)
                {
                    return new UnityUiLayoutRepairAction[0];
                }

                var plan = new List<UnityUiLayoutRepairAction>(maxSuggestions);
                for (var i = 0; i < issues.Length; i++)
                {
                    if (plan.Count >= maxSuggestions)
                    {
                        break;
                    }

                    var item = BuildRepairAction(issues[i], repairStyle);
                    if (item != null)
                    {
                        plan.Add(item);
                    }
                }

                return plan.ToArray();
            }

            private static UnityUiLayoutRepairAction BuildRepairAction(UnityUiLayoutIssue issue, string repairStyle)
            {
                if (issue == null)
                {
                    return null;
                }

                var issueType = string.IsNullOrWhiteSpace(issue.issue_type) ? string.Empty : issue.issue_type.Trim();
                if (string.IsNullOrEmpty(issueType))
                {
                    return null;
                }

                var style = NormalizeRepairStyle(repairStyle);
                var action = new UnityUiLayoutRepairAction
                {
                    issue_type = issueType,
                    target_anchor = CloneAnchor(issue.anchor),
                    strategy = "manual_triage",
                    recommended_action_type = "set_serialized_property",
                    action_data_template_json = "{}",
                    rationale = string.IsNullOrWhiteSpace(issue.suggestion)
                        ? "Apply a deterministic primitive edit and re-run validate_ui_layout."
                        : issue.suggestion.Trim(),
                    risk = "medium"
                };

                if (string.Equals(issueType, "OUT_OF_BOUNDS", StringComparison.Ordinal))
                {
                    action.strategy = "move_inside_safe_bounds";
                    action.recommended_action_type = "set_rect_anchored_position";
                    action.action_data_template_json = "{\"x\":0,\"y\":0}";
                    action.rationale = "Move element back to visible area first, then fine tune.";
                    action.risk = "low";
                    return action;
                }

                if (string.Equals(issueType, "OVERLAP", StringComparison.Ordinal))
                {
                    if (string.Equals(style, "aggressive", StringComparison.Ordinal))
                    {
                        action.strategy = "separate_by_layout_size";
                        action.recommended_action_type = "set_rect_size_delta";
                        action.action_data_template_json = "{\"x\":320,\"y\":80}";
                        action.rationale = "Expand conflicting area to reduce overlap under current anchors.";
                        action.risk = "medium";
                    }
                    else
                    {
                        action.strategy = "separate_by_position";
                        action.recommended_action_type = "set_rect_anchored_position";
                        action.action_data_template_json = "{\"x\":0,\"y\":0}";
                        action.rationale = "Offset one node to eliminate overlap while preserving hierarchy.";
                        action.risk = "low";
                    }

                    return action;
                }

                if (string.Equals(issueType, "NOT_CLICKABLE", StringComparison.Ordinal))
                {
                    if (string.Equals(issue.approx_reason, "NO_RAYCAST_SOURCE", StringComparison.Ordinal))
                    {
                        action.strategy = "enable_raycast";
                        action.recommended_action_type = "set_ui_image_raycast_target";
                        action.action_data_template_json = "{\"raycast_target\":true}";
                        action.rationale = "Enable raycast target so UI element can be hit by pointer checks.";
                        action.risk = "low";
                    }
                    else
                    {
                        action.strategy = "reactivate_node";
                        action.recommended_action_type = "set_active";
                        action.action_data_template_json = "{\"active\":true}";
                        action.rationale = "Restore interactable visibility chain before next clickability validation.";
                        action.risk = "medium";
                    }

                    return action;
                }

                if (string.Equals(issueType, "TEXT_OVERFLOW", StringComparison.Ordinal))
                {
                    if (string.Equals(style, "conservative", StringComparison.Ordinal))
                    {
                        action.strategy = "reduce_font_size";
                        action.recommended_action_type = "set_ui_text_font_size";
                        action.action_data_template_json = "{\"font_size\":24}";
                        action.rationale = "Lower font size first to reduce overflow risk with minimal layout impact.";
                        action.risk = "low";
                    }
                    else
                    {
                        action.strategy = "expand_text_container";
                        action.recommended_action_type = "set_rect_size_delta";
                        action.action_data_template_json = "{\"x\":320,\"y\":80}";
                        action.rationale = "Increase text container size to absorb overflow across resolutions.";
                        action.risk = "medium";
                    }

                    return action;
                }

                return action;
            }

            private static UnityObjectAnchor CloneAnchor(UnityObjectAnchor anchor)
            {
                if (anchor == null)
                {
                    return null;
                }

                return new UnityObjectAnchor
                {
                    object_id = string.IsNullOrWhiteSpace(anchor.object_id) ? string.Empty : anchor.object_id.Trim(),
                    path = string.IsNullOrWhiteSpace(anchor.path) ? string.Empty : anchor.path.Trim()
                };
            }
        }
    }
}

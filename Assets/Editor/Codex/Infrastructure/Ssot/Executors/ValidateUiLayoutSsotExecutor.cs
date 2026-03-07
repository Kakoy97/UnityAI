using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Generated.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Executors
{
    public sealed class ValidateUiLayoutSsotExecutor
    {
        private readonly UnityRagReadService _readService;

        public ValidateUiLayoutSsotExecutor()
            : this(new UnityRagReadService())
        {
        }

        internal ValidateUiLayoutSsotExecutor(UnityRagReadService readService)
        {
            _readService = readService ?? new UnityRagReadService();
        }

        public SsotDispatchResponse Execute(ValidateUiLayoutRequestDto request)
        {
            if (request == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_SSOT_SCHEMA_INVALID",
                    "validate_ui_layout request payload is required.",
                    ValidateUiLayoutRequestDto.ToolName);
            }

            var scope = BuildScope(request.scope_root_path);
            var resolutions = BuildResolutions(request);
            var checks = ParseChecksCsv(request.checks_csv);
            var readRequest = new UnityValidateUiLayoutRequest
            {
                @event = "unity.query.validate_ui_layout.request",
                request_id = "ssot_" + Guid.NewGuid().ToString("N"),
                thread_id = SsotExecutorCommon.Normalize(request.thread_id),
                turn_id = string.Empty,
                timestamp = DateTime.UtcNow.ToString("o"),
                payload = new UnityValidateUiLayoutPayload
                {
                    scope = scope,
                    resolutions = resolutions,
                    checks = checks,
                    max_issues = request.max_issues,
                    time_budget_ms = request.time_budget_ms,
                    layout_refresh_mode = SsotExecutorCommon.Normalize(request.layout_refresh_mode),
                    include_repair_plan = request.include_repair_plan,
                    max_repair_suggestions = request.max_repair_suggestions,
                    repair_style = SsotExecutorCommon.Normalize(request.repair_style),
                    timeout_ms = request.timeout_ms
                }
            };

            var response = _readService.ValidateUiLayout(readRequest);
            if (response == null)
            {
                return SsotRequestDispatcher.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "validate_ui_layout returned null response.",
                    ValidateUiLayoutRequestDto.ToolName);
            }

            if (!response.ok)
            {
                return SsotRequestDispatcher.Failure(
                    SsotExecutorCommon.Normalize(response.error_code),
                    SsotExecutorCommon.Normalize(response.error_message),
                    ValidateUiLayoutRequestDto.ToolName);
            }

            var responseData = response.data ?? new UnityValidateUiLayoutData();
            var issues = ConvertIssues(responseData.issues);
            var issueCount = responseData.issue_count > 0 ? responseData.issue_count : issues.Length;
            var runtimeResolution = responseData.runtime_resolution ?? new UnityQueryResolution();
            var rootPath = ResolveScopeRootPath(responseData.scope, scope);

            return SsotRequestDispatcher.Success(
                ValidateUiLayoutRequestDto.ToolName,
                new SsotDispatchResultData
                {
                    scene_revision = SsotExecutorCommon.BuildSceneRevision(),
                    root_path = rootPath,
                    issue_count = issueCount,
                    total_count = issueCount,
                    partial = responseData.partial,
                    truncated = responseData.partial,
                    truncated_reason = SsotExecutorCommon.Normalize(responseData.truncated_reason),
                    runtime_source = SsotExecutorCommon.Normalize(responseData.runtime_source),
                    runtime_resolution_name = SsotExecutorCommon.Normalize(responseData.runtime_resolution_name),
                    runtime_resolution_width = runtimeResolution.width,
                    runtime_resolution_height = runtimeResolution.height,
                    layout_issues = issues,
                    diagnosis = BuildDiagnosisSummary(responseData.specialist_summary, issueCount),
                });
        }

        private static UnityQueryScope BuildScope(string scopeRootPath)
        {
            var normalized = SsotExecutorCommon.Normalize(scopeRootPath);
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            return new UnityQueryScope
            {
                root_path = normalized
            };
        }

        private static string ResolveScopeRootPath(UnityQueryScope responseScope, UnityQueryScope requestScope)
        {
            if (responseScope != null)
            {
                var normalizedResponsePath = SsotExecutorCommon.Normalize(responseScope.root_path);
                if (!string.IsNullOrEmpty(normalizedResponsePath))
                {
                    return normalizedResponsePath;
                }
            }

            return requestScope == null ? string.Empty : SsotExecutorCommon.Normalize(requestScope.root_path);
        }

        private static UnityQueryResolutionItem[] BuildResolutions(ValidateUiLayoutRequestDto request)
        {
            if (request == null || request.resolution_width <= 0 || request.resolution_height <= 0)
            {
                return Array.Empty<UnityQueryResolutionItem>();
            }

            return new[]
            {
                new UnityQueryResolutionItem
                {
                    name = SsotExecutorCommon.Normalize(request.resolution_name),
                    width = request.resolution_width,
                    height = request.resolution_height
                }
            };
        }

        private static string[] ParseChecksCsv(string checksCsv)
        {
            var normalized = SsotExecutorCommon.Normalize(checksCsv);
            if (string.IsNullOrEmpty(normalized))
            {
                return Array.Empty<string>();
            }

            var tokens = normalized.Split(new[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
            if (tokens == null || tokens.Length <= 0)
            {
                return Array.Empty<string>();
            }

            var checks = new List<string>(tokens.Length);
            for (var i = 0; i < tokens.Length; i += 1)
            {
                var token = SsotExecutorCommon.Normalize(tokens[i]);
                if (!string.IsNullOrEmpty(token))
                {
                    checks.Add(token);
                }
            }

            return checks.ToArray();
        }

        private static SsotLayoutIssueSummary[] ConvertIssues(UnityUiLayoutIssue[] issues)
        {
            if (issues == null || issues.Length <= 0)
            {
                return Array.Empty<SsotLayoutIssueSummary>();
            }

            var mapped = new SsotLayoutIssueSummary[issues.Length];
            for (var i = 0; i < issues.Length; i += 1)
            {
                var issue = issues[i] ?? new UnityUiLayoutIssue();
                var anchor = issue.anchor ?? new UnityObjectAnchor();
                mapped[i] = new SsotLayoutIssueSummary
                {
                    issue_type = SsotExecutorCommon.Normalize(issue.issue_type),
                    severity = SsotExecutorCommon.Normalize(issue.severity),
                    resolution = SsotExecutorCommon.Normalize(issue.resolution),
                    details = SsotExecutorCommon.Normalize(issue.details),
                    suggestion = SsotExecutorCommon.Normalize(issue.suggestion),
                    mode = SsotExecutorCommon.Normalize(issue.mode),
                    confidence = SsotExecutorCommon.Normalize(issue.confidence),
                    approximate = issue.approximate,
                    approx_reason = SsotExecutorCommon.Normalize(issue.approx_reason),
                    object_id = SsotExecutorCommon.Normalize(anchor.object_id),
                    path = SsotExecutorCommon.Normalize(anchor.path)
                };
            }

            return mapped;
        }

        private static string BuildDiagnosisSummary(UnityUiLayoutSpecialistSummary summary, int issueCount)
        {
            if (summary == null)
            {
                return "issue_count=" + issueCount.ToString();
            }

            return
                "issue_count=" + issueCount.ToString() +
                ",out_of_bounds=" + summary.out_of_bounds_count.ToString() +
                ",overlap=" + summary.overlap_count.ToString() +
                ",not_clickable=" + summary.not_clickable_count.ToString() +
                ",text_overflow=" + summary.text_overflow_count.ToString();
        }
    }
}

using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using UnityEditor;
using UnityEditor.Compilation;
using UnityEditor.TestTools.TestRunner.Api;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure.Queries.Handlers
{
    public sealed class RunUnityTestsQueryHandler : IUnityQueryHandler
    {
        public string QueryType
        {
            get { return UnityQueryTypes.UnityTestRun; }
        }

        public async Task<UnityQueryHandlerResult> ExecuteAsync(
            UnityAI.Editor.Codex.Domain.UnityPulledQuery pulledQuery,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_QUERY_HANDLER_FAILED",
                    "unity.test.run execution context is null.");
            }

            var payload = context.GetQueryPayloadOrDefault<RunUnityTestsPayload>(pulledQuery);
            var request = RunUnityTestsRequest.FromPayload(payload);
            try
            {
                var response = await InProcessUnityTestRunner.RunAsync(request, context);
                return UnityQueryHandlerResult.Success(response, string.Empty);
            }
            catch (TimeoutException ex)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_UNITY_TEST_TIMEOUT",
                    string.IsNullOrWhiteSpace(ex == null ? string.Empty : ex.Message)
                        ? "Unity in-process test run timed out."
                        : ex.Message);
            }
            catch (InvalidOperationException ex)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_UNITY_TEST_EDITOR_BUSY",
                    string.IsNullOrWhiteSpace(ex == null ? string.Empty : ex.Message)
                        ? "Unity test runner is already executing another run."
                        : ex.Message);
            }
            catch (Exception ex)
            {
                return UnityQueryHandlerResult.Failure(
                    "E_UNITY_TEST_RUN_FAILED",
                    "Unity in-process test run failed: " +
                    (ex == null ? "unknown error" : ex.Message));
            }
        }
    }

    [Serializable]
    internal sealed class RunUnityTestsPayload
    {
        public string scope;
        public string test_filter;
        public int timeout_seconds;
        public bool ensure_compilation;
    }

    internal sealed class RunUnityTestsRequest
    {
        private const int DefaultTimeoutSeconds = 900;
        private const int MinTimeoutSeconds = 30;
        private const int MaxTimeoutSeconds = 7200;

        internal string Scope;
        internal string TestFilter;
        internal int TimeoutSeconds;
        internal bool EnsureCompilation;

        internal static RunUnityTestsRequest FromPayload(RunUnityTestsPayload payload)
        {
            var source = payload ?? new RunUnityTestsPayload();
            return new RunUnityTestsRequest
            {
                Scope = NormalizeScope(source.scope),
                TestFilter = NormalizeString(source.test_filter),
                TimeoutSeconds = ClampTimeoutSeconds(source.timeout_seconds),
                EnsureCompilation = source.ensure_compilation
            };
        }

        private static int ClampTimeoutSeconds(int value)
        {
            var parsed = value <= 0 ? DefaultTimeoutSeconds : value;
            if (parsed < MinTimeoutSeconds)
            {
                return MinTimeoutSeconds;
            }
            if (parsed > MaxTimeoutSeconds)
            {
                return MaxTimeoutSeconds;
            }
            return parsed;
        }

        private static string NormalizeScope(string value)
        {
            var token = NormalizeString(value).ToLowerInvariant();
            if (token == "editmode" || token == "playmode" || token == "all")
            {
                return token;
            }
            return "all";
        }

        private static string NormalizeString(string value)
        {
            return string.IsNullOrWhiteSpace(value) ? string.Empty : value.Trim();
        }
    }

    [Serializable]
    internal sealed class RunUnityTestsResponse
    {
        public bool ok;
        public string tool_name;
        public string run_id;
        public string scope_requested;
        public string[] scope_executed;
        public string status;
        public int total;
        public int passed;
        public int failed;
        public int skipped;
        public int inconclusive;
        public int duration_ms;
        public RunUnityTestsPlatformResult[] platform_results;
        public RunUnityTestsFailedCase[] failed_cases;
        public string artifacts_directory;
        public string captured_at;
    }

    [Serializable]
    internal sealed class RunUnityTestsPlatformResult
    {
        public string platform;
        public string status;
        public int total;
        public int passed;
        public int failed;
        public int skipped;
        public int inconclusive;
        public int duration_ms;
        public RunUnityTestsFailedCase[] failed_cases;
    }

    [Serializable]
    internal sealed class RunUnityTestsFailedCase
    {
        public string platform;
        public string name;
        public string fullname;
        public string message;
        public string stack_trace;
    }

    internal static class InProcessUnityTestRunner
    {
        private sealed class TestModePlan
        {
            internal string Platform;
            internal TestMode Mode;
        }

        private sealed class TestRunCallbacks : ICallbacks
        {
            private readonly TaskCompletionSource<ITestResultAdaptor> _completion =
                new TaskCompletionSource<ITestResultAdaptor>();

            public int priority
            {
                get { return 0; }
            }

            public Task<ITestResultAdaptor> CompletionTask
            {
                get { return _completion.Task; }
            }

            public void RunStarted(ITestAdaptor testsToRun)
            {
            }

            public void RunFinished(ITestResultAdaptor result)
            {
                _completion.TrySetResult(result);
            }

            public void TestStarted(ITestAdaptor test)
            {
            }

            public void TestFinished(ITestResultAdaptor result)
            {
            }
        }

        private sealed class TestRunStartContext
        {
            internal TestRunnerApi Api;
            internal TestRunCallbacks Callbacks;
            internal bool Started;
            internal string ErrorCode;
            internal string ErrorMessage;
        }

        private static int _runningFlag;

        internal static async Task<RunUnityTestsResponse> RunAsync(
            RunUnityTestsRequest request,
            UnityQueryExecutionContext context)
        {
            if (Interlocked.CompareExchange(ref _runningFlag, 1, 0) != 0)
            {
                throw new InvalidOperationException(
                    "Unity test runner is already running in editor process.");
            }

            try
            {
                await EnsureCompilationReadyAsync(request, context);

                var startedAt = DateTime.UtcNow;
                var runId = "utr_editor_" + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() +
                            "_" + Guid.NewGuid().ToString("N").Substring(0, 8);
                var plans = BuildModePlans(request.Scope);
                var platformResults = new List<RunUnityTestsPlatformResult>();
                var failedCases = new List<RunUnityTestsFailedCase>();

                for (var i = 0; i < plans.Count; i += 1)
                {
                    var summary = await RunSingleModeAsync(
                        plans[i],
                        request.TestFilter,
                        request.TimeoutSeconds,
                        context);
                    platformResults.Add(summary);
                    if (summary.failed_cases != null && summary.failed_cases.Length > 0)
                    {
                        failedCases.AddRange(summary.failed_cases);
                    }
                }

                var response = new RunUnityTestsResponse
                {
                    ok = true,
                    tool_name = "run_unity_tests",
                    run_id = runId,
                    scope_requested = request.Scope,
                    scope_executed = BuildExecutedScopes(plans),
                    status = "succeeded",
                    total = 0,
                    passed = 0,
                    failed = 0,
                    skipped = 0,
                    inconclusive = 0,
                    duration_ms = Math.Max(
                        0,
                        (int)Math.Round((DateTime.UtcNow - startedAt).TotalMilliseconds)),
                    platform_results = platformResults.ToArray(),
                    failed_cases = failedCases.ToArray(),
                    artifacts_directory = string.Empty,
                    captured_at = DateTime.UtcNow.ToString("o")
                };

                for (var i = 0; i < platformResults.Count; i += 1)
                {
                    var item = platformResults[i];
                    if (item == null)
                    {
                        continue;
                    }
                    response.total += item.total;
                    response.passed += item.passed;
                    response.failed += item.failed;
                    response.skipped += item.skipped;
                    response.inconclusive += item.inconclusive;
                }

                if (response.failed > 0)
                {
                    response.status = "failed";
                }
                return response;
            }
            finally
            {
                Interlocked.Exchange(ref _runningFlag, 0);
            }
        }

        private static async Task EnsureCompilationReadyAsync(
            RunUnityTestsRequest request,
            UnityQueryExecutionContext context)
        {
            if (context == null)
            {
                return;
            }

            var ensureCompilation = request != null && request.EnsureCompilation;
            if (ensureCompilation)
            {
                await context.RunOnEditorMainThreadAsync(() =>
                {
                    AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                    CompilationPipeline.RequestScriptCompilation();
                    return true;
                });
            }
            else
            {
                // Fast path: align with manual Test Runner behavior.
                // Do not force refresh/recompile unless caller explicitly requests it.
                var currentlyCompiling = await context.RunOnEditorMainThreadAsync(
                    () => EditorApplication.isCompiling);
                if (!currentlyCompiling)
                {
                    return;
                }
            }

            var timeoutSeconds = request == null ? 0 : request.TimeoutSeconds;
            var waitBudgetMs = Math.Max(10000, Math.Min(180000, timeoutSeconds * 250));
            var deadlineUtc = DateTime.UtcNow.AddMilliseconds(waitBudgetMs);
            while (true)
            {
                var isCompiling = await context.RunOnEditorMainThreadAsync(() => EditorApplication.isCompiling);
                if (!isCompiling)
                {
                    break;
                }

                if (DateTime.UtcNow >= deadlineUtc)
                {
                    throw new TimeoutException(
                        "Unity script compilation did not finish before running tests.");
                }

                await Task.Delay(200);
            }

            await Task.Delay(100);
        }

        private static async Task<RunUnityTestsPlatformResult> RunSingleModeAsync(
            TestModePlan plan,
            string testFilter,
            int timeoutSeconds,
            UnityQueryExecutionContext context)
        {
            var startedAt = DateTime.UtcNow;
            var start = await context.RunOnEditorMainThreadAsync(
                () => StartTestRun(plan, testFilter));
            if (start == null)
            {
                throw new Exception("Unity TestRunner start context is null.");
            }
            if (!start.Started)
            {
                throw new Exception(string.IsNullOrWhiteSpace(start.ErrorMessage)
                    ? "failed to start Unity TestRunner."
                    : start.ErrorMessage);
            }

            var timeoutTask = Task.Delay(Math.Max(1000, timeoutSeconds * 1000));
            var finished = await Task.WhenAny(start.Callbacks.CompletionTask, timeoutTask);
            if (!ReferenceEquals(finished, start.Callbacks.CompletionTask))
            {
                await context.RunOnEditorMainThreadAsync(() =>
                {
                    CleanupRunner(start);
                    return true;
                });
                throw new TimeoutException(
                    "Unity in-process test run timed out (" + plan.Platform + ").");
            }

            ITestResultAdaptor runRoot = null;
            try
            {
                runRoot = await start.Callbacks.CompletionTask;
            }
            finally
            {
                await context.RunOnEditorMainThreadAsync(() =>
                {
                    CleanupRunner(start);
                    return true;
                });
            }

            var durationMs = Math.Max(
                0,
                (int)Math.Round((DateTime.UtcNow - startedAt).TotalMilliseconds));
            return BuildPlatformSummary(runRoot, plan.Platform, durationMs);
        }

        private static TestRunStartContext StartTestRun(TestModePlan plan, string testFilter)
        {
            var state = new TestRunStartContext
            {
                Started = false,
                ErrorCode = string.Empty,
                ErrorMessage = string.Empty
            };

            try
            {
                var api = ScriptableObject.CreateInstance<TestRunnerApi>();
                if (api == null)
                {
                    state.ErrorCode = "E_UNITY_TEST_RUNNER_UNAVAILABLE";
                    state.ErrorMessage = "TestRunnerApi could not be created.";
                    return state;
                }

                var callbacks = new TestRunCallbacks();
                api.RegisterCallbacks(callbacks);

                var filter = new Filter
                {
                    testMode = plan.Mode
                };
                if (!string.IsNullOrWhiteSpace(testFilter))
                {
                    filter.testNames = new[] { testFilter.Trim() };
                }

                var executionSettings = new ExecutionSettings(new[] { filter });
                api.Execute(executionSettings);

                state.Api = api;
                state.Callbacks = callbacks;
                state.Started = true;
                return state;
            }
            catch (Exception ex)
            {
                state.ErrorCode = "E_UNITY_TEST_RUN_FAILED";
                state.ErrorMessage = "failed to start TestRunnerApi.Execute: " + ex.Message;
                return state;
            }
        }

        private static void CleanupRunner(TestRunStartContext state)
        {
            if (state == null || state.Api == null)
            {
                return;
            }

            try
            {
                if (state.Callbacks != null)
                {
                    state.Api.UnregisterCallbacks(state.Callbacks);
                }
            }
            catch
            {
            }

            try
            {
                UnityEngine.Object.DestroyImmediate(state.Api);
            }
            catch
            {
            }
        }

        private static List<TestModePlan> BuildModePlans(string scope)
        {
            var plans = new List<TestModePlan>();
            if (string.Equals(scope, "editmode", StringComparison.OrdinalIgnoreCase))
            {
                plans.Add(new TestModePlan
                {
                    Platform = "editmode",
                    Mode = TestMode.EditMode
                });
                return plans;
            }

            if (string.Equals(scope, "playmode", StringComparison.OrdinalIgnoreCase))
            {
                plans.Add(new TestModePlan
                {
                    Platform = "playmode",
                    Mode = TestMode.PlayMode
                });
                return plans;
            }

            plans.Add(new TestModePlan
            {
                Platform = "editmode",
                Mode = TestMode.EditMode
            });
            plans.Add(new TestModePlan
            {
                Platform = "playmode",
                Mode = TestMode.PlayMode
            });
            return plans;
        }

        private static string[] BuildExecutedScopes(List<TestModePlan> plans)
        {
            if (plans == null || plans.Count == 0)
            {
                return new string[0];
            }
            var output = new string[plans.Count];
            for (var i = 0; i < plans.Count; i += 1)
            {
                output[i] = plans[i] == null || string.IsNullOrWhiteSpace(plans[i].Platform)
                    ? string.Empty
                    : plans[i].Platform;
            }
            return output;
        }

        private static RunUnityTestsPlatformResult BuildPlatformSummary(
            object runRoot,
            string platform,
            int fallbackDurationMs)
        {
            var failedCases = new List<RunUnityTestsFailedCase>();
            CollectFailedLeafCases(runRoot, platform, failedCases);

            var passed = ReadInt(runRoot, "PassCount", "PassedCount", "Passed");
            var failed = ReadInt(runRoot, "FailCount", "FailedCount", "Failed");
            var skipped = ReadInt(runRoot, "SkipCount", "SkippedCount", "Skipped");
            var inconclusive = ReadInt(runRoot, "InconclusiveCount", "Inconclusive");

            var total = ReadInt(runRoot, "TotalCount", "TestCaseCount", "TestCount");
            if (total <= 0)
            {
                total = passed + failed + skipped + inconclusive;
            }

            var durationSeconds = ReadDouble(runRoot, "Duration");
            var durationMs = fallbackDurationMs;
            if (durationSeconds > 0d)
            {
                durationMs = Math.Max(0, (int)Math.Round(durationSeconds * 1000d));
            }

            return new RunUnityTestsPlatformResult
            {
                platform = string.IsNullOrWhiteSpace(platform) ? string.Empty : platform.Trim(),
                status = failed > 0 ? "failed" : "succeeded",
                total = total,
                passed = passed,
                failed = failed,
                skipped = skipped,
                inconclusive = inconclusive,
                duration_ms = durationMs,
                failed_cases = failedCases.ToArray()
            };
        }

        private static void CollectFailedLeafCases(
            object node,
            string platform,
            List<RunUnityTestsFailedCase> output)
        {
            if (node == null || output == null)
            {
                return;
            }

            var children = ReadChildren(node);
            var hasChildren = false;
            foreach (var _ in children)
            {
                hasChildren = true;
                break;
            }

            if (!hasChildren && IsFailedNode(node))
            {
                output.Add(new RunUnityTestsFailedCase
                {
                    platform = string.IsNullOrWhiteSpace(platform) ? string.Empty : platform.Trim(),
                    name = ReadString(node, "Name"),
                    fullname = ReadString(node, "FullName", "Fullname", "Name"),
                    message = ReadString(node, "Message"),
                    stack_trace = ReadString(node, "StackTrace", "StackTraceString")
                });
                return;
            }

            foreach (var child in ReadChildren(node))
            {
                CollectFailedLeafCases(child, platform, output);
            }
        }

        private static bool IsFailedNode(object node)
        {
            var resultState = ReadString(node, "ResultState");
            var status = ReadString(node, "TestStatus", "Status", "Result");
            var merged = (resultState + " " + status).ToLowerInvariant();
            return merged.Contains("failed") || merged.Contains("error") || merged.Contains("invalid");
        }

        private static IEnumerable ReadChildren(object node)
        {
            if (node == null)
            {
                return EmptyArray;
            }

            var prop = node.GetType().GetProperty("Children", BindingFlags.Instance | BindingFlags.Public);
            if (prop == null)
            {
                return EmptyArray;
            }

            try
            {
                var value = prop.GetValue(node, null) as IEnumerable;
                return value ?? EmptyArray;
            }
            catch
            {
                return EmptyArray;
            }
        }

        private static int ReadInt(object source, params string[] names)
        {
            var value = ReadValue(source, names);
            if (value == null)
            {
                return 0;
            }
            try
            {
                return Convert.ToInt32(value);
            }
            catch
            {
                return 0;
            }
        }

        private static double ReadDouble(object source, params string[] names)
        {
            var value = ReadValue(source, names);
            if (value == null)
            {
                return 0d;
            }
            try
            {
                return Convert.ToDouble(value);
            }
            catch
            {
                return 0d;
            }
        }

        private static string ReadString(object source, params string[] names)
        {
            var value = ReadValue(source, names);
            if (value == null)
            {
                return string.Empty;
            }
            var text = value as string ?? value.ToString();
            return string.IsNullOrWhiteSpace(text) ? string.Empty : text.Trim();
        }

        private static object ReadValue(object source, params string[] names)
        {
            if (source == null || names == null)
            {
                return null;
            }

            var type = source.GetType();
            for (var i = 0; i < names.Length; i += 1)
            {
                var name = names[i];
                if (string.IsNullOrWhiteSpace(name))
                {
                    continue;
                }

                var prop = type.GetProperty(name, BindingFlags.Instance | BindingFlags.Public);
                if (prop == null || !prop.CanRead)
                {
                    continue;
                }

                try
                {
                    return prop.GetValue(source, null);
                }
                catch
                {
                    return null;
                }
            }

            return null;
        }

        private static readonly object[] EmptyArray = new object[0];
    }
}

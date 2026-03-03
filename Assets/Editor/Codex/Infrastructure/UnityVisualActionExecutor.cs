using System;
using System.Diagnostics;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.Actions;
using UnityAI.Editor.Codex.Ports;
using UnityEngine;

namespace UnityAI.Editor.Codex.Infrastructure
{
    public sealed class UnityVisualActionExecutor : IUnityVisualActionExecutor
    {
        private const int MaxExecutionErrorMessageLength = 320;
        private readonly McpActionRegistry _registry;

        public UnityVisualActionExecutor()
            : this(McpActionRegistryBootstrap.Registry)
        {
        }

        internal UnityVisualActionExecutor(McpActionRegistry registry)
        {
            _registry = registry ?? McpActionRegistryBootstrap.Registry;
        }

        public UnityActionExecutionResult Execute(VisualLayerActionItem action, GameObject selected)
        {
            var watch = Stopwatch.StartNew();
            var executionResult = BuildInitialResult(action);
            var writeReceiptBaseline = WriteReceiptService.CaptureBefore(action, selected);

            try
            {
                var actionType = action != null && !string.IsNullOrWhiteSpace(action.type)
                    ? action.type
                    : string.Empty;
                if (string.IsNullOrEmpty(actionType))
                {
                    executionResult = Fail(executionResult, "E_SCHEMA_INVALID", "Visual action type is required.");
                    return executionResult;
                }

                IMcpVisualActionHandler handler;
                if (!_registry.TryGet(actionType, out handler))
                {
                    executionResult = Fail(
                        executionResult,
                        "E_ACTION_HANDLER_NOT_FOUND",
                        "Unsupported visual action type: " + actionType);
                    return executionResult;
                }

                var context = new McpVisualActionContext(action, selected, null, null);
                var handlerResult = handler.Execute(context);
                executionResult = ConvertHandlerResult(action, handlerResult);
                return executionResult;
            }
            catch (Exception ex)
            {
                executionResult = Fail(executionResult, "E_ACTION_EXECUTION_FAILED", ex.Message);
                return executionResult;
            }
            finally
            {
                watch.Stop();
                if (executionResult != null)
                {
                    executionResult.durationMs = (int)watch.ElapsedMilliseconds;
                    if (executionResult.writeReceipt == null)
                    {
                        try
                        {
                            executionResult.writeReceipt =
                                WriteReceiptService.Build(writeReceiptBaseline, action, executionResult);
                        }
                        catch (Exception ex)
                        {
                            executionResult.writeReceipt = BuildFallbackWriteReceipt(executionResult, ex);
                        }
                    }
                }
            }
        }

        private static UnityActionExecutionResult ConvertHandlerResult(
            VisualLayerActionItem action,
            McpVisualActionExecutionResult handlerResult)
        {
            var baseline = BuildInitialResult(action);
            if (handlerResult == null)
            {
                return Fail(baseline, "E_ACTION_EXECUTION_FAILED", "Visual action handler returned null.");
            }

            if (handlerResult.ExecutionResult != null)
            {
                return handlerResult.ExecutionResult;
            }

            if (handlerResult.Success)
            {
                baseline.success = true;
                baseline.errorCode = string.Empty;
                baseline.errorMessage = string.Empty;
                return baseline;
            }

            return Fail(baseline, handlerResult.ErrorCode, handlerResult.ErrorMessage);
        }

        private static UnityActionExecutionResult BuildInitialResult(
            VisualLayerActionItem action)
        {
            return new UnityActionExecutionResult
            {
                actionType = action != null ? action.type : string.Empty,
                targetObjectPath = action == null ? string.Empty : ReadAnchorPath(action.target_anchor),
                targetObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.target_anchor),
                componentAssemblyQualifiedName =
                    action == null ? string.Empty : action.component_assembly_qualified_name,
                sourceComponentAssemblyQualifiedName =
                    action == null ? string.Empty : action.source_component_assembly_qualified_name,
                createdObjectPath = string.Empty,
                createdObjectId = string.Empty,
                name = action == null ? string.Empty : action.name,
                parentObjectPath = action == null ? string.Empty : ReadAnchorPath(action.parent_anchor),
                parentObjectId = action == null ? string.Empty : ReadAnchorObjectId(action.parent_anchor),
                primitiveType = action == null ? string.Empty : action.primitive_type,
                uiType = action == null ? string.Empty : action.ui_type,
                success = false,
                errorCode = string.Empty,
                errorMessage = string.Empty,
                durationMs = 0,
                resultData = null,
                writeReceipt = null,
            };
        }

        private static UnityActionExecutionResult Fail(
            UnityActionExecutionResult result,
            string code,
            string message)
        {
            result.success = false;
            result.errorCode = NormalizeExecutionErrorCode(code);
            result.errorMessage = NormalizeExecutionErrorMessage(result.errorCode, message);
            return result;
        }

        private static string NormalizeExecutionErrorCode(string errorCode)
        {
            var normalized = string.IsNullOrWhiteSpace(errorCode)
                ? string.Empty
                : errorCode.Trim().ToUpperInvariant();
            if (string.IsNullOrEmpty(normalized))
            {
                return "E_ACTION_EXECUTION_FAILED";
            }

            if (string.Equals(normalized, "E_SCHEMA_INVALID", StringComparison.Ordinal))
            {
                return "E_ACTION_SCHEMA_INVALID";
            }

            if (string.Equals(normalized, "E_ACTION_TARGET_NOT_FOUND", StringComparison.Ordinal))
            {
                return "E_TARGET_NOT_FOUND";
            }

            return normalized;
        }

        private static string NormalizeExecutionErrorMessage(string errorCode, string errorMessage)
        {
            var normalizedInput = SanitizeSingleLine(errorMessage, MaxExecutionErrorMessageLength);
            if (!string.IsNullOrEmpty(normalizedInput))
            {
                return normalizedInput;
            }

            if (string.Equals(errorCode, "E_ACTION_SCHEMA_INVALID", StringComparison.Ordinal))
            {
                return "Visual action payload schema validation failed.";
            }

            if (string.Equals(errorCode, "E_TARGET_ANCHOR_CONFLICT", StringComparison.Ordinal))
            {
                return "Target anchor conflict: object_id and path resolve to different objects.";
            }

            if (string.Equals(errorCode, "E_TARGET_NOT_FOUND", StringComparison.Ordinal))
            {
                return "Target object not found.";
            }

            return "Visual action execution failed.";
        }

        private static string SanitizeSingleLine(string raw, int maxLength)
        {
            var value = string.IsNullOrWhiteSpace(raw) ? string.Empty : raw.Trim();
            if (string.IsNullOrEmpty(value))
            {
                return string.Empty;
            }

            var lines = value.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            var singleLine = lines.Length > 0 ? lines[0].Trim() : value;
            if (singleLine.Length <= maxLength)
            {
                return singleLine;
            }
            return singleLine.Substring(0, maxLength).TrimEnd();
        }

        private static UnityWriteReceipt BuildFallbackWriteReceipt(
            UnityActionExecutionResult executionResult,
            Exception error)
        {
            return new UnityWriteReceipt
            {
                schema_version = "write_receipt.v1",
                captured_at = DateTime.UtcNow.ToString("o"),
                success = executionResult != null && executionResult.success,
                error_code = executionResult == null ? string.Empty : executionResult.errorCode,
                target_resolution = "fallback",
                scene_diff = new UnityWriteSceneDiff
                {
                    dirty_scene_count_before = 0,
                    dirty_scene_count_after = 0,
                    added_dirty_scene_paths = new string[0],
                    cleared_dirty_scene_paths = new string[0],
                    dirty_scene_set_changed = false,
                },
                target_delta = new UnityWriteTargetDelta
                {
                    before = new UnityWriteTargetSnapshot
                    {
                        exists = false,
                    },
                    after = new UnityWriteTargetSnapshot
                    {
                        exists = false,
                    },
                    changed_fields = new string[0],
                },
                created_object_delta = new UnityWriteTargetDelta
                {
                    before = new UnityWriteTargetSnapshot
                    {
                        exists = false,
                    },
                    after = new UnityWriteTargetSnapshot
                    {
                        exists = false,
                    },
                    changed_fields = new string[0],
                },
                property_changes = error == null
                    ? new[] { "receipt.capture_failed" }
                    : new[] { "receipt.capture_failed:" + error.GetType().Name },
                console_snapshot = new UnityWriteConsoleSnapshot
                {
                    captured_at = DateTime.UtcNow.ToString("o"),
                    window_start_at = string.Empty,
                    window_end_at = string.Empty,
                    window_seconds = 0,
                    max_entries = 0,
                    total_errors = 0,
                    truncated = false,
                    errors = new UnityWriteConsoleEntry[0],
                },
            };
        }

        private static string ReadAnchorObjectId(UnityObjectAnchor anchor)
        {
            return anchor == null || string.IsNullOrWhiteSpace(anchor.object_id)
                ? string.Empty
                : anchor.object_id.Trim();
        }

        private static string ReadAnchorPath(UnityObjectAnchor anchor)
        {
            return anchor == null || string.IsNullOrWhiteSpace(anchor.path)
                ? string.Empty
                : anchor.path.Trim();
        }
    }
}

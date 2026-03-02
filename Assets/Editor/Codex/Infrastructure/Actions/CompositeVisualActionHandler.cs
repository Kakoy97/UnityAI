using System;
using System.Collections.Generic;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure;
using UnityEditor;
using UnityEngine;
using UnityEngine.SceneManagement;

namespace UnityAI.Editor.Codex.Infrastructure.Actions
{
    internal sealed class CompositeVisualActionHandler
        : McpVisualActionHandler<CompositeVisualActionData>
    {
        private const string TransientObjectIdPrefix = "instance_id:";
        private readonly McpActionRegistry _registry;
        private readonly UnityVisualActionExecutor _executor;
        private readonly CompositeTransactionRunner _transactionRunner;

        public override string ActionType
        {
            get { return "composite_visual_action"; }
        }

        public CompositeVisualActionHandler()
            : this(
                McpActionRegistryBootstrap.Registry,
                null,
                null)
        {
        }

        internal CompositeVisualActionHandler(McpActionRegistry registry)
            : this(registry, null, null)
        {
        }

        internal CompositeVisualActionHandler(
            McpActionRegistry registry,
            UnityVisualActionExecutor executor,
            CompositeTransactionRunner transactionRunner)
        {
            _registry = registry ?? McpActionRegistryBootstrap.Registry;
            _executor = executor ?? new UnityVisualActionExecutor(_registry);
            _transactionRunner = transactionRunner ?? new CompositeTransactionRunner();
        }

        protected override McpVisualActionExecutionResult ExecuteTyped(
            McpVisualActionContext context,
            CompositeVisualActionData data)
        {
            if (context == null || context.RawAction == null)
            {
                return McpVisualActionExecutionResult.Fail(
                    "E_COMPOSITE_EXECUTION_FAILED",
                    "Composite action context is required.");
            }

            if (data == null || data.steps == null || data.steps.Length == 0)
            {
                return McpVisualActionExecutionResult.Fail(
                    "E_COMPOSITE_PAYLOAD_INVALID",
                    "Composite steps must be a non-empty array.");
            }

            if (!string.IsNullOrWhiteSpace(data.atomic_mode) &&
                !string.Equals(data.atomic_mode.Trim(), "all_or_nothing", StringComparison.Ordinal))
            {
                return McpVisualActionExecutionResult.Fail(
                    "E_COMPOSITE_PAYLOAD_INVALID",
                    "Composite atomic_mode must be all_or_nothing when provided.");
            }

            var aliasTable = new CompositeAliasTable();
            var expectedDestroyedInstanceIds = new List<int>();
            var transactionName = BuildTransactionName(data);
            return _transactionRunner.ExecuteAtomic(
                transactionName,
                delegate
                {
                    for (var i = 0; i < data.steps.Length; i += 1)
                    {
                        var step = data.steps[i];
                        var stepId = BuildStepId(step, i);
                        var stepType = step == null || string.IsNullOrWhiteSpace(step.type)
                            ? string.Empty
                            : step.type.Trim();
                        if (string.IsNullOrEmpty(stepType))
                        {
                            return McpVisualActionExecutionResult.Fail(
                                "E_COMPOSITE_PAYLOAD_INVALID",
                                "Composite step " + stepId + " requires type.");
                        }

                        if (string.Equals(stepType, ActionType, StringComparison.Ordinal))
                        {
                            return McpVisualActionExecutionResult.Fail(
                                "E_COMPOSITE_PAYLOAD_INVALID",
                                "Composite step " + stepId + " cannot nest composite_visual_action.");
                        }

                        VisualLayerActionItem dispatchAction;
                        string buildErrorCode;
                        string buildErrorMessage;
                        if (!TryBuildDispatchAction(step, aliasTable, out dispatchAction, out buildErrorCode, out buildErrorMessage))
                        {
                            return McpVisualActionExecutionResult.Fail(
                                NormalizeErrorCode(buildErrorCode, "E_COMPOSITE_PAYLOAD_INVALID"),
                                "Composite step " + stepId + " invalid: " + buildErrorMessage);
                        }

                        IMcpVisualActionHandler resolvedHandler;
                        if (!_registry.TryGet(stepType, out resolvedHandler) || resolvedHandler == null)
                        {
                            return McpVisualActionExecutionResult.Fail(
                                "E_ACTION_HANDLER_NOT_FOUND",
                                "Composite step " + stepId + " handler not found: " + stepType);
                        }

                        McpActionCapability capability;
                        if (_registry.TryGetCapability(stepType, out capability) &&
                            capability != null &&
                            !string.Equals(
                                capability.UndoSafety,
                                McpActionGovernance.UndoSafetyAtomicSafe,
                                StringComparison.Ordinal))
                        {
                            return McpVisualActionExecutionResult.Fail(
                                "E_COMPOSITE_PAYLOAD_INVALID",
                                "Composite step " +
                                stepId +
                                " action_type '" +
                                stepType +
                                "' is not atomic_safe.");
                        }

                        var stepResult = _executor.Execute(dispatchAction, context.Selected);
                        if (stepResult == null)
                        {
                            return McpVisualActionExecutionResult.Fail(
                                "E_COMPOSITE_STEP_FAILED",
                                "Composite step " + stepId + " returned null result.");
                        }

                        if (!stepResult.success)
                        {
                            return McpVisualActionExecutionResult.Fail(
                                "E_COMPOSITE_STEP_FAILED",
                                BuildStepFailureMessage(stepId, stepResult));
                        }

                        TrackCreatedInstanceId(stepResult, expectedDestroyedInstanceIds);

                        string bindErrorCode;
                        string bindErrorMessage;
                        if (!TryBindOutputs(step, stepResult, aliasTable, out bindErrorCode, out bindErrorMessage))
                        {
                            return McpVisualActionExecutionResult.Fail(
                                NormalizeErrorCode(bindErrorCode, "E_COMPOSITE_ALIAS_INVALID"),
                                "Composite step " + stepId + " bind_outputs invalid: " + bindErrorMessage);
                        }
                    }

                    return McpVisualActionExecutionResult.Ok();
                },
                expectedDestroyedInstanceIds);
        }

        private static string BuildTransactionName(CompositeVisualActionData data)
        {
            if (data == null || string.IsNullOrWhiteSpace(data.transaction_id))
            {
                return "Codex composite_visual_action";
            }

            return "Codex composite " + data.transaction_id.Trim();
        }

        private static string BuildStepId(CompositeVisualActionStep step, int index)
        {
            if (step != null && !string.IsNullOrWhiteSpace(step.step_id))
            {
                return step.step_id.Trim();
            }

            return "step_" + (index + 1);
        }

        private static string BuildStepFailureMessage(string stepId, UnityActionExecutionResult result)
        {
            var code = NormalizeErrorCode(
                result == null ? string.Empty : result.errorCode,
                "E_ACTION_EXECUTION_FAILED");
            var message = result == null || string.IsNullOrWhiteSpace(result.errorMessage)
                ? "step execution failed"
                : result.errorMessage.Trim();
            return stepId + " failed (" + code + "): " + message;
        }

        private static bool TryBuildDispatchAction(
            CompositeVisualActionStep step,
            CompositeAliasTable aliasTable,
            out VisualLayerActionItem action,
            out string errorCode,
            out string errorMessage)
        {
            action = null;
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (step == null)
            {
                errorCode = "E_COMPOSITE_PAYLOAD_INVALID";
                errorMessage = "step is null.";
                return false;
            }

            action = new VisualLayerActionItem
            {
                type = string.IsNullOrWhiteSpace(step.type) ? string.Empty : step.type.Trim(),
                target_anchor = NormalizeAnchor(CloneAnchor(step.target_anchor)),
                parent_anchor = NormalizeAnchor(CloneAnchor(step.parent_anchor)),
                target_anchor_ref = string.IsNullOrWhiteSpace(step.target_anchor_ref)
                    ? string.Empty
                    : step.target_anchor_ref.Trim(),
                parent_anchor_ref = string.IsNullOrWhiteSpace(step.parent_anchor_ref)
                    ? string.Empty
                    : step.parent_anchor_ref.Trim(),
                action_data_json = string.IsNullOrWhiteSpace(step.action_data_json)
                    ? "{}"
                    : step.action_data_json.Trim(),
                action_data_marshaled = string.IsNullOrWhiteSpace(step.action_data_marshaled)
                    ? string.Empty
                    : step.action_data_marshaled.Trim(),
            };

            if (action.target_anchor != null && !string.IsNullOrEmpty(action.target_anchor_ref))
            {
                errorCode = "E_COMPOSITE_ALIAS_INVALID";
                errorMessage = "target_anchor and target_anchor_ref are mutually exclusive.";
                return false;
            }

            if (action.parent_anchor != null && !string.IsNullOrEmpty(action.parent_anchor_ref))
            {
                errorCode = "E_COMPOSITE_ALIAS_INVALID";
                errorMessage = "parent_anchor and parent_anchor_ref are mutually exclusive.";
                return false;
            }

            if (action.target_anchor == null && !string.IsNullOrEmpty(action.target_anchor_ref))
            {
                UnityObjectAnchor resolvedTarget;
                if (!aliasTable.TryResolve(action.target_anchor_ref, out resolvedTarget, out errorCode, out errorMessage))
                {
                    return false;
                }

                action.target_anchor = resolvedTarget;
            }

            if (action.parent_anchor == null && !string.IsNullOrEmpty(action.parent_anchor_ref))
            {
                UnityObjectAnchor resolvedParent;
                if (!aliasTable.TryResolve(action.parent_anchor_ref, out resolvedParent, out errorCode, out errorMessage))
                {
                    return false;
                }

                action.parent_anchor = resolvedParent;
            }

            if (action.target_anchor == null && action.parent_anchor == null)
            {
                errorCode = "E_COMPOSITE_PAYLOAD_INVALID";
                errorMessage = "target_anchor/target_anchor_ref or parent_anchor/parent_anchor_ref is required.";
                return false;
            }

            return true;
        }

        private static bool TryBindOutputs(
            CompositeVisualActionStep step,
            UnityActionExecutionResult result,
            CompositeAliasTable aliasTable,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (step == null || step.bind_outputs == null || step.bind_outputs.Length == 0)
            {
                return true;
            }

            for (var i = 0; i < step.bind_outputs.Length; i += 1)
            {
                var item = step.bind_outputs[i];
                if (item == null || string.IsNullOrWhiteSpace(item.alias))
                {
                    errorCode = "E_COMPOSITE_ALIAS_INVALID";
                    errorMessage = "bind_outputs[" + i + "].alias is required.";
                    return false;
                }

                if (item == null || string.IsNullOrWhiteSpace(item.source))
                {
                    errorCode = "E_COMPOSITE_ALIAS_INVALID";
                    errorMessage = "bind_outputs[" + i + "].source is required.";
                    return false;
                }

                UnityObjectAnchor anchor;
                if (!TryResolveAnchorFromResult(item.source, result, out anchor, out errorMessage))
                {
                    errorCode = "E_COMPOSITE_ALIAS_INVALID";
                    return false;
                }

                if (!aliasTable.TryBind(item.alias, anchor, out errorCode, out errorMessage))
                {
                    return false;
                }
            }

            return true;
        }

        private static bool TryResolveAnchorFromResult(
            string source,
            UnityActionExecutionResult result,
            out UnityObjectAnchor anchor,
            out string errorMessage)
        {
            anchor = null;
            errorMessage = string.Empty;

            var normalized = string.IsNullOrWhiteSpace(source) ? string.Empty : source.Trim();
            if (string.Equals(normalized, "created_object", StringComparison.Ordinal))
            {
                anchor = BuildAnchor(result == null ? string.Empty : result.createdObjectId, result == null ? string.Empty : result.createdObjectPath);
            }
            else if (string.Equals(normalized, "target_object", StringComparison.Ordinal))
            {
                anchor = BuildAnchor(result == null ? string.Empty : result.targetObjectId, result == null ? string.Empty : result.targetObjectPath);
            }
            else if (string.Equals(normalized, "parent_object", StringComparison.Ordinal))
            {
                anchor = BuildAnchor(result == null ? string.Empty : result.parentObjectId, result == null ? string.Empty : result.parentObjectPath);
            }
            else
            {
                errorMessage = "bind_outputs.source must be created_object/target_object/parent_object.";
                return false;
            }

            if (anchor == null)
            {
                errorMessage = "bind_outputs source '" + normalized + "' produced empty anchor.";
                return false;
            }

            return true;
        }

        private static UnityObjectAnchor BuildAnchor(string objectId, string path)
        {
            var normalizedPath = string.IsNullOrWhiteSpace(path) ? string.Empty : path.Trim();
            if (string.IsNullOrEmpty(normalizedPath))
            {
                return null;
            }

            var normalizedObjectId = string.IsNullOrWhiteSpace(objectId)
                ? string.Empty
                : objectId.Trim();
            if (string.IsNullOrEmpty(normalizedObjectId))
            {
                var byPath = FindGameObjectByScenePath(normalizedPath);
                normalizedObjectId = BuildObjectId(byPath);
                if (string.IsNullOrEmpty(normalizedObjectId))
                {
                    normalizedObjectId = BuildTransientObjectId(byPath);
                }
            }

            if (string.IsNullOrEmpty(normalizedObjectId))
            {
                return null;
            }

            return new UnityObjectAnchor
            {
                object_id = normalizedObjectId,
                path = normalizedPath,
            };
        }

        private static UnityObjectAnchor NormalizeAnchor(UnityObjectAnchor anchor)
        {
            if (anchor == null)
            {
                return null;
            }

            var objectId = string.IsNullOrWhiteSpace(anchor.object_id)
                ? string.Empty
                : anchor.object_id.Trim();
            var path = string.IsNullOrWhiteSpace(anchor.path)
                ? string.Empty
                : anchor.path.Trim();
            if (string.IsNullOrEmpty(objectId) && string.IsNullOrEmpty(path))
            {
                return null;
            }

            return new UnityObjectAnchor
            {
                object_id = objectId,
                path = path,
            };
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
                path = string.IsNullOrWhiteSpace(anchor.path) ? string.Empty : anchor.path.Trim(),
            };
        }

        private static string NormalizeErrorCode(string value, string fallback)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return fallback;
            }

            return value.Trim().ToUpperInvariant();
        }

        private static void TrackCreatedInstanceId(
            UnityActionExecutionResult result,
            List<int> expectedDestroyedInstanceIds)
        {
            if (result == null || expectedDestroyedInstanceIds == null)
            {
                return;
            }

            var created = ResolveCreatedGameObject(result);
            if (created == null)
            {
                return;
            }

            var instanceId = created.GetInstanceID();
            if (instanceId == 0)
            {
                return;
            }

            if (!expectedDestroyedInstanceIds.Contains(instanceId))
            {
                expectedDestroyedInstanceIds.Add(instanceId);
            }
        }

        private static string BuildTransientObjectId(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            var instanceId = gameObject.GetInstanceID();
            if (instanceId == 0)
            {
                return string.Empty;
            }

            return TransientObjectIdPrefix + instanceId;
        }

        private static GameObject ResolveCreatedGameObject(UnityActionExecutionResult result)
        {
            if (result == null)
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(result.createdObjectId))
            {
                GlobalObjectId parsed;
                if (GlobalObjectId.TryParse(result.createdObjectId, out parsed))
                {
                    var fromGlobalId = GlobalObjectId.GlobalObjectIdentifierToObjectSlow(parsed) as GameObject;
                    if (fromGlobalId != null)
                    {
                        return fromGlobalId;
                    }
                }
            }

            if (string.IsNullOrWhiteSpace(result.createdObjectPath))
            {
                return null;
            }

            return FindGameObjectByScenePath(result.createdObjectPath);
        }

        private static string BuildObjectId(GameObject gameObject)
        {
            if (gameObject == null)
            {
                return string.Empty;
            }

            try
            {
                var globalId = GlobalObjectId.GetGlobalObjectIdSlow(gameObject);
                return globalId.ToString();
            }
            catch
            {
                return string.Empty;
            }
        }

        private static GameObject FindGameObjectByScenePath(string scenePath)
        {
            var normalized = string.IsNullOrWhiteSpace(scenePath) ? string.Empty : scenePath.Trim();
            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            if (normalized.StartsWith("Scene/", StringComparison.Ordinal))
            {
                normalized = normalized.Substring("Scene/".Length);
            }

            if (string.IsNullOrEmpty(normalized))
            {
                return null;
            }

            var segments = normalized.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (segments.Length == 0)
            {
                return null;
            }

            for (var sceneIndex = 0; sceneIndex < SceneManager.sceneCount; sceneIndex += 1)
            {
                var scene = SceneManager.GetSceneAt(sceneIndex);
                if (!scene.IsValid() || !scene.isLoaded)
                {
                    continue;
                }

                var roots = scene.GetRootGameObjects();
                for (var i = 0; i < roots.Length; i += 1)
                {
                    var root = roots[i];
                    if (root == null || !string.Equals(root.name, segments[0], StringComparison.Ordinal))
                    {
                        continue;
                    }

                    var current = root.transform;
                    var matched = true;
                    for (var segmentIndex = 1; segmentIndex < segments.Length; segmentIndex += 1)
                    {
                        var next = current.Find(segments[segmentIndex]);
                        if (next == null)
                        {
                            matched = false;
                            break;
                        }

                        current = next;
                    }

                    if (matched && current != null)
                    {
                        return current.gameObject;
                    }
                }
            }

            return null;
        }
    }
}

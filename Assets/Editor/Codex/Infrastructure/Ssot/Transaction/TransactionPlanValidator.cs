using System;
using System.Collections.Generic;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction
{
    internal sealed class TransactionPlanValidator
    {
        private static readonly HashSet<string> ReservedEnvelopeFields =
            new HashSet<string>(StringComparer.Ordinal)
            {
                "execution_mode",
                "idempotency_key",
                "based_on_read_token",
                "write_anchor_object_id",
                "write_anchor_path"
            };

        internal bool Validate(
            TransactionPlan plan,
            out string errorCode,
            out string errorMessage)
        {
            errorCode = string.Empty;
            errorMessage = string.Empty;

            if (plan == null)
            {
                errorCode = "E_TRANSACTION_PLAN_INVALID";
                errorMessage = "transaction plan is required.";
                return false;
            }

            if (plan.Steps == null || plan.Steps.Count == 0)
            {
                errorCode = "E_TRANSACTION_PLAN_INVALID";
                errorMessage = "transaction plan requires at least one step.";
                return false;
            }

            var stepIdSet = new HashSet<string>(StringComparer.Ordinal);
            var aliasSet = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < plan.Steps.Count; index += 1)
            {
                var step = plan.Steps[index];
                if (step == null)
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage = "transaction step cannot be null at index " + index + ".";
                    return false;
                }

                if (string.IsNullOrEmpty(step.StepId))
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage = "transaction step requires step_id at index " + index + ".";
                    return false;
                }

                if (!stepIdSet.Add(step.StepId))
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage = "duplicated step_id: " + step.StepId;
                    return false;
                }

                if (!string.IsNullOrEmpty(step.SaveAs) && !aliasSet.Add(step.SaveAs))
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage = "duplicated save_as alias: " + step.SaveAs;
                    return false;
                }

                if (ContainsReservedEnvelopeFields(step.Payload, out var reservedFieldName))
                {
                    errorCode = "E_TRANSACTION_PLAN_INVALID";
                    errorMessage =
                        "transaction step payload cannot include reserved write_envelope field '" +
                        reservedFieldName +
                        "' at step '" +
                        step.StepId +
                        "'.";
                    return false;
                }
            }

            for (var index = 0; index < plan.Steps.Count; index += 1)
            {
                var step = plan.Steps[index];
                for (var depIndex = 0; depIndex < step.DependsOn.Count; depIndex += 1)
                {
                    var dependencyId = step.DependsOn[depIndex];
                    if (!stepIdSet.Contains(dependencyId))
                    {
                        errorCode = "E_TRANSACTION_DEPENDENCY_ORDER_INVALID";
                        errorMessage =
                            "step '" + step.StepId + "' depends on missing step_id '" + dependencyId + "'.";
                        return false;
                    }

                    if (!plan.StepIdToIndex.TryGetValue(dependencyId, out var dependencyStepIndex))
                    {
                        errorCode = "E_TRANSACTION_DEPENDENCY_ORDER_INVALID";
                        errorMessage =
                            "step '" + step.StepId + "' depends on unknown step_id '" + dependencyId + "'.";
                        return false;
                    }
                }
            }

            if (HasDependencyCycle(plan))
            {
                errorCode = "E_TRANSACTION_DEPENDENCY_CYCLE";
                errorMessage = "transaction step dependency graph contains a cycle.";
                return false;
            }

            for (var index = 0; index < plan.Steps.Count; index += 1)
            {
                var step = plan.Steps[index];
                for (var depIndex = 0; depIndex < step.DependsOn.Count; depIndex += 1)
                {
                    var dependencyId = step.DependsOn[depIndex];
                    if (!plan.StepIdToIndex.TryGetValue(dependencyId, out var dependencyStepIndex))
                    {
                        continue;
                    }

                    if (dependencyStepIndex >= index)
                    {
                        errorCode = "E_TRANSACTION_DEPENDENCY_ORDER_INVALID";
                        errorMessage =
                            "step '" + step.StepId + "' depends on non-previous step_id '" + dependencyId + "'.";
                        return false;
                    }
                }
            }

            return true;
        }

        private static bool HasDependencyCycle(TransactionPlan plan)
        {
            var marks = new Dictionary<string, int>(StringComparer.Ordinal);
            for (var index = 0; index < plan.Steps.Count; index += 1)
            {
                var stepId = plan.Steps[index].StepId;
                if (!marks.ContainsKey(stepId))
                {
                    marks[stepId] = 0;
                }
            }

            for (var index = 0; index < plan.Steps.Count; index += 1)
            {
                if (HasCycleFrom(plan, plan.Steps[index], marks))
                {
                    return true;
                }
            }

            return false;
        }

        private static bool HasCycleFrom(
            TransactionPlan plan,
            TransactionStepPlan step,
            IDictionary<string, int> marks)
        {
            if (!marks.TryGetValue(step.StepId, out var mark))
            {
                marks[step.StepId] = 0;
                mark = 0;
            }

            if (mark == 1)
            {
                return true;
            }

            if (mark == 2)
            {
                return false;
            }

            marks[step.StepId] = 1;
            for (var depIndex = 0; depIndex < step.DependsOn.Count; depIndex += 1)
            {
                var dependencyId = step.DependsOn[depIndex];
                if (!plan.StepIdToIndex.TryGetValue(dependencyId, out var dependencyIndex))
                {
                    continue;
                }

                var dependencyStep = plan.Steps[dependencyIndex];
                if (HasCycleFrom(plan, dependencyStep, marks))
                {
                    return true;
                }
            }

            marks[step.StepId] = 2;
            return false;
        }

        private static bool ContainsReservedEnvelopeFields(
            Dictionary<string, object> payload,
            out string reservedFieldName)
        {
            reservedFieldName = string.Empty;
            if (payload == null || payload.Count == 0)
            {
                return false;
            }

            foreach (var key in payload.Keys)
            {
                if (!ReservedEnvelopeFields.Contains(key))
                {
                    continue;
                }

                reservedFieldName = key;
                return true;
            }

            return false;
        }
    }
}

using System.Collections.Generic;
using UnityAI.Editor.Codex.Generated.Ssot;

namespace UnityAI.Editor.Codex.Infrastructure.Ssot.Transaction
{
    internal static class ExecuteUnityTransactionPayloadParser
    {
        internal static bool TryDeserialize(
            string payloadJson,
            out ExecuteUnityTransactionRequestDto requestDto,
            out string errorMessage)
        {
            requestDto = null;
            errorMessage = null;

            if (!TransactionJson.TryParseObject(payloadJson, out var root, out errorMessage))
            {
                return false;
            }

            if (!TryReadSteps(root, out var steps, out errorMessage))
            {
                return false;
            }

            requestDto = new ExecuteUnityTransactionRequestDto
            {
                execution_mode = ReadString(root, "execution_mode"),
                thread_id = ReadString(root, "thread_id"),
                idempotency_key = ReadString(root, "idempotency_key"),
                based_on_read_token = ReadString(root, "based_on_read_token"),
                write_anchor_object_id = ReadString(root, "write_anchor_object_id"),
                write_anchor_path = ReadString(root, "write_anchor_path"),
                transaction_id = ReadString(root, "transaction_id"),
                steps = steps,
            };
            return true;
        }

        private static bool TryReadSteps(
            Dictionary<string, object> root,
            out ExecuteUnityTransactionRequestDtoStepsItemDto[] steps,
            out string errorMessage)
        {
            steps = null;
            errorMessage = null;
            if (!root.TryGetValue("steps", out var stepsNode) || stepsNode == null)
            {
                return true;
            }

            if (!(stepsNode is List<object> stepsList))
            {
                errorMessage = "execute_unity_transaction.steps must be a JSON array.";
                return false;
            }

            var buffer = new List<ExecuteUnityTransactionRequestDtoStepsItemDto>(stepsList.Count);
            for (var index = 0; index < stepsList.Count; index += 1)
            {
                if (!(stepsList[index] is Dictionary<string, object> stepObject))
                {
                    errorMessage =
                        "execute_unity_transaction.steps[" +
                        index.ToString() +
                        "] must be a JSON object.";
                    return false;
                }

                if (!TryReadStepPayload(stepObject, index, out var payload, out errorMessage))
                {
                    return false;
                }

                if (!TryReadDependsOn(stepObject, index, out var dependsOn, out errorMessage))
                {
                    return false;
                }

                buffer.Add(new ExecuteUnityTransactionRequestDtoStepsItemDto
                {
                    step_id = ReadString(stepObject, "step_id"),
                    tool_name = ReadString(stepObject, "tool_name"),
                    payload = payload,
                    save_as = ReadString(stepObject, "save_as"),
                    depends_on = dependsOn,
                });
            }

            steps = buffer.ToArray();
            return true;
        }

        private static bool TryReadStepPayload(
            Dictionary<string, object> stepObject,
            int stepIndex,
            out Dictionary<string, object> payload,
            out string errorMessage)
        {
            payload = null;
            errorMessage = null;
            if (!stepObject.TryGetValue("payload", out var payloadNode) || payloadNode == null)
            {
                return true;
            }

            if (payloadNode is Dictionary<string, object> payloadObject)
            {
                payload = payloadObject;
                return true;
            }

            errorMessage =
                "execute_unity_transaction.steps[" +
                stepIndex.ToString() +
                "].payload must be a JSON object.";
            return false;
        }

        private static bool TryReadDependsOn(
            Dictionary<string, object> stepObject,
            int stepIndex,
            out string[] dependsOn,
            out string errorMessage)
        {
            dependsOn = null;
            errorMessage = null;
            if (!stepObject.TryGetValue("depends_on", out var dependsOnNode) || dependsOnNode == null)
            {
                return true;
            }

            if (!(dependsOnNode is List<object> dependsOnList))
            {
                errorMessage =
                    "execute_unity_transaction.steps[" +
                    stepIndex.ToString() +
                    "].depends_on must be an array of strings.";
                return false;
            }

            var values = new List<string>(dependsOnList.Count);
            for (var index = 0; index < dependsOnList.Count; index += 1)
            {
                var dependencyId = dependsOnList[index] as string;
                if (dependencyId == null)
                {
                    errorMessage =
                        "execute_unity_transaction.steps[" +
                        stepIndex.ToString() +
                        "].depends_on[" +
                        index.ToString() +
                        "] must be a string.";
                    return false;
                }

                values.Add(dependencyId);
            }

            dependsOn = values.ToArray();
            return true;
        }

        private static string ReadString(Dictionary<string, object> source, string key)
        {
            if (!source.TryGetValue(key, out var value) || value == null)
            {
                return string.Empty;
            }

            return value as string ?? string.Empty;
        }
    }
}

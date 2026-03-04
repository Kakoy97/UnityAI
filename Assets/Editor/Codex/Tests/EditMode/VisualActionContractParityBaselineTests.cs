using System;
using System.Collections.Generic;
using System.Reflection;
using NUnit.Framework;
using UnityAI.Editor.Codex.Application;
using UnityAI.Editor.Codex.Domain;
using UnityAI.Editor.Codex.Infrastructure.Actions;

namespace UnityAI.Editor.Codex.Tests.EditMode
{
    public sealed class VisualActionContractParityBaselineTests
    {
        private static readonly string[] KnownGapCaseIds = Array.Empty<string>();

        private static readonly Type VisualActionContractValidatorType =
            typeof(ConversationController).Assembly.GetType(
                "UnityAI.Editor.Codex.Application.VisualActionContractValidator");

        private static readonly MethodInfo TryValidateActionPayloadMethod =
            VisualActionContractValidatorType == null
                ? null
                : VisualActionContractValidatorType.GetMethod(
                    "TryValidateActionPayload",
                    BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);

        [Test]
        public void R20_UX_GOV_12B_L3_ParityMatrix_RemainsAligned()
        {
            var cases = BuildCases();
            for (var i = 0; i < cases.Length; i++)
            {
                var parityCase = cases[i];
                var outcome = EvaluateL3(parityCase.BuildAction());
                Assert.AreEqual(
                    parityCase.ExpectedL3,
                    outcome.Ok,
                    parityCase.Id +
                    " (" +
                    parityCase.Title +
                    ") L3 baseline drifted. code=" +
                    outcome.ErrorCode +
                    " message=" +
                    outcome.ErrorMessage);
            }
        }

        [Test]
        public void R20_UX_GOV_12B_KnownGapSet_ClosesToZero()
        {
            var cases = BuildCases();
            var mismatches = new List<string>();
            var undeclared = new List<string>();
            for (var i = 0; i < cases.Length; i++)
            {
                var parityCase = cases[i];
                var outcome = EvaluateL3(parityCase.BuildAction());
                if (outcome.Ok == parityCase.ExpectedL2)
                {
                    continue;
                }

                mismatches.Add(parityCase.Id);
                if (!parityCase.KnownGap)
                {
                    undeclared.Add(parityCase.Id);
                }
            }

            mismatches.Sort(StringComparer.Ordinal);
            Array.Sort(KnownGapCaseIds, StringComparer.Ordinal);

            CollectionAssert.AreEqual(
                KnownGapCaseIds,
                mismatches,
                "known_gap baseline changed unexpectedly.");
            CollectionAssert.AreEqual(
                Array.Empty<string>(),
                undeclared,
                "found undeclared L2/L3 mismatches.");
        }

        private static L3ValidationOutcome EvaluateL3(VisualLayerActionItem action)
        {
            Assert.NotNull(VisualActionContractValidatorType);
            Assert.NotNull(TryValidateActionPayloadMethod);
            Assert.NotNull(action);

            McpActionRegistryBootstrap.Rebuild();
            var args = new object[] { action, McpActionRegistryBootstrap.Registry, null, null };
            var ok = (bool)TryValidateActionPayloadMethod.Invoke(null, args);
            return new L3ValidationOutcome(
                ok,
                args[2] as string ?? string.Empty,
                args[3] as string ?? string.Empty);
        }

        private static ParityCase[] BuildCases()
        {
            return new[]
            {
                new ParityCase(
                    "P20-G12A-C01",
                    "create_object missing parent_anchor",
                    () => Action("create_object", actionDataJson: "{\"name\":\"Child\"}"),
                    expectedL2: false,
                    expectedL3: false),
                // R21-detox: removed C02 (create_gameobject alias parity) — alias no longer registered in L3.
                new ParityCase(
                    "P20-G12A-C03",
                    "rename_object missing action_data.name",
                    () => Action(
                        "rename_object",
                        target: Anchor("go_target", "Scene/Canvas/Panel"),
                        actionDataJson: "{}"),
                    expectedL2: false,
                    expectedL3: false),
                // R21-detox: removed C04 (rename_gameobject alias parity) — alias no longer registered in L3.
                new ParityCase(
                    "P20-G12A-C05",
                    "set_parent missing parent_anchor",
                    () => Action(
                        "set_parent",
                        target: Anchor("go_target", "Scene/Canvas/Panel"),
                        actionDataJson: "{}"),
                    expectedL2: false,
                    expectedL3: false),
                new ParityCase(
                    "P20-G12A-C06",
                    "set_active missing action_data.active",
                    () => Action(
                        "set_active",
                        target: Anchor("go_target", "Scene/Canvas/Panel"),
                        actionDataJson: "{}"),
                    expectedL2: false,
                    expectedL3: false),
                // R21-detox: removed C07 (set_gameobject_active alias parity) — alias no longer registered in L3.
                new ParityCase(
                    "P20-G12A-C08",
                    "set_local_position missing action_data.z",
                    () => Action(
                        "set_local_position",
                        target: Anchor("go_target", "Scene/Canvas/Panel"),
                        actionDataJson: "{\"x\":0,\"y\":0}"),
                    expectedL2: false,
                    expectedL3: false),
                new ParityCase(
                    "P20-G12A-C09",
                    "add_component missing component_assembly_qualified_name",
                    () => Action(
                        "add_component",
                        target: Anchor("go_target", "Scene/Canvas/Panel"),
                        actionDataJson: "{}"),
                    expectedL2: false,
                    expectedL3: false),
                new ParityCase(
                    "P20-G12A-C11",
                    "rename_object with malformed optional parent_anchor",
                    () => Action(
                        "rename_object",
                        target: Anchor("go_target", "Scene/Canvas/Panel"),
                        parent: Anchor("go_parent", string.Empty),
                        actionDataJson: "{\"name\":\"Panel_A\"}"),
                    expectedL2: false,
                    expectedL3: false),
                new ParityCase(
                    "P20-G12A-C10",
                    "rename_object valid payload",
                    () => Action(
                        "rename_object",
                        target: Anchor("go_target", "Scene/Canvas/Panel"),
                        actionDataJson: "{\"name\":\"Panel_B\"}"),
                    expectedL2: true,
                    expectedL3: true),
            };
        }

        private static VisualLayerActionItem Action(
            string type,
            UnityObjectAnchor target = null,
            UnityObjectAnchor parent = null,
            string actionDataJson = "{}")
        {
            return new VisualLayerActionItem
            {
                type = type,
                target_anchor = target,
                parent_anchor = parent,
                action_data_json = actionDataJson,
            };
        }

        private static UnityObjectAnchor Anchor(string objectId, string path)
        {
            return new UnityObjectAnchor
            {
                object_id = objectId,
                path = path,
            };
        }

        private readonly struct L3ValidationOutcome
        {
            public L3ValidationOutcome(bool ok, string errorCode, string errorMessage)
            {
                Ok = ok;
                ErrorCode = errorCode;
                ErrorMessage = errorMessage;
            }

            public bool Ok { get; }

            public string ErrorCode { get; }

            public string ErrorMessage { get; }
        }

        private sealed class ParityCase
        {
            public ParityCase(
                string id,
                string title,
                Func<VisualLayerActionItem> buildAction,
                bool expectedL2,
                bool expectedL3,
                bool knownGap = false)
            {
                Id = id;
                Title = title;
                BuildAction = buildAction;
                ExpectedL2 = expectedL2;
                ExpectedL3 = expectedL3;
                KnownGap = knownGap;
            }

            public string Id { get; private set; }

            public string Title { get; private set; }

            public Func<VisualLayerActionItem> BuildAction { get; private set; }

            public bool ExpectedL2 { get; private set; }

            public bool ExpectedL3 { get; private set; }

            public bool KnownGap { get; private set; }
        }
    }
}

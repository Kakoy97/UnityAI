"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  validateMcpApplyVisualActions,
} = require("../../src/domain/validators");
const {
  createActionContractRegistry,
} = require("../../src/domain/actionContractRegistry");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function assertFilesExist(relPaths, label) {
  const missing = [];
  for (const relPath of relPaths) {
    const fullPath = path.join(REPO_ROOT, relPath);
    if (!fs.existsSync(fullPath)) {
      missing.push(relPath);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `${label} missing required files:\n${missing.join("\n")}`
  );
}

test("R20-UX-QA-01 sidecar regression gate has required suites", () => {
  assertFilesExist(
    [
      "sidecar/tests/application/action-contract-parity.test.js",
      "sidecar/tests/application/turn-policies-schema-compensation.test.js",
      "sidecar/tests/application/get-write-contract-bundle.test.js",
      "sidecar/tests/application/get-tool-schema-lifecycle.test.js",
      "sidecar/tests/application/anchor-write-guard.test.js",
      "sidecar/tests/application/anchor-error-feedback.test.js",
      "sidecar/tests/application/r20-governance-metrics-wiring.test.js",
      "sidecar/tests/application/r20-governance-baseline-script.test.js",
      "sidecar/tests/application/r11-command-contract-snapshot.test.js",
      "sidecar/tests/application/mcp-tool-schema-minimal.test.js",
      "sidecar/tests/domain/validators.anchor-hardcut.test.js",
      "sidecar/tests/domain/validators.composite-action.test.js",
    ],
    "R20-UX-QA-01"
  );
});

test("R20-UX-QA-02 unity regression gate has required EditMode suites", () => {
  assertFilesExist(
    [
      "Assets/Editor/Codex/Tests/EditMode/SidecarContractsSnapshotTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityPhase6ClosureTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityVisualActionRegistryExecutorTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityVisualReadChainTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityErrorFeedbackReceiptTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/VisualActionContractParityBaselineTests.cs",
    ],
    "R20-UX-QA-02"
  );
});

test("R20-UX-E2E-01 authoritative docs and evidence index exist", () => {
  assertFilesExist(
    [
      "docs/ROADMAP.md",
      "docs/Phase20-Protocol-Usability-Acceptance.md",
      "docs/V2-PROTOCOL-协议可用性缺口修复实施方案.md",
      "Assets/Docs/Codex-Unity-MCP-Main-Index.md",
      "Assets/Docs/evidence/phase20/README.md",
    ],
    "R20-UX-E2E-01"
  );
});

test("R20-UX-HF-01/HF-02 unity hotfix guard suites exist", () => {
  assertFilesExist(
    [
      "Assets/Editor/Codex/Tests/EditMode/UnityAnchorExecutionTests.cs",
      "Assets/Editor/Codex/Tests/EditMode/UnityRuntimeRecoveryTests.cs",
      "Assets/Editor/Codex/Application/Conversation/TurnStateCoordinator.cs",
      "Assets/Editor/Codex/Application/Conversation/PendingActionCoordinator.cs",
    ],
    "R20-UX-HF-01/HF-02"
  );
});

test("R20-UX-HF-03 hotfix evidence scaffolding is archived", () => {
  assertFilesExist(
    [
      "docs/Phase20-Protocol-Usability-Acceptance.md",
      "Assets/Docs/evidence/phase20/README.md",
      "Assets/Docs/evidence/phase20/2026-03-03/case-f-invalid-envelope-fast-fail.json",
      "Assets/Docs/evidence/phase20/2026-03-03/case-f-optional-parent-anchor-compat.json",
      "Assets/Docs/evidence/phase20/2026-03-03/case-f-hotfix-regression-notes.md",
    ],
    "R20-UX-HF-03"
  );
});

test("R20-UX-GOV-07/GOV-08 governance closure assets exist", () => {
  assertFilesExist(
    [
      "sidecar/scripts/generate-r20-ux-governance-baseline.js",
      "docs/V2-PROTOCOL-协议可用性缺口修复实施方案.md",
      "docs/Phase20-Protocol-Usability-Acceptance.md",
      "Assets/Docs/evidence/phase20/README.md",
    ],
    "R20-UX-GOV-07/GOV-08"
  );
});

test("R20-UX-GOV-13 behavior gate: L2 blocks malformed optional parent_anchor and required action_data fields", () => {
  const actionContractRegistry = createActionContractRegistry({
    getCapabilityVersion: () => "cap_v1",
    listActionSummaries: () => [
      {
        type: "rename_object",
        anchor_policy: "target_required",
      },
      {
        type: "set_parent",
        anchor_policy: "target_and_parent_required",
      },
    ],
    resolveActionSchema: (actionType) => {
      if (actionType === "rename_object") {
        return {
          ok: true,
          action: {
            type: "rename_object",
            anchor_policy: "target_required",
            action_data_schema: {
              type: "object",
              required: ["name"],
              properties: {
                name: { type: "string" },
              },
            },
          },
        };
      }
      if (actionType === "set_parent") {
        return {
          ok: true,
          action: {
            type: "set_parent",
            anchor_policy: "target_and_parent_required",
            action_data_schema: {
              type: "object",
              required: [],
              properties: {},
            },
          },
        };
      }
      return null;
    },
  });

  const malformedParent = validateMcpApplyVisualActions(
    {
      based_on_read_token: "rt_case_reject_parent_12345678901234567890",
      write_anchor: {
        object_id: "go_target",
        path: "Scene/Canvas/Panel",
      },
      actions: [
        {
          type: "rename_object",
          target_anchor: {
            object_id: "go_target",
            path: "Scene/Canvas/Panel",
          },
          parent_anchor: {
            object_id: "go_parent",
            path: "",
          },
          action_data: {
            name: "Panel_A",
          },
        },
      ],
    },
    {
      actionContractRegistry,
    }
  );
  assert.equal(malformedParent.ok, false);
  assert.equal(malformedParent.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(
    malformedParent.message,
    "actions[0].parent_anchor.path is required"
  );

  const missingName = validateMcpApplyVisualActions(
    {
      based_on_read_token: "rt_case_missing_name_12345678901234567890",
      write_anchor: {
        object_id: "go_target",
        path: "Scene/Canvas/Panel",
      },
      actions: [
        {
          type: "rename_object",
          target_anchor: {
            object_id: "go_target",
            path: "Scene/Canvas/Panel",
          },
          action_data: {},
        },
      ],
    },
    {
      actionContractRegistry,
    }
  );
  assert.equal(missingName.ok, false);
  assert.equal(missingName.errorCode, "E_ACTION_SCHEMA_INVALID");
  assert.equal(missingName.message, "actions[0].action_data.name is required");
});

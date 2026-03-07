"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  emitTokenPolicyManifest,
} = require("../emitters/l2/emitTokenPolicyManifest");

test("emitTokenPolicyManifest emits token contract and tool-level policy rows", () => {
  const manifest = emitTokenPolicyManifest(
    {
      version: 1,
      _definitions: {
        mixins: {
          write_envelope: {
            input: {
              type: "object",
              required: [
                "execution_mode",
                "idempotency_key",
                "based_on_read_token",
                "write_anchor_object_id",
                "write_anchor_path",
              ],
              properties: {
                based_on_read_token: {
                  type: "string",
                },
              },
            },
          },
        },
        token_automation_contract: {
          issuance_authority: "l2_sidecar",
          token_families: [
            "read_issues_token",
            "write_requires_token",
            "local_static_no_token",
          ],
          success_continuation: ["read", "write"],
          drift_recovery: {
            enabled: true,
            error_code: "E_SCENE_REVISION_DRIFT",
            max_retry: 1,
            requires_idempotency: true,
            refresh_tool_name: "get_scene_snapshot_for_write",
          },
          redaction_policy: {
            strip_fields: [
              "read_token",
              "read_token_candidate",
              "read_token_candidate_legacy",
            ],
          },
          auto_retry_policy: {
            max_retry: 1,
            requires_idempotency_key: true,
            on_retry_failure: "return_both_errors",
          },
          auto_retry_safe_family: ["write_requires_token"],
        },
      },
      tools: [
        {
          name: "get_scene_snapshot_for_write",
          kind: "read",
          lifecycle: "stable",
          token_family: "read_issues_token",
          scene_revision_capable: true,
          input: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "set_component_properties",
          kind: "write",
          lifecycle: "stable",
          token_family: "write_requires_token",
          scene_revision_capable: true,
          mixins: ["write_envelope"],
          input: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "run_unity_tests",
          kind: "read",
          lifecycle: "experimental",
          token_family: "local_static_no_token",
          scene_revision_capable: false,
          input: {
            type: "object",
            properties: {},
          },
        },
      ],
    },
    {
      version: 1,
      commands: [
        {
          name: "get_scene_snapshot_for_write",
          kind: "read",
          dispatch_mode: "ssot_query",
        },
        {
          name: "set_component_properties",
          kind: "write",
          dispatch_mode: "ssot_query",
        },
        {
          name: "run_unity_tests",
          kind: "read",
          dispatch_mode: "local_static",
        },
      ],
    }
  );

  assert.equal(manifest.version, 1);
  assert.equal(manifest.contract.issuance_authority, "l2_sidecar");
  assert.deepEqual(manifest.contract.auto_retry_safe_family, [
    "write_requires_token",
  ]);
  assert.equal(manifest.tools.length, 3);
  const writeTool = manifest.tools.find(
    (item) => item.name === "set_component_properties"
  );
  assert.equal(writeTool.token_family, "write_requires_token");
  assert.equal(writeTool.requires_based_on_read_token, true);
  assert.equal(writeTool.declares_based_on_read_token, true);
  assert.equal(writeTool.auto_retry_safe, true);
  const localStaticTool = manifest.tools.find(
    (item) => item.name === "run_unity_tests"
  );
  assert.equal(localStaticTool.token_family, "local_static_no_token");
  assert.equal(localStaticTool.scene_revision_capable, false);
  assert.equal(localStaticTool.auto_retry_safe, false);
  assert.deepEqual(
    manifest.summary.write_requires_token_missing_based_on_read_token,
    []
  );
  assert.deepEqual(manifest.summary.scene_revision_ineligible_tools, []);
});


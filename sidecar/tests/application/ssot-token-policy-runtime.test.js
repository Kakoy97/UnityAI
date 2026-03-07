"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  createTokenPolicyRuntime,
  loadTokenPolicyManifest,
} = require("../../src/application/ssotRuntime/tokenPolicyRuntime");

test("token policy runtime loads generated artifact and resolves tool policies", () => {
  const loaded = loadTokenPolicyManifest();
  assert.ok(loaded && typeof loaded === "object");
  assert.ok(loaded.manifest && typeof loaded.manifest === "object");
  assert.ok(Array.isArray(loaded.manifest.tools));
  assert.ok(loaded.manifest.tools.length > 0);

  const runtime = createTokenPolicyRuntime();
  const modifyUiLayoutPolicy = runtime.getToolPolicy("modify_ui_layout");
  assert.ok(modifyUiLayoutPolicy);
  assert.equal(modifyUiLayoutPolicy.kind, "write");
  assert.equal(modifyUiLayoutPolicy.token_family, "write_requires_token");
  assert.equal(runtime.doesToolRequireWriteToken("modify_ui_layout"), true);
  assert.equal(runtime.isToolContinuationEligible("modify_ui_layout"), true);

  const actionCatalogPolicy = runtime.getToolPolicy("get_action_catalog");
  assert.ok(actionCatalogPolicy);
  assert.equal(actionCatalogPolicy.token_family, "local_static_no_token");
  assert.equal(runtime.isToolContinuationEligible("get_action_catalog"), false);
});

test("token policy runtime rejects invalid artifact shape", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "token-policy-runtime-"));
  try {
    const artifactPath = path.join(tempDir, "token-policy.generated.json");
    fs.writeFileSync(
      artifactPath,
      JSON.stringify({
        version: 1,
        contract: {
          issuance_authority: "l2",
          token_families: ["write_requires_token", "read_issues_token"],
          success_continuation: ["read", "write"],
          drift_recovery: {
            enabled: true,
            error_code: "E_SCENE_REVISION_DRIFT",
            max_retry: 1,
            requires_idempotency: true,
            refresh_tool_name: "get_scene_snapshot_for_write",
          },
          redaction_policy: {
            strip_fields: ["read_token"],
          },
          auto_retry_policy: {
            max_retry: 1,
            requires_idempotency_key: true,
            on_retry_failure: "return_both_errors",
          },
          auto_retry_safe_family: ["write_requires_token"],
        },
        tools: [
          {
            name: "modify_ui_layout",
            kind: "write",
            token_family: "write_requires_token",
            scene_revision_capable: true,
            requires_based_on_read_token: false,
            declares_based_on_read_token: true,
          },
        ],
      }),
      "utf8"
    );

    assert.throws(
      () =>
        createTokenPolicyRuntime({
          artifactPath,
        }),
      /must require based_on_read_token/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

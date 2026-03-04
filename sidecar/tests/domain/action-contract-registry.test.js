"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createActionContractRegistry,
} = require("../../src/domain/actionContractRegistry");

test("actionContractRegistry resolves canonical contract from capability summaries + schemas", () => {
  const registry = createActionContractRegistry({
    getCapabilityVersion() {
      return "sha256:cap_test_v1";
    },
    listActionSummaries() {
      return [
        {
          type: "rename_object",
          description: "Rename target object.",
          anchor_policy: "target_required",
        },
      ];
    },
    resolveActionSchema(actionType) {
      if (actionType !== "rename_object") {
        return {
          ok: false,
          reason: "action_not_found",
        };
      }
      return {
        ok: true,
        action_type: "rename_object",
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
    },
  });

  const contract = registry.resolveActionContract("rename_gameobject");
  assert.ok(contract);
  assert.equal(contract.action_type, "rename_object");
  assert.equal(contract.anchor_policy, "target_required");
  assert.equal(contract.anchor_requirement, "target_required");
  assert.deepEqual(contract.action_data_schema.required, ["name"]);
  assert.equal(contract.aliases.includes("rename_gameobject"), true);
});

test("actionContractRegistry keeps unknown action submit-open when capability metadata is absent", () => {
  const registry = createActionContractRegistry({
    getCapabilityVersion() {
      return "sha256:cap_test_v1";
    },
    listActionSummaries() {
      return [];
    },
    resolveActionSchema() {
      return {
        ok: false,
        reason: "action_not_found",
      };
    },
  });

  const contract = registry.resolveActionContract("set_rect_transform");
  assert.equal(contract, null);
});

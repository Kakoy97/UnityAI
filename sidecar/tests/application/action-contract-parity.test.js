"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateMcpApplyVisualActions } = require("../../src/domain/validators");
const {
  createActionContractRegistry,
} = require("../../src/domain/actionContractRegistry");
const {
  canonicalizeVisualActionType,
} = require("../../src/domain/actionTypeCanonicalizer");

const VALID_TOKEN = "tok_gov12b_parity_12345678901234567890";
const KNOWN_GAP_CASE_IDS = Object.freeze([]);

const CONTRACT_SPECS = Object.freeze({
  create_object: Object.freeze({
    anchor_policy: "parent_required",
    required: ["name"],
    properties: { name: { type: "string" } },
  }),
  rename_object: Object.freeze({
    anchor_policy: "target_required",
    required: ["name"],
    properties: { name: { type: "string" } },
  }),
  set_parent: Object.freeze({
    anchor_policy: "target_and_parent_required",
    required: [],
    properties: {},
  }),
  set_active: Object.freeze({
    anchor_policy: "target_required",
    required: ["active"],
    properties: { active: { type: "boolean" } },
  }),
  set_local_position: Object.freeze({
    anchor_policy: "target_required",
    required: ["x", "y", "z"],
    properties: { x: { type: "number" }, y: { type: "number" }, z: { type: "number" } },
  }),
  add_component: Object.freeze({
    anchor_policy: "target_required",
    required: ["component_assembly_qualified_name"],
    properties: { component_assembly_qualified_name: { type: "string" } },
  }),
});

function anchor(objectId, path) {
  return { object_id: objectId, path };
}

function createActionContractRegistryForParity() {
  return createActionContractRegistry({
    getCapabilityVersion() {
      return "sha256:gov12a_baseline_v1";
    },
    listActionSummaries() {
      return Object.entries(CONTRACT_SPECS).map(([type, spec]) => ({
        type,
        description: `contract for ${type}`,
        anchor_policy: spec.anchor_policy,
      }));
    },
    resolveActionSchema(actionType) {
      const canonical = canonicalizeVisualActionType(actionType);
      const spec = canonical ? CONTRACT_SPECS[canonical] : null;
      if (!spec) {
        return {
          ok: false,
          reason: "action_not_found",
        };
      }
      return {
        ok: true,
        action_type: canonical,
        action: {
          type: canonical,
          anchor_policy: spec.anchor_policy,
          action_data_schema: {
            type: "object",
            required: [...spec.required],
            properties: { ...spec.properties },
          },
        },
      };
    },
  });
}

function buildApplyBody(action) {
  return {
    based_on_read_token: VALID_TOKEN,
    write_anchor: anchor("go_root", "Scene/Root"),
    actions: [action],
  };
}

function buildParityCases() {
  return [
    {
      id: "P20-G12A-C01",
      title: "create_object missing parent_anchor",
      action: {
        type: "create_object",
        action_data: { name: "Child" },
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C02",
      title: "create_gameobject(alias) missing parent_anchor",
      action: {
        type: "create_gameobject",
        action_data: { name: "Child" },
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C03",
      title: "rename_object missing action_data.name",
      action: {
        type: "rename_object",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        action_data: {},
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C04",
      title: "rename_gameobject(alias) missing action_data.name",
      action: {
        type: "rename_gameobject",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        action_data: {},
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C05",
      title: "set_parent missing parent_anchor",
      action: {
        type: "set_parent",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        action_data: {},
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C06",
      title: "set_active missing action_data.active",
      action: {
        type: "set_active",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        action_data: {},
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C07",
      title: "set_gameobject_active(alias) missing action_data.active",
      action: {
        type: "set_gameobject_active",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        action_data: {},
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C08",
      title: "set_local_position missing action_data.z",
      action: {
        type: "set_local_position",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        action_data: { x: 0, y: 0 },
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C09",
      title: "add_component missing component_assembly_qualified_name",
      action: {
        type: "add_component",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        action_data: {},
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C11",
      title: "rename_object with malformed optional parent_anchor",
      action: {
        type: "rename_object",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        parent_anchor: {
          object_id: "go_parent",
          path: "",
        },
        action_data: { name: "Panel_A" },
      },
      expected_l2: false,
      expected_l3: false,
      known_gap: false,
    },
    {
      id: "P20-G12A-C10",
      title: "rename_object valid payload",
      action: {
        type: "rename_object",
        target_anchor: anchor("go_target", "Scene/Canvas/Panel"),
        action_data: { name: "Panel_B" },
      },
      expected_l2: true,
      expected_l3: true,
      known_gap: false,
    },
  ];
}

function evaluateL2(caseItem, actionContractRegistry) {
  const result = validateMcpApplyVisualActions(buildApplyBody(caseItem.action), {
    actionContractRegistry,
  });
  return {
    ok: result && result.ok === true,
    errorCode: result && result.errorCode ? result.errorCode : "",
    message: result && result.message ? result.message : "",
  };
}

test("R20-UX-GOV-12B L2 parity matrix stays aligned for high-frequency actions", () => {
  const actionContractRegistry = createActionContractRegistryForParity();
  const cases = buildParityCases();

  for (const item of cases) {
    const observed = evaluateL2(item, actionContractRegistry);
    assert.equal(
      observed.ok,
      item.expected_l2,
      `${item.id}(${item.title}) l2 baseline drifted. code=${observed.errorCode} message=${observed.message}`
    );
  }
});

test("R20-UX-GOV-12B known_gap set is closed to zero", () => {
  const actionContractRegistry = createActionContractRegistryForParity();
  const cases = buildParityCases();
  const observedMismatchIds = [];
  const undeclaredMismatchIds = [];

  for (const item of cases) {
    const observed = evaluateL2(item, actionContractRegistry);
    if (observed.ok === item.expected_l3) {
      continue;
    }
    observedMismatchIds.push(item.id);
    if (!item.known_gap) {
      undeclaredMismatchIds.push(item.id);
    }
  }

  assert.deepEqual(
    observedMismatchIds.sort(),
    [...KNOWN_GAP_CASE_IDS].sort(),
    `known_gap baseline changed unexpectedly: ${observedMismatchIds.join(", ")}`
  );
  assert.deepEqual(
    undeclaredMismatchIds,
    [],
    `found undeclared L2/L3 mismatches: ${undeclaredMismatchIds.join(", ")}`
  );
});

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emitMcpToolsJson } = require("../emitters/l2/emitMcpToolsJson");

test("emitMcpToolsJson maps tool IR to MCP tools payload", () => {
  const fullDescription = [
    "Modify RectTransform geometry only.",
    "Strictly do NOT use this tool for color/text/sprite/material changes.",
    "If target is not RectTransform, fail fast without fallback.",
  ].join("\n");
  const dictionary = {
    version: 1,
    tools: [
      {
        name: "modify_ui_layout",
        lifecycle: "stable",
        kind: "write",
        description: fullDescription,
        input: {
          type: "object",
          additionalProperties: false,
          required: ["execution_mode", "target_path", "width", "height"],
          properties: {
            execution_mode: { type: "string", enum: ["validate", "execute"] },
            target_path: { type: "string" },
            width: { type: "number" },
            height: { type: "number" },
          },
        },
        examples: [
          {
            name: "set_layout",
            user_intent: "Move button to x=100,y=100 and resize it",
            request_business_only: {
              target_path: "Scene/Canvas/Button",
              width: 160,
              height: 48,
            },
            request: {
              execution_mode: "execute",
              target_path: "Scene/Canvas/Button",
              width: 160,
              height: 48,
            },
          },
        ],
      },
    ],
  };

  const emitted = emitMcpToolsJson(dictionary);
  const tool = emitted.tools[0];

  assert.equal(emitted.version, 1);
  assert.equal(tool.name, "modify_ui_layout");
  assert.equal(tool.kind, "write");
  assert.equal(tool.lifecycle, "stable");
  assert.equal(tool.token_family, "write_requires_token");
  assert.equal(tool.scene_revision_capable, true);
  assert.equal(tool.description, fullDescription);
  assert.equal(tool.inputSchema.required.includes("execution_mode"), true);
  assert.deepEqual(tool.examples[0].request, {
    execution_mode: "execute",
    target_path: "Scene/Canvas/Button",
    width: 160,
    height: 48,
  });
  assert.equal(tool.examples[0].user_intent, "Move button to x=100,y=100 and resize it");
  assert.equal(Object.prototype.hasOwnProperty.call(tool.examples[0], "request_business_only"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(tool.examples[0], "name"), false);
});

test("emitMcpToolsJson applies fallback defaults for missing optional tool fields", () => {
  const emitted = emitMcpToolsJson({
    version: 1,
    tools: [
      {
        name: "get_scene_snapshot_for_write",
      },
    ],
  });

  const tool = emitted.tools[0];
  assert.equal(tool.lifecycle, "stable");
  assert.equal(tool.kind, "write");
  assert.equal(tool.token_family, "write_requires_token");
  assert.equal(tool.scene_revision_capable, true);
  assert.deepEqual(tool.inputSchema, { type: "object", properties: {} });
  assert.deepEqual(tool.examples, []);
  assert.equal(Object.prototype.hasOwnProperty.call(tool, "ux_contract"), false);
  assert.deepEqual(emitted.global_contracts, {});
});

test("emitMcpToolsJson projects v2 global contracts from _definitions", () => {
  const emitted = emitMcpToolsJson({
    version: 1,
    _definitions: {
      error_context_contract: {
        error_context_version: "2.0",
      },
      recovery_action_contract: {
        dependency_validation: {
          check_cycles: true,
          max_depth: 10,
          on_cycle_detected: "fail_fast",
        },
      },
      ambiguity_resolution_policy_contract: {
        anchor_conflict: {
          resolution_mode: "explicit_target_only",
        },
      },
      transaction_write_family: {
        rollback_policy: {
          on_step_failure: "rollback_all",
        },
      },
      anchor_write_family: {
        conflict_error_code: "E_TARGET_ANCHOR_CONFLICT",
      },
      create_family: {
        pre_check_policy: {
          check_existing: true,
          on_conflict: "fail",
          return_candidates: true,
        },
      },
      error_feedback_contract: {
        catalog_version: "v1",
        defaults: {
          fallback_suggestion:
            "Inspect error_code/error_message, adjust task payload, then retry if safe.",
          timeout_suggestion:
            "Retry once after backoff. If timeout persists, reduce task scope or inspect sidecar logs.",
        },
        anchor_error_codes: [
          "E_ACTION_SCHEMA_INVALID",
          "E_TARGET_ANCHOR_CONFLICT",
          "E_TARGET_CONFLICT",
        ],
        error_templates: {
          E_STALE_SNAPSHOT: {
            recoverable: true,
            suggestion: "请先调用读工具获取最新 token，并仅重试一次写操作。",
          },
          E_ACTION_SCHEMA_INVALID: {
            recoverable: true,
            suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
          },
          E_TARGET_ANCHOR_CONFLICT: {
            recoverable: true,
            suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
          },
          E_TARGET_CONFLICT: {
            recoverable: true,
            suggestion: "请先调用读工具获取目标 object_id 与 path，再重试写操作。",
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
      mixins: {
        write_envelope: {
          input: {
            type: "object",
          },
        },
      },
    },
    tools: [
      {
        name: "create_object",
        kind: "write",
        input: {
          type: "object",
          properties: {},
        },
      },
    ],
  });

  assert.equal(
    emitted.global_contracts.error_context_contract.error_context_version,
    "2.0"
  );
  assert.equal(
    emitted.global_contracts.transaction_write_family.rollback_policy.on_step_failure,
    "rollback_all"
  );
  assert.equal(
    emitted.global_contracts.error_feedback_contract.catalog_version,
    "v1"
  );
  assert.equal(
    emitted.global_contracts.token_automation_contract.issuance_authority,
    "l2_sidecar"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(emitted.global_contracts, "mixins"),
    false
  );
});

test("emitMcpToolsJson emits self-contained $defs closure for _definitions refs", () => {
  const emitted = emitMcpToolsJson({
    version: 1,
    _definitions: {
      transaction_ref_value: {
        type: "object",
        additionalProperties: false,
        required: ["$ref"],
        properties: {
          $ref: { type: "string" },
        },
      },
      transaction_payload_value: {
        anyOf: [
          { type: "string" },
          { $ref: "#/_definitions/transaction_ref_value" },
        ],
      },
      transaction_step: {
        type: "object",
        additionalProperties: false,
        required: ["step_id", "tool_name", "payload"],
        properties: {
          step_id: { type: "string" },
          tool_name: { type: "string" },
          payload: {
            type: "object",
            additionalProperties: {
              $ref: "#/_definitions/transaction_payload_value",
            },
          },
        },
      },
      mixins: {
        write_envelope: {
          input: {
            type: "object",
          },
        },
      },
      removed_tool_names: ["instantiate_prefab"],
    },
    tools: [
      {
        name: "execute_unity_transaction",
        kind: "write",
        lifecycle: "experimental",
        input: {
          type: "object",
          required: ["steps"],
          properties: {
            steps: {
              type: "array",
              items: { $ref: "#/_definitions/transaction_step" },
            },
          },
        },
      },
    ],
  });

  const schema = emitted.tools[0].inputSchema;
  assert.equal(
    schema.properties.steps.items.$ref,
    "#/$defs/transaction_step"
  );
  assert.equal(
    schema.$defs.transaction_step.properties.payload.additionalProperties.$ref,
    "#/$defs/transaction_payload_value"
  );
  assert.equal(
    schema.$defs.transaction_payload_value.anyOf[1].$ref,
    "#/$defs/transaction_ref_value"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(schema.$defs, "mixins"),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(schema.$defs, "removed_tool_names"),
    false
  );
});

test("emitMcpToolsJson projects g1 contract metadata fields", () => {
  const emitted = emitMcpToolsJson({
    version: 1,
    tools: [
      {
        name: "set_component_properties",
        lifecycle: "stable",
        kind: "write",
        description: "Set one explicit component property",
        input: {
          type: "object",
          properties: {},
        },
        tool_priority: "P0",
        must_configure: true,
        priority_score: 0.33,
        usage_notes: "Use m_ serialized paths for Unity properties.",
        examples_positive: [
          {
            scenario: "batch_ui_create",
            example_revision: "g1-r1",
            context_tags: ["ui", "property"],
            request: {
              component_type: "UnityEngine.UI.Image, UnityEngine.UI",
              property_path: "m_Color.a",
              value_kind: "number",
              value_number: 0.5,
            },
          },
        ],
        examples_negative: [
          {
            error_code: "E_PROPERTY_NOT_FOUND",
            fix_hint: "spacing is invalid; use m_Spacing",
            wrong_payload_fragment: {
              property_path: "spacing",
            },
          },
        ],
        common_error_fixes: {
          E_PROPERTY_NOT_FOUND: {
            suggested_action: "get_serialized_property_tree",
            fix_hint: "Query serialized property tree first.",
          },
        },
        related_tools: ["get_serialized_property_tree"],
        tool_combinations: [
          {
            scenario: "set_layout_spacing",
            tools: ["get_serialized_property_tree", "set_component_properties"],
          },
        ],
        property_path_rules: {
          format: "SerializedProperty.propertyPath",
          prefix: "m_",
          discovery_tool: "get_serialized_property_tree",
        },
        high_frequency_properties: {
          "UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI": {
            m_Spacing: {
              type: "number",
              common_mistake: "spacing",
            },
          },
        },
      },
    ],
  });

  const tool = emitted.tools[0];
  assert.equal(tool.tool_priority, "P0");
  assert.equal(tool.must_configure, true);
  assert.equal(tool.priority_score, 0.33);
  assert.equal(tool.usage_notes.length > 0, true);
  assert.equal(tool.examples_positive.length, 1);
  assert.equal(tool.examples_negative.length, 1);
  assert.equal(tool.related_tools[0], "get_serialized_property_tree");
  assert.equal(tool.property_path_rules.discovery_tool, "get_serialized_property_tree");
  assert.equal(
    tool.high_frequency_properties["UnityEngine.UI.HorizontalLayoutGroup, UnityEngine.UI"].m_Spacing.type,
    "number"
  );
});

test("emitMcpToolsJson projects planner ux_contract metadata", () => {
  const emitted = emitMcpToolsJson({
    version: 1,
    tools: [
      {
        name: "planner_execute_mcp",
        kind: "read",
        token_family: "local_static_no_token",
        scene_revision_capable: false,
        input: {
          type: "object",
          required: ["block_spec"],
          properties: {
            block_spec: {
              type: "object",
            },
          },
        },
        ux_contract: {
          domain: "planner_entry",
          block_type_enum: ["READ_STATE", "CREATE", "MUTATE", "VERIFY"],
          required_business_fields: [
            "block_spec.block_id",
            "block_spec.block_type",
            "block_spec.intent_key",
            "block_spec.input",
          ],
          system_fields: [
            "execution_context",
            "block_spec.based_on_read_token",
          ],
          auto_filled_fields: [
            "block_spec.write_envelope.execution_mode",
            "block_spec.write_envelope.idempotency_key",
          ],
          minimal_valid_template: {
            block_spec: {
              block_id: "block_read_snapshot_1",
              block_type: "READ_STATE",
              intent_key: "read.snapshot_for_write",
              input: {
                scope_path: "Scene/Canvas",
              },
            },
          },
          common_aliases: {
            "block_spec.block_type": ["block_spec.type"],
          },
          autofill_policy: {
            write_envelope_execution_mode: {
              field: "block_spec.write_envelope.execution_mode",
              strategy: "default_if_missing",
              value: "execute",
            },
          },
        },
      },
    ],
  });

  const tool = emitted.tools[0];
  assert.equal(tool.name, "planner_execute_mcp");
  assert.equal(tool.ux_contract.domain, "planner_entry");
  assert.deepEqual(tool.ux_contract.block_type_enum, [
    "READ_STATE",
    "CREATE",
    "MUTATE",
    "VERIFY",
  ]);
  assert.equal(
    tool.ux_contract.autofill_policy.write_envelope_execution_mode.strategy,
    "default_if_missing"
  );
  assert.equal(Array.isArray(tool.inputSchema.examples), true);
  assert.equal(tool.inputSchema.examples.length, 1);
  assert.equal(tool.inputSchema.examples[0].block_spec.block_type, "READ_STATE");
  assert.equal(
    tool.inputSchema.properties.block_spec.properties.block_type.enum.includes("MUTATE"),
    true
  );
  assert.equal(
    typeof tool.inputSchema.properties.block_spec.description === "string",
    true
  );
});

test("emitMcpToolsJson throws when _definitions ref cannot be resolved", () => {
  assert.throws(
    () =>
      emitMcpToolsJson({
        version: 1,
        _definitions: {},
        tools: [
          {
            name: "execute_unity_transaction",
            input: {
              type: "object",
              required: ["steps"],
              properties: {
                steps: {
                  type: "array",
                  items: { $ref: "#/_definitions/transaction_step" },
                },
              },
            },
          },
        ],
      }),
    /transaction_step/
  );
});

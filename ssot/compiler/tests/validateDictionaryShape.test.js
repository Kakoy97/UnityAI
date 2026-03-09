"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateDictionaryShape } = require("../parser/validateDictionaryShape");

function buildTool(overrides = {}) {
  return {
    name: "create_object",
    kind: "write",
    mixins: ["write_envelope"],
    token_family: "write_requires_token",
    scene_revision_capable: true,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    transaction: {
      enabled: true,
      undo_safe: true,
    },
    ...overrides,
  };
}

function buildContractMetadata(overrides = {}) {
  return {
    tool_priority: "P0",
    must_configure: true,
    priority_score: 0.24,
    usage_notes: "Always obtain fresh token from get_scene_snapshot_for_write before write chain.",
    related_tools: ["get_scene_snapshot_for_write", "save_scene"],
    examples_positive: [
      {
        scenario: "batch_ui_create",
        example_revision: "g1-r1",
        context_tags: ["transaction", "ui"],
        request: {
          target_object_id: "mock_target_object_id",
        },
      },
    ],
    examples_negative: [
      {
        error_code: "E_PROPERTY_NOT_FOUND",
        fix_hint: "Use serialized property path with m_ prefix",
        wrong_payload_fragment: {
          property_path: "spacing",
        },
      },
    ],
    common_error_fixes: {
      E_SCENE_REVISION_DRIFT: {
        suggested_action: "get_scene_snapshot_for_write",
        fix_hint: "Refresh read token before retry",
        context_required: ["scene_revision_changed"],
        auto_fixable: true,
        fix_steps: [
          {
            step: 1,
            tool: "get_scene_snapshot_for_write",
          },
        ],
      },
    },
    tool_combinations: [
      {
        scenario: "write_then_save",
        tools: ["create_object", "save_scene"],
      },
    ],
    ...overrides,
  };
}

function buildDefinitions(overrides = {}) {
  return {
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
    error_context_contract: {
      error_context_version: "2.0",
      transaction_failure: {
        required_fields: [
          "failed_step_id",
          "failed_tool_name",
          "failed_error_code",
        ],
      },
      anchor_conflict: {
        required_fields: [
          "ambiguity_kind",
          "resolved_candidates_count",
          "path_candidate_path",
          "path_candidate_object_id",
          "object_id_candidate_path",
          "object_id_candidate_object_id",
        ],
      },
    },
    recovery_action_contract: {
      dependency_validation: {
        check_cycles: true,
        max_depth: 10,
        on_cycle_detected: "fail_fast",
      },
      context_validity: {
        ttl_seconds: 300,
        context_snapshot: true,
        requires_context_refresh_field: "requires_context_refresh",
      },
      fallback_strategy: {
        allowed: [
          "try_simpler_fix",
          "return_manual_instructions",
          "escalate_to_human",
        ],
        default: "return_manual_instructions",
      },
    },
    ambiguity_resolution_policy_contract: {
      anchor_conflict: {
        resolution_mode: "explicit_target_only",
        required_actions: ["get_hierarchy_subtree"],
      },
      name_collision: {
        allowed_policies: ["fail", "suffix", "reuse"],
        default_policy: "fail",
      },
    },
    transaction_write_family: {
      rollback_policy: {
        on_step_failure: "rollback_all",
      },
    },
    anchor_write_family: {
      conflict_error_code: "E_TARGET_ANCHOR_CONFLICT",
      requires_ambiguity_kind: true,
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
    ...overrides,
  };
}

test("validateDictionaryShape accepts write tool when transaction metadata is complete", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [buildTool()],
  };

  assert.equal(validateDictionaryShape(dictionary), true);
});

test("validateDictionaryShape rejects write tool without transaction metadata", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [buildTool({ transaction: undefined })],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /transaction is required for write tools/
  );
});

test("validateDictionaryShape rejects error_feedback_contract when anchor template is missing", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions({
      error_feedback_contract: {
        catalog_version: "v1",
        defaults: {
          fallback_suggestion: "fallback",
          timeout_suggestion: "timeout",
        },
        anchor_error_codes: ["E_TARGET_ANCHOR_CONFLICT"],
        error_templates: {
          E_STALE_SNAPSHOT: {
            recoverable: true,
            suggestion: "stale",
          },
        },
      },
    }),
    tools: [buildTool()],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /anchor_error_codes requires matching error_templates entry/
  );
});

test("validateDictionaryShape rejects write tool when transaction flags are not booleans", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool({
        transaction: {
          enabled: "true",
          undo_safe: true,
        },
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /transaction\.enabled must be boolean/
  );
});

test("validateDictionaryShape allows read tool without transaction metadata", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      {
        name: "get_scene_roots",
        kind: "read",
        token_family: "read_issues_token",
        scene_revision_capable: true,
        input: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    ],
  };

  assert.equal(validateDictionaryShape(dictionary), true);
});

test("validateDictionaryShape accepts must_configure tool with contract metadata", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool(
        buildContractMetadata({
          related_tools: ["save_scene"],
          tool_combinations: [
            {
              scenario: "write_then_save",
              tools: ["create_object", "save_scene"],
            },
          ],
        })
      ),
      buildTool({
        name: "save_scene",
      }),
      buildTool({
        name: "get_scene_snapshot_for_write",
        kind: "read",
        token_family: "read_issues_token",
        scene_revision_capable: true,
      }),
    ],
  };

  assert.equal(validateDictionaryShape(dictionary), true);
});

test("validateDictionaryShape rejects must_configure tool when examples_negative missing", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool(
        buildContractMetadata({
          examples_negative: undefined,
          related_tools: ["save_scene"],
          tool_combinations: [
            {
              scenario: "write_then_save",
              tools: ["create_object", "save_scene"],
            },
          ],
        })
      ),
      buildTool({
        name: "save_scene",
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /examples_negative/
  );
});

test("validateDictionaryShape rejects related_tools cycle", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool({
        name: "create_object",
        kind: "write",
        input: {
          type: "object",
          properties: {},
        },
        transaction: {
          enabled: true,
          undo_safe: true,
        },
        related_tools: ["save_scene"],
      }),
      buildTool({
        name: "save_scene",
        kind: "write",
        input: {
          type: "object",
          properties: {},
        },
        transaction: {
          enabled: true,
          undo_safe: true,
        },
        related_tools: ["create_object"],
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /related_tools cycle detected/
  );
});

test("validateDictionaryShape rejects common_error_fixes when suggested_action is unknown", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool(
        buildContractMetadata({
          related_tools: ["save_scene"],
          common_error_fixes: {
            E_SCENE_REVISION_DRIFT: {
              suggested_action: "unknown_tool_name",
              fix_hint: "refresh token",
              auto_fixable: false,
            },
          },
          tool_combinations: [
            {
              scenario: "write_then_save",
              tools: ["create_object", "save_scene"],
            },
          ],
        })
      ),
      buildTool({
        name: "save_scene",
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /suggested_action references unknown tool/
  );
});

test("validateDictionaryShape rejects common_error_fixes when fix_steps tool is unknown", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool(
        buildContractMetadata({
          related_tools: ["save_scene"],
          common_error_fixes: {
            E_SCENE_REVISION_DRIFT: {
              suggested_action: "get_scene_snapshot_for_write",
              fix_hint: "refresh token",
              auto_fixable: true,
              fix_steps: [
                {
                  step: 1,
                  tool: "unknown_tool_name",
                },
              ],
            },
          },
          tool_combinations: [
            {
              scenario: "write_then_save",
              tools: ["create_object", "save_scene"],
            },
          ],
        })
      ),
      buildTool({
        name: "save_scene",
      }),
      buildTool({
        name: "get_scene_snapshot_for_write",
        kind: "read",
        token_family: "read_issues_token",
        scene_revision_capable: true,
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /fix_steps\[0\]\.tool references unknown tool/
  );
});

test("validateDictionaryShape rejects common_error_fixes when auto_fixable=true but fix_steps missing", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool(
        buildContractMetadata({
          related_tools: ["save_scene"],
          common_error_fixes: {
            E_SCENE_REVISION_DRIFT: {
              suggested_action: "get_scene_snapshot_for_write",
              fix_hint: "refresh token",
              auto_fixable: true,
            },
          },
          tool_combinations: [
            {
              scenario: "write_then_save",
              tools: ["create_object", "save_scene"],
            },
          ],
        })
      ),
      buildTool({
        name: "save_scene",
      }),
      buildTool({
        name: "get_scene_snapshot_for_write",
        kind: "read",
        token_family: "read_issues_token",
        scene_revision_capable: true,
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /auto_fixable=true requires non-empty fix_steps/
  );
});

test("validateDictionaryShape accepts nested_error_routes in common_error_fixes", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool(
        buildContractMetadata({
          related_tools: ["save_scene", "get_write_contract_bundle"],
          common_error_fixes: {
            E_TRANSACTION_STEP_FAILED: {
              suggested_action: "get_write_contract_bundle",
              fix_hint: "inspect nested error",
              fix_steps: [
                {
                  step: 1,
                  tool: "get_write_contract_bundle",
                },
              ],
              nested_error_routes: {
                E_SCENE_REVISION_DRIFT: {
                  suggested_action: "get_scene_snapshot_for_write",
                  fix_hint: "refresh token",
                  fix_steps: [
                    {
                      step: 1,
                      tool: "get_scene_snapshot_for_write",
                    },
                  ],
                },
              },
            },
          },
          tool_combinations: [
            {
              scenario: "write_then_save",
              tools: ["create_object", "save_scene"],
            },
          ],
        })
      ),
      buildTool({
        name: "save_scene",
      }),
      buildTool({
        name: "get_scene_snapshot_for_write",
        kind: "read",
        token_family: "read_issues_token",
        scene_revision_capable: true,
      }),
      buildTool({
        name: "get_write_contract_bundle",
        kind: "read",
        token_family: "read_issues_token",
        scene_revision_capable: true,
      }),
    ],
  };

  assert.equal(validateDictionaryShape(dictionary), true);
});

test("validateDictionaryShape rejects nested_error_routes when suggested_action is unknown", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool(
        buildContractMetadata({
          related_tools: ["save_scene", "get_write_contract_bundle"],
          common_error_fixes: {
            E_TRANSACTION_STEP_FAILED: {
              suggested_action: "get_write_contract_bundle",
              fix_hint: "inspect nested error",
              fix_steps: [
                {
                  step: 1,
                  tool: "get_write_contract_bundle",
                },
              ],
              nested_error_routes: {
                E_SCENE_REVISION_DRIFT: {
                  suggested_action: "unknown_tool",
                  fix_hint: "refresh token",
                  fix_steps: [
                    {
                      step: 1,
                      tool: "unknown_tool",
                    },
                  ],
                },
              },
            },
          },
          tool_combinations: [
            {
              scenario: "write_then_save",
              tools: ["create_object", "save_scene"],
            },
          ],
        })
      ),
      buildTool({
        name: "save_scene",
      }),
      buildTool({
        name: "get_write_contract_bundle",
        kind: "read",
        token_family: "read_issues_token",
        scene_revision_capable: true,
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /nested_error_routes/
  );
});

test("validateDictionaryShape rejects tool_combinations failure_handling required_action when unknown", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      buildTool(
        buildContractMetadata({
          related_tools: ["save_scene"],
          tool_combinations: [
            {
              scenario: "write_then_save",
              tools: ["create_object", "save_scene"],
              failure_handling: {
                after_write_failure: {
                  required_action: "unknown_tool_name",
                  reason: "scene changed",
                },
              },
            },
          ],
        })
      ),
      buildTool({
        name: "save_scene",
      }),
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /after_write_failure\.required_action references unknown tool/
  );
});

test("validateDictionaryShape rejects dictionary when _definitions is missing", () => {
  const dictionary = {
    version: 1,
    tools: [buildTool()],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /Dictionary missing required field: _definitions/
  );
});

test("validateDictionaryShape rejects invalid transaction_write_family.rollback_policy", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions({
      transaction_write_family: {
        rollback_policy: {
          on_step_failure: "invalid_mode",
        },
      },
    }),
    tools: [buildTool()],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /rollback_policy\.on_step_failure must be one of/
  );
});

test("validateDictionaryShape rejects error_context_contract when anchor candidate fields are missing", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions({
      error_context_contract: {
        error_context_version: "2.0",
        transaction_failure: {
          required_fields: [
            "failed_step_id",
            "failed_tool_name",
            "failed_error_code",
          ],
        },
        anchor_conflict: {
          required_fields: ["ambiguity_kind"],
        },
      },
    }),
    tools: [buildTool()],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /anchor_conflict\.required_fields must include 'resolved_candidates_count'/
  );
});

test("validateDictionaryShape rejects tool when token_family is missing", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      {
        ...buildTool(),
        token_family: undefined,
      },
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /token_family must be a non-empty string/
  );
});

test("validateDictionaryShape rejects write_requires_token tool when based_on_read_token is not declared", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions({
      mixins: {
        write_envelope: {
          input: {
            type: "object",
            required: [
              "execution_mode",
              "idempotency_key",
              "write_anchor_object_id",
              "write_anchor_path",
            ],
            properties: {
              execution_mode: {
                type: "string",
              },
            },
          },
        },
      },
    }),
    tools: [
      {
        ...buildTool({
          mixins: ["write_envelope"],
          input: {
            type: "object",
            additionalProperties: false,
            required: [],
            properties: {},
          },
        }),
      },
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /write_requires_token must declare based_on_read_token/
  );
});

test("validateDictionaryShape accepts planner ux_contract metadata", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      {
        name: "planner_execute_mcp",
        kind: "read",
        token_family: "local_static_no_token",
        scene_revision_capable: false,
        input: {
          type: "object",
          additionalProperties: false,
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
            write_envelope_idempotency_key: {
              field: "block_spec.write_envelope.idempotency_key",
              strategy: "generate_if_missing",
            },
          },
        },
      },
    ],
  };

  assert.equal(validateDictionaryShape(dictionary), true);
});

test("validateDictionaryShape rejects planner ux_contract with invalid autofill strategy", () => {
  const dictionary = {
    version: 1,
    _definitions: buildDefinitions(),
    tools: [
      {
        name: "planner_execute_mcp",
        kind: "read",
        token_family: "local_static_no_token",
        scene_revision_capable: false,
        input: {
          type: "object",
          additionalProperties: false,
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
          auto_filled_fields: ["block_spec.write_envelope.execution_mode"],
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
          autofill_policy: {
            write_envelope_execution_mode: {
              field: "block_spec.write_envelope.execution_mode",
              strategy: "smart_infer",
            },
          },
        },
      },
    ],
  };

  assert.throws(
    () => validateDictionaryShape(dictionary),
    /strategy must be one of/
  );
});

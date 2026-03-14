"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  WORKFLOW_ROUTING_ADVISOR_VERSION,
  CANDIDATE_CONFIDENCE,
  GATING_ACTION,
  createWorkflowRoutingAdvisor,
} = require("../../src/application/blockRuntime/entry");

function buildContract(overrides = {}) {
  return {
    workflow_candidate_rules: [
      {
        rule_id: "script_create_compile_attach_candidate_v1",
        enabled: true,
        priority: 100,
        template_ref: "script_create_compile_attach.v1",
        match_when: {
          all_signals: [
            "script_file_action",
            "component_attach",
            "target_anchor_available",
            "thread_id_available",
          ],
          any_signals: ["compile_wait_intent"],
        },
        deny_when: {
          any_signals: [
            "target_anchor_missing",
            "thread_id_missing",
            "required_capability_missing",
            "workflow_template_disabled",
          ],
        },
        reason_code_on_hit: "workflow_candidate_script_create_compile_attach",
        reason_code_on_deny: "workflow_candidate_script_create_compile_attach_blocked",
      },
    ],
    workflow_templates: {
      "script_create_compile_attach.v1": {
        enabled: true,
        selection: {
          required_capabilities: [
            "write.async_ops.submit_task",
            "write.async_ops.get_task_status",
            "write.component_lifecycle.add_component",
          ],
        },
      },
    },
    workflow_intent_gating_rules: [
      {
        rule_id: "workflow_gating_allow_non_candidate_default_v1",
        enabled: true,
        priority: 10,
        action: "allow",
        when: {
          candidate_hit: false,
        },
        reason_code: "workflow_gating_allow_non_candidate",
      },
      {
        rule_id: "workflow_gating_warn_script_candidate_v1",
        enabled: true,
        priority: 100,
        action: "warn",
        when: {
          candidate_hit: true,
          candidate_rule_ids: ["script_create_compile_attach_candidate_v1"],
          candidate_confidence_in: ["medium", "high"],
          required_scene_signals_all: [
            "script_file_action",
            "component_attach",
            "target_anchor_available",
            "thread_id_available",
          ],
        },
        reason_code: "workflow_gating_warn_script_candidate",
      },
      {
        rule_id: "workflow_gating_reject_script_mixed_submit_slots_v1",
        enabled: false,
        priority: 120,
        action: "reject",
        when: {
          candidate_hit: true,
          candidate_rule_ids: ["script_create_compile_attach_candidate_v1"],
          candidate_confidence_in: ["high"],
          misroute_patterns_any: ["async_ops_submit_task_mixed_slots"],
        },
        reason_code: "workflow_gating_reject_script_mixed_submit_slots",
      },
    ],
    ...overrides,
  };
}

function buildWorkflowBlockSpec(overrides = {}) {
  return {
    block_id: "block_workflow_candidate_1",
    block_type: "MUTATE",
    intent_key: "workflow.script.create_compile_attach",
    input: {
      thread_id: "thread_candidate_1",
      file_actions: [
        {
          action: "create_or_update_script",
          path: "Assets/Scripts/Candidate.cs",
          content: "using UnityEngine; public class Candidate : MonoBehaviour {}",
        },
      ],
      visual_layer_actions: [
        {
          action: "add_component",
          component_type: "Candidate",
          target_object_id: "GlobalObjectId_V1-target",
          target_path: "Scene/Canvas/Candidate",
        },
      ],
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/Candidate",
    },
    ...overrides,
  };
}

function buildAsyncMixedSlotWorkflowBlockSpec(overrides = {}) {
  return {
    block_id: "block_workflow_candidate_async_mixed_1",
    block_type: "MUTATE",
    intent_key: "write.async_ops.submit_task.compile",
    input: {
      thread_id: "thread_candidate_async_mixed_1",
      file_actions: [
        {
          action: "create_or_update_script",
          path: "Assets/Scripts/CandidateAsync.cs",
          content:
            "using UnityEngine; public class CandidateAsync : MonoBehaviour {}",
        },
      ],
      visual_layer_actions: [
        {
          action: "add_component",
          component_type: "CandidateAsync",
          target_object_id: "GlobalObjectId_V1-target",
          target_path: "Scene/Canvas/CandidateAsync",
        },
      ],
    },
    target_anchor: {
      object_id: "GlobalObjectId_V1-target",
      path: "Scene/Canvas/CandidateAsync",
    },
    based_on_read_token: "rt_async_mixed",
    write_envelope: {
      execution_mode: "execute",
      idempotency_key: "idp_async_mixed_1",
      write_anchor_object_id: "GlobalObjectId_V1-target",
      write_anchor_path: "Scene/Canvas/CandidateAsync",
    },
    ...overrides,
  };
}

test("WorkflowRoutingAdvisor exports stable symbols", () => {
  assert.equal(typeof WORKFLOW_ROUTING_ADVISOR_VERSION, "string");
  assert.equal(WORKFLOW_ROUTING_ADVISOR_VERSION.length > 0, true);
  assert.equal(CANDIDATE_CONFIDENCE.NONE, "none");
  assert.equal(CANDIDATE_CONFIDENCE.MEDIUM, "medium");
  assert.equal(CANDIDATE_CONFIDENCE.HIGH, "high");
  assert.equal(GATING_ACTION.ALLOW, "allow");
  assert.equal(GATING_ACTION.WARN, "warn");
  assert.equal(GATING_ACTION.REJECT, "reject");
});

test("WorkflowRoutingAdvisor returns high-confidence hit for script create+compile+attach candidate", () => {
  const advisor = createWorkflowRoutingAdvisor();
  const decision = advisor.detectCandidate({
    block_spec: buildWorkflowBlockSpec(),
    execution_context: {
      capabilities: [
        "write.async_ops.submit_task",
        "write.async_ops.get_task_status",
        "write.component_lifecycle.add_component",
      ],
    },
    orchestration_contract: buildContract(),
  });

  assert.equal(decision.candidate_hit, true);
  assert.equal(decision.confidence, CANDIDATE_CONFIDENCE.HIGH);
  assert.equal(
    decision.matched_rule_id,
    "script_create_compile_attach_candidate_v1"
  );
  assert.equal(
    decision.recommended_workflow_template_id,
    "script_create_compile_attach.v1"
  );
  assert.equal(
    decision.reason_code,
    "workflow_candidate_script_create_compile_attach"
  );
});

test("WorkflowRoutingAdvisor returns deny reason when candidate template is disabled", () => {
  const advisor = createWorkflowRoutingAdvisor();
  const contract = buildContract({
    workflow_templates: {
      "script_create_compile_attach.v1": {
        enabled: false,
        selection: {
          required_capabilities: [],
        },
      },
    },
  });
  const decision = advisor.detectCandidate({
    block_spec: buildWorkflowBlockSpec(),
    execution_context: {},
    orchestration_contract: contract,
  });

  assert.equal(decision.candidate_hit, false);
  assert.equal(decision.confidence, CANDIDATE_CONFIDENCE.NONE);
  assert.equal(
    decision.matched_rule_id,
    "script_create_compile_attach_candidate_v1"
  );
  assert.equal(
    decision.recommended_workflow_template_id,
    "script_create_compile_attach.v1"
  );
  assert.equal(
    decision.reason_code,
    "workflow_candidate_script_create_compile_attach_blocked"
  );
});

test("WorkflowRoutingAdvisor returns default miss when rules do not match", () => {
  const advisor = createWorkflowRoutingAdvisor();
  const decision = advisor.detectCandidate({
    block_spec: {
      block_id: "block_workflow_candidate_miss",
      block_type: "READ_STATE",
      intent_key: "read.snapshot_for_write",
      input: {},
    },
    execution_context: {},
    orchestration_contract: buildContract(),
  });

  assert.equal(decision.candidate_hit, false);
  assert.equal(decision.confidence, CANDIDATE_CONFIDENCE.NONE);
  assert.equal(decision.matched_rule_id, "");
  assert.equal(decision.recommended_workflow_template_id, "");
  assert.equal(decision.reason_code, "workflow_candidate_not_matched");
});

test("WorkflowRoutingAdvisor returns warn gating decision for workflow candidate hit", () => {
  const advisor = createWorkflowRoutingAdvisor();
  const candidateDecision = advisor.detectCandidate({
    block_spec: buildWorkflowBlockSpec(),
    execution_context: {},
    orchestration_contract: buildContract(),
  });
  const gatingDecision = advisor.evaluateIntentGating({
    block_spec: buildWorkflowBlockSpec(),
    execution_context: {},
    orchestration_contract: buildContract(),
    candidate_decision: candidateDecision,
  });

  assert.equal(gatingDecision.action, GATING_ACTION.WARN);
  assert.equal(
    gatingDecision.matched_rule_id,
    "workflow_gating_warn_script_candidate_v1"
  );
  assert.equal(
    gatingDecision.reason_code,
    "workflow_gating_warn_script_candidate"
  );
  assert.equal(
    gatingDecision.recommended_workflow_template_id,
    "script_create_compile_attach.v1"
  );
});

test("WorkflowRoutingAdvisor returns allow gating decision for non-candidate request", () => {
  const advisor = createWorkflowRoutingAdvisor();
  const candidateDecision = advisor.detectCandidate({
    block_spec: {
      block_id: "block_workflow_gating_allow_1",
      block_type: "READ_STATE",
      intent_key: "read.snapshot_for_write",
      input: {},
    },
    execution_context: {},
    orchestration_contract: buildContract(),
  });
  const gatingDecision = advisor.evaluateIntentGating({
    block_spec: {
      block_id: "block_workflow_gating_allow_1",
      block_type: "READ_STATE",
      intent_key: "read.snapshot_for_write",
      input: {},
    },
    execution_context: {},
    orchestration_contract: buildContract(),
    candidate_decision: candidateDecision,
  });

  assert.equal(gatingDecision.action, GATING_ACTION.ALLOW);
  assert.equal(
    gatingDecision.matched_rule_id,
    "workflow_gating_allow_non_candidate_default_v1"
  );
  assert.equal(
    gatingDecision.reason_code,
    "workflow_gating_allow_non_candidate"
  );
});

test("WorkflowRoutingAdvisor returns reject gating decision only when reject rule is enabled and matched", () => {
  const advisor = createWorkflowRoutingAdvisor({
    reject_enabled: true,
    reject_rule_ids: ["workflow_gating_reject_script_mixed_submit_slots_v1"],
  });
  const contract = buildContract({
    workflow_intent_gating_rules: [
      {
        rule_id: "workflow_gating_reject_script_mixed_submit_slots_v1",
        enabled: true,
        priority: 120,
        action: "reject",
        when: {
          candidate_hit: true,
          candidate_rule_ids: ["script_create_compile_attach_candidate_v1"],
          candidate_confidence_in: ["high"],
          misroute_patterns_any: ["async_ops_submit_task_mixed_slots"],
        },
        reason_code: "workflow_gating_reject_script_mixed_submit_slots",
      },
    ],
  });
  const blockSpec = buildAsyncMixedSlotWorkflowBlockSpec();
  const candidateDecision = advisor.detectCandidate({
    block_spec: blockSpec,
    execution_context: {},
    orchestration_contract: contract,
  });
  const gatingDecision = advisor.evaluateIntentGating({
    block_spec: blockSpec,
    execution_context: {},
    orchestration_contract: contract,
    candidate_decision: candidateDecision,
  });

  assert.equal(candidateDecision.candidate_hit, true);
  assert.equal(candidateDecision.confidence, CANDIDATE_CONFIDENCE.HIGH);
  assert.equal(gatingDecision.action, GATING_ACTION.REJECT);
  assert.equal(
    gatingDecision.matched_rule_id,
    "workflow_gating_reject_script_mixed_submit_slots_v1"
  );
  assert.equal(
    gatingDecision.reason_code,
    "workflow_gating_reject_script_mixed_submit_slots"
  );
});

test("WorkflowRoutingAdvisor keeps warn when reject rule matches but runtime reject gate is disabled", () => {
  const advisor = createWorkflowRoutingAdvisor({
    reject_enabled: false,
  });
  const contract = buildContract();
  contract.workflow_intent_gating_rules[2].enabled = true;
  const blockSpec = buildAsyncMixedSlotWorkflowBlockSpec();
  const candidateDecision = advisor.detectCandidate({
    block_spec: blockSpec,
    execution_context: {},
    orchestration_contract: contract,
  });
  const gatingDecision = advisor.evaluateIntentGating({
    block_spec: blockSpec,
    execution_context: {},
    orchestration_contract: contract,
    candidate_decision: candidateDecision,
  });

  assert.equal(candidateDecision.candidate_hit, true);
  assert.equal(gatingDecision.action, GATING_ACTION.WARN);
  assert.equal(
    gatingDecision.matched_rule_id,
    "workflow_gating_warn_script_candidate_v1"
  );
  assert.equal(
    gatingDecision.reason_code,
    "workflow_gating_warn_script_candidate"
  );
});

test("WorkflowRoutingAdvisor keeps warn when reject rule matches but runtime allowlist excludes rule id", () => {
  const advisor = createWorkflowRoutingAdvisor({
    reject_enabled: true,
    reject_rule_ids: ["workflow_gating_reject_some_other_rule_v1"],
  });
  const contract = buildContract();
  contract.workflow_intent_gating_rules[2].enabled = true;
  const blockSpec = buildAsyncMixedSlotWorkflowBlockSpec();
  const candidateDecision = advisor.detectCandidate({
    block_spec: blockSpec,
    execution_context: {},
    orchestration_contract: contract,
  });
  const gatingDecision = advisor.evaluateIntentGating({
    block_spec: blockSpec,
    execution_context: {},
    orchestration_contract: contract,
    candidate_decision: candidateDecision,
  });

  assert.equal(candidateDecision.candidate_hit, true);
  assert.equal(gatingDecision.action, GATING_ACTION.WARN);
  assert.equal(
    gatingDecision.matched_rule_id,
    "workflow_gating_warn_script_candidate_v1"
  );
  assert.equal(
    gatingDecision.reason_code,
    "workflow_gating_warn_script_candidate"
  );
});

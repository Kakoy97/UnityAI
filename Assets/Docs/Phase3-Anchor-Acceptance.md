# Phase 3 Anchor Hard-Cut Acceptance

## 1. Scope

This document defines the end-to-end acceptance checklist for Phase 3 anchor hard-cut:

- Mandatory top-level `write_anchor` for all write entry points.
- Strict action union validation:
  - mutation (`add_component` / `remove_component` / `replace_component`) requires `target_anchor`.
  - `create_gameobject` requires `parent_anchor`.
- Unified anchor error feedback.
- No bypass path from HTTP or MCP entry.

Covered write entry points:

- `POST /mcp/submit_unity_task`
- `POST /mcp/apply_script_actions`
- `POST /mcp/apply_visual_actions`
- MCP tools `submit_unity_task` / `apply_script_actions` / `apply_visual_actions` (through sidecar HTTP mapping).

## 2. Preconditions

1. Sidecar is running with MCP adapter enabled.
2. Unity editor is connected and can receive/execute visual actions.
3. A valid `based_on_read_token` is available from a read tool.
4. There are at least two scene objects for anchor conflict verification.

## 3. Fixed Anchor Suggestion

For anchor schema or anchor conflict failures, response `suggestion` must be exactly:

`请先调用读工具获取目标 object_id 与 path，再重试写操作。`

## 4. Acceptance Matrix (5 Required Chains)

| Chain ID | Scenario | Request Pattern | Expected Result |
|---|---|---|---|
| P3-E2E-01-A | Mutation missing `target_anchor` | `apply_visual_actions` with action `type=add_component`, no `target_anchor` | Rejected. HTTP 400, `error_code=E_ACTION_SCHEMA_INVALID`, `suggestion` equals fixed anchor suggestion. No job created / queued. |
| P3-E2E-01-B | Create missing `parent_anchor` | `apply_visual_actions` with action `type=create_gameobject`, no `parent_anchor` | Rejected. HTTP 400, `error_code=E_ACTION_SCHEMA_INVALID`, `suggestion` equals fixed anchor suggestion. No job created / queued. |
| P3-E2E-01-C | Union mismatch | `apply_visual_actions` with action `type=create_gameobject` but carries `target_anchor` | Rejected. HTTP 400, `error_code=E_ACTION_SCHEMA_INVALID`, `suggestion` equals fixed anchor suggestion. No job created / queued. |
| P3-E2E-01-D | Anchor conflict | Schema-valid visual action, but anchor `object_id` and `path` resolve to different scene objects | Rejected. `error_code=E_TARGET_ANCHOR_CONFLICT`, `suggestion` equals fixed anchor suggestion. L3 executes no write side effects. |
| P3-E2E-01-E | Legal write | Schema-valid action with matching anchor (`object_id + path`) and valid token | Accepted. Job enters execution chain; no anchor error; action can complete successfully. |

## 5. Verification Steps

### 5.1 HTTP Path Verification

For each chain A-E:

1. Send request to corresponding HTTP write endpoint.
2. Record status code and response JSON.
3. Confirm rejection chains A-D never produce a new `job_id`.
4. Confirm success chain E can produce accepted/queued job and reaches Unity execution path.

### 5.2 MCP Path Consistency Verification

For at least chains A, D, E:

1. Invoke MCP write tools with equivalent payload.
2. Confirm response behavior matches HTTP path:
   - same `error_code` and `suggestion` for failures.
   - same acceptance semantics for legal write.

## 6. Exit Criteria

Phase 3 anchor hard-cut is accepted only if:

1. Chains A-D are all rejected with expected error codes.
2. Chains A-D all return the fixed anchor suggestion exactly.
3. Chain E passes and can execute through the normal write pipeline.
4. HTTP and MCP paths show consistent behavior.
5. No bypass path can execute single-anchor or implicit-target writes.

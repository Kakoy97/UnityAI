# Phase 5 Error Feedback Acceptance

## 1. Purpose

This document is the acceptance gate for Phase 5 (error-feedback standardization).
Phase 5 is complete only when all required chains below pass with stable output contracts.

## 2. Frozen Output Contract

For all rejected/failed write paths, responses visible to L1 must keep:

- `error_code`
- `error_message`
- `suggestion`
- `recoverable`

Stability rules:

1. `E_STALE_SNAPSHOT` suggestion must be exactly:
- `请先调用读工具获取最新 token。`
2. Same failure must stay consistent across:
- HTTP response
- MCP tool response
- Stream event payload
3. `error_message` must be sanitized:
- No multiline raw stack dump
- No absolute local path leakage
- Long messages truncated to transport-safe length

## 3. Acceptance Chains (P5-E2E-01)

### P5-E2E-01-A `E_STALE_SNAPSHOT` fixed suggestion

1. Send write request with missing/expired/invalid `based_on_read_token`.
2. Assert:
- `error_code == E_STALE_SNAPSHOT`
- `suggestion == 请先调用读工具获取最新 token。`
- `recoverable == true`

### P5-E2E-01-B Anchor conflict template

1. Submit write action with conflicting anchor semantics.
2. Assert:
- `error_code == E_TARGET_ANCHOR_CONFLICT` (or mapped anchor conflict code)
- `suggestion` equals anchor retry template
- `recoverable == true`

### P5-E2E-01-C Unity stack sanitization

1. Report Unity action/compile failure with multiline stack and absolute paths.
2. Assert:
- returned `error_message` is single line
- absolute paths are removed/redacted
- summary remains actionable

### P5-E2E-01-D Auto-cancel error template

1. Trigger any auto-cancel path (`heartbeat`, `max_runtime`, `reboot_wait_timeout`).
2. Assert:
- `error_code` is one of auto-cancel codes
- suggestion is standardized and actionable
- `recoverable == true`

### P5-E2E-01-E Unknown error fallback

1. Trigger unknown/internal error path.
2. Assert:
- `error_code` falls back to stable internal/default code
- suggestion uses fallback template
- `recoverable` decision remains stable (default false unless mapped)

## 4. Automation Mapping

### Sidecar tests (P5-QA-01)

Run:

```bash
cd sidecar
npm test
```

Required coverage mapping:

- `anchor-error-feedback.test.js`
  - fixed stale suggestion
  - stack/path sanitization
  - recoverable template checks
- `error-feedback-three-entry-consistency.test.js`
  - HTTP/MCP/Stream field consistency for same failed action
  - unknown error fallback recoverable stability
- `validators.error-feedback-template.test.js`
  - hard-fixed suggestion policy enforcement

### Unity EditMode tests (P5-QA-02)

Run in Unity Test Runner (EditMode):

- `UnityErrorFeedbackReceiptTests.NormalizeUnityActionResultRequest_MapsSchemaCodeToActionSchemaCode`
- `UnityErrorFeedbackReceiptTests.NormalizeUnityActionResultRequest_PreservesReceiptFieldsAndAnchorConflictTemplate`
- `UnityErrorFeedbackReceiptTests.NormalizeUnityActionResultRequest_SanitizesMultilineErrorMessage`

Coverage intent:

- L3 error-code mapping stability
- receipt field completeness
- sanitized transport message format

## 5. Metrics Acceptance

`GET /mcp/metrics` must expose and update:

- `error_feedback_normalized_total`
- `error_stack_sanitized_total`
- `error_path_sanitized_total`
- `error_message_truncated_total`
- `error_fixed_suggestion_enforced_total`
- `error_feedback_by_code`

## 6. Exit Criteria

Phase 5 passes only when:

1. Chains A-E are reproducible and pass.
2. Sidecar automation is green.
3. Unity EditMode error-receipt tests are green.
4. Metrics counters are observable for normalized/sanitized error paths.

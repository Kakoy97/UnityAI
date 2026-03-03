# Phase20 Evidence Guide

## Directory Rule
- Store each acceptance run under:
  - `Assets/Docs/evidence/phase20/<yyyy-mm-dd>/`

## Mandatory Artifacts
- `case-a-get-write-contract-bundle.json`
- `case-a-get-action-schema-template.json`
- `case-a-get-tool-schema-sequence.json`
- `case-b-anchor-error-feedback.json`
- `case-b-action-data-error-feedback.json`
- `case-b-corrected-payload-retry.json`
- `case-c-preflight-normalized.json`
- `case-c-dry-run-alias-parity.json`
- `case-c-ambiguous-anchor-rejected.json`
- `case-d-retry-fuse-blocked.json`
- `case-d-stale-retry-policy.json`
- `case-e-test-r20-qa.txt`
- `case-e-test-full.txt`
- `case-f-invalid-envelope-fast-fail.json`
- `case-f-optional-parent-anchor-compat.json`
- `case-f-hotfix-regression-notes.md`

## Optional Artifacts
- `case-e-unity-editmode-results.xml`

## Validation Quick Checks
1. All mandatory files exist and are non-empty.
2. `case-e-test-r20-qa.txt` contains `pass` and `fail 0`.
3. `case-e-test-full.txt` contains `pass` and `fail 0`.
4. `case-b-anchor-error-feedback.json` contains `field_path`, `fix_kind`, and `suggested_patch`.
5. `case-d-stale-retry-policy.json` contains `retry_policy.allow_auto_retry=true` and `max_attempts=1`.
6. `case-f-invalid-envelope-fast-fail.json` does not contain `E_JOB_MAX_RUNTIME_EXCEEDED` and includes deterministic schema failure code.
7. `case-f-optional-parent-anchor-compat.json` shows mutation action reaches terminal status (`succeeded` or deterministic `failed`), without silent pending loop.

# Phase19 V2-SELFUPGRADE Acceptance

## 1. Scope
- This document is the acceptance entry for:
  - `R19-SU-E2E-00`
  - `R19-SU-QA-01`
  - `R19-SU-QA-02`
  - `R19-SU-E2E-01`
- It freezes the E2E case catalog and evidence naming for V2-SELFUPGRADE.

## 2. Success Criteria
1. `Phase A` onboarding baseline is reproducible (`A-01/A-02/A-03`).
2. `Phase B/C` self-upgrade proposal/approval/apply pipeline is reproducible and auditable.
3. Domain reload after generated action activation still restores generated capability registration.
4. `Phase D` operation history query + replay workflow is reproducible with conflict-safe defaults.
5. Sidecar + Unity focused QA gates are green, and full regression remains green.

## 3. Preconditions
1. Sidecar dependencies are installed.
2. Unity project opens and scripts compile.
3. Sidecar endpoint is reachable at `http://127.0.0.1:46321`.
4. Evidence root exists: `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/`.

## 4. E2E Case Catalog (R19-SU-E2E-00)

### 4.1 Frozen Case IDs
- `P19-A-WINDOW-001`: Unity control panel can start/stop sidecar and run health diagnostics.
- `P19-A-SETUP-001`: `setup_cursor_mcp` tool writes/updates MCP config in whitelist path only.
- `P19-A-VERIFY-001`: `verify_mcp_setup` tool returns structured readiness report.
- `P19-A-HISTORY-001`: write operation receipt persists to `Library/Codex/operation_history/*.jsonl`.
- `P19-B-PROPOSE-001`: missing action proposal can be created without side effects.
- `P19-B-SANDBOX-001`: generated draft is constrained to `Generated/Pending` and produces diff summary.
- `P19-B-GUARD-001`: compile failure on pending draft triggers automatic rollback.
- `P19-C-APPROVAL-001`: unapproved proposal cannot be applied.
- `P19-C-REGISTER-001`: approved generated action appears in `get_action_catalog`.
- `P19-C-RELOAD-001`: generated action remains available after domain reload.
- `P19-C-IDEMPOTENT-001`: duplicate proposal/apply requests are idempotent.
- `P19-C-REMOVE-001`: disabled/removed generated action is removed from catalog after refresh.
- `P19-D-HISTORY-QUERY-001`: operation history query supports session/action/object/time filters.
- `P19-D-REPLAY-001`: replay defaults to `dry_run=true` and commit mode enforces precondition guard.
- `P19-E-QA-SIDECAR-001`: sidecar focused gate for phase19 is green.
- `P19-E-QA-UNITY-001`: Unity editmode focused gate for phase19 is green.
- `P19-E-E2E-001`: mandatory evidence set archived and traceable.

### 4.2 Frozen Evidence Naming
- `case-a-window-health.txt`
- `case-a-setup-native.json`
- `case-a-verify-report.json`
- `case-a-history-jsonl-sample.txt`
- `case-b-propose-response.json`
- `case-b-sandbox-diff.json`
- `case-b-compile-rollback.txt`
- `case-c-approval-required.json`
- `case-c-catalog-after-apply.json`
- `case-c-domain-reload-catalog.json`
- `case-c-idempotent-sequence.txt`
- `case-c-remove-generated-action.json`
- `case-d-history-query.json`
- `case-d-replay-dryrun.txt`
- `case-d-replay-commit-conflict.txt`
- `case-e-test-r19-qa.txt`
- `case-e-test-full.txt`
- `case-e-unity-editmode-results.xml` (optional CLI output)

## 5. Automated Gates (To Be Finalized In R19-SU-E2E-01)

### 5.1 Sidecar
```bash
cd sidecar
npm run test:r19:qa
npm test
```

### 5.2 Unity
- `Assets/Editor/Codex/Tests/EditMode/*SelfUpgrade*.cs`
- `Assets/Editor/Codex/Tests/EditMode/*OperationHistory*.cs`

## 6. Case Status Matrix
| Case ID | Status | Evidence |
|---|---|---|
| P19-A-WINDOW-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-a-window-health.txt` |
| P19-A-SETUP-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-a-setup-native.json` |
| P19-A-VERIFY-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-a-verify-report.json` |
| P19-A-HISTORY-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-a-history-jsonl-sample.txt` |
| P19-B-PROPOSE-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-b-propose-response.json` |
| P19-B-SANDBOX-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-b-sandbox-diff.json` |
| P19-B-GUARD-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-b-compile-rollback.txt` |
| P19-C-APPROVAL-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-c-approval-required.json` |
| P19-C-REGISTER-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-c-catalog-after-apply.json` |
| P19-C-RELOAD-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-c-domain-reload-catalog.json` |
| P19-C-IDEMPOTENT-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-c-idempotent-sequence.txt` |
| P19-C-REMOVE-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-c-remove-generated-action.json` |
| P19-D-HISTORY-QUERY-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-d-history-query.json` |
| P19-D-REPLAY-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-d-replay-dryrun.txt` |
| P19-E-QA-SIDECAR-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-e-test-r19-qa.txt` |
| P19-E-QA-UNITY-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/case-e-unity-editmode-results.xml` |
| P19-E-E2E-001 | TODO | `Assets/Docs/evidence/phase19/<yyyy-mm-dd>/` |

## 7. Sign-off
- [x] `R19-SU-E2E-00` complete (case catalog and evidence naming frozen)
- [ ] `R19-SU-E2E-01` complete (mandatory cases replayed with archived evidence)

# Phase18 Evidence Guide

## Directory Rule
- Store each acceptance run under:
  - `Assets/Docs/evidence/phase18/<yyyy-mm-dd>/`

## Mandatory Artifacts
- `case-a-overlay-report.json`
- `case-a-feedback.json`
- `case-b-diagnose-capture-output.txt`
- `case-b-capture-response.json`
- `case-b-write-receipt.json`
- `case-b-console-snapshot.json`
- `case-b-size-control.json`
- `case-c-flag-disabled.json`
- `case-c-fuse-sequence.txt`
- `case-c-busy-guard.json`
- `case-e-test-r18-qa.txt`
- `case-e-test-full.txt`

## Optional Artifacts
- `case-d-editmode-composite.json`
- `case-d-temp-scene-cleanup.txt`
- `case-e-unity-editmode-results.xml`

## Validation Quick Checks
1. All mandatory files exist and are non-empty.
2. `case-e-test-r18-qa.txt` contains `pass` and `fail 0`.
3. `case-e-test-full.txt` contains `pass` and `fail 0`.
4. `case-b-capture-response.json` contains `visual_evidence` field (nullable allowed).
5. `case-b-write-receipt.json` contains `write_receipt` object.

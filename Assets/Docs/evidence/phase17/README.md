# Phase17 Evidence Template

Use this folder to keep acceptance artifacts for:
- `R17-POLISH-QA-01`
- `R17-POLISH-QA-02`
- `R17-POLISH-E2E-01`

Recommended layout:
- `Assets/Docs/evidence/phase17/<yyyy-mm-dd>/sidecar-test-r17-qa.txt`
- `Assets/Docs/evidence/phase17/<yyyy-mm-dd>/sidecar-test-full.txt`
- `Assets/Docs/evidence/phase17/<yyyy-mm-dd>/unity-editmode-results.xml`
- `Assets/Docs/evidence/phase17/<yyyy-mm-dd>/e2e-case-a.json`
- `Assets/Docs/evidence/phase17/<yyyy-mm-dd>/e2e-case-b-metrics.json`
- `Assets/Docs/evidence/phase17/<yyyy-mm-dd>/v1-polish-primitive-candidates.json`

Minimum capture checklist:
1. `npm --prefix sidecar run test:r17:qa` output.
2. `npm --prefix sidecar test` output.
3. Unity EditMode run result for suites listed in `docs/Phase17-V1-Polish-Acceptance.md`.
4. Case A/B/C replay outputs from section 5 of the same document.

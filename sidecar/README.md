# Sidecar MVP Placeholder

## Run

```bash
node index.js --port 46321
```

or:

```bash
npm start
```

## Endpoints

- `GET /health`
- `GET /state/snapshot`
- `POST /session/start`
- `POST /turn/send`
- `POST /file-actions/apply`
- `POST /unity/compile/result`
- `GET /turn/status?request_id=...&cursor=...`
- `POST /turn/cancel`

## Notes

- This is a Phase 0 placeholder sidecar.
- It enforces one active turn at a time and returns HTTP `429` for concurrent `turn.send`.
- It validates envelope fields for `session.start` / `turn.send` / `turn.cancel`:
  - `event`, `request_id`, `thread_id`, `turn_id`, `timestamp`, `payload`
- `POST /file-actions/apply` expects `event=file_actions.apply` and:
  - `payload.file_actions[]` with `type`, `path`, `content`, `overwrite_if_exists`
- `POST /unity/compile/result` expects `event=unity.compile.result` and:
  - `payload.success: boolean`
  - optional `payload.duration_ms`
  - optional `payload.errors[]`
- It simulates completion after ~4 seconds unless cancelled.
- It supports idempotent replay for repeated `request_id` on `session.start` and cancelled turns.
- File action executor enforces:
  - write root allowlist: `Assets/Scripts/AIGenerated/`
  - forbidden roots: `ProjectSettings/`, `Packages/`
  - max file size: `100KB`
  - encoding/newline: `utf-8` + `\n`
  - no automatic rollback on partial failures
- It persists sidecar state snapshot to `sidecar/.state/sidecar-state.json`.
- It includes TTL cleanup to avoid unbounded request cache growth (default 15 minutes).
- It applies timeout fuses in state machine:
  - Codex stage timeout: 60s (`E_CODEX_TIMEOUT`)
  - Compile stage timeout: 120s (`E_COMPILE_TIMEOUT`)
- Optional env overrides:
  - `CODEX_TIMEOUT_MS`
  - `COMPILE_TIMEOUT_MS`
  - `REQUEST_CACHE_TTL_MS`
  - `MAINTENANCE_INTERVAL_MS`
  - `USE_CODEX_APP_SERVER` (`true/false`, default `true`)
  - `USE_FAKE_CODEX_TIMEOUT_PLANNER` (`true/false`, default `false`, testing only)
  - `CODEX_EXECUTABLE` (default `codex`; on Windows can point to `codex.cmd` absolute path)
  - `SIDECAR_DIAG_QUERY_RESULT` (`true/false`, default `false`)

## Optional: Codex app-server planner mode

By default (`USE_CODEX_APP_SERVER=true`), `turn.send` uses `codex app-server` (JSON-RPC stdio) for planning:

1. `initialize`
2. `thread/start`
3. `turn/start`
4. stream notifications (`item/agentMessage/delta`) into `turn.status.events`

Then sidecar executes script-layer `file_actions`, opens compile gate, and continues the Unity action flow as before.

If Codex app-server planning fails, sidecar automatically falls back to the local deterministic planner for the same turn.

## Smoke baseline runner (Step 0)

Use CLI smoke runner to generate a repeatable baseline report under `sidecar/.state/`:

```bash
npm run smoke:fast
```

This command:

1. Optionally spawns local sidecar (`USE_CODEX_APP_SERVER=false`) when sidecar is not running.
2. Runs deterministic file/compile/cancel flows.
3. Includes compile-timeout sweep validation (`E_COMPILE_TIMEOUT`) with short timeout override.
4. Writes JSON report to `sidecar/.state/smoke-turn-report-*.json`.

Full run (20 rounds + turn.send smoke):

```bash
npm run smoke
```

Codex timeout sweep (isolated port + fake timeout planner):

```bash
npm run smoke:codex-timeout
```

Advanced options example:

```bash
node scripts/smoke-turn-runner.js \
  --base-url http://127.0.0.1:46329 \
  --iterations 5 \
  --include-turn-send \
  --include-timeout-case \
  --spawn-sidecar \
  --compile-timeout-ms 1200
```

Note: `--include-timeout-case` requires the runner to spawn sidecar with timeout overrides.
If you already have a sidecar running on the same port, use a different `--base-url` port.

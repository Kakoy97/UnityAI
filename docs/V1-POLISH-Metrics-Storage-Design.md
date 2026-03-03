# V1-POLISH Metrics Storage Design

## Scope
- Task: `R17-POLISH-O11Y-01`
- Target: Sidecar-level metrics for generalized-layer polish and primitive-promotion input.
- Constraint: keep `/mcp/metrics` frozen fields unchanged; only append extension payload.

## Storage
- Mode: local file snapshot (JSON).
- Default path: `sidecar/.state/v1-polish-metrics.json`.
- Writer: `V1PolishMetricsCollector` in `sidecar/src/application/v1PolishMetricsCollector.js`.
- Rotation strategy: time-window pruning by day bucket (`daily_buckets[YYYY-MM-DD]`).

## Retention Policy
- Default retention: `7` days.
- Pruning rule: keep last `N` day buckets, drop older buckets on write/read.
- Retention config:
  - `V1_POLISH_METRICS_RETENTION_DAYS` (integer, `>=1`, default `7`).

## Feature Flags
- `V1_POLISH_METRICS_ENABLED`:
  - `true` (default): collect + persist + expose extension metrics.
  - `false`: no collection; `/mcp/metrics.v1_polish_metrics` returns disabled snapshot.
- `V1_POLISH_METRICS_TOP_N`:
  - controls top list size in `/mcp/metrics` extension.
  - default `10`.

## Collection Points
- Tool invocation (`commandRegistry.dispatchHttpCommand`):
  - tool call totals
  - write/generalized/primitive split
  - dry-run usage
  - serialized property patch frequencies (`property_path`, `value_kind`, `array op`)
- Read token validation:
  - `McpEyesWriteService.validateWriteReadToken`
  - `McpGateway.validateWriteReadToken`
- Write task terminal outcome:
  - `jobLifecycle.finalizeJob` -> failed count / rollback-inferred count

## `/mcp/metrics` Contract Extension
- Added field: `v1_polish_metrics`.
- Existing freeze fields remain unchanged.
- `v1_polish_metrics` includes:
  - `schema_version`
  - `enabled`
  - `retention_days`
  - `storage { mode, path }`
  - `counters`
  - `derived` ratios (`avg_tool_calls_per_task`, `write_rollback_rate`, `read_token_expiry_rate`, `dry_run_usage_rate`)
  - `by_tool`
  - `top_property_paths` / `top_value_kinds` / `top_array_ops`

## Report Consumption
- Task linkage: `R17-POLISH-O11Y-02`.
- Script: `sidecar/scripts/generate-v1-polish-primitive-report.js`.
- Input: `sidecar/.state/v1-polish-metrics.json`.
- Output: `sidecar/.state/v1-polish-primitive-candidates.json`.
- Trigger:
  - manual: `npm --prefix sidecar run metrics:v1-polish:report`
  - CI: `npm --prefix sidecar run metrics:v1-polish:report:ci`


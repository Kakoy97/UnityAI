# Codex Unity Sidecar (Phase 6 Frozen Baseline)

This sidecar is the L2 gateway in the Codex-Unity embodied-agent architecture.
Phase 6 freeze means only the new MCP/Unity protocol paths are valid.

## Run

```bash
npm start
```

or

```bash
node index.js --port 46321
```

## Active HTTP Routes

- Health:
  - `GET /health`
  - `GET /state/snapshot`
- MCP write:
  - `POST /mcp/submit_unity_task`
  - `POST /mcp/apply_script_actions`
  - `POST /mcp/apply_visual_actions`
- MCP status/runtime:
  - `GET /mcp/get_unity_task_status?job_id=...`
  - `POST /mcp/cancel_unity_task`
  - `POST /mcp/heartbeat`
  - `GET /mcp/metrics`
  - `GET /mcp/stream`
- MCP read (RAG pull):
  - `POST /mcp/list_assets_in_folder`
  - `POST /mcp/get_scene_roots`
  - `POST /mcp/find_objects_by_component`
  - `POST /mcp/query_prefab_info`
- Unity callbacks:
  - `POST /unity/compile/result`
  - `POST /unity/action/result`
  - `POST /unity/runtime/ping`
  - `POST /unity/query/pull`
  - `POST /unity/query/report`

## Removed Routes (hard reject)

Legacy routes are removed and respond with `410 E_GONE`.
Examples: `/session/start`, `/turn/send`, `/turn/status`, `/turn/cancel`, and other old MCP eyes aliases.

## Protocol Hard Rules

- OCC hard cut:
  - Every write request must include `based_on_read_token`.
- Dual-anchor hard cut:
  - Top-level `write_anchor` is mandatory and must contain both `object_id` and `path`.
  - Visual action union rules are strict:
    - mutation (`add_component`/`remove_component`/`replace_component`) requires `target_anchor`
    - create (`create_gameobject`) requires `parent_anchor`
- No soft-switch fallback is allowed.

## Observability Contract Freeze (P6-L2-04)

### Version markers

- Metrics body field: `metrics_contract_version = "mcp.metrics.v1"`
- Stream event field: `stream_event_contract_version = "mcp.stream.event.v1"`
- Stream ready event field: `stream_ready_contract_version = "mcp.stream.ready.v1"`

### Response headers

- `GET /mcp/metrics`:
  - `X-Codex-Metrics-Contract-Version`
  - `Cache-Control: no-store`
  - `Pragma: no-cache`
- `GET /mcp/stream`:
  - `X-Codex-Stream-Contract-Version`
  - `X-Codex-Stream-Ready-Contract-Version`

### Frozen metrics fields (additive changes only)

- `observability_phase`
- `metrics_contract_version`
- `status_query_calls`
- `stream_connect_calls`
- `stream_events_published`
- `stream_events_delivered`
- `stream_replay_events_sent`
- `stream_recovery_jobs_sent`
- `stream_subscriber_rejects`
- `stream_subscriber_drops`
- `push_events_total`
- `query_to_push_ratio`
- `active_stream_subscribers`
- `stream_max_subscribers`
- `stream_recovery_jobs_max`
- `recent_stream_buffer_size`
- `running_job_id`
- `queued_job_count`
- `total_job_count`
- `auto_cleanup_enforced`
- `lease_heartbeat_timeout_ms`
- `lease_max_runtime_ms`
- `reboot_wait_timeout_ms`
- `lease_janitor_interval_ms`
- `auto_cancel_total`
- `auto_cancel_heartbeat_timeout_total`
- `auto_cancel_max_runtime_total`
- `auto_cancel_reboot_wait_timeout_total`
- `lock_release_total`
- `queue_promote_total`
- `error_feedback_normalized_total`
- `error_stack_sanitized_total`
- `error_path_sanitized_total`
- `error_message_truncated_total`
- `error_fixed_suggestion_enforced_total`
- `error_feedback_by_code`

### Frozen stream event fields (additive changes only)

- `stream_event_contract_version`
- `seq`
- `event`
- `timestamp`
- `thread_id`
- `job_id`
- `status`
- `stage`
- `message`
- `progress_message`
- `error_code`
- `error_message`
- `suggestion`
- `recoverable`
- `request_id`
- `running_job_id`
- `approval_mode`
- `execution_report`
- `created_at`
- `updated_at`

### Frozen stream.ready fields (additive changes only)

- `stream_ready_contract_version`
- `seq`
- `event`
- `timestamp`
- `cursor_source`
- `requested_cursor`
- `oldest_event_seq`
- `latest_event_seq`
- `replay_from_seq`
- `replay_truncated`
- `fallback_query_suggested`
- `recovery_jobs_count`
- `recovery_jobs`
- `replay_count`

## Smoke / Regression Scripts

- `npm run smoke:mcp-job`
- `npm run smoke:mcp-stream`
- `npm run smoke:mcp-visual-anchor`
- `npm run smoke` (all three)
- `npm run gate:step8`
- `npm run replay:failed -- --report <path-to-report>`

## MCP Helper Scripts

- `npm run mcp:setup-cursor`
- `npm run mcp:verify`
- `npm run mcp:server`

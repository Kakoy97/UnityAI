"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createCaptureCompositeRuntime,
} = require("../../src/application/captureCompositeRuntime");

test("captureCompositeRuntime trips fuse after threshold failures and falls back during cooldown", () => {
  const runtime = createCaptureCompositeRuntime({
    enabled: true,
    fuseFailureThreshold: 3,
    fuseCooldownMs: 60000,
  });

  for (let i = 0; i < 3; i += 1) {
    const started = runtime.tryStartRequest(1000 + i);
    assert.equal(started.ok, true);
    assert.equal(started.mode, "normal");
    runtime.recordCompositeFailure({
      kind: "black",
      mode: started.mode,
      reason: "ALL_BLACK",
      nowMs: 1000 + i,
    });
    runtime.endRequest();
  }

  const snapshot = runtime.getMetricsSnapshot(1200);
  assert.equal(snapshot.fused, true);
  assert.equal(snapshot.consecutive_failures, 3);
  assert.equal(snapshot.total_black_failures, 3);

  const fallbackStarted = runtime.tryStartRequest(2000);
  assert.equal(fallbackStarted.ok, true);
  assert.equal(fallbackStarted.mode, "fallback");
  runtime.endRequest();

  const snapshotAfterFallback = runtime.getMetricsSnapshot(2000);
  assert.equal(snapshotAfterFallback.total_fallback_renders, 1);
});

test("captureCompositeRuntime uses probe success to recover from fuse", () => {
  const runtime = createCaptureCompositeRuntime({
    enabled: true,
    fuseFailureThreshold: 3,
    fuseCooldownMs: 60000,
  });

  for (let i = 0; i < 3; i += 1) {
    const started = runtime.tryStartRequest(1000 + i);
    assert.equal(started.ok, true);
    runtime.recordCompositeFailure({
      kind: "error",
      mode: started.mode,
      reason: "E_SCREENSHOT_CAPTURE_FAILED",
      nowMs: 1000 + i,
    });
    runtime.endRequest();
  }

  const probeStarted = runtime.tryStartRequest(61010);
  assert.equal(probeStarted.ok, true);
  assert.equal(probeStarted.mode, "probe");
  runtime.recordCompositeSuccess({
    mode: probeStarted.mode,
    nowMs: 61010,
  });
  runtime.endRequest();

  const snapshot = runtime.getMetricsSnapshot(61010);
  assert.equal(snapshot.fused, false);
  assert.equal(snapshot.total_probe_attempts, 1);
  assert.equal(snapshot.total_probe_recoveries, 1);
});

test("captureCompositeRuntime reopens fuse window when probe fails", () => {
  const runtime = createCaptureCompositeRuntime({
    enabled: true,
    fuseFailureThreshold: 3,
    fuseCooldownMs: 60000,
  });

  for (let i = 0; i < 3; i += 1) {
    const started = runtime.tryStartRequest(1000 + i);
    assert.equal(started.ok, true);
    runtime.recordCompositeFailure({
      kind: "black",
      mode: started.mode,
      reason: "ALL_BLACK",
      nowMs: 1000 + i,
    });
    runtime.endRequest();
  }

  const probeStarted = runtime.tryStartRequest(61010);
  assert.equal(probeStarted.ok, true);
  assert.equal(probeStarted.mode, "probe");
  runtime.recordCompositeFailure({
    kind: "error",
    mode: probeStarted.mode,
    reason: "E_SCREENSHOT_CAPTURE_FAILED",
    nowMs: 61010,
  });
  runtime.endRequest();

  const snapshot = runtime.getMetricsSnapshot(61010);
  assert.equal(snapshot.fused, true);
  assert.equal(snapshot.total_probe_attempts, 1);
  assert.equal(snapshot.total_fuse_trips >= 2, true);
  assert.equal(snapshot.fused_until_ms > 61010, true);
});

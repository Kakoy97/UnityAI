# V1-CAPTURE Composite Mode Mini-Design

## 1. Scope
- Task: `R18-CAPTURE-C-00`
- Parent phase: `V1-CAPTURE / Phase C (gamma-1)`
- Goal: define a low-risk `capture_mode=composite` contract that is PlayMode-first, fail-closed, and reversible by flags.

## 2. Contract Decision
- New capture mode: `composite`
- Semantics:
  - `render_output`: camera render path (existing stable baseline)
  - `composite`: diagnostic composite capture path (not OS desktop pixels, not `final_pixels`)
- Non-goals:
  - no restore of `final_pixels`
  - no restore of `editor_view`
  - no desktop foreground screenshot

## 3. Flags And Gates
- L2 (Sidecar) gate:
  - env: `CAPTURE_COMPOSITE_ENABLED`
  - default: `false`
  - behavior:
    - `false`: reject `capture_mode=composite` with `E_CAPTURE_MODE_DISABLED`
    - `true`: allow request to enter Unity query pipeline
- L3 (Unity) gate:
  - env: `UNITY_CAPTURE_COMPOSITE_ENABLED`
  - default: `false`
  - behavior:
    - `false`: reject `capture_mode=composite` with `E_CAPTURE_MODE_DISABLED`
    - `true`: execute PlayMode composite capture path
- Dual-gate rule:
  - both L2 and L3 must be enabled
  - either side disabled means fail-closed

## 4. PlayMode Composite Path
- Entry condition:
  - `capture_mode=composite`
  - L3 composite flag enabled
  - Unity is in PlayMode
- Capture primitive:
  - `ScreenCapture.CaptureScreenshotAsTexture()`
- Output normalization:
  - keep existing output contract (`artifact_uri` / `inline_base64`, `visual_evidence`, `pixel_sanity`)
  - preserve `max_base64_bytes` fallback behavior
- Mandatory diagnosis tags:
  - `COMPOSITE_RENDER`
  - `PLAYMODE_CAPTURE`

## 5. Error And Fallback Semantics
- Stable disabled modes:
  - `final_pixels` and `editor_view` remain disabled
- Composite unavailable in EditMode:
  - return `E_COMPOSITE_PLAYMODE_REQUIRED`
- Generic capture failures:
  - return `E_SCREENSHOT_CAPTURE_FAILED`

## 6. Fuse Parameters (for C-03 implementation)
- Fuse trigger:
  - consecutive `3` failures (`ALL_BLACK` or runtime exception)
- Cooldown:
  - `60` seconds
- Probe recovery:
  - after cooldown, allow one probe request
  - probe success closes fuse; probe failure re-opens cooldown
- Fuse diagnosis tag:
  - `COMPOSITE_FUSED`

## 7. Compatibility Matrix (Design Target)
| Dimension | Target | Notes |
|---|---|---|
| Unity version | 2021.3 LTS+ | `ScreenCapture.CaptureScreenshotAsTexture` available |
| Render pipeline | Built-in / URP / HDRP | treat as diagnostic image, not pixel-perfect reference |
| Runtime mode | PlayMode only (Phase C) | EditMode composite deferred to Phase D TempScene clone |
| View mode | `game` effective | `composite` is Game output semantics |

## 8. Acceptance Mapping
- `R18-CAPTURE-C-01`
  - L2 accepts `composite` in schema, but guarded by flag
  - manifest text clearly states diagnostic semantics and gating
- `R18-CAPTURE-C-02`
  - L3 PlayMode path returns successful composite image
  - diagnosis tags include `COMPOSITE_RENDER` and `PLAYMODE_CAPTURE`

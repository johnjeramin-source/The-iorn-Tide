# Part 2 — Quick-win features

## Added
- Auto-battle assist toggle in Settings and the Orders strip. Idle units acquire nearby targets through the existing spatial grid; units at or below 22% HP retreat toward the FOB.
- Rally point: long-press the tactical minimap to set a rally point. Newly deployed units route toward it. A short-lived blue ping marks the rally point.
- Control groups 1–5 in the Orders strip: tap to recall; long-press (about 520 ms) or right-click to save the current selection.
- Incoming-wave preview banner during the final 8 seconds before a wave, with a perimeter spawn-direction hint.
- Health bars for brute, tank, mutated and infected-marine elite classes.
- Floating damage numbers use a fixed 64-entry pool; they are automatically disabled while Low-Lag mode is active and can be toggled in Settings.
- Tactical minimap: double-tap to place a danger ping; long-press to set rally. Pings fade and expire after four seconds.
- Auto-pause on document visibility loss, pagehide, or window blur. The Capacitor WebView lifecycle events are used; no extra native plugin is required.
- First-run field guide, dismissed once and remembered with `irontide_tutorial_seen_v1`.
- Haptics for selection/deploy, wave start, explosions/impacts, unit loss and base integrity loss. Haptics honor the Settings toggle.
- End-of-run Share captures the game canvas and uses the native share sheet when file sharing is supported; otherwise it downloads `iron-tide-run.png`.

## Validation
- TypeScript/TSX syntax transpilation: 22 files, no syntax errors.
- Engine tests: 23 passed, 0 failed. Existing selection tests exposed a stale spatial-grid issue before the first simulation tick; selection now rebuilds the friendly-unit grid at selection time.
- `tsc --noEmit` could not complete because this working copy has no installed dependencies and cannot resolve `vite/client` or `vite-plugin-pwa/client`.
- No new packages, Capacitor plugins, or GitHub Actions workflow changes are required.

## Notes
- The wave preview uses a compact generic type forecast and a perimeter-direction hint rather than a precise per-wave composition simulation.
- Control groups are scoped to the current run; they are not persisted across a restart.
- Damage numbers are backed by a fixed 64-slot pool and skip both recording and drawing in Low-Lag mode.

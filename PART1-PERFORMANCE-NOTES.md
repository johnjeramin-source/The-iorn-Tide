# Iron Tide — Part 1 Performance Update

## Implemented

- The browser loop now uses a fixed 60 Hz simulation step (30 Hz when Battery Saver is enabled), a three-substep maximum, and a bounded accumulator to prevent a spiral of death after slow frames.
- Zombie target selection is staggered across four simulation ticks and cached directly on each zombie. Zombie movement remains updated every simulation step.
- Zombie separation is staggered across three ticks, limited to the visible camera region, and uses a caller-owned `Int32Array` scratch buffer through `SpatialGrid.queryRadiusInto` instead of allocating a callback for every zombie.
- Fence damage and civilian zombie-proximity checks use bounded spatial-grid queries rather than scanning every zombie for every fence/civilian.
- Graphics quality controls zombie caps (Low 350 / Medium 550 / High 700). At the cap, incoming spawns reinforce the nearest living zombie as an elite with increased maximum/current HP and damage rather than silently disappearing.
- Added a bounded projectile object pool (Low 120 / Medium 240 / High 360). Particle, blood decal, crater and damage-number activity is capped/scaled by quality; damage numbers are suppressed on Low.
- Renderer limits decals and craters, draws simple zombie dots at low LOD, removes detailed zombie shadow ellipses below High, and steps through fewer particles at lower quality tiers.
- HUD horde count is maintained as a world counter. HUD snapshot count aggregation no longer creates zombie/unit/civilian filter arrays.
- Added saved Settings toggles for Adaptive Quality and FPS / Zombie Counter. Adaptive quality lowers the runtime tier after sustained >20 ms frames and restores toward the selected graphics preference after sustained stable frames. The optional counter appears in-game.

## Validation

- 29 engine tests passed, including tests for the graphics zombie caps, elite spawn reinforcement, allocation-free spatial-grid query, and HUD horde counter.
- TypeScript/TSX syntax transpilation: 22 files checked, 0 syntax diagnostics.
- `tsc --noEmit` could not complete because the extracted project does not have dependencies installed; it stops at missing `vite/client` and `vite-plugin-pwa/client` type packages. `npm install --ignore-scripts --no-audit --no-fund` timed out in this environment. Therefore a full type-check and APK build are not claimed.
- `build-apk.yml` equivalent in this archive is `.github/workflows/android-apk.yml`; it was not changed. No new native plugin or dependency is required.

## Synthetic engine benchmark (not an Android-device measurement)

A deterministic Node benchmark created 500 zombies, warmed the simulation for 60 ticks, then timed 180 `stepWorld(1/60)` calls. Three runs per version:

- Archive baseline: 3.275 / 3.364 / 3.337 ms per step (median 3.337 ms)
- Updated engine: 1.726 / 1.529 / 1.782 ms per step (median 1.726 ms)
- Median engine-step time reduction: approximately 48.3%

This benchmark excludes Canvas rendering, React, WebView overhead, Android GPU/CPU behavior and real touch latency. It is useful as a comparative engine-only signal, not a prediction of phone FPS.

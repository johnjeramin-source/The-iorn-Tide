# IRON TIDE — Part 5: Bunker Access & Horde Stability

## Implemented
- Added bunker-hull collision for ground-unit movement, move-order destination placement, and the main zombie movement pass.
- The sealed/locked bunker blocks ground units and infected at the hull, including the blast-door threshold.
- Unlocking and fully opening the blast door creates a centered passage through the south entrance. Closing/locking the door restores the collision barrier.
- Added a regression test for sealed-door blocking and open-door passage.
- Preserved the existing quality-based active-zombie budgets (Low 600 / Medium 900 / High 1,200); this update does not claim 10,000 simultaneous simulated zombies or guaranteed 60 FPS.

## Scope still outstanding
- The bunker is now physically passable through its doorway, but a rendered interior room, interior camera transition, and interior-specific navigation/AI are not implemented.
- Zombie pathfinding remains the existing steering + spatial-grid approach; this part does not introduce a new navmesh or crowd-simulation system.
- No device-specific FPS benchmark or Android APK build was performed.

## Validation
- TypeScript/TSX transpilation syntax check: 25 files, 0 syntax errors.
- Isolated bunker collision smoke test: passed (sealed blocks; open allows passage).
- Full project typecheck and game test suite were not run because dependencies (including Vite type packages and the TSX test runner) are not installed in this environment.

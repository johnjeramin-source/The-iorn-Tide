# IRON TIDE — Part 4: Combat & Bunker Systems

## Implemented
- Direct-control reload action with class-based reload times: infantry 1.65s, specialist infantry 2.2s, ground vehicles 3.2s, and aircraft 2.8s.
- Reload can be started from the on-screen button or the `R` key while piloting. Outside direct control, `R` retains its build-rotation behavior.
- Ammo refills only when the reload timer completes. The HUD displays the remaining reload time and disables reload when full or already reloading.
- Added a bunker door control with locked, unlocked, and open states. The bunker door uses a twin-leaf sliding visual and a status label.
- Added engine tests for reload completion and bunker door state transitions.

## Scope notes
- Manual reload currently applies to the directly controlled unit. AI-controlled units retain the existing combat/resupply behavior.
- Bunker door states and visuals are implemented; bunker interior traversal and physical door collision/pathfinding are not yet implemented.
- This update does not claim guaranteed 60 FPS or 10,000 simultaneously simulated zombies. The previous quality-based live-zombie budgets remain in place.

## Validation
- TypeScript/TSX transpilation syntax check: 25 files, 0 syntax errors.
- Full TypeScript typecheck, engine test execution, browser build, and Android APK build were not run because project dependencies are not installed in this environment.

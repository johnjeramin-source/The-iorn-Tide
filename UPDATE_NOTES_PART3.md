# Iron Tide — Part 3 Update

## Implemented in this pass
- Added an explicit Endless Survival option. In this mode, securing every sector no longer ends the run; the run continues until the force and FOB are lost. Campaign objectives still finish normally.
- Raised the bounded live zombie entity budgets to Low 600 / Medium 900 / High 1,200. The total kill/service-record count remains unbounded. The cap is intentional: 10,000 simultaneously active full-AI entities is not a realistic mobile WebView target.
- Increased Low-quality zombie markers and added a dark outline so the horde remains visible against terrain and effects.
- Moved the tactical minimap to the upper edge of the HUD.
- Added a Rotate control directly in the Build tab, so touch players do not need to switch to Orders to rotate a wall or gate.
- Extended the initial loading overlay to 2.8 seconds.
- Dispatches the profile refresh event after a run is recorded, so the openable service record refreshes immediately.

## Existing systems retained
- Auto-battle assist and unit retreat behavior are already present.
- Existing ammo is consumed in combat and resupplied by support vehicles / supply structures. This pass does not add a separate manual reload animation or reload command.
- Existing bunker art is present, but interactive open/locked bunker doors are not implemented in this pass.

## Validation
- TypeScript/TSX transpilation syntax check: 25 files, 0 syntax errors.
- Full app build and engine test suite could not be run here because project dependencies are not installed. Direct Node test execution also cannot resolve the project's extensionless TypeScript imports in this environment.
- No claim is made that 60+ FPS is guaranteed on every Android device. Actual frame rate depends on device CPU/GPU, WebView version, viewport, and active entity count.

## Part 4 — Combat & bunker interaction
- Added manual reload for the directly controlled unit. Reload duration varies by infantry, specialist, vehicle, and aircraft class; ammo refills only when the timer completes.
- Added a touch-friendly Reload button and the R keyboard shortcut while piloting. R continues to rotate build pieces when not piloting.
- Added a bunker door state control with locked, unlocked, and open states, plus a sliding twin-leaf blast-door visual and status indicator.
- Added engine tests for timed reload completion and bunker door state transitions.

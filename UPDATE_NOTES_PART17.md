# IRON TIDE – Part 17: Mobile Command Input Isolation

## Changes
- Added pointer-event capture isolation to the compact mobile command dock, desktop dock, and selected-unit command panel.
- HUD pointer-down, pointer-up, pointer-cancel, and click events no longer bubble into battlefield input handlers.
- Raised the mobile dock stacking order and added touch-friendly minimum button height.
- Preserved horizontal pan gestures for the unit/build/strike/order action strips.
- Added pressed-state feedback to mobile command buttons.
- Existing command callbacks and game actions remain connected; this update does not replace them with display-only controls.

## Why this should help
The game canvas handles pointer input for battlefield selection and movement. Without isolating HUD events during capture, a tap on a HUD control can also reach the canvas. Part 17 stops that propagation at the HUD boundary.

## Validation
- Source-level edits applied to the Part 16 project.
- ZIP archive integrity checked after packaging.
- Full dependency install, TypeScript check, browser gameplay test, and physical Android touchscreen test have not been run in this environment.
- No APK is included.

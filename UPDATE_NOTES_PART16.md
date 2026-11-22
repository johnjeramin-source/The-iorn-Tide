# IRON TIDE – Part 16: Mobile Command Dock Reliability

## Changes
- Pinned the compact mobile command dock above the canvas, minimap, and Android safe-area inset.
- Raised the dock stacking order so the bottom controls are not covered by other HUD layers.
- Explicitly restored pointer hit-testing on the dock and its controls while preserving horizontal swipe scrolling inside action strips.
- Added native tap behavior to dock buttons for touch devices.
- Removed the unnecessary negative tab focus setting from mobile category tabs.
- Routed Auto-Battle Assist through an App-level action that updates the world, alert, and HUD snapshot immediately.
- Kept the existing Units, Build, Strikes, Orders, deploy, placement, rotate, fog, formation, control-group, and pilot actions connected to their existing handlers.

## Validation
- Source changes applied to the Part 15 project.
- ZIP archive integrity checked after packaging.
- A full Vite/TypeScript build and physical Android touch test still need to be run in an environment with dependencies and a device/emulator.

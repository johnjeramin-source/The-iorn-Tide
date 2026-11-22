# Part 18 – Mobile Command Dock Reliability

## Changes
- Raised the compact mobile command dock to a dedicated stacking layer (`z-index: 60`) and isolated its stacking context.
- Explicitly retained pointer interaction on the dock.
- Increased compact dock button minimum height to 44 CSS pixels for easier touch targeting.
- Applied `touch-action: manipulation` to HUD controls while leaving the horizontal command strips' `pan-x` scrolling behavior intact.
- Removed negative tab indices from HUD buttons so keyboard and switch-access navigation can focus controls.
- Added visible keyboard focus outlines.

## Scope and limitations
- Existing command handlers and game logic are preserved; this update does not invent new command actions.
- This is a source update. No Android APK or device-level touch test is claimed.

# Part 21 — Unit Visual Identity Pass

## Implemented
- Added compact role markings for infantry: shoulder tabs and a distinct medic cross.
- Added stencil stripes, hatch details, and side markers to ground vehicles.
- Added flight/rescue stripes and cockpit highlights to helicopters and aircraft.
- Added a small elite chevron to elite zombie variants.
- Kept the changes in the existing Canvas renderer; no external image assets or new per-frame entity objects are required.

## Performance and compatibility
- Markings are drawn only for units already being rendered in the viewport.
- Existing low/medium/high graphics paths and low-lag behavior remain in place.
- No gameplay stats, spawn rates, AI, or combat rules were changed in Part 21.

## Validation
- The uploaded Part 20 archive passed ZIP integrity validation before editing.
- The modified renderer was written successfully.
- A Vite/TypeScript build was not run because dependencies are not installed in this workspace. Run `npm install` then `npm run build` to validate in the project environment.

This is a source-project update, not a compiled Android APK.

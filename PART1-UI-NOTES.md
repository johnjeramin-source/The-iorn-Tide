# Iron Tide — Part 1 UI Update

## Included
- Landscape touch HUD condensed to a one-row command dock with horizontally scrollable action items.
- Touch modes, fog, pilot, and formation moved to compact icon controls.
- Dock auto-hides after about four seconds and can be restored with the small bottom handle.
- Selected-unit quick-command card positioned above the dock.
- In-game player identity moved away from the right utility rail; utility rail scrolls vertically.
- Settings screen available from the title screen, pause dialog, and in-game settings icon.
- Settings persisted at `irontide_settings_v1` with safe defaults.
- Brightness, rain intensity, night visibility, graphics quality, 30 FPS battery saver, haptics, handedness, large text, colorblind contrast treatment, sound/music volume preferences, damage-number preference, and screen-shake control.
- Seven detailed avatar prompts added for avatar slots 2–8.

## Honest implementation notes
- The current project has no background music playback system; Music Volume is saved as a preference but has no active music track to control.
- The current renderer has no floating damage-number feature; Damage Numbers is saved as a preference for the later combat-feedback feature.
- Colorblind mode currently increases HUD contrast/border distinction; it is not a full color-vision palette remap.
- Sound Volume controls generated sound effects and spoken radio barks. Haptics respect the saved Haptics switch.
- No engine simulation logic was added or changed in Part 1, so `src/game/engine.test.ts` did not need new engine tests.
- `build-apk.yml` does not need changes for these UI-only updates; no native plugin or new package was added.

## Validation
- All TypeScript/TSX source files passed TypeScript transpilation syntax checks.
- `tsc --noEmit` could not complete because this checkout has no installed dependencies and the Vite/Vite-PWA type packages are missing.
- `npm run build` could not run because `vite` is not installed in this environment.

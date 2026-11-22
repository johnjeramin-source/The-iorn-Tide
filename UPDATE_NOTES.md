# IRON TIDE – Update Notes

## Included in this project update

- Corrected project documentation to identify the real stack: React, TypeScript, Vite, custom Canvas simulation, and Capacitor Android packaging.
- Added collision-aware movement steering for ground units and wall-aware movement target placement.
- Linked gate opening to active friendly exit orders from successful unit deployment; gates stay open for nearby queued units and close after they clear. Added gate movement sound cues.
- Expanded zombie roster to 12: Shambler, Sprinter, Leaper, Spitter, Riot Zombie, Brute, Crawler, Exploder, Tank, Screamer, Mutated, and Infected Marine.
- Added separate stats, spawn weighting, combat behavior, and visual details for the six new zombie classes.
- Added three modern coastal maps: Island Logistics Base, Tempest Bay, and North Ridge Relay. Existing seven maps remain available.
- Added a custom branded boot/loading screen.
- Replaced launcher icon artwork and PWA icon sizes with the custom Iron Tide naval crest. Android CI generates the launcher icon from the custom artwork.
- Set PWA orientation to landscape and updated the project metadata / README.

## Validation performed

- TypeScript core game modules passed `tsc --noEmit`.
- All TypeScript / TSX files passed syntax transpilation.
- Runtime smoke tests passed for all 10 maps, all 12 zombie classes, soldier movement, and purchase-triggered gate open/close behavior.

## Android build note

This ZIP contains the complete updated source project and Android icon-generation workflow. A compiled APK is not included because this environment did not complete dependency installation and does not have a configured Android SDK / Gradle build environment. Build the APK using the included GitHub Actions workflow or the commands in `ANDROID_BUILD.md`.


## IRON TIDE 2.0 – Advanced Warfare & Interactive Command Update

- Added a third escort vessel, the PC-17 USS Breakwater gunboat. It joins the existing naval task force and participates in player-called naval barrages.
- Added four selectable squad formations: Grid, Line, Column, and Circle. The active formation controls actual unit destination offsets when issuing orders.
- Added persistent fog of war. Friendly units, FOBs, and captured sectors reveal nearby cells; explored cells remain dimmed and unknown cells are hidden. The tactical minimap uses the same visibility state.
- Added a 20-mission campaign selector with briefings, kill/sector objectives, requisition rewards, and local progression unlocks. Free Operations remains available.
- Added campaign objective progress in the HUD and mission-completion screen.
- Added Fog and Formation controls to desktop and mobile HUDs.
- Fixed a bunker gate condition so it opens for nearby friendly ground units even if they do not yet have a movement target.
- Existing tanks, IFVs/APCs, helicopters, construction placement, defensive structures, naval bombardment, unit selection, and tactical minimap remain playable and connected to the current simulation.


## Verification

- Engine tests: 20/20 passed, including campaign completion, fog visibility, formation orders, and the existing gate behavior.
- TypeScript core engine check: passed.
- Full Vite/React production build was not run because package installation timed out in this environment; build the APK using the included Android workflow or install dependencies locally first.


## 2.1 – Illustrated Logo & Graphics Pass
- Added the provided illustrated IRON TIDE logo to the boot/loading screen and main title screen.
- Rebuilt the PWA and Android launcher icon assets from the same logo.
- Added deterministic terrain grain and concrete seam texture to the cached terrain renderer.
- Kept texture generation in the static terrain cache to avoid per-frame overhead.
- Preserved the existing React/TypeScript/Vite/Canvas architecture.

# Iron Tide UI Overhaul

This update refreshes the existing 2D tactical HUD without changing gameplay rules or economy.

## Included
- Unified dark navy tactical panels with cyan and amber accents.
- Improved top telemetry, player identity chip, and utility control styling.
- Redesigned desktop and mobile command docks.
- New unit, defense, and strike button visual states, including clear active/disabled states and touch feedback.
- Improved selected-force panel with unit-type summary and aggregate health bar.
- Updated tactical minimap frame and heading.
- Stronger keyboard focus indicators and reduced-motion support.
- Mobile-friendly touch targets and responsive spacing.

## Gameplay compatibility
- No unit limit added.
- No changes to unit costs, coin balance, deployment logic, combat, or selection logic.
- Existing button callbacks and command actions are retained.

## Validation
- TypeScript/TSX transpile syntax checked for the modified React components.
- Full Vite production build could not be run because npm dependency installation timed out in this environment.

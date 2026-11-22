# IRON TIDE — Part 7: Vehicle Field Repair

## Implemented
- Added a selected-vehicle field repair command to the selection command panel.
- Repairs are available only to damaged, living selected vehicles within the existing FOB/supply-truck service radius.
- Each repair order restores up to 30% of a vehicle's maximum HP, capped at maximum HP.
- Repair cost is charged in requisition (0.6 REQ per HP, rounded up); the operation is rejected without spending if funds are insufficient.
- Added feedback for missing selection, out-of-range vehicles, insufficient requisition, and successful repairs.
- Added regression tests for successful repair, service-range restriction, and insufficient funds.

## Scope still outstanding
- No vehicle fuel, component-specific damage, towing, or repair animations are included.
- Vehicle combat stats have not been rebalanced in this update.
- No 10,000-active-zombie or device-specific 60 FPS benchmark was performed.
- No Android APK build was performed.

## Validation
- Run `npm test` only if a test script is configured; otherwise run the focused test with `npx tsx --test src/game/repair.test.ts`.
- Run `npm run lint` and `npm run build` after installing dependencies.

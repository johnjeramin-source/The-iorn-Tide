# IRON TIDE — Part 8: Vehicle Fuel Logistics

## Implemented
- New vehicle fuel state (100-unit tank) initialized when a vehicle is created.
- Fuel consumption is based on distance travelled, not frame count.
- Vehicles stop when their fuel reaches zero and cannot continue moving under new movement orders.
- Vehicles refuel gradually while inside the existing FOB/supply-truck service radius.
- Non-vehicle units are unaffected.

## Scope and limitations
- Fuel is currently an engine-level simulation value; a dedicated fuel gauge, low-fuel warning, refuel interaction, and fuel-canister logistics UI are not included.
- No vehicle breakdown animations, component damage, towing, or combat rebalance are included.
- No 10,000-active-zombie benchmark, device-specific FPS benchmark, or Android APK build was performed.

## Validation
- Source changes were inspected, but dependencies are not installed in this environment; project typecheck, tests, and production build have not been run.
